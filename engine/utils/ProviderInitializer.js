import { StorageManager } from '../managers/StorageManager.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { createLogger } from '../utils/logger.js';
import MongoClientUtil from '../utils/mongo-client.js';
import { MongoDataService } from '../services/MongoDataService.js';

/**
 * Static Provider Initializer
 * Singleton pattern for initializing and retrieving providers
 * Prevents redundant initialization within the same execution context (worker thread)
 */
export class ProviderInitializer {
  static cache = null;
  static mongoClient = null;
  static mongoData = null;
  static providers = null; // Map<string, BaseIPTVProvider>
  static tmdbProvider = null;
  static logger = createLogger('ProviderInitializer');
  static initialized = false;

  /**
   * Initialize providers - always loads fresh providers/settings/cache policies
   * Infrastructure (MongoDB, StorageManager, TMDBProvider) is cached and reused
   * @param {string} cacheDir - Directory path for cache storage
   * @returns {Promise<void>}
   */
  static async initialize(cacheDir) {
    ProviderInitializer.logger.debug('Initializing providers...');

    // Initialize MongoDB connection (reuse if already connected)
    if (!ProviderInitializer.mongoClient || !ProviderInitializer.mongoClient.isConnected()) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
      const dbName = process.env.MONGODB_DB_NAME || 'playarr';
      
      try {
        ProviderInitializer.mongoClient = new MongoClientUtil(mongoUri, dbName);
        await ProviderInitializer.mongoClient.connect();
        ProviderInitializer.mongoData = new MongoDataService(ProviderInitializer.mongoClient);
        ProviderInitializer.logger.debug('✓ MongoDB connection initialized');
      } catch (error) {
        ProviderInitializer.logger.error(`✗ Failed to connect to MongoDB: ${error.message}`);
        ProviderInitializer.logger.error('MongoDB is required. Please ensure MongoDB is running and MONGODB_URI is configured correctly.');
        throw new Error(`MongoDB connection failed: ${error.message}`);
      }
    }

    // Initialize storage manager (reuse if already initialized)
    if (!ProviderInitializer.cache) {
      ProviderInitializer.cache = new StorageManager(cacheDir, false, ProviderInitializer.mongoData);
    }
    
    // Always reload cache policies fresh from MongoDB
    await ProviderInitializer.cache.initialize();
    
    ProviderInitializer.logger.debug('✓ Storage manager initialized');

    // Always load settings fresh from MongoDB
    let settings = {};
    try {
      settings = await ProviderInitializer.mongoData.getSettings();
      ProviderInitializer.logger.debug('✓ Settings loaded from MongoDB');
    } catch (error) {
      ProviderInitializer.logger.warn(`Failed to load settings from MongoDB: ${error.message}`);
    }

    // Always load providers fresh from MongoDB
    ProviderInitializer.providers = new Map();
    const providerConfigs = await BaseProvider.loadProviders(ProviderInitializer.mongoData);
    ProviderInitializer.logger.debug(`Found ${providerConfigs.length} enabled provider(s)`);

    for (const providerData of providerConfigs) {
      try {
        const instance = ProviderInitializer._createProviderInstance(providerData);
        
        // Initialize cache policies for this provider (fresh from MongoDB)
        await instance.initializeCachePolicies();
        
        ProviderInitializer.providers.set(providerData.id, instance);
        ProviderInitializer.logger.debug(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        ProviderInitializer.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }

    if (ProviderInitializer.providers.size === 0) {
      ProviderInitializer.logger.warn('No providers were successfully loaded');
    }

    // Initialize or update TMDB provider with fresh settings
    ProviderInitializer.tmdbProvider = await TMDBProvider.getInstance(
      ProviderInitializer.cache,
      ProviderInitializer.mongoData,
      settings
    );
    ProviderInitializer.logger.debug('✓ TMDB provider initialized');

    ProviderInitializer.initialized = true;
    ProviderInitializer.logger.debug('Provider initialization completed');
  }


  /**
   * Get initialized IPTV providers
   * @returns {Map<string, import('../providers/BaseIPTVProvider.js').BaseIPTVProvider>} Map of provider ID to provider instance
   * @throws {Error} If providers are not initialized
   */
  static getProviders() {
    if (!ProviderInitializer.providers) {
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
    if (!ProviderInitializer.tmdbProvider) {
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
    if (!ProviderInitializer.cache) {
      throw new Error('Cache not initialized. Call initialize() first.');
    }
    return ProviderInitializer.cache;
  }


  /**
   * Get initialized MongoDB data service
   * @returns {import('../services/MongoDataService.js').MongoDataService} MongoDB data service
   * @throws {Error} If not initialized
   */
  static getMongoData() {
    if (!ProviderInitializer.mongoData) {
      throw new Error('MongoDB data service not initialized. Call initialize() first.');
    }
    return ProviderInitializer.mongoData;
  }


  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {import('../providers/BaseIPTVProvider.js').BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  static _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(providerData, ProviderInitializer.cache, ProviderInitializer.mongoData);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, ProviderInitializer.cache, ProviderInitializer.mongoData);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }
}

