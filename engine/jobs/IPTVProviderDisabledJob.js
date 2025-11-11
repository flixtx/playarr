import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for handling IPTV provider disabled events
 * Updates ApplicationContext config, deletes title streams, removes provider from sources, deletes titles without sources
 * @extends {BaseJob}
 */
export class IPTVProviderDisabledJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('IPTVProviderDisabledJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - handle provider disabled events
   * @returns {Promise<{processed: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      await this.setJobStatus('running');

      // Get providers from action queue
      const providerIds = context.getAndClearProviderActionQueue('iptvProviderDisabled');

      if (providerIds.size === 0) {
        this.logger.info('No providers to process');
        await this.setJobStatus('completed', {});
        return { processed: 0, errors: [] };
      }

      this.logger.info(`Processing ${providerIds.size} provider(s) disabled event(s)`);

      const errors = [];
      let processed = 0;
      const processedProviderIds = [];

      for (const providerId of providerIds) {
        try {
          this.logger.info(`Processing disable for provider ${providerId}`);

          // Get provider configuration
          const providerConfig = await this.getProviderConfig(providerId);

          if (!providerConfig) {
            this.logger.warn(`Provider ${providerId} not found in database`);
            continue;
          }

          // Get or create provider instance
          let providerInstance = this.providers.get(providerId);
          if (!providerInstance) {
            // Create instance if it doesn't exist
            providerInstance = context.createProviderInstance(providerConfig);
            await providerInstance.initializeCachePolicies();
            this.providers.set(providerId, providerInstance);
            this.logger.info(`Created provider instance for ${providerId}`);
          }

          // 1. Update provider configuration
          await providerInstance.updateConfiguration(providerConfig);

          processedProviderIds.push(providerId);
          processed++;
        } catch (error) {
          this.logger.error(`Error processing provider ${providerId}: ${error.message}`);
          errors.push({ providerId, error: error.message });
        }
      }

      // Batch operations: run once after all providers are processed
      if (processedProviderIds.length > 0) {
        try {
          // 2. Delete all title streams for processed providers (batch operation through TMDBProvider)
          const deletedStreams = await this.tmdbProvider.deleteTitleStreams(processedProviderIds);
          this.logger.info(`Deleted ${deletedStreams} title streams for ${processedProviderIds.length} provider(s)`);

          // 3. Remove all processed providers from title sources (batch operation through TMDBProvider)
          const { titlesUpdated, streamsRemoved } = await this.tmdbProvider.removeProvidersFromTitleSources(processedProviderIds);
          this.logger.info(`Removed ${processedProviderIds.length} provider(s) from ${titlesUpdated} titles, ${streamsRemoved} streams removed`);

          // 4. Delete titles without sources (batch operation through TMDBProvider)
          const deletedTitlesWithoutSources = await this.tmdbProvider.deleteTitlesWithoutSources(processedProviderIds);
          this.logger.info(`Deleted ${deletedTitlesWithoutSources} titles without sources`);
        } catch (error) {
          this.logger.error(`Error in batch operations: ${error.message}`);
          // Don't fail the entire job, but log the error
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

