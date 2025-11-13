import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProviderRepository');

/**
 * Repository for iptv_providers collection
 * Minimal repository - uses BaseRepository methods directly
 */
export class ProviderRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'iptv_providers',
      (doc) => doc.id
    );
  }

  /**
   * Initialize database indexes for iptv_providers collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Primary lookup (unique)
      await this.createIndexIfNotExists({ id: 1 }, { unique: true });
      logger.debug('Created index: id (unique)');

      // HIGH: Active providers with priority sort
      await this.createIndexIfNotExists({ deleted: 1, priority: 1 });
      logger.debug('Created index: deleted + priority');

      logger.info('ProviderRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findByQuery() for queries
  // - findOneByQuery() for single document
  // - insertOne() for inserts
  // - updateOne() for updates
  // - deleteOne() for deletes
}

