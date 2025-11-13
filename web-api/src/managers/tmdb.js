import { BaseManager } from './BaseManager.js';

const TMDB_TOKEN_KEY = 'tmdb_token';

/**
 * TMDB manager for API key management
 * Handles TMDB API key storage and verification via settings
 * For actual TMDB API calls, use TMDBProvider directly
 */
class TMDBManager extends BaseManager {
  /**
   * @param {import('./settings.js').SettingsManager} settingsManager - Settings manager instance
   * @param {import('../providers/TMDBProvider.js').TMDBProvider} tmdbProvider - TMDB provider instance
   */
  constructor(settingsManager, tmdbProvider) {
    super('TMDBManager');
    this._settingsManager = settingsManager;
    this._tmdbTokenKey = TMDB_TOKEN_KEY;
    this._tmdbProvider = tmdbProvider;
  }

  /**
   * Get the TMDB API key from settings
   * Matches Python's TMDBApiKeyService.get_api_key()
   */
  async getApiKey() {
    try {
      const result = await this._settingsManager.getSetting(this._tmdbTokenKey);
      
      if (result.statusCode !== 200) {
        return {
          response: { api_key: null },
          statusCode: 200,
        };
      }

      return {
        response: { api_key: result.response.value || null },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting TMDB API key:', error);
      return {
        response: { error: 'Failed to get TMDB API key' },
        statusCode: 500,
      };
    }
  }

  /**
   * Set the TMDB API key in settings
   * Matches Python's TMDBApiKeyService.set_api_key()
   */
  async setApiKey(apiKey) {
    try {
      const result = await this._settingsManager.setSetting(this._tmdbTokenKey, apiKey);
      
      if (result.statusCode !== 200) {
        return result;
      }

      // Update the provider's API key
      this._tmdbProvider.updateApiKey(apiKey);

      return {
        response: { api_key: apiKey },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error setting TMDB API key:', error);
      return {
        response: { error: 'Failed to set TMDB API key' },
        statusCode: 500,
      };
    }
  }

  /**
   * Delete the TMDB API key from settings
   * Matches Python's TMDBApiKeyService.delete_api_key()
   */
  async deleteApiKey() {
    try {
      const result = await this._settingsManager.deleteSetting(this._tmdbTokenKey);
      
      if (result.statusCode !== 200) {
        return result;
      }

      return {
        response: {},
        statusCode: 204,
      };
    } catch (error) {
      this.logger.error('Error deleting TMDB API key:', error);
      return {
        response: { error: 'Failed to delete TMDB API key' },
        statusCode: 500,
      };
    }
  }

  /**
   * Verify a TMDB API key
   * Matches Python's TMDBVerificationService.verify_api_key()
   */
  async verifyApiKey(apiKey) {
    try {
      const result = await this._tmdbProvider.verifyApiKey(apiKey);
      return {
        response: {
          valid: result.success,
          message: result.success ? 'API key is valid' : result.status_message || 'Authentication failed',
          status_code: result.status_code || 200,
        },
        statusCode: result.success ? 200 : (result.status_code || 401),
      };
    } catch (error) {
      this.logger.error('Error verifying TMDB API key:', error);
      return {
        response: {
          valid: false,
          message: `Error connecting to TMDB: ${error.message}`,
          status_code: 500,
        },
        statusCode: 500,
      };
    }
  }

}

// Export class
export { TMDBManager };

