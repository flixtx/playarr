import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TitleRepository');

/**
 * Repository for titles collection
 * Handles all operations related to main titles
 */
export class TitleRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'titles',
      (doc) => doc.title_key
    );
  }

  /**
   * Build existence query for titles
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc, options) {
    return {
      title_key: doc.title_key
    };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options
   * @returns {string|null} Key or null
   */
  buildKeyForCheck(doc, options) {
    return doc.title_key || null;
  }

  /**
   * Get document key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {string|null} Key or null
   */
  getDocumentKey(doc) {
    return doc.title_key || null;
  }

  /**
   * Build update operation
   * @protected
   * @param {Object} doc - Document to update
   * @param {Object} options - Options
   * @returns {Object} Bulk write operation
   */
  buildUpdateOperation(doc, options) {
    return {
      updateOne: {
        filter: { title_key: doc.title_key },
        update: {
          $set: {
            ...doc,
            lastUpdated: new Date()
          }
        }
      }
    };
  }

  /**
   * Initialize database indexes for titles collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Primary lookup (unique)
      await this.createIndexIfNotExists({ title_key: 1 }, { unique: true });
      logger.debug('Created index: title_key (unique)');

      // CRITICAL: Most common query pattern (type filter + alphabetical sort)
      await this.createIndexIfNotExists({ type: 1, title: 1 });
      logger.debug('Created index: type + title');

      // HIGH: Date range queries with type
      await this.createIndexIfNotExists({ type: 1, release_date: 1 });
      logger.debug('Created index: type + release_date');

      // HIGH: Text search index for full-text search
      try {
        const collection = this.db.collection(this.collectionName);
        const indexes = await collection.indexes();
        const hasTextIndex = indexes.some(idx => idx.textIndexVersion !== undefined);
        if (!hasTextIndex) {
          await collection.createIndex({ title: 'text' });
          logger.debug('Created text index: title');
        }
      } catch (error) {
        // Text index might fail if there's already a different index on title
        // This is okay, we'll use regex search instead
        logger.debug('Text index creation skipped (may already exist or conflict)');
      }

      // MEDIUM: Release date only
      await this.createIndexIfNotExists({ release_date: 1 });
      logger.debug('Created index: release_date');

      logger.info('TitleRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find titles by title_key array
   * @param {Array<string>} keys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of title documents
   */
  async findByTitleKeys(keys) {
    return await super.findByKeys(keys, 'title_key');
  }

  /**
   * Remove provider from titles.streams
   * Updates titles to remove provider from stream sources
   * @param {string} providerId - Provider ID to remove
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<{titlesUpdated: number, streamsRemoved: number}>}
   */
  async removeProviderFromStreams(providerId, titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return { titlesUpdated: 0, streamsRemoved: 0 };
    }

    const titles = await super.findByKeys(titleKeys, 'title_key');
    
    if (titles.length === 0) {
      return { titlesUpdated: 0, streamsRemoved: 0 };
    }

    let titlesUpdated = 0;
    let streamsRemoved = 0;
    const bulkOps = [];

    for (const title of titles) {
      const streamsObj = title.streams || {};
      let titleModified = false;
      const updatedStreams = { ...streamsObj };
      
      for (const [streamKey, streamValue] of Object.entries(streamsObj)) {
        if (streamValue && typeof streamValue === 'object' && Array.isArray(streamValue.sources)) {
          const originalLength = streamValue.sources.length;
          const filteredSources = streamValue.sources.filter(id => id !== providerId);
          
          if (filteredSources.length !== originalLength) {
            streamsRemoved += (originalLength - filteredSources.length);
            
            if (filteredSources.length > 0) {
              updatedStreams[streamKey] = {
                ...streamValue,
                sources: filteredSources
              };
            } else {
              updatedStreams[streamKey] = undefined;
            }
            titleModified = true;
          }
        }
      }
      
      // Remove undefined entries
      for (const key in updatedStreams) {
        if (updatedStreams[key] === undefined) {
          delete updatedStreams[key];
        }
      }
      
      if (titleModified) {
        titlesUpdated++;
        bulkOps.push({
          updateOne: {
            filter: { title_key: title.title_key },
            update: {
              $set: {
                streams: updatedStreams,
                lastUpdated: new Date()
              }
            }
          }
        });
      }
    }
    
    if (bulkOps.length > 0) {
      await this.bulkWrite(bulkOps, { batch: true, ordered: false });
    }

    return { titlesUpdated, streamsRemoved };
  }

  /**
   * Delete titles without streams
   * Checks both title_streams collection and titles.streams to ensure they're empty
   * @param {Array<string>} titleKeys - Array of title_key values to check
   * @param {Set<string>} titleKeysWithStreams - Set of title_keys that have streams (from title_streams collection)
   * @returns {Promise<number>} Number of deleted titles
   */
  async deleteWithoutStreams(titleKeys, titleKeysWithStreams) {
    if (!titleKeys || titleKeys.length === 0) {
      return 0;
    }

    // Filter out title_keys that have streams in title_streams
    const titleKeysWithoutStreams = titleKeys.filter(key => !titleKeysWithStreams.has(key));
    
    if (titleKeysWithoutStreams.length === 0) {
      return 0;
    }

    // Also check titles.streams to ensure they're empty
    const titles = await super.findByKeys(titleKeysWithoutStreams, 'title_key');
    
    const titlesToDelete = titles.filter(title => {
      const streams = title.streams || {};
      const streamEntries = Object.entries(streams);
      
      if (streamEntries.length === 0) {
        return true;
      }
      
      // Check if all stream sources are empty
      return streamEntries.every(([key, value]) => {
        if (!value || typeof value !== 'object' || !Array.isArray(value.sources)) {
          return true;
        }
        return value.sources.length === 0;
      });
    });

    if (titlesToDelete.length === 0) {
      return 0;
    }

    const titleKeysToDelete = titlesToDelete.map(t => t.title_key);
    const result = await this.deleteManyByQuery({
      title_key: { $in: titleKeysToDelete }
    });

    return result.deletedCount || 0;
  }
}

