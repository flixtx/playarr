import fs from 'fs-extra';
import path from 'path';
import { createLogger } from '../utils/logger.js';

/**
 * Storage manager for storing and retrieving cached data
 * Handles path building, validation, and file operations
 */
export class StorageManager {
  /**
   * @param {string} storageDir - Base storage directory path
   * @param {boolean} [wrapData=false] - If true, wraps data in {data: ..., metadata: ...} format (for cache directory)
   */
  constructor(storageDir, wrapData = false) {
    this.storageDir = storageDir;
    this.wrapData = wrapData;
    this.logger = createLogger('StorageManager');
  }

  /**
   * Convert cache key parts to file path
   * @private
   * @param {...string} keyParts - Variable number of path parts (all parts except last are directories, last is filename)
   * @returns {string} Full path to cache file
   */
  _buildPath(...keyParts) {
    if (keyParts.length === 0) {
      throw new Error('At least one key part is required');
    }

    const fileName = keyParts[keyParts.length - 1];
    const directoryParts = keyParts.slice(0, -1);
    
    // Last part must be a filename with extension
    if (!fileName.includes('.')) {
      throw new Error(`Last part must be a filename with extension, got: ${fileName}`);
    }

    // Build directory path
    const dir = path.join(this.storageDir, ...directoryParts);
    fs.ensureDirSync(dir);
    
    // Return full file path - lastPart is already filename with extension
    return path.join(dir, fileName);
  }

  /**
   * Check if cache is valid (exists and not expired)
   * @param {number} [maxAgeHours=24] - Maximum age in hours before cache is considered invalid
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {boolean} True if cache is valid, false otherwise
   */
  isValid(maxAgeHours = 24, ...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return false;
      }

      const stats = fs.statSync(cachePath);
      const ageMs = Date.now() - stats.mtimeMs;
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

      return ageMs < maxAgeMs;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get data from cache
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {*|null} Cached data or null if cache doesn't exist
   */
  get(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const cacheData = fs.readJsonSync(cachePath);
      // If wrapData is false, return data directly (no wrapper)
      // Handle old files that might still have wrapper for backward compatibility
      if (!this.wrapData) {
        // If old format with wrapper, unwrap it
        return cacheData.data !== undefined ? cacheData.data : cacheData;
      }
      // If wrapData is true, unwrap from {data: ..., metadata: ...} format
      return cacheData.data || cacheData; // Support both formats for backward compatibility
    } catch (error) {
      this.logger.error(`Error loading cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Set data in cache
   * @param {*} data - Data to cache
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @throws {Error} If cache save fails
   */
  set(data, ...keyParts) {
    if (keyParts.length === 0) {
      throw new Error('At least one key part is required');
    }

    try {
      const cachePath = this._buildPath(...keyParts);
      // If wrapData is false, save data directly without wrapper
      // If wrapData is true, wrap in {data: ..., metadata: ...} format
      if (!this.wrapData) {
        fs.writeJsonSync(cachePath, data, { spaces: 2 });
      } else {
        const cacheData = {
          data,
          metadata: {
            storedAt: new Date().toISOString()
          }
        };
        fs.writeJsonSync(cachePath, cacheData, { spaces: 2 });
      }
    } catch (error) {
      this.logger.error(`Error saving cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get metadata from cache file
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   * @returns {Object|null} Cache metadata or null if cache doesn't exist
   */
  getMetadata(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const cacheData = fs.readJsonSync(cachePath);
      return cacheData.metadata || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Save raw text data (like M3U8) to cache
   * @param {string} textData - Text data to cache
   * @param {...string} keyParts - Cache key parts (last part should be 'filename.ext' format, e.g., 'movies.m3u8')
   * @throws {Error} If cache save fails
   */
  setText(textData, ...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      fs.writeFileSync(cachePath, textData, 'utf8');
    } catch (error) {
      this.logger.error(`Error saving text cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load raw text data (like M3U8) from cache
   * @param {...string} keyParts - Cache key parts (last part should be 'filename.ext' format, e.g., 'movies.m3u8')
   * @returns {string|null} Cached text data or null if cache doesn't exist
   */
  getText(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      if (!fs.existsSync(cachePath)) {
        return null;
      }
      return fs.readFileSync(cachePath, 'utf8');
    } catch (error) {
      this.logger.error(`Error loading text cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Clear cache for specific key parts (e.g., all cache for a provider)
   * @param {...string} keyParts - Cache key parts (providerId is optional)
   */
  clear(...keyParts) {
    try {
      const cachePath = this._buildPath(...keyParts);
      const targetPath = fs.existsSync(cachePath) && fs.statSync(cachePath).isDirectory()
        ? cachePath
        : path.dirname(cachePath);
      
      if (fs.existsSync(targetPath)) {
        fs.removeSync(targetPath);
      }
    } catch (error) {
      this.logger.error(`Error clearing cache: ${error.message}`);
    }
  }
}

