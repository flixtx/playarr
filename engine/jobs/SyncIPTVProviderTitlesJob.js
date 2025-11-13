import { BaseJob } from './BaseJob.js';

/**
 * Job for processing provider titles (fetching metadata from IPTV providers)
 * Handles fetching metadata from all configured IPTV providers,
 * and matching TMDB IDs for provider titles
 * @extends {BaseJob}
 */
export class SyncIPTVProviderTitlesJob extends BaseJob {
  /**
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(mongoData, providers, tmdbProvider) {
    super('SyncIPTVProviderTitlesJob', mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - fetch metadata from all IPTV providers (incremental)
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async execute() {
    this._validateDependencies();

    try {
      // Get last execution time from job history BEFORE setting status
      // This ensures we have the correct last_execution value from previous successful run
      const lastExecution = await this.getLastExecution({
        fallbackDate: null,
        logMessage: 'Last execution: {date}. Processing incremental update.',
        noExecutionMessage: 'No previous execution found. Processing full update.'
      });

      // Set status to "running" at start (after reading last_execution)
      await this.setJobStatus('running');

      // Fetch metadata from all providers
      // Note: fetchMetadata() will load all provider titles internally for comparison
      this.logger.info(`Starting metadata fetch process for ${this.providers.size} provider(s)...`);
      
      const results = await Promise.all(
        Array.from(this.providers.entries()).map(async ([providerId, providerInstance]) => {
          try {
            this.logger.debug(`[${providerId}] Processing provider (${providerInstance.getProviderType()})`);
            this.logger.info(`Fetching metadata from provider ${providerId}...`);
            
            // Fetch movies and TV shows in parallel
            const [moviesCount, tvShowsCount] = await Promise.all([
              providerInstance.fetchMetadata('movies').catch(err => {
                this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
                return 0;
              }),
              providerInstance.fetchMetadata('tvshows').catch(err => {
                this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
                return 0;
              })
            ]);
            
            return {
              providerId,
              providerName: providerId,
              movies: moviesCount,
              tvShows: tvShowsCount
            };
          } catch (error) {
            this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
            return {
              providerId,
              providerName: providerId,
              error: error.message
            };
          }
        })
      );

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
    } finally {
      // Unload titles from memory to free resources
      // Note: fetchMetadata() updates _titlesCache via saveTitles(), so cleanup is needed
      try {
        this.logger.debug('Unloading titles from memory cache...');
        for (const [providerId, providerInstance] of this.providers) {
          providerInstance.unloadTitles();
        }
        this.logger.debug('Memory cleanup completed');
      } catch (error) {
        this.logger.error(`Error during memory cleanup: ${error.message}`);
      }
    }
  }

}

