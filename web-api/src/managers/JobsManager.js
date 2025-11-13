import { createLogger } from '../utils/logger.js';

/**
 * Jobs manager for validating and checking job status
 * Handles job validation logic including running status checks and dependency blocking
 */
export class JobsManager {
  /**
   * @param {Object} jobsConfig - Jobs configuration from jobs.json
   * @param {Object} [scheduler] - Optional scheduler instance for checking running jobs
   * @param {import('../repositories/JobHistoryRepository.js').JobHistoryRepository} [jobHistoryRepo] - Optional job history repository
   */
  constructor(jobsConfig, scheduler = null, jobHistoryRepo = null) {
    this.jobsConfig = jobsConfig;
    this.logger = createLogger('JobsManager');
    this._scheduler = scheduler;
    this._jobHistoryRepo = jobHistoryRepo;
    
    // Build job metadata lookup from config
    this._jobMetadata = {};
    this.jobsConfig.jobs.forEach(job => {
      this._jobMetadata[job.name] = {
        name: job.name,
        jobHistoryName: job.jobHistoryName,
        description: job.description,
        schedule: job.schedule,
        interval: job.interval,
        skipIfOtherInProgress: job.skipIfOtherInProgress || [],
        postExecute: job.postExecute || []
      };
    });
  }

  /**
   * Get job history name from config
   * @param {string} engineJobName - Engine job name
   * @returns {string} Job history name
   */
  getJobHistoryName(engineJobName) {
    const jobConfig = this._jobMetadata[engineJobName];
    return jobConfig?.jobHistoryName || engineJobName;
  }

  /**
   * Check if a job is currently running
   * Checks scheduler's running jobs map and MongoDB state
   * @param {string} engineJobName - Engine job name
   * @returns {Promise<boolean>} True if job is running
   */
  async isJobRunning(engineJobName) {
    // First check scheduler's running jobs map (most up-to-date runtime state)
    if (this._scheduler && this._scheduler._runningJobs && this._scheduler._runningJobs.has(engineJobName)) {
      return true;
    }
    
    // Check MongoDB state (persisted job history)
    const historyJobName = this.getJobHistoryName(engineJobName);
    let jobHistory = null;
    
    if (this._jobHistoryRepo) {
      // Use repository if available
      jobHistory = await this._jobHistoryRepo.findOneByQuery({ job_name: historyJobName });
    } else {
      // No repository available, can't check persisted state
      this.logger.warn('No jobHistoryRepo available for checking job status');
      return false;
    }
    
    return jobHistory && jobHistory.status === 'running';
  }

  /**
   * Validate if a job can run
   * Checks if the job itself is running and if any blocking jobs are running
   * @param {string} engineJobName - Engine job name
   * @returns {Promise<{canRun: boolean, reason?: string, blockingJobs?: string[]}>} Validation result
   */
  async canRunJob(engineJobName) {
    // Check if job itself is running
    if (await this.isJobRunning(engineJobName)) {
      return {
        canRun: false,
        reason: `Job '${engineJobName}' is already running`,
        blockingJobs: [engineJobName]
      };
    }

    // Find job config to check skipIfOtherInProgress
    const jobConfig = this._jobMetadata[engineJobName];
    
    // Check if any blocking jobs are running
    if (jobConfig && jobConfig.skipIfOtherInProgress && jobConfig.skipIfOtherInProgress.length > 0) {
      const blockingJobs = [];
      for (const blockingJobName of jobConfig.skipIfOtherInProgress) {
        if (await this.isJobRunning(blockingJobName)) {
          blockingJobs.push(blockingJobName);
        }
      }

      if (blockingJobs.length > 0) {
        const blockingJobsList = blockingJobs.join(', ');
        return {
          canRun: false,
          reason: `Job '${engineJobName}' cannot run because the following job(s) are currently running: ${blockingJobsList}`,
          blockingJobs
        };
      }
    }

    return { canRun: true };
  }

  /**
   * Get job metadata
   * @param {string} engineJobName - Engine job name
   * @returns {Object|null} Job metadata or null if not found
   */
  getJobMetadata(engineJobName) {
    return this._jobMetadata[engineJobName] || null;
  }

  /**
   * Get all jobs metadata
   * @returns {Array} Array of job metadata objects
   */
  getAllJobsMetadata() {
    return Object.values(this._jobMetadata);
  }
}

