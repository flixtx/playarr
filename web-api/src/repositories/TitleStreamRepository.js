import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TitleStreamRepository');

/**
 * Repository for title_streams collection
 * Handles all operations related to title streams
 */
export class TitleStreamRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'title_streams',
      (doc) => `${doc.title_key}|${doc.stream_id}|${doc.provider_id}`
    );
  }

  /**
   * Build existence query for title streams
   * @protected
   * @param {Object} doc - Document
   * @param {Object} options - Options
   * @returns {Object} Query object
   */
  buildExistenceQuery(doc, options) {
    return {
      title_key: doc.title_key,
      stream_id: doc.stream_id,
      provider_id: doc.provider_id
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
    if (!doc.title_key || !doc.stream_id || !doc.provider_id) {
      return null;
    }
    return `${doc.title_key}|${doc.stream_id}|${doc.provider_id}`;
  }

  /**
   * Get document key for existence check
   * @protected
   * @param {Object} doc - Document
   * @returns {boolean} Whether document has required fields
   */
  getDocumentKey(doc) {
    return !!(doc.title_key && doc.stream_id && doc.provider_id);
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
        filter: {
          title_key: doc.title_key,
          stream_id: doc.stream_id,
          provider_id: doc.provider_id
        },
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
   * Initialize database indexes for title_streams collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Primary lookup (unique compound key)
      await this.createIndexIfNotExists(
        { title_key: 1, stream_id: 1, provider_id: 1 },
        { unique: true }
      );
      logger.debug('Created index: title_key + stream_id + provider_id (unique)');

      // CRITICAL: Most common query (get streams for title)
      await this.createIndexIfNotExists({ title_key: 1, stream_id: 1 });
      logger.debug('Created index: title_key + stream_id');

      // HIGH: Get all streams for a title
      await this.createIndexIfNotExists({ title_key: 1 });
      logger.debug('Created index: title_key');

      // HIGH: Provider-based queries
      await this.createIndexIfNotExists({ provider_id: 1 });
      logger.debug('Created index: provider_id');

      // MEDIUM: Provider + title combination
      await this.createIndexIfNotExists({ provider_id: 1, title_key: 1 });
      logger.debug('Created index: provider_id + title_key');

      logger.info('TitleStreamRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find streams by title keys
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<Array<Object>>} Array of stream documents
   */
  async findByTitleKeys(titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return [];
    }
    return await this.findByQuery({ title_key: { $in: titleKeys } });
  }

  /**
   * Delete streams by provider and title keys
   * @param {string} providerId - Provider ID
   * @param {Array<string>} titleKeys - Array of title_key values
   * @returns {Promise<import('mongodb').DeleteResult>}
   */
  async deleteByProviderAndTitleKeys(providerId, titleKeys) {
    if (!titleKeys || titleKeys.length === 0) {
      return { deletedCount: 0 };
    }
    return await this.deleteManyByQuery({
      provider_id: providerId,
      title_key: { $in: titleKeys }
    });
  }

  /**
   * Save title streams (uses inherited bulkSave)
   * @param {Array<Object>} streams - Array of stream objects
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async saveTitleStreams(streams) {
    return await this.bulkSave(streams, {
      addTimestamps: true
    });
  }
}

