import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for handling IPTV provider categories enabled state changed events
 * Updates ApplicationContext config, deletes provider titles for disabled categories, deletes title streams, removes provider from sources, deletes titles without sources, triggers process provider titles
 * @extends {BaseJob}
 */
export class IPTVProviderCategoriesChangedJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('IPTVProviderCategoriesChangedJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - handle provider categories changed events
   * @returns {Promise<{processed: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      await this.setJobStatus('running');

      // Get providers from action queue
      const providerIds = context.getAndClearProviderActionQueue('iptvProviderCategoriesChanged');

      if (providerIds.size === 0) {
        this.logger.info('No providers to process');
        await this.setJobStatus('completed', {});
        return { processed: 0, errors: [] };
      }

      this.logger.info(`Processing ${providerIds.size} provider(s) categories changed event(s)`);

      const errors = [];
      let processed = 0;
      const providersWithDisabledCategories = []; // Track providers that had disabled categories

      for (const providerId of providerIds) {
        try {
          this.logger.info(`Processing categories changed for provider ${providerId}`);

          // 1. Update ApplicationContext - provider configuration
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

          // 2. Get enabled categories from provider config
          const enabledCategories = providerConfig.enabled_categories || { movies: [], tvshows: [] };
          const enabledCategoryKeys = new Set([
            ...(enabledCategories.movies || []),
            ...(enabledCategories.tvshows || [])
          ]);

          // 3. Get all categories for this provider using provider instance
          const allCategories = await providerInstance.getAllCategories();

          const disabledCategoryKeys = allCategories
            .map(cat => cat.category_key)
            .filter(key => !enabledCategoryKeys.has(key));

          if (disabledCategoryKeys.length > 0) {
            this.logger.info(`Found ${disabledCategoryKeys.length} disabled categories for ${providerId}`);

            // 4. Delete provider titles for disabled categories using provider instance
            await providerInstance.deleteTitlesByCategories(disabledCategoryKeys);

            // Track this provider and its disabled categories for batch operations
            providersWithDisabledCategories.push({
              providerId,
              disabledCategoryKeys
            });
          }

          // 5. Trigger process provider titles using provider instance
          await providerInstance.processProviderTitles();

          processed++;
        } catch (error) {
          this.logger.error(`Error processing provider ${providerId}: ${error.message}`);
          errors.push({ providerId, error: error.message });
        }
      }

      // Batch operations: run once after all providers are processed
      if (providersWithDisabledCategories.length > 0) {
        try {
          // Collect all provider IDs and all disabled category keys
          const affectedProviderIds = providersWithDisabledCategories.map(p => p.providerId);
          const allDisabledCategoryKeys = [...new Set(
            providersWithDisabledCategories.flatMap(p => p.disabledCategoryKeys)
          )];

          // 6. Delete title streams for disabled categories (batch operation through TMDBProvider)
          const deletedStreams = await this.tmdbProvider.deleteTitleStreamsByCategories(affectedProviderIds, allDisabledCategoryKeys);
          this.logger.info(`Deleted ${deletedStreams} title streams for disabled categories across ${affectedProviderIds.length} provider(s)`);

          // 7. Remove all affected providers from title sources (batch operation through TMDBProvider)
          const { titlesUpdated, streamsRemoved } = await this.tmdbProvider.removeProvidersFromTitleSources(affectedProviderIds);
          this.logger.info(`Removed ${affectedProviderIds.length} provider(s) from ${titlesUpdated} titles, ${streamsRemoved} streams removed`);

          // 8. Delete titles without sources (batch operation through TMDBProvider)
          const deletedTitlesWithoutSources = await this.tmdbProvider.deleteTitlesWithoutSources(affectedProviderIds);
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

