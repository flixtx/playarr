import { BaseIPTVProvider } from './BaseIPTVProvider.js';
import path from 'path';

/**
 * Apollo Group TV provider implementation
 * Handles AGTV-specific API calls for M3U8 content
 * @extends {BaseIPTVProvider}
 */
export class AGTVProvider extends BaseIPTVProvider {

  /**
   * Fetch M3U8 content from AGTV provider
   * @param {string} providerId - Provider ID
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} [page] - Page number (for paginated types)
   * @returns {Promise<string>} M3U8 content as string
   */
  async fetchM3U8(providerId, type, page = null) {
    const provider = this._getProviderConfig(providerId);
    
    let url = `${provider.api_url}/api/list/${provider.username}/${provider.password}/m3u8/${type}`;
    
    // Add page if provided (for paginated types like tvshows)
    if (page) {
      url += `/${page}`;
    }
    
    const limiter = this._getLimiter(providerId);

    return await this._fetchTextWithCacheAxios({
      providerId,
      type,
      endpoint: 'm3u8',
      cacheParams: page ? { page } : {},
      url,
      headers: {},
      limiter
    });
  }

  /**
   * Get cache key mappings for AGTV provider
   * @private
   * @param {string} providerId - Provider ID
   * @returns {Object<string, {type: string, endpoint: string, dirBuilder: Function, fileBuilder: Function, cacheParams?: Object, ttl: number|null}>} Mapping of cache key identifier to cache configuration
   */
  _getCacheKeyMappings(providerId) {
    return {
      // Movies M3U8 (no page param = list.m3u8)
      'm3u8-movies': {
        type: 'movies',
        endpoint: 'm3u8',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'movies', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, type, 'metadata');
          const filename = params.page ? `list-${params.page}.m3u8` : 'list.m3u8';
          return path.join(dirPath, filename);
        },
        ttl: 6 // 6 hours
      },
      'm3u8-tvshows': {
        type: 'tvshows',
        endpoint: 'm3u8',
        dirBuilder: (cacheDir, providerId, params) => {
          return path.join(cacheDir, providerId, 'tvshows', 'metadata');
        },
        fileBuilder: (cacheDir, providerId, type, params) => {
          const dirPath = path.join(cacheDir, providerId, type, 'metadata');
          const filename = params.page ? `list-${params.page}.m3u8` : 'list.m3u8';
          return path.join(dirPath, filename);
        },
        ttl: 6 // 6 hours
      }
    };
  }
}

