import { BaseJob } from './BaseJob.js';
import { generateTitleKey } from '../utils/titleUtils.js';

/**
 * Job for processing main titles
 * Handles main title generation from provider titles
 * @extends {BaseJob}
 */
export class ProcessMainTitlesJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('ProcessMainTitlesJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - generate main titles from provider titles (incremental)
   * Processes only titles updated since last execution
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles by type (for reporting)
   */
  async execute() {
    this._validateDependencies();

    const jobName = 'ProcessMainTitlesJob';
    let lastExecution = null;

    try {
      // Get last execution time from job history BEFORE setting status
      // This ensures we have the correct last_execution value from previous successful run
      const jobHistory = await this.mongoData.getJobHistory(jobName);
      if (jobHistory && jobHistory.last_execution) {
        lastExecution = new Date(jobHistory.last_execution);
        this.logger.info(`Last execution: ${lastExecution.toISOString()}. Processing incremental update.`);
      } else {
        this.logger.info('No previous execution found. Processing full update.');
      }

      // Set status to "running" at start (after reading last_execution)
      await this.mongoData.updateJobStatus(jobName, 'running');

      // Load provider titles incrementally (only updated since last execution)
      for (const [providerId, providerInstance] of this.providers) {
        await providerInstance.loadProviderTitles(lastExecution);
      }

      // Load main titles for provider titles that have TMDB IDs
      // Main titles use title_key = type-tmdb_id, not type-title_id
      const mainTitleKeys = new Set();
      for (const [providerId, providerInstance] of this.providers) {
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
      for (const [providerId, providerInstance] of this.providers) {
        providerTitlesByProvider.set(providerId, providerInstance.getAllTitles());
      }

      // Delegate main title processing to TMDBProvider
      // It will only process titles that need regeneration based on provider title updates
      const result = await this.tmdbProvider.processMainTitles(providerTitlesByProvider);

      // Update job history
      await this.mongoData.updateJobHistory(jobName, {
        movies_processed: result.movies,
        tvshows_processed: result.tvShows
      });

      // Set status to completed on success
      await this.mongoData.updateJobStatus(jobName, 'completed');

      return result;
    } catch (error) {
      this.logger.error(`Job execution failed: ${error.message}`);
      
      await this.mongoData.updateJobStatus(jobName, 'failed');
      // Update job history with error
      await this.mongoData.updateJobHistory(jobName, {
        error: error.message
      }).catch(err => {
        this.logger.error(`Failed to update job history: ${err.message}`);
      });
      throw error;
    } finally {
      // Unload titles from memory to free resources
      try {
        this.logger.debug('Unloading titles from memory cache...');
        for (const [providerId, providerInstance] of this.providers) {
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

