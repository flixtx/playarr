import { BaseJob } from './BaseJob.js';
import { ApplicationContext } from '../context/ApplicationContext.js';

/**
 * Job for monitoring settings changes
 * Checks if settings changed since last execution and updates TMDB provider if TMDB token changed
 * @extends {BaseJob}
 */
export class SettingsMonitorJob extends BaseJob {
  /**
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../services/MongoDataService.js').MongoDataService} mongoData - MongoDB data service instance
   * @param {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} providers - Map of providerId -> provider instance (already initialized)
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider singleton instance
   */
  constructor(cache, mongoData, providers, tmdbProvider) {
    super('SettingsMonitorJob', cache, mongoData, providers, tmdbProvider);
  }

  /**
   * Execute the job - monitor settings changes
   * @returns {Promise<{settingsUpdated: number, errors: Array}>} Processing results
   */
  async execute() {
    this._validateDependencies();

    try {
      // Get last execution time from job history BEFORE setting status
      const lastExecution = await this.getLastExecution({
        fallbackDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        logMessage: 'Last execution: {date}. Checking for settings changes.',
        noExecutionMessage: 'No previous execution found. Checking all settings.'
      });

      // Set status to "running" at start (after reading last_execution)
      await this.setJobStatus('running');

      // Get settings changed since last execution
      const changedSettings = await this.mongoData.getSettingsChangedSince(lastExecution);

      if (changedSettings.length === 0) {
        this.logger.info('No settings changed since last execution');
        await this.setJobStatus('completed', {});
        return { settingsUpdated: 0, errors: [] };
      }

      this.logger.info(`Found ${changedSettings.length} setting(s) changed`);

      const errors = [];
      let settingsUpdated = 0;

      // Check if TMDB token changed
      const tmdbTokenSetting = changedSettings.find(s => s._id === 'tmdb_token');
      if (tmdbTokenSetting) {
        try {
          this.logger.info('TMDB token changed, updating TMDB provider configuration');
          
          // Get all current settings
          const allSettings = await this.mongoData.getSettings();
          
          // Update TMDB provider settings
          await this.tmdbProvider.updateSettings(allSettings);
          
          settingsUpdated++;
          this.logger.info('TMDB provider configuration updated successfully');
        } catch (error) {
          this.logger.error(`Error updating TMDB provider: ${error.message}`);
          errors.push({ setting: 'tmdb_token', error: error.message });
        }
      }

      // Set status to completed on success with result
      await this.setJobStatus('completed', {
        settings_checked: changedSettings.length,
        settings_updated: settingsUpdated,
        errors: errors
      });
      return { settingsUpdated, errors };
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

