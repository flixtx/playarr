import { createLogger } from '../utils/logger.js';

const logger = createLogger('MongoDataService');

/**
 * MongoDB-based data service for engine
 * Provides efficient collection-based queries with bulk operations and incremental updates
 */
export class MongoDataService {
  /**
   * @param {import('../utils/mongo-client.js').default} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    this.client = mongoClient;
    this.db = mongoClient.getDatabase();
    this.batchSize = 1000; // Batch size for bulk operations
    this.existenceCheckBatchSize = 1000; // Batch size for existence checks (MongoDB $or limit)
  }

  /**
   * Check existence of documents in batches using $or queries
   * @private
   * @param {import('mongodb').Collection} collection - MongoDB collection
   * @param {Array<Object>} queries - Array of query objects to check
   * @param {Function} keyBuilder - Function to build unique key from query: (query) => string
   * @returns {Promise<Set<string>>} Set of existing keys
   */
  async _checkExistenceBatch(collection, queries, keyBuilder) {
    const existingSet = new Set();
    
    if (queries.length === 0) {
      return existingSet;
    }

    // MongoDB $or has practical limits, so batch the queries
    for (let i = 0; i < queries.length; i += this.existenceCheckBatchSize) {
      const batch = queries.slice(i, i + this.existenceCheckBatchSize);
      
      const existing = await collection.find(
        { $or: batch },
        { projection: { _id: 0 } } // Only return fields needed for key building
      ).toArray();

      for (const doc of existing) {
        const key = keyBuilder(doc);
        if (key) {
          existingSet.add(key);
        }
      }
    }

    return existingSet;
  }

  /**
   * Extract category IDs from category keys
   * @private
   * @param {Array<string>} categoryKeys - Array of category keys (e.g., ["movies-1", "tvshows-5"])
   * @returns {Array<number>} Array of category IDs (integers), filtered to remove invalid values
   */
  _extractCategoryIdsFromKeys(categoryKeys) {
    if (!categoryKeys || categoryKeys.length === 0) {
      return [];
    }

    return categoryKeys
      .map(key => {
        const parts = key.split('-');
        return parts.length > 1 ? parseInt(parts[1]) : null;
      })
      .filter(id => id !== null && !isNaN(id));
  }

  /**
   * Convert array of documents to key-value object
   * @private
   * @param {Array<Object>} docs - Array of documents with _id and value fields
   * @returns {Object} Object with _id as keys and value as values
   */
  _convertDocsToKeyValueObject(docs) {
    const result = {};
    for (const doc of docs) {
      result[doc._id] = doc.value;
    }
    return result;
  }

