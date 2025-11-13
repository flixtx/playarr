import { BaseJob } from './BaseJob.js';
import { generateTitleKey } from '../utils/titleUtils.js';

/**
 * Job for monitoring provider titles changes
 * Monitors provider titles for changes and processes them incrementally
 * @extends {BaseJob}
 */
export class ProviderTitlesMonitorJob extends BaseJob {
  /**
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(mongoData, providers, tmdbProvider) {
    super('ProviderTitlesMonitorJob', mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - process provider titles that changed since last execution
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    this._validateDependencies();

    try {
      // Get last execution time from job history BEFORE setting status
      const lastExecution = await this.getLastExecution({
        fallbackDate: null,
        logMessage: 'Last execution: {date}. Processing incremental update.',
        noExecutionMessage: 'No previous execution found. Processing full update.'
      });

      // Set status to "running" at start (after reading last_execution)
      await this.setJobStatus('running');

      // Filter to only enabled, non-deleted providers
      const enabledProviders = Array.from(this.providers.entries())
        .filter(([id, providerInstance]) => {
          const config = providerInstance.providerData;
          return config.enabled && !config.deleted;
        });

      // Load provider titles that changed since lastExecution
      for (const [id, providerInstance] of enabledProviders) {
        await providerInstance.loadProviderTitles(lastExecution);
      }

      // Load main titles for provider titles that have TMDB IDs
      // Main titles use title_key = type-tmdb_id, not type-title_id
      const mainTitleKeys = new Set();
      for (const [id, providerInstance] of enabledProviders) {
        for (const title of providerInstance.getAllTitles()) {
          if (title.tmdb_id && title.type) {
            mainTitleKeys.add(generateTitleKey(title.type, title.tmdb_id));
          }
        }
      }
      
      if (mainTitleKeys.size > 0) {
        const mainTitles = await this.tmdbProvider.getMainTitlesByKeys(Array.from(mainTitleKeys));
        this.tmdbProvider._mainTitlesCache = mainTitles;
      } else {
        this.tmdbProvider._mainTitlesCache = [];
      }

      // Extract provider titles into dictionary for main title processing
      const providerTitlesByProvider = new Map();
      for (const [id, providerInstance] of enabledProviders) {
        providerTitlesByProvider.set(id, providerInstance.getAllTitles());
      }

      // Delegate main title processing to TMDBProvider
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbProvider.processMainTitles(providerTitlesByProvider);

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        movies_processed: result.movies,
        tvshows_processed: result.tvShows
      });

      return result;
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      
      // Set status to failed with error result
      await this.setJobStatus('failed', {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    } finally {
      // Unload titles from memory to free resources
      try {
        this.logger.debug('Unloading titles from memory cache...');
        // Filter to enabled providers for cleanup
        const enabledProviders = Array.from(this.providers.entries())
          .filter(([id, providerInstance]) => {
            const config = providerInstance.providerData;
            return config.enabled && !config.deleted;
          });
        for (const [id, providerInstance] of enabledProviders) {
          providerInstance.unloadTitles();
        }
        this.tmdbProvider.unloadMainTitles();
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }
}

