import { StorageManager } from '../managers/StorageManager.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { createLogger } from '../utils/logger.js';

/**
 * Static Provider Initializer
 * Singleton pattern for initializing and retrieving providers
 * Prevents redundant initialization within the same execution context (worker thread)
 */
export class ProviderInitializer {
  // Static singleton instance
  static instance = null;
  static cache = null;
  static data = null;
  static providers = null; // Map<string, BaseIPTVProvider>
  static tmdbProvider = null;
  static logger = createLogger('ProviderInitializer');
  static initialized = false;

  /**
   * Initialize providers (singleton - only initializes once)
   * @param {string} cacheDir - Directory path for cache storage
   * @param {string} dataDir - Directory path for data storage
   * @returns {Promise<void>}
   */
  static async initialize(cacheDir, dataDir) {
    // If already initialized, skip
    if (ProviderInitializer.initialized) {
      ProviderInitializer.logger.debug('Providers already initialized, skipping...');
      return;
    }

    ProviderInitializer.logger.info('Initializing providers...');

    // Initialize storage managers
    ProviderInitializer.cache = new StorageManager(cacheDir, false);
    ProviderInitializer.data = new StorageManager(dataDir, false);
    ProviderInitializer.logger.info('✓ Storage managers initialized');

    // Initialize IPTV providers
    ProviderInitializer.providers = new Map();
    const providerConfigs = await BaseProvider.loadProviders();
    ProviderInitializer.logger.info(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = ProviderInitializer._createProviderInstance(providerData);
        ProviderInitializer.providers.set(providerData.id, instance);
        ProviderInitializer.logger.info(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        ProviderInitializer.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (ProviderInitializer.providers.size === 0) {
      ProviderInitializer.logger.warn('No providers were successfully loaded');
    }

    // Initialize TMDB provider (singleton)
    ProviderInitializer.tmdbProvider = TMDBProvider.getInstance(
      ProviderInitializer.cache,
      ProviderInitializer.data
    );
    ProviderInitializer.logger.info('✓ TMDB provider initialized');

    ProviderInitializer.initialized = true;
    ProviderInitializer.logger.info('Provider initialization completed');
  }

  /**
   * Get initialized IPTV providers
   * @returns {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} Map of provider ID to provider instance
   * @throws {Error} If providers are not initialized
   */
  static getProviders() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.providers) {
      throw new Error('Providers not initialized. Call initialize() first.');
    }
    return ProviderInitializer.providers;
  }

  /**
   * Get initialized TMDB provider
   * @returns {import('../providers/TMDBProvider.js').TMDBProvider} TMDB provider instance
   * @throws {Error} If TMDB provider is not initialized
   */
  static getTMDBProvider() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.tmdbProvider) {
      throw new Error('TMDB provider not initialized. Call initialize() first.');
    }
    return ProviderInitializer.tmdbProvider;
  }

  /**
   * Get initialized cache storage manager
   * @returns {import('../managers/StorageManager.js').StorageManager} Cache storage manager
   * @throws {Error} If not initialized
   */
  static getCache() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.cache) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return ProviderInitializer.cache;
  }

  /**
   * Get initialized data storage manager
   * @returns {import('../managers/StorageManager.js').StorageManager} Data storage manager
   * @throws {Error} If not initialized
   */
  static getData() {
    if (!ProviderInitializer.initialized || !ProviderInitializer.data) {
      throw new Error('Data storage not initialized. Call initialize() first.');
    }
    return ProviderInitializer.data;
  }

  /**
   * Reset initialization state (useful for testing)
   * @private
   */
  static _reset() {
    ProviderInitializer.cache = null;
    ProviderInitializer.data = null;
    ProviderInitializer.providers = null;
    ProviderInitializer.tmdbProvider = null;
    ProviderInitializer.initialized = false;
  }

  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  static _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(providerData, ProviderInitializer.cache, ProviderInitializer.data);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, ProviderInitializer.cache, ProviderInitializer.data);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }
}

