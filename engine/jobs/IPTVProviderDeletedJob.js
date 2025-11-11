import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for handling IPTV provider deleted events
 * Deletes provider titles, title streams, removes provider from sources, deletes titles without sources, removes cache, and removes from ApplicationContext
 * @extends {BaseJob}
 */
export class IPTVProviderDeletedJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('IPTVProviderDeletedJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - handle provider deleted events
   * @returns {Promise<{processed: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      await this.setJobStatus('running');

      // Get providers from action queue
      const providerIds = context.getAndClearProviderActionQueue('iptvProviderDeleted');

      if (providerIds.size === 0) {
        this.logger.info('No providers to process');
        await this.setJobStatus('completed', {});
        return { processed: 0, errors: [] };
      }

      this.logger.info(`Processing ${providerIds.size} provider(s) deleted event(s)`);

      const errors = [];
      let processed = 0;
      const processedProviderIds = [];

      for (const providerId of providerIds) {
        try {
          this.logger.info(`Processing deletion for provider ${providerId}`);

          // Get provider instance
          const providerInstance = this.providers.get(providerId);

          if (providerInstance) {
            // 1. Delete provider titles using provider instance
            await providerInstance.deleteAllTitles();

            // 2. Cleanup cache files using provider instance
            await providerInstance.cleanup();

            // 3. Delete cache policies using provider instance
            await providerInstance.deleteCachePolicies();

            // 4. Remove from ApplicationContext
            this.providers.delete(providerId);
            this.logger.info(`Removed provider ${providerId} from ApplicationContext`);
          } else {
            this.logger.warn(`Provider ${providerId} instance not found in ApplicationContext, skipping provider-specific cleanup`);
          }

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
          // 5. Delete all title streams for processed providers (batch operation through TMDBProvider)
          const deletedStreams = await this.tmdbProvider.deleteTitleStreams(processedProviderIds);
          this.logger.info(`Deleted ${deletedStreams} title streams for ${processedProviderIds.length} provider(s)`);

          // 6. Remove all processed providers from title sources (batch operation through TMDBProvider)
          const { titlesUpdated, streamsRemoved } = await this.tmdbProvider.removeProvidersFromTitleSources(processedProviderIds);
          this.logger.info(`Removed ${processedProviderIds.length} provider(s) from ${titlesUpdated} titles, ${streamsRemoved} streams removed`);

          // 7. Delete titles without sources (batch operation through TMDBProvider)
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

