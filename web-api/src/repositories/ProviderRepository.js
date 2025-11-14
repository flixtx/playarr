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
   * Get index definitions for iptv_providers collection
   * @returns {Array<Object>} Array of index definitions
   */
  getIndexDefinitions() {
    return [
      {
        key: { id: 1 },
        options: { unique: true },
        duplicateKey: { id: 1 },
        description: 'Primary lookup (unique)'
      },
      {
        key: { deleted: 1, priority: 1 },
        options: {},
        description: 'Active providers with priority sort'
      }
    ];
  }
  
  // No wrapper methods needed - use inherited methods directly:
  // - findByQuery() for queries
  // - findOneByQuery() for single document
  // - insertOne() for inserts
  // - updateOne() for updates
  // - deleteOne() for deletes
}

