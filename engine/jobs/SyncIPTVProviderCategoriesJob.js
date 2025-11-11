import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for syncing IPTV provider categories
 * Fetches categories from all IPTV providers and automatically disables
 * any enabled categories that no longer exist in the provider
 * @extends {BaseJob}
 */
export class SyncIPTVProviderCategoriesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('SyncIPTVProviderCategoriesJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - fetch categories from all IPTV providers and auto-disable missing enabled categories
   * @returns {Promise<Array<{providerId: string, categoriesFetched: number, categoriesDisabled: number, error?: string}>>} Array of sync results
   */
  async execute() {
    this._validateDependencies();

    const context = ApplicationContext.getInstance();

    try {
      // Set status to "running" at start
      await this.setJobStatus('running');

      this.logger.info(`Starting category sync for ${this.providers.size} provider(s)...`);

      // Fetch categories from all providers
      this.logger.info(`Fetching categories from ${this.providers.size} provider(s)...`);
      await Promise.all(
        Array.from(this.providers.entries()).map(async ([providerId, providerInstance]) => {
          try {
            this.logger.debug(`Fetching categories from provider ${providerId}...`);
            const [movieCats, tvShowCats] = await Promise.all([
              providerInstance.fetchCategories('movies').catch(() => []),
              providerInstance.fetchCategories('tvshows').catch(() => [])
            ]);
            this.logger.info(`[${providerId}] Found ${movieCats.length} movie categories, ${tvShowCats.length} TV show categories`);
          } catch (error) {
            this.logger.error(`[${providerId}] Error fetching categories: ${error.message}`);
          }
        })
      );

      // Check for missing enabled categories and auto-disable them
      const results = await this.checkAndDisableMissingCategories(context);

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        providers_processed: this.providers.size,
        results: results
      });

      return results;
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

  /**
   * Check for enabled categories that no longer exist and auto-disable them
   * @param {ApplicationContext} context - Application context instance
   * @returns {Promise<Array<{providerId: string, categoriesFetched: number, categoriesDisabled: number, error?: string}>>} Array of check results
   */
  async checkAndDisableMissingCategories(context) {
    this.logger.info(`Checking for missing enabled categories across ${this.providers.size} provider(s)...`);

    const results = [];

    for (const [providerId, providerInstance] of this.providers) {
      try {
        // Get current enabled categories from provider config (already in memory)
        const enabledCategories = providerInstance.providerData.enabled_categories || { movies: [], tvshows: [] };
        const enabledCategoryKeys = new Set([
          ...(enabledCategories.movies || []),
          ...(enabledCategories.tvshows || [])
        ]);

        if (enabledCategoryKeys.size === 0) {
          // No enabled categories, nothing to check
          results.push({
            providerId,
            categoriesFetched: 0,
            categoriesDisabled: 0
          });
          continue;
        }

        // Get all fetched categories from provider method
        const allCategories = await providerInstance.getAllCategories();

        const fetchedCategoryKeys = new Set(
          allCategories.map(cat => cat.category_key)
        );

        // Find enabled categories that are missing from fetched categories
        const missingCategoryKeys = Array.from(enabledCategoryKeys).filter(
          key => !fetchedCategoryKeys.has(key)
        );

        if (missingCategoryKeys.length > 0) {
          this.logger.warn(
            `[${providerId}] Found ${missingCategoryKeys.length} enabled category(ies) that no longer exist: ${missingCategoryKeys.join(', ')}`
          );

          // Separate missing categories by type
          const missingMovies = missingCategoryKeys.filter(key => key.startsWith('movies-'));
          const missingTvShows = missingCategoryKeys.filter(key => key.startsWith('tvshows-'));

          // Update enabled categories using provider method
          const updatedEnabledCategories = {
            movies: (enabledCategories.movies || []).filter(key => !missingMovies.includes(key)),
            tvshows: (enabledCategories.tvshows || []).filter(key => !missingTvShows.includes(key))
          };

          await providerInstance.updateEnabledCategories(updatedEnabledCategories);

          this.logger.info(
            `[${providerId}] Auto-disabled ${missingCategoryKeys.length} missing category(ies) in provider config`
          );

          // Add provider to categories changed queue for cleanup
          context.addProviderToActionQueue('iptvProviderCategoriesChanged', providerId);
          this.logger.info(`[${providerId}] Added to categories changed queue for cleanup`);

          results.push({
            providerId,
            categoriesFetched: allCategories.length,
            categoriesDisabled: missingCategoryKeys.length
          });
        } else {
          // No missing categories
          results.push({
            providerId,
            categoriesFetched: allCategories.length,
            categoriesDisabled: 0
          });
        }
      } catch (error) {
        this.logger.error(`[${providerId}] Error checking missing categories: ${error.message}`);
        results.push({
          providerId,
          categoriesFetched: 0,
          categoriesDisabled: 0,
          error: error.message
        });
      }
    }

    return results;
  }
}