  /**
   * Execute bulk insert and update operations in batches
   * @private
   * @param {import('mongodb').Collection} collection - MongoDB collection
   * @param {Array<Object>} toInsert - Array of documents to insert
   * @param {Array<Object>} toUpdate - Array of bulk write operations for updates
   * @returns {Promise<{inserted: number, updated: number}>} Count of inserted and updated documents
   */
  async _executeBulkOperations(collection, toInsert, toUpdate) {
    let inserted = 0;
    let updated = 0;

    // Bulk insert in batches
    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += this.batchSize) {
        const batch = toInsert.slice(i, i + this.batchSize);
        const result = await collection.insertMany(batch, { ordered: false });
        inserted += result.insertedCount;
      }
    }

    // Bulk update in batches
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += this.batchSize) {
        const batch = toUpdate.slice(i, i + this.batchSize);
        const result = await collection.bulkWrite(batch, { ordered: false });
        updated += result.modifiedCount;
      }
    }

    return { inserted, updated };
  }

  /**
   * Remove provider IDs from title stream sources using MongoDB aggregation pipeline
   * More efficient: performs all filtering and updates directly in the database
   * @private
   * @param {string|Array<string>|Set<string>} providerIds - Provider ID(s) to remove (single string, array, or Set)
   * @param {import('mongodb').Collection} collection - MongoDB collection for titles
   * @param {Array<string>} [titleKeys=null] - Optional: only update these title_keys (for efficiency)
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number}>} Results
   */
  async _removeProvidersFromTitleStreams(providerIds, collection, titleKeys = null) {
    // Normalize providerIds to array
    const providerIdsArray = providerIds instanceof Set
      ? Array.from(providerIds)
      : Array.isArray(providerIds)
      ? providerIds
      : [providerIds];

    if (providerIdsArray.length === 0) {
      return { titlesUpdated: 0, streamsRemoved: 0 };
    }

    // Build query filter - only update titles that have streams
    const queryFilter = {
      streams: { $exists: true, $ne: {} }
    };

    // If titleKeys provided, only update those specific titles
    if (titleKeys && titleKeys.length > 0) {
      queryFilter.title_key = { $in: titleKeys };
    }

    // Use MongoDB aggregation pipeline update
    const result = await collection.updateMany(
      queryFilter,
      [
        {
          $set: {
            streams: {
              $arrayToObject: {
                $map: {
                  input: {
                    $filter: {
                      input: { $objectToArray: "$streams" },
                      as: "stream",
                      cond: {
                        $and: [
                          { $isArray: "$$stream.v.sources" },
                          {
                            $gt: [
                              {
                                $size: {
                                  $filter: {
                                    input: "$$stream.v.sources",
                                    as: "src",
                                    cond: { $not: { $in: ["$$src", providerIdsArray] } }
                                  }
                                }
                              },
                              0
                            ]
                          }
                        ]
                      }
                    }
                  },
                  as: "stream",
                  in: {
                    k: "$$stream.k",
                    v: {
                      $mergeObjects: [
                        "$$stream.v",
                        {
                          sources: {
                            $filter: {
                              input: "$$stream.v.sources",
                              as: "src",
                              cond: { $not: { $in: ["$$src", providerIdsArray] } }
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            },
            lastUpdated: new Date()
          }
        }
      ]
    );

    // Note: streamsRemoved count would require a separate aggregation to calculate exactly
    // For now, return modifiedCount as titlesUpdated
    // The actual streamsRemoved is tracked separately via title_streams deletion
    return {
      titlesUpdated: result.modifiedCount || 0,
      streamsRemoved: 0 // Calculated separately in calling methods via title_streams deletion
    };
  }

  /**
   * Get provider titles from MongoDB
   * @param {string} providerId - Provider identifier
   * @param {Object} [options={}] - Query options
   * @param {Date} [options.since] - Only get titles updated since this date
   * @param {string} [options.type] - Filter by type ('movies' or 'tvshows')
   * @param {boolean} [options.ignored] - Filter by ignored status
   * @returns {Promise<Array<Object>>} Array of provider title documents
   */
  async getProviderTitles(providerId, options = {}) {
    const query = { provider_id: providerId };
    
    // Incremental: only get titles updated since last execution
    if (options.since) {
      query.lastUpdated = { $gt: options.since };
    }
    
    // Filter by type if specified
    if (options.type) {
      query.type = options.type;
    }
    
    // Filter ignored if specified
    if (options.ignored !== undefined) {
      query.ignored = options.ignored;
    }
    
    return await this.db.collection('provider_titles')
      .find(query)
      .toArray();
  }

  /**
   * Save provider titles with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000 to reduce database load
   * @param {string} providerId - Provider identifier
   * @param {Array<Object>} titles - Array of title objects to save (accumulated since last save)
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderTitles(providerId, titles) {
    if (!titles || titles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('provider_titles');
    const now = new Date();
    
    // Build queries to check existence (using title_key as unique identifier)
    const existenceQueries = titles
      .filter(t => t.title_key)
      .map(t => ({
        provider_id: providerId,
        title_key: t.title_key
      }));

    // Get existing documents in batches to check existence and compare TMDB IDs
    const existingKeys = new Set();
    const existingDocs = new Map();
    
    if (existenceQueries.length > 0) {
      // Fetch existing documents in batches (more efficient than checking existence separately)
      for (let i = 0; i < existenceQueries.length; i += this.existenceCheckBatchSize) {
        const batch = existenceQueries.slice(i, i + this.existenceCheckBatchSize);
        const docs = await collection.find(
          { $or: batch },
          { projection: { _id: 0, provider_id: 1, title_key: 1, tmdb_id: 1 } } // Only fetch fields we need
        ).toArray();
        
        for (const doc of docs) {
          const key = `${doc.provider_id}|${doc.title_key}`;
          existingKeys.add(key);
          existingDocs.set(key, doc);
        }
      }
    }

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const title of titles) {
      if (!title.title_key) continue;

      const key = `${providerId}|${title.title_key}`;
      const titleDoc = {
        ...title,
        provider_id: providerId,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // If title reached saveProviderTitles, it was detected as changed or new
        // Always update lastUpdated to ensure ProviderTitlesMonitorJob picks it up
        // This handles cases where new episodes/streams were added but TMDB ID didn't change
        toUpdate.push({
          updateOne: {
            filter: { 
              provider_id: providerId,
              title_key: title.title_key 
            },
            update: {
              $set: {
                ...title,
                provider_id: providerId,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(titleDoc);
      }
    }

    return await this._executeBulkOperations(collection, toInsert, toUpdate);
  }

  /**
   * Reset lastUpdated timestamp for all provider titles of a provider
   * Used when provider is re-enabled to ensure all titles are reprocessed by ProviderTitlesMonitorJob
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of titles updated
   */
  async resetProviderTitlesLastUpdated(providerId) {
    try {
      const now = new Date();
      const result = await this.db.collection('provider_titles')
        .updateMany(
          { provider_id: providerId },
          { $set: { lastUpdated: now } }
        );
      return result.modifiedCount || 0;
    } catch (error) {
      logger.error(`Error resetting provider titles lastUpdated for ${providerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get main titles from MongoDB
   * @param {Object} [query={}] - MongoDB query object
   * @returns {Promise<Array<Object>>} Array of main title documents
   */
  async getMainTitles(query = {}) {
    return await this.db.collection('titles')
      .find(query)
      .toArray();
  }

  /**
   * Get main titles by title_key array (efficient lookup)
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of main title documents
   */
  async getMainTitlesByKeys(titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return [];
    }
    
    return await this.db.collection('titles')
      .find({ title_key: { $in: titleKeys } })
      .toArray();
  }

  /**
   * Save main titles with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000
   * @param {Array<Object>} titles - Array of main title objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveMainTitles(titles) {
    if (!titles || titles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('titles');
    const now = new Date();
    
    // Build queries to check existence (using title_key as unique identifier)
    const existenceQueries = titles
      .filter(t => t.title_key)
      .map(t => ({
        title_key: t.title_key
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => doc.title_key
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const title of titles) {
      if (!title.title_key) continue;

      const titleDoc = {
        ...title,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(title.title_key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: { title_key: title.title_key },
            update: {
              $set: {
                ...title,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(titleDoc);
      }
    }

    return await this._executeBulkOperations(collection, toInsert, toUpdate);
  }

  /**
   * Save title streams with optimized bulk operations
   * Called periodically (every 30 seconds) or at end of process
   * Internally batches operations into chunks of 1000
   * @param {Array<Object>} streams - Array of stream objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveTitleStreams(streams) {
    if (!streams || streams.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('title_streams');
    const now = new Date();
    
    // Build queries to check existence (compound key: title_key + stream_id + provider_id)
    const existenceQueries = streams
      .filter(s => s.title_key && s.stream_id && s.provider_id)
      .map(s => ({
        title_key: s.title_key,
        stream_id: s.stream_id,
        provider_id: s.provider_id
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => `${doc.title_key}|${doc.stream_id}|${doc.provider_id}`
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const stream of streams) {
      if (!stream.title_key || !stream.stream_id || !stream.provider_id) {
        continue;
      }

      const key = `${stream.title_key}|${stream.stream_id}|${stream.provider_id}`;
      const streamDoc = {
        ...stream,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: {
              title_key: stream.title_key,
              stream_id: stream.stream_id,
              provider_id: stream.provider_id
            },
            update: {
              $set: {
                ...stream,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(streamDoc);
      }
    }

    return await this._executeBulkOperations(collection, toInsert, toUpdate);
  }

  /**
   * Get provider categories from MongoDB
   * @param {string} providerId - Provider identifier
   * @param {string} [type=null] - Filter by type ('movies' or 'tvshows')
   * @returns {Promise<Array<Object>>} Array of category documents
   */
  async getProviderCategories(providerId, type = null) {
    const query = { provider_id: providerId };
    if (type) {
      query.type = type;
    }
    return await this.db.collection('provider_categories')
      .find(query)
      .toArray();
  }

  /**
   * Save provider categories with optimized bulk operations
   * @param {string} providerId - Provider identifier
   * @param {Array<Object>} categories - Array of category objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderCategories(providerId, categories) {
    if (!categories || categories.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const collection = this.db.collection('provider_categories');
    const now = new Date();
    
    // Build queries to check existence (using category_key as unique identifier)
    // category_key format: "{type}-{category_id}"
    const existenceQueries = categories
      .filter(c => c.category_key || (c.type && c.category_id !== undefined))
      .map(c => ({
        provider_id: providerId,
        category_key: c.category_key || `${c.type}-${c.category_id}`
      }));

    // Check existence in batches
    const existingKeys = await this._checkExistenceBatch(
      collection,
      existenceQueries,
      (doc) => `${doc.provider_id}|${doc.category_key}`
    );

    // Separate into inserts and updates
    const toInsert = [];
    const toUpdate = [];

    for (const category of categories) {
      const categoryKey = category.category_key || 
        (category.type && category.category_id !== undefined 
          ? `${category.type}-${category.category_id}` 
          : null);
      
      if (!categoryKey) continue;

      const key = `${providerId}|${categoryKey}`;
      const categoryDoc = {
        ...category,
        provider_id: providerId,
        category_key: categoryKey,
        createdAt: now,
        lastUpdated: now
      };

      if (existingKeys.has(key)) {
        // Update existing
        toUpdate.push({
          updateOne: {
            filter: { 
              provider_id: providerId,
              category_key: categoryKey
            },
            update: {
              $set: {
                ...category,
                provider_id: providerId,
                category_key: categoryKey,
                lastUpdated: now
              }
            }
          }
        });
      } else {
        // Insert new
        toInsert.push(categoryDoc);
      }
    }

    return await this._executeBulkOperations(collection, toInsert, toUpdate);
  }

  /**
   * Get all IPTV providers from MongoDB (non-deleted only)
   * @returns {Promise<Array<Object>>} Array of all non-deleted provider documents, sorted by priority
   */
  async getAllIPTVProviders() {
    return await this.db.collection('iptv_providers')
      .find({ deleted: { $ne: true } })
      .sort({ priority: 1 })
      .toArray();
  }

  /**
   * Get provider configuration by ID
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object|null>} Provider configuration document or null if not found
   */
  async getProviderConfig(providerId) {
    try {
      const providerConfig = await this.db.collection('iptv_providers')
        .findOne({ id: providerId, deleted: { $ne: true } });
      return providerConfig;
    } catch (error) {
      logger.error(`Error getting provider config for ${providerId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get job history from MongoDB
   * @param {string} jobName - Job name (e.g., "SyncIPTVProviderTitlesJob")
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @returns {Promise<Object|null>} Job history document or null if not found
   */
  async getJobHistory(jobName, providerId = null) {
    const query = { job_name: jobName };
    if (providerId) {
      query.provider_id = providerId;
    }
    
    return await this.db.collection('job_history')
      .findOne(query);
  }

  /**
   * Update job status in MongoDB
   * If result is provided, also updates job history in the same operation
   * @param {string} jobName - Job name (e.g., "SyncIPTVProviderTitlesJob")
   * @param {string} status - Job status: "running" | "cancelled" | "completed" | "failed"
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @param {Object|null} [result=null] - Optional execution result object (if provided, updates both status and history)
   * @returns {Promise<void>}
   */
  async updateJobStatus(jobName, status, providerId = null, result = null) {
    const collection = this.db.collection('job_history');
    const now = new Date();
    
    const filter = {
      job_name: jobName,
      ...(providerId && { provider_id: providerId })
    };
    
    // Start with base update object for status only
    const update = {
      $set: {
        status: status,
        lastUpdated: now
      },
      $setOnInsert: {
        createdAt: now
      }
    };
    
    // Modify update object if result is provided
    if (result !== null) {
      const { last_provider_check, last_settings_check, last_policy_check, ...resultData } = result;
      
      update.$set.last_result = resultData;
      update.$inc = { execution_count: 1 };
      
      if (last_provider_check !== undefined) {
        update.$set.last_provider_check = last_provider_check;
      }
      if (last_settings_check !== undefined) {
        update.$set.last_settings_check = last_settings_check;
      }
      if (last_policy_check !== undefined) {
        update.$set.last_policy_check = last_policy_check;
      }
      
      if (!result.error) {
        update.$set.last_execution = now;
      }
    } else {
      // Only set execution_count to 0 on insert when result is null
      update.$setOnInsert.execution_count = 0;
    }
    
    await collection.updateOne(filter, update, { upsert: true });
  }

  /**
   * Reset all in-progress jobs to cancelled status
   * Called on engine startup to handle jobs that were interrupted by a crash/restart
   * @returns {Promise<number>} Number of jobs reset
   */
  async resetInProgressJobs() {
    const collection = this.db.collection('job_history');
    const now = new Date();
    
    const result = await collection.updateMany(
      { status: 'running' },
      {
        $set: {
          status: 'cancelled',
          lastUpdated: now
        }
      }
    );
    
    return result.modifiedCount;
  }


  /**
   * Get all cache policies from MongoDB as an object
   * @returns {Promise<Object>} Cache policy object with key-value pairs
   */
  async getCachePolicies() {
    try {
      const docs = await this.db.collection('cache_policy')
        .find({})
        .toArray();
      
      return this._convertDocsToKeyValueObject(docs);
    } catch (error) {
      logger.error(`Error getting cache policies: ${error.message}`);
      return {};
    }
  }

  /**
   * Extract provider_id from policy key
   * @private
   * @param {string} policyKey - Cache path key (e.g., "agtv/categories", "tmdb/search/movie")
   * @returns {string|null} Provider ID or null if global policy
   */
  _extractProviderIdFromPolicyKey(policyKey) {
    if (!policyKey || typeof policyKey !== 'string') {
      return null;
    }
    
    // Check if it starts with known provider prefixes
    if (policyKey.startsWith('tmdb/')) {
      return 'tmdb';
    }
    
    // Extract first part before first slash (e.g., "agtv/categories" -> "agtv")
    const parts = policyKey.split('/');
    if (parts.length > 0 && parts[0]) {
      // Check if it's a valid provider ID (not a generic path like "search")
      const firstPart = parts[0];
      // Common provider types: agtv, xtream, or any custom provider ID
      // If it doesn't look like a generic path, assume it's a provider ID
      if (firstPart !== 'search' && firstPart !== 'find' && firstPart !== 'movie' && firstPart !== 'tv') {
        return firstPart;
      }
    }
    
    return null;
  }

  /**
   * Update cache policy in MongoDB
   * @param {string} policyKey - Cache path key (e.g., "tmdb/search/movie", "agtv/categories")
   * @param {number|null} ttlHours - TTL in hours (null for Infinity)
   * @param {string|null} [providerId=null] - Optional provider ID. If not provided, will be extracted from policyKey
   * @returns {Promise<void>}
   */
  async updateCachePolicy(policyKey, ttlHours, providerId = null) {
    const now = new Date();
    
    // Extract provider_id from policyKey if not provided
    const extractedProviderId = providerId !== null ? providerId : this._extractProviderIdFromPolicyKey(policyKey);
    
    await this.db.collection('cache_policy').updateOne(
      { _id: policyKey },
      {
        $set: {
          value: ttlHours,
          provider_id: extractedProviderId,
          lastUpdated: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );
  }

  /**
   * Get all settings from MongoDB as an object
   * @returns {Promise<Object>} Settings object with key-value pairs
   */
  async getSettings() {
    try {
      const docs = await this.db.collection('settings')
        .find({})
        .toArray();
      
      return this._convertDocsToKeyValueObject(docs);
    } catch (error) {
      logger.error(`Error getting settings: ${error.message}`);
      return {};
    }
  }



  /**
   * Get settings changed since a specific date
   * @param {Date} since - Date to check changes since
   * @returns {Promise<Array<Object>>} Array of changed setting documents
   */
  async getSettingsChangedSince(since) {
    try {
      return await this.db.collection('settings')
        .find({ lastUpdated: { $gt: since } })
        .toArray();
    } catch (error) {
      logger.error(`Error getting settings changed since ${since}: ${error.message}`);
      return [];
    }
  }

  /**
   * Purge cache files for a provider
   * Note: This removes cache policies, actual cache files are managed by StorageManager
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of deleted cache policies
   */
  async purgeProviderCache(providerId) {
    try {
      // Delete cache policies for this provider
      const result = await this.db.collection('cache_policy')
        .deleteMany({ provider_id: providerId });
      return result.deletedCount || 0;
    } catch (error) {
      logger.error(`Error purging cache for provider ${providerId}: ${error.message}`);
      throw error;
    }
  }

}

