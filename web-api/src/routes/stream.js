import express from 'express';
import { createRequireApiKey } from '../middleware/apiKey.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('StreamRouter');

/**
 * Stream router for handling stream endpoints
 */
class StreamRouter {
  /**
   * @param {StreamManager} streamManager - Stream manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(streamManager, database) {
    this._streamManager = streamManager;
    this._database = database;
    this._requireApiKey = createRequireApiKey(database);
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/stream/movies/:title_id
     * Get movie stream redirect (requires API key)
     */
    this.router.get('/movies/:title_id', this._requireApiKey, async (req, res) => {
      try {
        const { title_id } = req.params;
        const stream = await this._streamManager.getBestSource(title_id, 'movies');

        if (!stream) {
          return res.status(503).json({ error: 'No available providers' });
        }

        return res.redirect(stream);
      } catch (error) {
        logger.error('Get movie stream error:', error);
        return res.status(500).json({ error: 'Failed to get stream' });
      }
    });

    /**
     * GET /api/stream/tvshows/:title_id/:season/:episode
     * Get TV show stream redirect (requires API key)
     */
    this.router.get('/tvshows/:title_id/:season/:episode', this._requireApiKey, async (req, res) => {
      try {
        const { title_id, season, episode } = req.params;
        const stream = await this._streamManager.getBestSource(
          title_id,
          'tvshows',
          season,
          episode
        );

        if (!stream) {
          return res.status(503).json({ error: 'No available providers' });
        }

        return res.redirect(stream);
      } catch (error) {
        logger.error('Get TV show stream error:', error);
        return res.status(500).json({ error: 'Failed to get stream' });
      }
    });
  }
}

export default StreamRouter;
