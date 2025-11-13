import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProviderTitleRepository');

/**
 * Repository for provider_titles collection
 * Handles all operations related to provider-specific titles
 */
export class ProviderTitleRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'provider_titles',
      (doc) => `${doc.provider_id}|${doc.title_key}`
    );
  }

  /**
   * Build existence query for provider titles
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options with providerId
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc, options) {
    return {
      provider_id: options.providerId,
      title_key: doc.title_key
    };
  }

  /**
   * Build key for existence check
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options with providerId
   * @returns {string} Key string
   */
  buildKeyForCheck(doc, options) {
    if (!doc.title_key || !options.providerId) {
      return null;
    }
    return `${options.providerId}|${doc.title_key}`;
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
   * @param {Object} options - Options with providerId
   * @returns {Object} Bulk write operation
   */
  buildUpdateOperation(doc, options) {
    return {
      updateOne: {
        filter: {
          provider_id: options.providerId,
          title_key: doc.title_key
        },
        update: {
          $set: {
            ...doc,
            provider_id: options.providerId,
            lastUpdated: new Date()
          }
        }
      }
    };
  }

  /**
   * Save provider titles (uses inherited bulkSave)
   * @param {string} providerId - Provider ID
   * @param {Array<Object>} titles - Array of title objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveProviderTitles(providerId, titles) {
    return await this.bulkSave(titles, {
      providerId,
      addTimestamps: true,
      existenceOptions: {
        projection: { _id: 0, provider_id: 1, title_key: 1, tmdb_id: 1 }
      }
    });
  }

  /**
   * Initialize database indexes for provider_titles collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Primary lookup (unique compound key)
      await this.createIndexIfNotExists({ provider_id: 1, title_key: 1 }, { unique: true });
      logger.debug('Created index: provider_id + title_key (unique)');

      // CRITICAL: Most common query pattern
      await this.createIndexIfNotExists({ provider_id: 1, type: 1 });
      logger.debug('Created index: provider_id + type');

      // HIGH: Ignored titles filtering
      await this.createIndexIfNotExists({ provider_id: 1, ignored: 1 });
      logger.debug('Created index: provider_id + ignored');

      // HIGH: Incremental sync queries
      await this.createIndexIfNotExists({ provider_id: 1, lastUpdated: 1 });
      logger.debug('Created index: provider_id + lastUpdated');

      // MEDIUM: Find all providers for a title
      await this.createIndexIfNotExists({ title_key: 1 });
      logger.debug('Created index: title_key');

      logger.info('ProviderTitleRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get provider titles with filters
   * @param {string} providerId - Provider ID
   * @param {Object} [options={}] - Query options
   * @param {Date} [options.since] - Only get titles updated since this date
   * @param {string} [options.type] - Filter by type ('movies' or 'tvshows')
   * @param {boolean} [options.ignored] - Filter by ignored status
   * @returns {Promise<Array<Object>>} Array of provider title documents
   */
  async getProviderTitles(providerId, options = {}) {
    const query = { provider_id: providerId };
    
    if (options.since) {
      query.lastUpdated = { $gt: options.since };
    }
    
    if (options.type) {
      query.type = options.type;
    }
    
    if (options.ignored !== undefined) {
      query.ignored = options.ignored;
    }
    
    return await this.findByQuery(query);
  }

  /**
   * Reset lastUpdated for all provider titles
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of titles updated
   */
  async resetLastUpdated(providerId) {
    const result = await this.updateManyByQuery(
      { provider_id: providerId },
      { $set: { lastUpdated: new Date() } }
    );
    return result.modifiedCount || 0;
  }

  /**
   * Delete all provider titles for a provider
   * @param {string} providerId - Provider ID
   * @returns {Promise<number>} Number of documents deleted
   */
  async deleteByProvider(providerId) {
    const result = await this.deleteManyByQuery({ provider_id: providerId });
    return result.deletedCount || 0;
  }
}

