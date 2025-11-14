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
   * Get index definitions for users collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { username: 1 },
        options: { unique: true },
        duplicateKey: { username: 1 },
        description: 'Authentication (unique)'
      },
      {
        key: { api_key: 1 },
        options: { unique: true, sparse: true },
        duplicateKey: { api_key: 1 },
        description: 'API key authentication (unique, sparse)'
      }
    ];
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findOneByQuery({ username }) for get by username
  // - findOneByQuery({ api_key }) for get by API key
  // - findByQuery({}) for get all
  // - insertOne() for creates
  // - updateOne() for updates
  // - deleteOne() for deletes
}

