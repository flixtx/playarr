import { BaseManager } from './BaseManager.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const jobsConfig = JSON.parse(readFileSync(join(__dirname, '../jobs.json'), 'utf-8'));

/**
 * Jobs manager for managing jobs
 * Reads job history from MongoDB and triggers jobs via scheduler
 */
class JobsManager extends BaseManager {
  /**
   * @param {Object} jobsConfig - Jobs configuration
   * @param {import('../engineScheduler.js').EngineScheduler} [scheduler] - Optional scheduler instance for triggering jobs
   * @param {import('../repositories/JobHistoryRepository.js').JobHistoryRepository} [jobHistoryRepo] - Optional job history repository
   */
  constructor(jobsConfig, scheduler = null, jobHistoryRepo = null) {
    super('JobsManager');
    this._scheduler = scheduler;
    this._jobHistoryRepo = jobHistoryRepo;
  }

  /**
   * Get job history from MongoDB
   * @param {string} jobName - Job name (e.g., "SyncIPTVProviderTitlesJob")
   * @returns {Promise<Object|null>} Job history document or null if not found
   */
  async _getJobHistory(jobName) {
    try {
      if (!this._jobHistoryRepo) {
        this.logger.warn('JobHistoryRepository not available, cannot get job history');
        return null;
      }
      const jobHistory = await this._jobHistoryRepo.findOneByQuery({ job_name: jobName });
      return jobHistory;
    } catch (error) {
      this.logger.error(`Error getting job history for ${jobName}:`, error);
      return null;
    }
  }


  /**
   * Format job data for UI
   * @param {Object} engineJob - Job metadata from engine
   * @param {Object|null} jobHistory - Job history from MongoDB
   * @returns {Object} Formatted job data
   */
  _formatJobData(engineJob, jobHistory) {
    return {
      name: engineJob.name,
      description: engineJob.description,
      schedule: engineJob.schedule,
      interval: engineJob.interval,
      status: jobHistory?.status || 'unknown',
      lastExecution: jobHistory?.last_execution || null,
      executionCount: jobHistory?.execution_count || 0,
      lastResult: jobHistory?.last_result || null,
      lastError: jobHistory?.last_error || null,
      createdAt: jobHistory?.createdAt || null,
      lastUpdated: jobHistory?.lastUpdated || null
    };
  }

  /**
   * Get all jobs with their details and status
   * Reads from jobs.json and MongoDB job history
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getAllJobs() {
    try {
      // Get job list from jobs.json
      const jobs = jobsConfig.jobs || [];

      // Get job history for each job from MongoDB
      // Use job.name because that's what's stored in the database (BaseJob uses this.jobName)
      const jobsWithHistory = await Promise.all(
        jobs.map(async (job) => {
          const jobHistory = await this._getJobHistory(job.name);
          return this._formatJobData(job, jobHistory);
        })
      );

      return {
        response: {
          jobs: jobsWithHistory
        },
        statusCode: 200
      };
    } catch (error) {
      this.logger.error('Error getting all jobs:', error);
      return {
        response: { error: 'Failed to get jobs' },
        statusCode: 500
      };
    }
  }

  /**
   * Trigger a job via scheduler
   * @param {string} jobName - Job name (e.g., "syncIPTVProviderTitles")
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.providerId] - Provider ID to process all titles for
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async triggerJob(jobName, options = {}) {
    try {
      if (!this._scheduler) {
        return {
          response: {
            success: false,
            error: 'Job scheduler is not available'
          },
          statusCode: 503
        };
      }

      const { providerId } = options;
      const workerData = providerId ? { providerId } : {};

      try {
        await this._scheduler.runJob(jobName, workerData);
        
        return {
          response: {
            success: true,
            message: `Job '${jobName}' triggered successfully`,
            jobName: jobName,
            ...(providerId ? { providerId } : {})
          },
          statusCode: 200
        };
      } catch (error) {
        // Handle specific error cases
        if (error.code === 'JOB_ALREADY_RUNNING' || error.isAlreadyRunning) {
          return {
            response: {
              success: false,
              error: error.message || `Job '${jobName}' is already running`,
              status: 'running'
            },
            statusCode: 409
          };
        } else if (error.code === 'JOB_CANNOT_RUN') {
          return {
            response: {
              success: false,
              error: error.message || `Job '${jobName}' cannot run`,
              blockingJobs: error.blockingJobs || []
            },
            statusCode: 409
          };
        } else if (error.message && error.message.includes('not found')) {
          return {
            response: {
              success: false,
              error: error.message || `Job '${jobName}' not found`
            },
            statusCode: 404
          };
        }
        
        // Other errors
        this.logger.error(`Error triggering job ${jobName}:`, error.message);
        return {
          response: {
            success: false,
            error: `Failed to trigger job: ${error.message}`
          },
          statusCode: 500
        };
      }
    } catch (error) {
      this.logger.error(`Error triggering job ${jobName}:`, error);
      return {
        response: { 
          success: false,
          error: 'Failed to trigger job'
        },
        statusCode: 500
      };
    }
  }
}

export { JobsManager };

