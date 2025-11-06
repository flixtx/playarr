/**
 * M3U8 parameters that should be included in playlist entries
 * Matches Python's M3U8_PARAMETERS
 */
const M3U8_PARAMETERS = [
  'tvg-id',
  'tvg-name',
  'tvg-logo',
  'group-title',
];

/**
 * Playlist manager for handling M3U8 playlist generation
 * Matches Python's PlaylistService
 */
class PlaylistManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   */
  constructor(database) {
    this._database = database;
  }

  /**
   * Get media files mapping for all titles in watchlist
   * Matches Python's PlaylistService.get_media_files_mapping()
   */
  async getMediaFilesMapping(baseUrl, mediaType, user = null) {
    const mediaFiles = {};

    // Get titles in watchlist
    let watchlistTitleKeys = [];
    if (user && user.watchlist) {
      watchlistTitleKeys = user.watchlist;
    } else {
      // If no user, get all titles with watchlist flag set to true
      // This matches backward compatibility behavior
      watchlistTitleKeys = await this._getTitlesInWatchlist(mediaType);
    }

    // Get streams from database
    const streamsData = await this._database.getDataObject('titles-streams') || {};
    if (!streamsData || Object.keys(streamsData).length === 0) {
      return mediaFiles;
    }

    // Get main titles to match title keys
    const titlesData = await this._database.getDataList('titles');

    for (const titleKey of watchlistTitleKeys) {
      const title = titlesData.get(titleKey);

      if (!title) {
        continue;
      }

      const currentTitleType = title.type;

      if (currentTitleType !== mediaType) {
        continue;
      }

      // Find all streams for this title
      // Stream key format: {type}-{tmdbId}-{streamId}-{providerId}
      const titlePrefix = `${title.type}-${title.title_id}-`;

      for (const [streamKey, streamEntry] of Object.entries(streamsData)) {
        if (streamKey.startsWith(titlePrefix)) {
          const proxyPath = streamEntry.proxy_path;
          const proxyUrl = streamEntry.proxy_url;

          if (proxyPath && proxyUrl) {
            const streamUrl = `${baseUrl}/api/stream/${proxyUrl}`;
            mediaFiles[proxyPath] = streamUrl;
          }
        }
      }
    }

    return mediaFiles;
  }

  /**
   * Generate unified M3U8 playlist from all titles in watchlist
   * Matches Python's PlaylistService.get_m3u8_streams()
   */
  async getM3u8Streams(baseUrl, mediaType, user = null) {
    const lines = ['#EXTM3U'];

    // Get titles in watchlist
    let watchlistTitleKeys = [];
    if (user && user.watchlist) {
      watchlistTitleKeys = user.watchlist;
    } else {
      // If no user, get all titles with watchlist flag set to true
      // This matches backward compatibility behavior
      watchlistTitleKeys = await this._getTitlesInWatchlist(mediaType);
    }

    // Get streams from database
    const streamsData = await this._database.getDataObject('titles-streams') || {};
    if (!streamsData || Object.keys(streamsData).length === 0) {
      return lines.join('\n');
    }

    // Get main titles to match title keys
    const titlesData = await this._database.getDataList('titles');

    for (const titleKey of watchlistTitleKeys) {
      const title = titlesData.get(titleKey);

      if (!title) {
        continue;
      }

      const currentTitleType = title.type;

      if (currentTitleType !== mediaType) {
        continue;
      }

      // Find all streams for this title
      // Stream key format: {type}-{tmdbId}-{streamId}-{providerId}
      const titlePrefix = `${title.type}-${title.title_id}-`;

      for (const [streamKey, streamEntry] of Object.entries(streamsData)) {
        if (streamKey.startsWith(titlePrefix)) {
          const streamLines = this._getM3u8ItemFromStreamEntry(streamEntry, baseUrl);
          lines.push(...streamLines);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Get M3U8 item for a specific stream entry from main-titles-streams
   * @param {Object} streamEntry - Stream entry from main-titles-streams.json
   * @param {string} baseUrl - Base URL for stream proxy
   * @returns {Array<string>} Array with [metadata, streamUrl] or empty array
   */
  _getM3u8ItemFromStreamEntry(streamEntry, baseUrl) {
    const proxyUrl = streamEntry.proxy_url;
    const tvgName = streamEntry['tvg-name'];

    if (!tvgName || !proxyUrl) {
      return [];
    }

    const streamUrl = `${baseUrl}/api/stream/${proxyUrl}`;

    // Build parameters from stream entry, only including M3U8 parameters
    const paramsParts = [];
    for (const [key, value] of Object.entries(streamEntry)) {
      if (M3U8_PARAMETERS.includes(key)) {
        paramsParts.push(`${key}="${value}"`);
      }
    }

    const params = paramsParts.join(' ');
    const metadata = `#EXTINF:-1 ${params},${tvgName}`;

    return [metadata, streamUrl];
  }

  /**
   * Get M3U8 item for a specific stream (legacy method, kept for compatibility)
   * Matches Python's PlaylistService._get_m3u8_item()
   */
  _getM3u8Item(streamData, baseUrl) {
    const streamProxyData = streamData.proxy;

    if (!streamProxyData) {
      return [];
    }

    const tvgName = streamProxyData['tvg-name'];
    const proxyStreamUrl = streamProxyData.url;

    if (!tvgName || !proxyStreamUrl) {
      return [];
    }

    const streamUrl = `${baseUrl}/api/stream/${proxyStreamUrl}`;

    // Build parameters from proxy data, only including M3U8 parameters
    const paramsParts = [];
    for (const [key, value] of Object.entries(streamProxyData)) {
      if (M3U8_PARAMETERS.includes(key)) {
        paramsParts.push(`${key}="${value}"`);
      }
    }

    const params = paramsParts.join(' ');

    const metadata = `#EXTINF:-1 ${params},${tvgName}`;

    return [metadata, streamUrl];
  }

  /**
   * Get all titles in watchlist (for backward compatibility when no user provided)
   * Matches Python's TMDBProvider.get_titles_in_watchlist()
   */
  async _getTitlesInWatchlist(mediaType) {
    const titlesData = await this._database.getDataList('titles');
    const watchlistTitleKeys = [];

    for (const [titleKey, titleData] of titlesData.entries()) {
      // Filter by media type
      if (titleData.type !== mediaType) {
        continue;
      }

      // Check if title has watchlist flag set to true
      if (titleData.watchlist === true) {
        watchlistTitleKeys.push(titleKey);
      }
    }

    return watchlistTitleKeys;
  }
}

// Export class
export { PlaylistManager };

