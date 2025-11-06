import { createLogger } from '../utils/logger.js';

const logger = createLogger('StreamManager');

/**
 * Constants for stream endpoint
 * Matches Python's STREAM_HEADERS
 */
const STREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept': '*/*',
  'Connection': 'keep-alive',
};

/**
 * Stream manager for handling stream data operations
 * Matches Python's StreamService
 */
class StreamManager {
  /**
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   * @param {import('../services/cache.js').CacheService} cacheService - Cache service instance for API titles
   */
  constructor(titlesManager, cacheService) {
    this._titlesManager = titlesManager;
    this._cacheService = cacheService;
    this._timeout = 3000; // 3 seconds timeout for URL checks
  }

  /**
   * Get episode number in format E## (e.g., E01)
   * Matches Python's get_episode_number()
   */
  _getEpisodeNumber(episodeNum) {
    return this._getNumber(episodeNum, 'E');
  }

  /**
   * Get season number in format S## (e.g., S01)
   * Matches Python's get_season_number()
   */
  _getSeasonNumber(seasonNum) {
    return this._getNumber(seasonNum, 'S');
  }

  /**
   * Format number with prefix (e.g., S01, E01)
   * Matches Python's _get_number()
   */
  _getNumber(num, prefix) {
    const number = String(num).padStart(2, '0');
    return `${prefix}${number}`;
  }

  /**
   * Get API titles from cache (with provider URLs)
   * @private
   * @returns {Map<string, MainTitle>|null} API titles Map or null if not cached
   */
  _getAPITitlesFromCache() {
    return this._cacheService.get('titles-api') || null;
  }

  /**
   * Get the best source for a specific title
   * Matches Python's StreamService.get_best_source()
   */
  async getBestSource(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    logger.debug(
      `Getting best source for title ID: ${titleId}, media type: ${mediaType}, season: ${seasonNumber}, episode: ${episodeNumber}`
    );

    const sources = await this._getSources(titleId, mediaType, seasonNumber, episodeNumber);

    if (!sources || sources.length === 0) {
      return null;
    }

    // Check each source and return the first valid one
    for (const source of sources) {
      if (await this._checkUrl(source)) {
        return source;
      }
    }

    return null;
  }

  /**
   * Get sources for a specific title
   * Matches Python's StreamService._get_sources()
   */
  async _getSources(titleId, mediaType, seasonNumber = null, episodeNumber = null) {
    const titleKey = `${mediaType}-${titleId}`;
    
    // Get API titles from cache (with provider URLs)
    const apiTitles = this._getAPITitlesFromCache();
    if (!apiTitles) {
      logger.warn('API titles cache not available');
      return [];
    }

    const titleData = apiTitles.get(titleKey);
    if (!titleData) {
      logger.warn(`Title data not found for title key: ${titleKey}`);
      return [];
    }

    const streams = titleData.streams || {};
    let streamId = 'main';

    if (mediaType === 'tvshows') {
      const seasonNum = this._getSeasonNumber(seasonNumber);
      const episodeNum = this._getEpisodeNumber(episodeNumber);
      streamId = `${seasonNum}-${episodeNum}`;
    }

    const streamData = streams[streamId];
    if (!streamData) {
      logger.warn(`Stream data not found for stream ID: ${streamId}`);
      return [];
    }

    // Extract URLs from sources dictionary (now {providerId: url})
    const sourcesDict = streamData.sources || {};
    const sources = Object.values(sourcesDict);

    return sources;
  }

  /**
   * Check if a URL is reachable using GET
   * Matches Python's StreamService._check_url()
   */
  async _checkUrl(url) {
    try {
      logger.debug(`Checking URL: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this._timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: STREAM_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Read a small amount to ensure connection works
      const reader = response.body.getReader();
      const { done } = await reader.read();
      reader.releaseLock();

      const isValid = response.ok;
      logger.debug(`URL is valid: ${isValid}`);

      return isValid;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.debug(`URL check timed out: ${url}`);
      } else {
        logger.error(`Error checking URL: ${url}`, error);
      }
      return false;
    }
  }
}

// Export class
export { StreamManager };

