import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('StatsRouter');

/**
 * Stats router for handling statistics endpoints
 */
class StatsRouter {
  /**
   * @param {StatsManager} statsManager - Stats manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(statsManager, database) {
    this._statsManager = statsManager;
    this._database = database;
    this._requireAuth = createRequireAuth(database);
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/stats
     * Get all statistics grouped by provider
     */
    this.router.get('/', this._requireAuth, async (req, res) => {
      try {
        const result = await this._statsManager.getStats();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        logger.error('Get stats error:', error);
        return res.status(500).json({ error: 'Failed to get statistics' });
      }
    });
  }
}

export default StatsRouter;
