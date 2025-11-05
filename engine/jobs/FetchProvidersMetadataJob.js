import { AGTVProvider } from '../providers/AGTVProvider.js';
import { XtreamProvider } from '../providers/XtreamProvider.js';
import { BaseIPTVProvider } from '../providers/BaseIPTVProvider.js';
import { TMDBProvider } from '../providers/TMDBProvider.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { StorageManager } from '../managers/StorageManager.js';
import { createLogger } from '../utils/logger.js';

/**
 * Job for fetching metadata from IPTV providers and TMDB
 */
export class FetchProvidersMetadataJob {
  constructor(cacheDir, dataDir) {
    this.cacheDir = cacheDir;
    this.dataDir = dataDir;
    this.cache = new StorageManager(cacheDir, false); // false = wrapData, saves raw API response without wrapper
    this.data = new StorageManager(dataDir, false); // false = wrapData, saves directly without wrapper
    this.providers = new Map(); // Map of providerId -> provider instance (IPTV providers only)
    this.providerConfigs = []; // Array of provider configurations
    this.tmdbProvider = null; // Singleton TMDB provider instance
    this.logger = createLogger('FetchProvidersMetadataJob');
  }

  /**
   * Initialize the engine by loading all providers and creating instances
   * @returns {Promise<number>} Number of successfully loaded providers
   */
  async initialize() {
    this.logger.info('Loading provider configurations...');
    this.providerConfigs = await BaseProvider.loadProviders();
    
    this.logger.info(`Found ${this.providerConfigs.length} enabled provider(s)`);
    
    // Create provider instances
    for (const providerData of this.providerConfigs) {
      try {
        const instance = this._createProviderInstance(providerData);
        this.providers.set(providerData.id, instance);
        this.logger.info(`✓ Loaded provider: ${providerData.id} (${providerData.type})`);
      } catch (error) {
        this.logger.error(`✗ Failed to load provider ${providerData.id}: ${error.message}`);
      }
    }
    
    return this.providers.size;
  }

  /**
   * Create a provider instance based on type
   * @private
   * @param {Object} providerData - Provider configuration data
   * @returns {BaseIPTVProvider} Provider instance (AGTVProvider or XtreamProvider)
   */
  _createProviderInstance(providerData) {
    if (providerData.type === 'agtv') {
      return new AGTVProvider(providerData, this.cache, this.data);
    } else if (providerData.type === 'xtream') {
      return new XtreamProvider(providerData, this.cache, this.data);
    } else {
      throw new Error(`Unknown provider type: ${providerData.type}`);
    }
  }

  /**
   * Get or create the TMDB provider instance (singleton)
   * @returns {TMDBProvider} TMDB provider instance
   */
  getTMDBProvider() {
    if (!this.tmdbProvider) {
      this.tmdbProvider = TMDBProvider.getInstance(this.cache, this.data);
      this.logger.info('✓ Initialized TMDB provider (singleton)');
    }
    return this.tmdbProvider;
  }

  /**
   * Fetch categories from a provider instance
   * @param {BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider ID
   */
  async fetchCategoriesFromProvider(providerInstance, providerId) {
    try {
      this.logger.debug(`Fetching categories from provider ${providerId}...`);
      const [movieCats, tvShowCats] = await Promise.all([
        providerInstance.fetchCategories('movies').catch(() => []),
        providerInstance.fetchCategories('tvshows').catch(() => [])
      ]);
      this.logger.info(`Found ${movieCats.length} movie categories, ${tvShowCats.length} TV show categories`);
      return { movieCats, tvShowCats };
    } catch (error) {
      this.logger.error(`Error fetching categories from ${providerId}: ${error.message}`);
      return { movieCats: [], tvShowCats: [] };
    }
  }

  /**
   * Fetch categories from all providers
   * @returns {Promise<void>}
   */
  async fetchAllCategories() {
    if (this.providers.size === 0) {
      await this.initialize();
    }

    this.logger.info(`Fetching categories from ${this.providers.size} provider(s)...`);
    
    for (const [providerId, providerInstance] of this.providers) {
      await this.fetchCategoriesFromProvider(providerInstance, providerId);
    }
  }

