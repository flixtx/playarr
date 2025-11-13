import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UserRepository');

/**
 * Repository for users collection
 * Minimal repository - uses BaseRepository methods directly
 */
export class UserRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'users',
      (doc) => doc.username
    );
  }

  /**
   * Initialize database indexes for users collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Authentication (unique)
      await this.createIndexIfNotExists({ username: 1 }, { unique: true });
      logger.debug('Created index: username (unique)');

      // HIGH: API key authentication
      await this.createIndexIfNotExists({ api_key: 1 }, { unique: true, sparse: true });
      logger.debug('Created index: api_key (unique, sparse)');

      logger.info('UserRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findOneByQuery({ username }) for get by username
  // - findOneByQuery({ api_key }) for get by API key
  // - findByQuery({}) for get all
  // - insertOne() for creates
  // - updateOne() for updates
  // - deleteOne() for deletes
}

