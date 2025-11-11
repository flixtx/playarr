import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for handling IPTV provider added events
 * Adds provider to ApplicationContext and triggers process provider titles
 * @extends {BaseJob}
 */
export class IPTVProviderAddedJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('IPTVProviderAddedJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - handle provider added events
   * @returns {Promise<{processed: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      await this.setJobStatus('running');

      // Get providers from action queue
      const providerIds = context.getAndClearProviderActionQueue('iptvProviderAdded');

      if (providerIds.size === 0) {
        this.logger.info('No providers to process');
        await this.setJobStatus('completed', {});
        return { processed: 0, errors: [] };
      }

      this.logger.info(`Processing ${providerIds.size} provider(s) added event(s)`);

      const errors = [];
      let processed = 0;

      for (const providerId of providerIds) {
        try {
          // Get provider configuration from MongoDB
          const providerConfig = await this.getProviderConfig(providerId);

          if (!providerConfig) {
            this.logger.warn(`Provider ${providerId} not found in database`);
            continue;
          }

          // Get or create provider instance
          let providerInstance = this.providers.get(providerId);
          if (providerInstance) {
            this.logger.info(`Provider ${providerId} already exists in context, updating configuration`);
            // Update existing provider configuration
            await providerInstance.updateConfiguration(providerConfig);
          } else {
            // Create new provider instance
            providerInstance = context.createProviderInstance(providerConfig);
            await providerInstance.initializeCachePolicies();
            this.providers.set(providerId, providerInstance);
            this.logger.info(`Added provider ${providerId} to ApplicationContext`);
          }

          // Trigger process provider titles if provider is enabled
          if (providerConfig.enabled) {
            await providerInstance.processProviderTitles();
          }

          processed++;
        } catch (error) {
          this.logger.error(`Error processing provider ${providerId}: ${error.message}`);
          errors.push({ providerId, error: error.message });
        }
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: processed,
        errors: errors
      });
      return { processed, errors };
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      // Set status to failed with error result
      await this.setJobStatus('failed', {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    }
  }
}