  /**
   * Fetch titles metadata (movies and TV shows) from a specific provider instance
   * Fetches movies and TV shows in parallel for better performance
   * @param {BaseIPTVProvider} providerInstance - Provider instance (AGTVProvider or XtreamProvider)
   * @param {string} providerId - Provider ID
   * @returns {Promise<{movies: number, tvShows: number}>} Count of fetched movies and TV shows
   */
  async fetchMetadataFromProvider(providerInstance, providerId) {
    // Fetch and save movies and TV shows metadata in parallel
    this.logger.info(`Fetching metadata from provider ${providerId}...`);
    
    const [moviesCount, tvShowsCount] = await Promise.all([
      providerInstance.fetchMetadata('movies').catch(err => {
        this.logger.error(`[${providerId}] Error fetching movies: ${err.message}`);
        return 0;
      }),
      providerInstance.fetchMetadata('tvshows').catch(err => {
        this.logger.error(`[${providerId}] Error fetching TV shows: ${err.message}`);
        return 0;
      })
    ]);

    return {
      movies: moviesCount,
      tvShows: tvShowsCount
    };
  }

  /**
   * Fetch metadata from all providers
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async fetchAllMetadata() {
    if (this.providers.size === 0) {
      await this.initialize();
    }

    this.logger.info(`Starting metadata fetch process for ${this.providers.size} provider(s)...`);
    const results = [];

    for (const [providerId, providerInstance] of this.providers) {
      try {
        this.logger.debug(`[${providerId}] Processing provider (${providerInstance.getProviderType()})`);
        const result = await this.fetchMetadataFromProvider(providerInstance, providerId);
        results.push({
          providerId,
          providerName: providerId,
          ...result
        });
      } catch (error) {
        this.logger.error(`[${providerId}] Error processing provider: ${error.message}`);
        results.push({
          providerId,
          providerName: providerId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Start fetching titles metadata from all loaded providers automatically
   * @returns {Promise<Array<{providerId: string, providerName: string, movies?: number, tvShows?: number, error?: string}>>} Array of fetch results
   */
  async startFetch() {
    if (this.providers.size === 0) {
      this.logger.info('No providers loaded. Initializing...');
      await this.initialize();
    }

    if (this.providers.size === 0) {
      this.logger.warn('No providers available to fetch from.');
      return [];
    }

    // Fetch categories from all providers first
    await this.fetchAllCategories();

    // Then fetch metadata from all providers
    const results = await this.fetchAllMetadata();

    // Match TMDB IDs for all provider titles
    await this.matchAllTMDBIds();

    // Generate main titles from provider titles with TMDB IDs
    await this.generateMainTitles();

    return results;
  }

  /**
   * Fetch titles metadata from a specific provider by ID
   * @param {string} providerId - Provider identifier
   * @returns {Promise<{movies: number, tvShows: number}>} Count of fetched movies and TV shows
   * @throws {Error} If provider is not found or not loaded
   */
  async fetchProvider(providerId) {
    if (this.providers.size === 0) {
      await this.initialize();
    }

    const providerInstance = this.providers.get(providerId);
    if (!providerInstance) {
      throw new Error(`Provider ${providerId} not found or not loaded`);
    }

    // Fetch categories first
    await this.fetchCategoriesFromProvider(providerInstance, providerId);

    return await this.fetchMetadataFromProvider(providerInstance, providerId);
  }

  /**
   * Get all loaded provider instances
   * @returns {Map<string, BaseIPTVProvider>} Map of provider ID to provider instance
   */
  getProviders() {
    return this.providers;
  }

  /**
   * Get provider configuration by ID
   * @param {string} providerId - Provider identifier
   * @returns {Object|undefined} Provider configuration object or undefined if not found
   */
  getProviderConfig(providerId) {
    return this.providerConfigs.find(p => p.id === providerId);
  }

