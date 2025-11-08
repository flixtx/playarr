import express from 'express';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Get the base URL from the request, respecting X-Forwarded-* headers
 * Matches Python's _get_base_url() and playlist router pattern
 */
function getBaseUrl(req) {
  // Check X-Forwarded-Proto header (set by reverse proxies like nginx)
  const scheme = req.headers['x-forwarded-proto'] || (req.protocol || 'http');

  // Check X-Forwarded-Host header (preferred over Host when behind proxy)
  let host = req.headers['x-forwarded-host'] || req.get('host');

  // Remove port from host if X-Forwarded-Port is provided separately
  const forwardedPort = req.headers['x-forwarded-port'];
  if (forwardedPort) {
    // Remove any port that might be in the host
    if (host.includes(':')) {
      host = host.split(':')[0];
    }
    // Add the forwarded port if it's not default (443 for https, 80 for http)
    if (forwardedPort !== '443' && forwardedPort !== '80') {
      host = `${host}:${forwardedPort}`;
    }
  } else {
    // If no X-Forwarded-Port, check if host includes port
    // For default ports with https, we might want to remove :443
    if (scheme === 'https' && host.endsWith(':443')) {
      host = host.slice(0, -4);
    } else if (scheme === 'http' && host.endsWith(':80')) {
      host = host.slice(0, -3);
    }
  }

  const baseUrl = `${scheme}://${host}`.replace(/\/$/, '');
  return baseUrl;
}

/**
 * Xtream Code API router
 * Exposes movies and TV shows in Xtream Code API format
 * Authentication: username and API key (password parameter)
 */
class XtreamRouter {
  /**
   * @param {import('../managers/xtream.js').XtreamManager} xtreamManager - Xtream manager instance
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(xtreamManager, database) {
    this._xtreamManager = xtreamManager;
    this._database = database;
    this.router = express.Router();
    
    // Action handlers configuration map
    this._actionHandlers = {
      get_vod_categories: this._handleGetVodCategories.bind(this),
      get_vod_streams: this._handleGetVodStreams.bind(this),
      get_series_categories: this._handleGetSeriesCategories.bind(this),
      get_series: this._handleGetSeries.bind(this),
      get_vod_info: this._handleGetVodInfo.bind(this),
      get_series_info: this._handleGetSeriesInfo.bind(this),
      get_short_epg: this._handleGetShortEpg.bind(this),
      get_simple_data_table: this._handleGetSimpleDataTable.bind(this)
    };
    
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /
     * Xtream Code API endpoint (mounted at /player_api.php)
     * Query parameters: username, password (API key), action
     */
    this.router.get('/', async (req, res) => {
      try {
        const { username, password, action } = req.query;

        // Validate required parameters
        if (!username || !password) {
          return res.status(401).json({ 
            user_info: { 
              auth: 0,
              status: 'Unauthorized',
              exp_date: null,
              is_trial: 0,
              active_cons: 0,
              created_at: null,
              max_connections: 0,
              allowed_output_formats: []
            }
          });
        }

        // Authenticate user (password is the API key)
        const user = await this._authenticateUser(username, password);
        if (!user) {
          return res.status(401).json({ 
            user_info: { 
              auth: 0,
              status: 'Unauthorized',
              exp_date: null,
              is_trial: 0,
              active_cons: 0,
              created_at: null,
              max_connections: 0,
              allowed_output_formats: []
            }
          });
        }

        // Get base URL for stream endpoints
        const baseUrl = getBaseUrl(req);

        // Handle action using config map
        const handler = action ? this._actionHandlers[action] : null;
        
        if (handler) {
          try {
            const response = await handler(req, user, baseUrl);
            return res.status(200).json(response);
          } catch (error) {
            // Handle specific errors from handlers
            if (error.message === 'vod_id parameter required' || error.message === 'series_id parameter required') {
              return res.status(400).json({ error: error.message });
            }
            if (error.message === 'Movie not found' || error.message === 'Series not found') {
              return res.status(404).json({ error: error.message });
            }
            throw error; // Re-throw to be caught by outer catch
          }
        }

        // Default: return user info if no action or unknown action
        return res.status(200).json({
          user_info: {
            auth: 1,
            status: 'Active',
            exp_date: null,
            is_trial: 0,
            active_cons: 0,
            created_at: user.createdAt || null,
            max_connections: 1,
            allowed_output_formats: ['m3u8', 'ts']
          }
        });
      } catch (error) {
        console.error('Xtream API error:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  /**
   * Handle get_vod_categories action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD categories
   */
  async _handleGetVodCategories(req, user, baseUrl) {
    return await this._xtreamManager.getVodCategories(user);
  }

  /**
   * Handle get_vod_streams action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} VOD streams
   */
  async _handleGetVodStreams(req, user, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getVodStreams(user, baseUrl, categoryId);
  }

  /**
   * Handle get_series_categories action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series categories
   */
  async _handleGetSeriesCategories(req, user, baseUrl) {
    return await this._xtreamManager.getSeriesCategories(user);
  }

  /**
   * Handle get_series action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Series list
   */
  async _handleGetSeries(req, user, baseUrl) {
    const categoryId = req.query.category_id ? parseInt(req.query.category_id, 10) : null;
    return await this._xtreamManager.getSeries(user, baseUrl, categoryId);
  }

  /**
   * Handle get_vod_info action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} VOD info or error response
   */
  async _handleGetVodInfo(req, user, baseUrl) {
    const vodId = req.query.vod_id ? parseInt(req.query.vod_id, 10) : null;
    if (!vodId) {
      throw new Error('vod_id parameter required');
    }
    const response = await this._xtreamManager.getVodInfo(user, baseUrl, vodId);
    if (!response) {
      throw new Error('Movie not found');
    }
    return response;
  }

  /**
   * Handle get_series_info action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Series info or error response
   */
  async _handleGetSeriesInfo(req, user, baseUrl) {
    const seriesId = req.query.series_id ? parseInt(req.query.series_id, 10) : null;
    if (!seriesId) {
      throw new Error('series_id parameter required');
    }
    const response = await this._xtreamManager.getSeriesInfo(user, baseUrl, seriesId);
    if (!response) {
      throw new Error('Series not found');
    }
    return response;
  }

  /**
   * Handle get_short_epg action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Array>} Empty EPG array
   */
  async _handleGetShortEpg(req, user, baseUrl) {
    // EPG not implemented, return empty array
    return [];
  }

  /**
   * Handle get_simple_data_table action
   * @private
   * @param {Object} req - Express request object
   * @param {Object} user - Authenticated user
   * @param {string} baseUrl - Base URL
   * @returns {Promise<Object>} Empty object
   */
  async _handleGetSimpleDataTable(req, user, baseUrl) {
    // Not implemented, return empty object
    return {};
  }

  /**
   * Authenticate user by username and API key
   * @private
   * @param {string} username - Username
   * @param {string} apiKey - API key (passed as password parameter)
   * @returns {Promise<Object|null>} User object or null if invalid
   */
  async _authenticateUser(username, apiKey) {
    try {
      const usersCollection = toCollectionName(DatabaseCollections.USERS);
      const user = await this._database.getData(usersCollection, { 
        username: username,
        api_key: apiKey 
      });

      if (!user || user.status !== 'active') {
        return null;
      }

      // Remove sensitive data
      const { password_hash, _id, ...userPublic } = user;
      return userPublic;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }
}

export default XtreamRouter;

