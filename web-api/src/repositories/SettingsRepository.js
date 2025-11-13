import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SettingsRepository');

/**
 * Repository for settings collection
 * Handles application settings stored as key-value pairs
 */
export class SettingsRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'settings',
      (doc) => doc._id
    );
  }

  /**
   * Get all settings as object (legacy compatibility)
   * Converts array of documents to object format: { key: value }
   * @returns {Promise<Object>} Settings object
   */
  async getAllAsObject() {
    try {
      const docs = await this.findByQuery({});
      
      const result = {};
      for (const doc of docs) {
        result[doc._id] = doc.value;
      }
      return result;
    } catch (error) {
      logger.error(`Error getting settings as object: ${error.message}`);
      return {};
    }
  }

  /**
   * Initialize database indexes for settings collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: _id is automatically indexed by MongoDB (no need to create)
      // MEDIUM: Changed settings query
      await this.createIndexIfNotExists({ lastUpdated: 1 });
      logger.debug('Created index: lastUpdated');

      logger.info('SettingsRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get settings changed since a specific date
   * @param {Date} since - Date to check changes since
   * @returns {Promise<Array<Object>>} Array of changed setting documents
   */
  async getChangedSince(since) {
    try {
      return await this.findByQuery({ lastUpdated: { $gt: since } });
    } catch (error) {
      logger.error(`Error getting settings changed since ${since}: ${error.message}`);
      return [];
    }
  }
}