  /**
   * Match TMDB IDs for all titles of a specific provider and type
   * @private
   * @param {BaseIPTVProvider} providerInstance - Provider instance
   * @param {string} providerId - Provider identifier
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<{matched: number, ignored: number}>} Count of matched and ignored titles
   */
  async _matchTMDBIdsForProviderType(providerInstance, providerId, type) {
    const providerType = providerInstance.getProviderType();
    const allTitles = providerInstance.loadTitles(type);
    
    // Filter titles without TMDB ID
    const titlesWithoutTMDB = allTitles.filter(t => !t.tmdb_id && t.title_id);

    if (titlesWithoutTMDB.length === 0) {
      this.logger.info(`[${providerId}] All ${type} titles already have TMDB IDs`);
      return { matched: 0, ignored: 0 };
    }

    this.logger.debug(`[${providerId}] Matching TMDB IDs for ${titlesWithoutTMDB.length} ${type} titles...`);

    // Load existing ignored titles
    const ignoredTitles = providerInstance.loadIgnoredTitles(type);
    const initialIgnoredCount = Object.keys(ignoredTitles).length;
    
    // Get recommended batch size from TMDB provider
    const tmdbProvider = this.getTMDBProvider();
    const batchSize = tmdbProvider.getRecommendedBatchSize();
    
    let matchedCount = 0;
    let ignoredCount = 0;
    const updatedTitles = [];
    
    // Track remaining titles for progress
    let totalRemaining = titlesWithoutTMDB.length;
    
    // Track last saved ignored count to avoid saving unchanged state
    let lastSavedIgnoredCount = initialIgnoredCount;
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      // Save updated titles
      if (updatedTitles.length > 0) {
        try {
          await providerInstance.saveTitles(type, updatedTitles);
          this.logger.debug(`[${providerId}] Saved ${updatedTitles.length} accumulated ${type} titles with TMDB IDs via progress callback`);
          updatedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving accumulated titles for ${type}: ${error.message}`);
        }
      }
      
      // Save ignored titles if changed since last save
      const currentIgnoredCount = Object.keys(ignoredTitles).length;
      if (currentIgnoredCount !== lastSavedIgnoredCount) {
        try {
          providerInstance.saveIgnoredTitles(type, ignoredTitles);
          this.logger.debug(`[${providerId}] Saved ignored ${type} titles via progress callback`);
          lastSavedIgnoredCount = currentIgnoredCount;
        } catch (error) {
          this.logger.error(`[${providerId}] Error saving ignored titles for ${type}: ${error.message}`);
        }
      }
    };

    // Register this type for progress tracking with save callback
    // Use a unique key to avoid conflicts with fetchMetadata progress tracking
    const progressKey = `tmdb_${type}`;
    providerInstance.registerProgress(progressKey, totalRemaining, saveCallback);

    // Process titles in batches for progress reporting and memory efficiency
    // Note: TMDB provider's limiter handles actual rate limiting internally
    try {
      for (let i = 0; i < titlesWithoutTMDB.length; i += batchSize) {
        const batch = titlesWithoutTMDB.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (title) => {
          // Skip if already ignored (they won't be reprocessed)
          if (ignoredTitles.hasOwnProperty(title.title_id)) {
            ignoredCount++;
            return;
          }

          const tmdbId = await tmdbProvider.matchTMDBIdForTitle(title, type, providerType);
          
          if (tmdbId) {
            title.tmdb_id = tmdbId;
            title.lastUpdated = new Date().toISOString();
            updatedTitles.push(title);
            matchedCount++;
            
            // Remove from ignored list if it was previously ignored
            if (ignoredTitles.hasOwnProperty(title.title_id)) {
              delete ignoredTitles[title.title_id];
            }
          } else {
            // Add to ignored list with reason
            ignoredTitles[title.title_id] = 'TMDB matching failed';
            ignoredCount++;
          }
        }));

        totalRemaining = titlesWithoutTMDB.length - (matchedCount + ignoredCount);
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        providerInstance.updateProgress(progressKey, totalRemaining);

        // Log progress every batch
        if ((i + batchSize) % 100 === 0 || i + batchSize >= titlesWithoutTMDB.length) {
          this.logger.debug(`[${providerId}] Progress: ${Math.min(i + batchSize, titlesWithoutTMDB.length)}/${titlesWithoutTMDB.length} ${type} titles processed (${matchedCount} matched, ${ignoredCount} ignored)`);
        }
      }
    } finally {
      // Save any remaining accumulated titles before unregistering
      await saveCallback();
      
      // Unregister this type from progress tracking (will also call save callback)
      providerInstance.unregisterProgress(progressKey);
    }

    return { matched: matchedCount, ignored: ignoredCount };
  }

  /**
   * Match TMDB IDs for all provider titles across all providers
   * Matches titles that don't have a TMDB ID using multiple strategies:
   * 1. For AGTV provider: use title_id (IMDB ID) directly
   * 2. Fallback: search by title name
   * 3. If both fail: mark as ignored for future re-matching
   * @returns {Promise<void>}
   */
  async matchAllTMDBIds() {
    if (this.providers.size === 0) {
      this.logger.warn('No providers available for TMDB ID matching.');
      return;
    }

    this.logger.debug(`Starting TMDB ID matching process for ${this.providers.size} provider(s)...`);
    
    for (const [providerId, providerInstance] of this.providers) {
      try {
        this.logger.info(`[${providerId}] Processing TMDB ID matching...`);
        
        const [moviesResult, tvShowsResult] = await Promise.all([
          this._matchTMDBIdsForProviderType(providerInstance, providerId, 'movies'),
          this._matchTMDBIdsForProviderType(providerInstance, providerId, 'tvshows')
        ]);

        this.logger.info(
          `[${providerId}] TMDB ID matching completed: ` +
          `Movies - ${moviesResult.matched} matched, ${moviesResult.ignored} ignored; ` +
          `TV Shows - ${tvShowsResult.matched} matched, ${tvShowsResult.ignored} ignored`
        );
      } catch (error) {
        this.logger.error(`[${providerId}] Error during TMDB ID matching: ${error.message}`);
      }
    }

    this.logger.info('TMDB ID matching process completed');
  }

  /**
   * Generate main titles from all provider titles with TMDB IDs
   * Groups provider titles by TMDB ID and creates main titles using TMDB API data
   * @returns {Promise<{movies: number, tvShows: number}>} Count of generated main titles
   */
  async generateMainTitles() {
    if (this.providers.size === 0) {
      this.logger.warn('No providers available for main title generation.');
      return { movies: 0, tvShows: 0 };
    }

    this.logger.info('Starting main title generation process...');
    const tmdbProvider = this.getTMDBProvider();
    const batchSize = tmdbProvider.getRecommendedBatchSize();

    // Process movies and TV shows separately
    const [moviesCount, tvShowsCount] = await Promise.all([
      this._generateMainTitlesForType('movies', batchSize),
      this._generateMainTitlesForType('tvshows', batchSize)
    ]);

    this.logger.info(
      `Main title generation completed: ${moviesCount} movies, ${tvShowsCount} TV shows`
    );

    return { movies: moviesCount, tvShows: tvShowsCount };
  }

  /**
   * Generate main titles for a specific type (movies or tvshows)
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {number} batchSize - Batch size for processing
   * @returns {Promise<number>} Count of generated main titles
   */
  async _generateMainTitlesForType(type, batchSize) {
    // Collect all provider titles with TMDB IDs
    const providerTitlesByTMDB = new Map(); // Map<tmdbId, Array<{providerId, title}>>

    for (const [providerId, providerInstance] of this.providers) {
      const titles = providerInstance.loadTitles(type);
      
      titles.forEach(title => {
        if (title.tmdb_id) {
          const tmdbId = title.tmdb_id;
          
          if (!providerTitlesByTMDB.has(tmdbId)) {
            providerTitlesByTMDB.set(tmdbId, []);
          }
          
          providerTitlesByTMDB.get(tmdbId).push({
            providerId,
            title
          });
        }
      });
    }

    if (providerTitlesByTMDB.size === 0) {
      this.logger.info(`No ${type} with TMDB IDs found for main title generation`);
      return 0;
    }

    this.logger.info(`Generating ${providerTitlesByTMDB.size} main ${type} titles...`);

    const tmdbProvider = this.getTMDBProvider();
    const uniqueTMDBIds = Array.from(providerTitlesByTMDB.keys());
    const mainTitles = [];
    let processedCount = 0;

    // Load existing main titles to preserve createdAt timestamps
    const existingMainTitles = this.data.get('main', `${type}.json`) || [];
    const existingMainTitleMap = new Map(
      existingMainTitles.map(t => [t.title_id, t])
    );

    // Track remaining titles for progress
    let totalRemaining = uniqueTMDBIds.length;

    // Save callback for progress tracking
    const saveCallback = async () => {
      if (mainTitles.length > 0) {
        try {
          await this._saveMainTitles(type, mainTitles, existingMainTitleMap);
          this.logger.debug(`Saved ${mainTitles.length} accumulated main ${type} titles via progress callback`);
          mainTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated main ${type} titles: ${error.message}`);
        }
      }
    };

    // Register for progress tracking
    const progressKey = `main_${type}`;
    tmdbProvider.registerProgress(progressKey, totalRemaining, saveCallback);

    try {
      // Process in batches
      for (let i = 0; i < uniqueTMDBIds.length; i += batchSize) {
        const batch = uniqueTMDBIds.slice(i, i + batchSize);

        await Promise.all(batch.map(async (tmdbId) => {
          const providerTitleGroups = providerTitlesByTMDB.get(tmdbId);
          
          const mainTitle = await tmdbProvider.generateMainTitle(
            tmdbId,
            type,
            providerTitleGroups
          );

          if (mainTitle) {
            // Preserve createdAt if title already exists
            const existing = existingMainTitleMap.get(tmdbId);
            if (existing && existing.createdAt) {
              mainTitle.createdAt = existing.createdAt;
            }
            
            mainTitles.push(mainTitle);
            processedCount++;
          }
        }));

        totalRemaining = uniqueTMDBIds.length - processedCount;
        tmdbProvider.updateProgress(progressKey, totalRemaining);

        // Log progress
        if ((i + batchSize) % 100 === 0 || i + batchSize >= uniqueTMDBIds.length) {
          this.logger.debug(
            `Progress: ${Math.min(i + batchSize, uniqueTMDBIds.length)}/${uniqueTMDBIds.length} ` +
            `${type} main titles processed`
          );
        }
      }
    } finally {
      // Save any remaining accumulated titles
      await saveCallback();
      
      // Unregister from progress tracking
      tmdbProvider.unregisterProgress(progressKey);
    }

    // Final save to ensure all titles are saved
    if (mainTitles.length > 0) {
      await this._saveMainTitles(type, mainTitles, existingMainTitleMap);
    }

    return processedCount;
  }

  /**
   * Save main titles to data directory
   * @private
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Array<Object>} newMainTitles - Array of new main titles to save
   * @param {Map<number, Object>} existingMainTitleMap - Map of existing main titles by title_id
   * @returns {Promise<void>}
   */
  async _saveMainTitles(type, newMainTitles, existingMainTitleMap) {
    const cacheKey = ['main', `${type}.json`];
    const existingTitles = this.data.get(...cacheKey) || [];

    // Create map of new titles by title_id
    const newTitleMap = new Map(newMainTitles.map(t => [t.title_id, t]));

    // Merge: update existing titles that are in newTitles, keep others unchanged
    const updatedTitles = existingTitles.map(existing => {
      const updated = newTitleMap.get(existing.title_id);
      return updated || existing;
    });

    // Add new titles that don't exist yet
    const existingIds = new Set(existingTitles.map(t => t.title_id));
    newMainTitles.forEach(newTitle => {
      if (!existingIds.has(newTitle.title_id)) {
        updatedTitles.push(newTitle);
      }
    });

    // Sort by title_id for consistency
    updatedTitles.sort((a, b) => a.title_id - b.title_id);

    try {
      this.data.set(updatedTitles, ...cacheKey);
      this.logger.info(`Saved ${newMainTitles.length} main ${type} titles (total: ${updatedTitles.length})`);
    } catch (error) {
      this.logger.error(`Error saving main ${type} titles: ${error.message}`);
      throw error;
    }
  }
}

