import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createRequireAdmin } from '../middleware/admin.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('JobsRouter');

/**
 * Jobs router for handling job management endpoints
 */
class JobsRouter {
  /**
   * @param {JobsManager} jobsManager - Jobs manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(jobsManager, database) {
    this._jobsManager = jobsManager;
    this._database = database;
    this._requireAuth = createRequireAuth(database);
    this._requireAdmin = createRequireAdmin(this._requireAuth);
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/jobs
     * List all jobs with details and status (admin only)
     */
    this.router.get('/', this._requireAdmin, async (req, res) => {
      try {
        logger.debug('Calling getAllJobs() from JobsManager');
        const result = await this._jobsManager.getAllJobs();
        logger.debug(`GET /api/jobs - Returning status ${result.statusCode}, engineReachable: ${result.response.engineReachable}, jobs count: ${result.response.jobs?.length || 0}`);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        logger.error('Error stack:', error.stack);
        return res.status(500).json({ error: 'Failed to get jobs' });
      }
    });

    /**
     * POST /api/jobs/:jobName/trigger
     * Trigger a job manually (admin only)
     */
    this.router.post('/:jobName/trigger', this._requireAdmin, async (req, res) => {
      try {
        const { jobName } = req.params;

        if (!jobName) {
          return res.status(400).json({ error: 'Job name is required' });
        }

        const result = await this._jobsManager.triggerJob(jobName);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        logger.error('Trigger job error:', error);
        return res.status(500).json({ error: 'Failed to trigger job' });
      }
    });
  }
}

export default JobsRouter;

