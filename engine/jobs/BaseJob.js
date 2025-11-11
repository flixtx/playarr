import { createLogger } from '../utils/logger.js';

/**
 * Base class for all jobs in the engine
 * Provides common functionality: cache, providers, TMDB provider, and logger
 * @abstract
 */
export class BaseJob {
  /**
   * @param {string} jobName - Name identifier for this job (used in logging)
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(jobName, cache, mongoData, providers, tmdbProvider) {
    if (this.constructor === BaseJob) {
      throw new Error('BaseJob is an abstract class and cannot be instantiated directly');
    }

    this.jobName = jobName;
    this.cache = cache;
    this.mongoData = mongoData;
    this.providers = providers; // Map<string, BaseIPTVProvider>
    this.tmdbProvider = tmdbProvider;
    this.logger = createLogger(jobName);
  }

  /**
   * Execute the job
   * Must be implemented by subclasses
   * @abstract
   * @returns {Promise<any>} Job execution result
   */
  async execute() {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate that required dependencies are available
   * @protected
   * @throws {Error} If required dependencies are missing
   */
  _validateDependencies() {
    if (!this.cache) {
      throw new Error('Cache storage manager is required');
    }
    if (!this.mongoData) {
      throw new Error('MongoDB data service is required');
    }
    if (!this.providers || this.providers.size === 0) {
      throw new Error('At least one IPTV provider is required');
    }
    if (!this.tmdbProvider) {
      throw new Error('TMDB provider is required');
    }
  }

  /**
   * Get provider configuration from MongoDB
   * @param {string} providerId - Provider ID
   * @returns {Promise<Object|null>} Provider configuration document or null if not found
   */
  async getProviderConfig(providerId) {
    try {
      const providerConfig = await this.mongoData.db.collection('iptv_providers')
        .findOne({ id: providerId, deleted: { $ne: true } });
      return providerConfig;
    } catch (error) {
      this.logger.error(`Error getting provider config for ${providerId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get last execution time from job history
   * @param {Object} [options] - Options for getting last execution
   * @param {Date|null} [options.fallbackDate] - Fallback date if no execution found (null means no fallback)
   * @param {string} [options.logMessage] - Log message template with {date} placeholder
   * @param {string} [options.noExecutionMessage] - Message to log when no execution found
   * @returns {Promise<Date|null>} Last execution date or fallback date or null
   */
  async getLastExecution(options = {}) {
    const { fallbackDate = null, logMessage, noExecutionMessage } = options;
    
    try {
      const jobHistory = await this.mongoData.getJobHistory(this.jobName);
      if (jobHistory && jobHistory.last_execution) {
        const lastExecution = new Date(jobHistory.last_execution);
        if (logMessage) {
          this.logger.info(logMessage.replace('{date}', lastExecution.toISOString()));
        }
        return lastExecution;
      } else {
        if (noExecutionMessage) {
          this.logger.info(noExecutionMessage);
        }
        return fallbackDate;
      }
    } catch (error) {
      this.logger.error(`Error getting last execution: ${error.message}`);
      return fallbackDate;
    }
  }

  /**
   * Update job status in MongoDB
   * If result is provided, also updates job history in the same operation
   * @param {string} status - Job status: "running" | "cancelled" | "completed" | "failed"
   * @param {Object|null} [result=null] - Optional execution result object (if provided, updates both status and history)
   * @param {string} [providerId=null] - Optional provider ID for provider-specific jobs
   * @returns {Promise<void>}
   */
  async setJobStatus(status, result = null, providerId = null) {
    await this.mongoData.updateJobStatus(this.jobName, status, providerId, result);
  }
}

