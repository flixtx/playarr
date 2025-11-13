import { BaseManager } from './BaseManager.js';

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_AUTH_URL = `${TMDB_API_URL}/authentication`;
const TMDB_TOKEN_KEY = 'tmdb_token';
const API_REQUEST_TIMEOUT = 5000; // 5 seconds

/**
 * TMDB manager for handling TMDB API operations
 * Matches Python's TMDB services
 */
class TMDBManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('./settings.js').SettingsManager} settingsManager - Settings manager instance
   * @param {import('../services/providerApiStorage.js').ProviderApiStorage} providerApiStorage - Provider API storage instance for caching
   */
  constructor(database, settingsManager, providerApiStorage) {
    super('TMDBManager', database);
    this._settingsManager = settingsManager;
    this._providerApiStorage = providerApiStorage;
    this._tmdbTokenKey = TMDB_TOKEN_KEY;
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT);

      try {
        const response = await fetch(TMDB_AUTH_URL, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseData = await response.json();

        if (response.ok && response.status === 200) {
          if (responseData.success === true) {
            return {
              response: {
                valid: true,
                message: 'API key is valid',
                status_code: 200,
              },
              statusCode: 200,
            };
          } else {
            return {
              response: {
                valid: false,
                message: responseData.status_message || 'Authentication failed',
                status_code: 401,
              },
              statusCode: 401,
            };
          }
        } else {
          return {
            response: {
              valid: false,
              message: responseData.status_message || `Unexpected error: ${response.status}`,
              status_code: response.status,
            },
            statusCode: response.status,
          };
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        if (fetchError.name === 'AbortError') {
          return {
            response: {
              valid: false,
              message: 'Request timeout',
              status_code: 500,
            },
            statusCode: 500,
          };
        }

        throw fetchError;
      }
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

  /**
   * Get TMDB lists for the authenticated user
   * Matches Python's TMDBListsService.get_lists()
   */
  async getLists(apiKey) {
    try {
      // First get the account ID
      const accountUrl = `${TMDB_API_URL}/account`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      };

      const accountResponse = await fetch(accountUrl, { headers });
      if (!accountResponse.ok) {
        const accountData = await accountResponse.json();
        return {
          response: {
            error: 'Failed to fetch TMDB account details',
            details: accountData.status_message,
          },
          statusCode: accountResponse.status,
        };
      }

      const accountData = await accountResponse.json();
      const accountId = accountData.id;

      if (!accountId) {
        return {
          response: { error: 'Could not retrieve account ID' },
          statusCode: 400,
        };
      }

      // Now fetch the lists
      const listsUrl = `${TMDB_API_URL}/account/${accountId}/lists`;
      const listsResponse = await fetch(listsUrl, { headers });

      if (!listsResponse.ok) {
        const listsData = await listsResponse.json();
        return {
          response: {
            error: 'Failed to fetch TMDB lists',
            details: listsData.status_message,
          },
          statusCode: listsResponse.status,
        };
      }

      const listsData = await listsResponse.json();
      return {
        response: { lists: listsData.results || [] },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error fetching TMDB lists:', error);
      return {
        response: { error: `Failed to fetch TMDB lists: ${error.message}` },
        statusCode: 500,
      };
    }
  }

  /**
   * Get all items from a TMDB list
   * Matches Python's TMDBListsService.get_list_items()
   */
  async getListItems(apiKey, listId) {
    try {
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      };

      const allItems = [];
      let currentPage = 1;
      let totalPages = 1;

      while (currentPage <= totalPages) {
        const listUrl = `${TMDB_API_URL}/list/${listId}?language=en-US&page=${currentPage}`;
        const response = await fetch(listUrl, { headers });

        if (!response.ok) {
          const responseData = await response.json();
          return {
            response: {
              error: 'Failed to fetch TMDB list items',
              details: responseData.status_message,
            },
            statusCode: response.status,
          };
        }

        const responseData = await response.json();

        // Update total pages on first iteration
        if (currentPage === 1) {
          totalPages = responseData.total_pages || 1;
        }

        // Process items from current page
        const items = responseData.items || [];
        for (const item of items) {
          const itemId = item.id;
          const mediaType = item.media_type;

          if (itemId && mediaType) {
            // Check if title exists in our collection (placeholder for now)
            item.exists = await this._checkTitleExists(itemId, mediaType);
            // Check watchlist status (placeholder for now)
            item.in_watchlist = await this._checkWatchlistStatus(itemId, mediaType);
          }
        }

        allItems.push(...items);
        currentPage += 1;
      }

      // Count existing items
      const existingCount = allItems.filter(item => item.exists).length;

      return {
        response: {
          items: allItems,
          total_items: allItems.length,
          existing_count: existingCount,
        },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error fetching TMDB list items:', error);
      return {
        response: { error: `Failed to fetch TMDB list items: ${error.message}` },
        statusCode: 500,
      };
    }
  }

  /**
   * Check if a title exists in our collection
   * Placeholder implementation - matches Python's placeholder
   */
  async _checkTitleExists(itemId, mediaType) {
    try {
      // TODO: Implement actual title existence check
      return false;
    } catch (error) {
      this.logger.error('Error checking title existence:', error);
      return false;
    }
  }

  /**
   * Check if a title is in the watchlist
   * Placeholder implementation - matches Python's placeholder
   */
  async _checkWatchlistStatus(itemId, mediaType) {
    try {
      // TODO: Implement actual watchlist status check
      return false;
    } catch (error) {
      this.logger.error('Error checking watchlist status:', error);
      return false;
    }
  }

  /**
   * Get TMDB movie stream URL
   * Basic implementation - Python version seems incomplete
   */
  async getMovieStream(tmdbId) {
    try {
      // Get API key from settings
      const apiKeyResult = await this.getApiKey();
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.api_key) {
        return {
          response: { error: 'TMDB API key not configured' },
          statusCode: 400,
        };
      }

      const apiKey = apiKeyResult.response.api_key;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      };

      // Get movie details
      const movieUrl = `${TMDB_API_URL}/movie/${tmdbId}`;
      const response = await fetch(movieUrl, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        return {
          response: {
            error: 'Failed to fetch TMDB movie',
            details: responseData.status_message,
          },
          statusCode: response.status,
        };
      }

      const movieData = await response.json();
      
      // Return movie data (actual stream URL would need to be determined)
      return {
        response: { movie: movieData },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting TMDB movie stream:', error);
      return {
        response: { error: `Failed to get TMDB movie stream: ${error.message}` },
        statusCode: 500,
      };
    }
  }

  /**
   * Search for movies or TV shows by title
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {string} title - Title to search for
   * @param {number|null} year - Optional release year
   * @returns {Promise<Object>} TMDB search results
   */
  async search(type, title, year = null) {
    try {
      // Check cache first
      const cached = this._providerApiStorage.get('tmdb', type, 'tmdb-search', { title, year });
      if (cached !== null) {
        this.logger.debug(`Cache hit for TMDB search: ${type}/${title}/${year || 'no-year'}`);
        return cached;
      }

      // Get API key from settings
      const apiKeyResult = await this._settingsManager.getSetting(this._tmdbTokenKey);
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.value) {
        throw new Error('TMDB API key not configured');
      }

      const apiKey = apiKeyResult.response.value;
      const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
      const params = new URLSearchParams({ query: title });
      
      if (year) {
        if (type === 'movie') {
          params.set('year', year);
        } else {
          params.set('first_air_date_year', year);
        }
      }

      const url = `${TMDB_API_URL}${endpoint}?${params.toString()}`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      };

      this.logger.debug(`Fetching from TMDB API: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the result
      this._providerApiStorage.set('tmdb', type, 'tmdb-search', data, { title, year });
      
      return data;
    } catch (error) {
      this.logger.error(`Error searching TMDB ${type} "${title}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Find TMDB ID by IMDB ID
   * @param {string} imdbId - IMDB ID (e.g., 'tt0133093')
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object>} TMDB find results
   */
  async findByIMDBId(imdbId, type) {
    try {
      // Check cache first
      const cached = this._providerApiStorage.get('tmdb', type, 'tmdb-find', { imdbId });
      if (cached !== null) {
        this.logger.debug(`Cache hit for TMDB find by IMDB: ${imdbId}/${type}`);
        return cached;
      }

      // Get API key from settings
      const apiKeyResult = await this._settingsManager.getSetting(this._tmdbTokenKey);
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.value) {
        throw new Error('TMDB API key not configured');
      }

      const apiKey = apiKeyResult.response.value;
      const url = `${TMDB_API_URL}/find/${imdbId}?external_source=imdb_id`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      };

      this.logger.debug(`Fetching from TMDB API: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the result
      this._providerApiStorage.set('tmdb', type, 'tmdb-find', data, { imdbId });
      
      return data;
    } catch (error) {
      this.logger.error(`Error finding TMDB by IMDB ID ${imdbId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get details by TMDB ID
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @returns {Promise<Object>} Media details
   */
  async getDetails(type, tmdbId) {
    try {
      // Check cache first
      const cached = this._providerApiStorage.get('tmdb', type, 'tmdb-details', { tmdbId });
      if (cached !== null) {
        this.logger.debug(`Cache hit for TMDB details: ${type}/${tmdbId}`);
        return cached;
      }

      // Get API key from settings
      const apiKeyResult = await this._settingsManager.getSetting(this._tmdbTokenKey);
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.value) {
        throw new Error('TMDB API key not configured');
      }

      const apiKey = apiKeyResult.response.value;
      const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
      const url = `${TMDB_API_URL}${endpoint}`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      };

      this.logger.debug(`Fetching from TMDB API: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the result
      this._providerApiStorage.set('tmdb', type, 'tmdb-details', data, { tmdbId });
      
      return data;
    } catch (error) {
      this.logger.error(`Error getting TMDB details for ${type} ${tmdbId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get TV show season details
   * @param {number} tmdbId - TMDB TV show ID
   * @param {number} seasonNumber - Season number
   * @returns {Promise<Object>} Season details
   */
  async getSeasonDetails(tmdbId, seasonNumber) {
    try {
      // Check cache first
      const cached = this._providerApiStorage.get('tmdb', 'tv', 'tmdb-season', { tmdbId, seasonNumber });
      if (cached !== null) {
        this.logger.debug(`Cache hit for TMDB season: ${tmdbId}/S${seasonNumber}`);
        return cached;
      }

      // Get API key from settings
      const apiKeyResult = await this._settingsManager.getSetting(this._tmdbTokenKey);
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.value) {
        throw new Error('TMDB API key not configured');
      }

      const apiKey = apiKeyResult.response.value;
      const url = `${TMDB_API_URL}/tv/${tmdbId}/season/${seasonNumber}`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      };

      this.logger.debug(`Fetching from TMDB API: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the result (6 hours TTL)
      this._providerApiStorage.set('tmdb', 'tv', 'tmdb-season', data, { tmdbId, seasonNumber });
      
      return data;
    } catch (error) {
      this.logger.error(`Error getting TMDB season details for ${tmdbId}/S${seasonNumber}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get similar movies or TV shows
   * @param {string} type - Media type: 'movie' or 'tv'
   * @param {number} tmdbId - TMDB ID
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Similar media results
   */
  async getSimilar(type, tmdbId, page = 1) {
    try {
      // Check cache first
      const cached = this._providerApiStorage.get('tmdb', type, 'tmdb-similar', { tmdbId, page });
      if (cached !== null) {
        this.logger.debug(`Cache hit for TMDB similar: ${type}/${tmdbId}/${page}`);
        return cached;
      }

      // Get API key from settings
      const apiKeyResult = await this._settingsManager.getSetting(this._tmdbTokenKey);
      if (apiKeyResult.statusCode !== 200 || !apiKeyResult.response.value) {
        throw new Error('TMDB API key not configured');
      }

      const apiKey = apiKeyResult.response.value;
      const endpoint = type === 'movie' ? `/movie/${tmdbId}/similar` : `/tv/${tmdbId}/similar`;
      const url = `${TMDB_API_URL}${endpoint}?page=${page}`;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      };

      this.logger.debug(`Fetching from TMDB API: ${url}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const responseData = await response.json();
        throw new Error(responseData.status_message || `TMDB API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the result
      this._providerApiStorage.set('tmdb', type, 'tmdb-similar', data, { tmdbId, page });
      
      return data;
    } catch (error) {
      this.logger.error(`Error getting TMDB similar for ${type} ${tmdbId}: ${error.message}`);
      throw error;
    }
  }
}

// Export class
export { TMDBManager };

