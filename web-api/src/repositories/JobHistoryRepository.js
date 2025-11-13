import { BaseRepository } from './BaseRepository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('JobHistoryRepository');

/**
 * Repository for job_history collection
 * Handles job execution history and status tracking
 */
export class JobHistoryRepository extends BaseRepository {
  /**
   * @param {import('mongodb').MongoClient} mongoClient - MongoDB client instance
   */
  constructor(mongoClient) {
    super(
      mongoClient,
      'job_history',
      (doc) => `${doc.job_name}|${doc.provider_id || ''}`
    );
  }

  /**
   * Update job status with optional result
   * Encapsulates complex update logic with upsert
   * @param {string} jobName - Job name
   * @param {string} status - Job status: "running" | "cancelled" | "completed" | "failed"
   * @param {string} [providerId=null] - Optional provider ID
   * @param {Object|null} [result=null] - Optional execution result
   * @returns {Promise<void>}
   */
  async updateStatus(jobName, status, providerId = null, result = null) {
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
    
    await this.updateOne(filter, update, { upsert: true });
  }

  /**
   * Initialize database indexes for job_history collection
   * Creates all required indexes if they don't exist
   * @returns {Promise<void>}
   */
  async initializeIndexes() {
    try {
      // CRITICAL: Primary lookup
      await this.createIndexIfNotExists({ job_name: 1 });
      logger.debug('Created index: job_name');

      // HIGH: Provider-specific jobs
      await this.createIndexIfNotExists({ job_name: 1, provider_id: 1 });
      logger.debug('Created index: job_name + provider_id');

      // HIGH: Status queries (startup reset)
      await this.createIndexIfNotExists({ status: 1 });
      logger.debug('Created index: status');

      logger.info('JobHistoryRepository indexes initialized');
    } catch (error) {
      logger.error(`Error initializing indexes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reset all in-progress jobs to cancelled status
   * Called on startup to handle jobs that were interrupted by a crash/restart
   * @returns {Promise<number>} Number of jobs reset
   */
  async resetInProgress() {
    const now = new Date();
    
    const result = await this.updateManyByQuery(
      { status: 'running' },
      {
        $set: {
          status: 'cancelled',
          lastUpdated: now
        }
      }
    );
    
    return result.modifiedCount || 0;
  }
}

