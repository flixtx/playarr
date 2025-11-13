import BaseRouter from './BaseRouter.js';
import { createRequireApplicationToken } from '../middleware/applicationToken.js';

/**
 * TMDB router for handling TMDB API endpoints
 */
class TMDBRouter extends BaseRouter {
  /**
   * @param {TMDBManager} tmdbManager - TMDB manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(tmdbManager, database) {
    super(database, 'TMDBRouter');
    this._tmdbManager = tmdbManager;
    this._requireApplicationToken = createRequireApplicationToken();
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/tmdb/api-key
     * Get the TMDB API key
     */
    this.router.get('/api-key', this._requireAuth, async (req, res) => {
      try {
        const result = await this._tmdbManager.getApiKey();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB API key', `Get TMDB API key error: ${error.message}`);
      }
    });

    /**
     * PUT /api/tmdb/api-key
     * Set the TMDB API key (admin only)
     */
    this.router.put('/api-key', this._requireAdmin, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'Missing api_key field');
        }

        const result = await this._tmdbManager.setApiKey(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set TMDB API key', `Set TMDB API key error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/tmdb/api-key
     * Delete the TMDB API key (admin only)
     */
    this.router.delete('/api-key', this._requireAdmin, async (req, res) => {
      try {
        const result = await this._tmdbManager.deleteApiKey();
        
        // 204 No Content should have empty body
        if (result.statusCode === 204) {
          return res.status(204).send();
        }
        
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete TMDB API key', `Delete TMDB API key error: ${error.message}`);
      }
    });

    /**
     * POST /api/tmdb/verify
     * Verify a TMDB API key
     */
    this.router.post('/verify', this._requireAuth, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return res.status(400).json({ 
            valid: false, 
            message: 'API key is required' 
          });
        }

        const result = await this._tmdbManager.verifyApiKey(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        this.logger.error('Verify TMDB API key error:', error);
        return res.status(500).json({ 
          valid: false, 
          message: `Error verifying API key: ${error.message}` 
        });
      }
    });

    /**
     * POST /api/tmdb/lists
     * Get TMDB lists for the authenticated user
     */
    this.router.post('/lists', this._requireAuth, async (req, res) => {
      try {
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'API key is required');
        }

        const result = await this._tmdbManager.getLists(api_key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB lists', `Get TMDB lists error: ${error.message}`);
      }
    });

    /**
     * POST /api/tmdb/lists/:list_id/items
     * Get items from a TMDB list
     */
    this.router.post('/lists/:list_id/items', this._requireAuth, async (req, res) => {
      try {
        const { list_id } = req.params;
        const { api_key } = req.body;

        if (!api_key) {
          return this.returnErrorResponse(res, 400, 'API key is required');
        }

        const result = await this._tmdbManager.getListItems(api_key, list_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB list items', `Get TMDB list items error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/stream/movies/:tmdb_id
     * Get TMDB movie stream
     */
    this.router.get('/stream/movies/:tmdb_id', this._requireAuth, async (req, res) => {
      try {
        const { tmdb_id } = req.params;
        const result = await this._tmdbManager.getMovieStream(tmdb_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB movie stream', `Get TMDB movie stream error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/search?type={movie|tv}&title={title}&year={year}
     * Search by title (engine endpoint, protected by application token)
     */
    this.router.get('/search', this._requireApplicationToken, async (req, res) => {
      try {
        const { type, title, year } = req.query;

        if (!type || !['movie', 'tv'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movie" or "tv"');
        }

        if (!title) {
          return this.returnErrorResponse(res, 400, 'Title parameter is required');
        }

        const yearNum = year ? parseInt(year, 10) : null;
        if (year && (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100)) {
          return this.returnErrorResponse(res, 400, 'Invalid year parameter');
        }

        const result = await this._tmdbManager.search(type, title, yearNum);
        return res.status(200).json(result);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to search TMDB', `Search TMDB error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/find/imdb?imdb_id={id}&type={movies|tvshows}
     * Find by IMDB ID (engine endpoint, protected by application token)
     */
    this.router.get('/find/imdb', this._requireApplicationToken, async (req, res) => {
      try {
        const { imdb_id, type } = req.query;

        if (!imdb_id) {
          return this.returnErrorResponse(res, 400, 'imdb_id parameter is required');
        }

        if (!type || !['movies', 'tvshows'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movies" or "tvshows"');
        }

        const result = await this._tmdbManager.findByIMDBId(imdb_id, type);
        return res.status(200).json(result);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to find TMDB by IMDB ID', `Find TMDB by IMDB ID error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/details?type={movie|tv}&tmdb_id={id}
     * Get details by TMDB ID (engine endpoint, protected by application token)
     */
    this.router.get('/details', this._requireApplicationToken, async (req, res) => {
      try {
        const { type, tmdb_id } = req.query;

        if (!type || !['movie', 'tv'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movie" or "tv"');
        }

        if (!tmdb_id) {
          return this.returnErrorResponse(res, 400, 'tmdb_id parameter is required');
        }

        const tmdbIdNum = parseInt(tmdb_id, 10);
        if (isNaN(tmdbIdNum) || tmdbIdNum < 1) {
          return this.returnErrorResponse(res, 400, 'Invalid tmdb_id parameter');
        }

        const result = await this._tmdbManager.getDetails(type, tmdbIdNum);
        return res.status(200).json(result);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB details', `Get TMDB details error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/season?tmdb_id={id}&season={number}
     * Get TV season details (engine endpoint, protected by application token)
     */
    this.router.get('/season', this._requireApplicationToken, async (req, res) => {
      try {
        const { tmdb_id, season } = req.query;

        if (!tmdb_id) {
          return this.returnErrorResponse(res, 400, 'tmdb_id parameter is required');
        }

        if (!season) {
          return this.returnErrorResponse(res, 400, 'season parameter is required');
        }

        const tmdbIdNum = parseInt(tmdb_id, 10);
        const seasonNum = parseInt(season, 10);
        
        if (isNaN(tmdbIdNum) || tmdbIdNum < 1) {
          return this.returnErrorResponse(res, 400, 'Invalid tmdb_id parameter');
        }

        if (isNaN(seasonNum) || seasonNum < 0) {
          return this.returnErrorResponse(res, 400, 'Invalid season parameter');
        }

        const result = await this._tmdbManager.getSeasonDetails(tmdbIdNum, seasonNum);
        return res.status(200).json(result);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB season details', `Get TMDB season details error: ${error.message}`);
      }
    });

    /**
     * GET /api/tmdb/similar?type={movie|tv}&tmdb_id={id}&page={page}
     * Get similar titles (engine endpoint, protected by application token)
     */
    this.router.get('/similar', this._requireApplicationToken, async (req, res) => {
      try {
        const { type, tmdb_id, page } = req.query;

        if (!type || !['movie', 'tv'].includes(type)) {
          return this.returnErrorResponse(res, 400, 'Invalid type parameter. Must be "movie" or "tv"');
        }

        if (!tmdb_id) {
          return this.returnErrorResponse(res, 400, 'tmdb_id parameter is required');
        }

        const tmdbIdNum = parseInt(tmdb_id, 10);
        if (isNaN(tmdbIdNum) || tmdbIdNum < 1) {
          return this.returnErrorResponse(res, 400, 'Invalid tmdb_id parameter');
        }

        const pageNum = page ? parseInt(page, 10) : 1;
        if (page && (isNaN(pageNum) || pageNum < 1)) {
          return this.returnErrorResponse(res, 400, 'Invalid page parameter');
        }

        const result = await this._tmdbManager.getSimilar(type, tmdbIdNum, pageNum);
        return res.status(200).json(result);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get TMDB similar titles', `Get TMDB similar titles error: ${error.message}`);
      }
    });
  }
}

export default TMDBRouter;
