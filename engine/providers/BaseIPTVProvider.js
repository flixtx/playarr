/**
 * @typedef {Object} TitleData
 * @property {string} [stream_id]
 * @property {string} [series_id]
 * @property {string} [stream_display_name]
 * @property {string} [name]
 * @property {string} [title]
 * @property {string} [container_extension]
 * @property {Object} [info]
 * @property {number} [category_id]
 * @property {string} [category_name]
 * @property {string} [url]
 * @property {number} [duration]
 * @property {string} [type]
 * @property {string} [createdAt] - ISO timestamp when title was first created
 * @property {string} [lastUpdated] - ISO timestamp when title was last updated
 * @property {Object<string, string>} [streams] - Dictionary of stream URLs (key: "main" for movies, "Sxx-Exx" for TV shows)
 * @property {Array} [episodes] - Array of episode data (for TV shows)
 */

import { BaseProvider } from './BaseProvider.js';

/**
 * Base class for all IPTV providers (AGTV, Xtream)
 * Extends BaseProvider with IPTV-specific functionality
 * @abstract
 */
export class BaseIPTVProvider extends BaseProvider {
  /**
   * @param {Object} providerData - Provider configuration data
   * @param {import('../managers/StorageManager.js').StorageManager} cache - Storage manager instance for temporary cache
   * @param {import('../managers/StorageManager.js').StorageManager} data - Storage manager instance for persistent data storage
   */
  constructor(providerData, cache, data) {
    super(providerData, cache, data);
  }

  /**
   * Get the provider type identifier
   * @returns {string} Provider type (e.g., 'agtv', 'xtream')
   * @abstract
   */
  getProviderType() {
    throw new Error('getProviderType() must be implemented by subclass');
  }

  /**
   * Fetch categories from the provider
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array<{category_id: number, category_name: string}>>} Array of category data
   * @abstract
   */
  async fetchCategories(type) {
    throw new Error('fetchCategories(type) must be implemented by subclass');
  }

  /**
   * Fetch metadata from the provider and save it
   * Template method pattern - delegates to provider-specific methods
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<number>} Number of titles processed and saved
   * @override
   */
  async fetchMetadata(type) {
    this.logger.info(`${type}: Starting fetchMetadata`);

    // Step 1: Fetch titles metadata (provider-specific)
    const titles = await this._fetchTitlesMetadata(type);

    // Step 2: Filter titles (provider-specific)
    const filteredTitles = await this._filterTitles(titles, type);

    this.logger.info(`${type}: Filtered ${filteredTitles.length} titles to process`);

    // Step 3: Process in batches for memory efficiency
    // Batch size controls memory usage (max concurrent promises), not save frequency
    const batchSize = 100; // Process 100 at a time to limit memory
    const batches = [];
    for (let i = 0; i < filteredTitles.length; i += batchSize) {
      batches.push(filteredTitles.slice(i, i + batchSize));
    }

    this.logger.info(`${type}: Processing ${batches.length} batch(es) of up to ${batchSize} titles each`);

    let totalProcessed = 0;
    let totalRemaining = filteredTitles.length;
    
    // Accumulate processed titles for periodic saving (not batch-based)
    const processedTitles = [];
    
    // Save callback for progress tracking (called every 30 seconds and on completion)
    const saveCallback = async () => {
      if (processedTitles.length > 0) {
        try {
          await this.saveTitles(type, processedTitles);
          this.logger.debug(`${type}: Saved ${processedTitles.length} accumulated title(s) via progress callback`);
          processedTitles.length = 0; // Clear after saving
        } catch (error) {
          this.logger.error(`Error saving accumulated titles for ${type}: ${error.message}`);
        }
      }
    };

    // Register this type for progress tracking with save callback
    this.registerProgress(type, totalRemaining, saveCallback);

    try {
      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchStart = batchIndex * batchSize + 1;
        const batchEnd = Math.min((batchIndex + 1) * batchSize, filteredTitles.length);

        this.logger.debug(`${type}: Starting batch ${batchIndex + 1}/${batches.length} (titles ${batchStart}-${batchEnd})`);

        // Process batch titles in parallel (rate limiting happens inside fetchWithCache)
        const batchPromises = batch.map(title => 
          this._processSingleTitle(title, type)
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Accumulate results instead of saving immediately
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value) {
            const processedTitle = this._buildProcessedTitleData(result.value, type);
            processedTitles.push(processedTitle);
            totalProcessed++;
          } else if (result.status === 'rejected') {
            this.logger.warn(`${type}: Failed to process title: ${result.reason?.message || result.reason}`);
          }
        }

        totalRemaining = filteredTitles.length - totalProcessed;
        
        // Update progress tracking (triggers save callback every 30 seconds if configured)
        this.updateProgress(type, totalRemaining);

        // Log progress every batch
        this.logger.info(`${type}: Completed batch ${batchIndex + 1}/${batches.length} - ${totalProcessed} title(s) processed, ${totalRemaining} remaining`);
      }
    } finally {
      // Save any remaining accumulated titles before unregistering
      await saveCallback();
      
      // Unregister this type from progress tracking (will also call save callback)
      this.unregisterProgress(type);
    }

    this.logger.info(`${type}: Completed processing - ${totalProcessed} title(s) processed and saved`);
    
    return totalProcessed;
  }

  /**
   * Fetch titles metadata from provider (provider-specific)
   * @abstract
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of raw title objects
   */
  async _fetchTitlesMetadata(type) {
    throw new Error('_fetchTitlesMetadata(type) must be implemented by subclass');
  }

  /**
   * Filter titles based on provider-specific rules (provider-specific)
   * @abstract
   * @param {Array} titles - Array of raw title objects
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Array>} Array of filtered title objects
   */
  async _filterTitles(titles, type) {
    throw new Error('_filterTitles(titles, type) must be implemented by subclass');
  }

  /**
   * Process a single title (provider-specific)
   * @abstract
   * @param {Object} title - Raw title object
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Promise<Object|null>} Processed title object or null if should be skipped
   */
  async _processSingleTitle(title, type) {
    throw new Error('_processSingleTitle(title, type) must be implemented by subclass');
  }

  /**
   * Build processed title data object (provider-specific)
   * @abstract
   * @param {Object} title - Title object after processing
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object} Clean title data object
   */
  _buildProcessedTitleData(title, type) {
    throw new Error('_buildProcessedTitleData(title, type) must be implemented by subclass');
  }

  /**
   * Apply cleanup rules to title names
   * @param {string} title - Title to clean up
   * @returns {string} Cleaned title
   */
  cleanupTitle(title) {
    if (!this.providerData.cleanup || typeof title !== 'string') {
      return title;
    }

    let cleaned = title;
    for (const [pattern, replacement] of Object.entries(this.providerData.cleanup)) {
      try {
        const regex = new RegExp(pattern, 'g');
        cleaned = cleaned.replace(regex, replacement);
      } catch (error) {
        this.logger.warn(`Invalid cleanup pattern: ${pattern}`, error.message);
      }
    }

    return cleaned.trim();
  }

  /**
   * Save categories for a provider by type
   * Merges with existing categories, preserving enabled status
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {Array<{category_id: number|string, category_name: string}>} categories - Array of category data objects
   * @returns {Object} Saved category data object
   */
  saveCategories(type, categories) {
    const category_data_key = ['categories', this.providerId, `${type}.json`];
    const existingData = this.data.get(...category_data_key);
    let existingCategories = [];
    
    if (existingData && existingData.categories) {
      existingCategories = existingData.categories;
    }
    
    // Create a map of existing categories by ID to preserve enabled status
    const existingMap = new Map();
    existingCategories.forEach(cat => {
      existingMap.set(cat.category_id, cat.enabled);
    });
    
    // Merge: preserve enabled status for existing categories, default to false for new ones
    const mergedCategories = categories.map(cat => ({
      category_id: cat.category_id || cat.id,
      category_name: cat.category_name || cat.name,
      enabled: existingMap.has(cat.category_id || cat.id) 
        ? existingMap.get(cat.category_id || cat.id) 
        : false // Default to disabled for new categories
    }));
    
    const categoryData = {
      providerId: this.providerId,
      type,
      count: mergedCategories.length,
      fetchedAt: new Date().toISOString(),
      categories: mergedCategories
    };
    
    this.data.set(categoryData, ...category_data_key);
    return categoryData;
  }

  /**
   * Load categories for a provider by type
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @returns {Array<{category_id: number, category_name: string, enabled: boolean}>} Array of category data objects
   */
  loadCategories(type) {
    const categoryData = this.data.get('categories', this.providerId, `${type}.json`);
    if (categoryData && categoryData.categories) {
      return categoryData.categories;
    }
    
    return [];
  }

  /**
   * Get category enabled status by ID and type
   * @param {string} type - Category type ('movies' or 'tvshows')
   * @param {number} categoryId - Category ID
   * @returns {boolean} True if category is enabled, false otherwise (defaults to false if not found)
   */
  isCategoryEnabled(type, categoryId) {
    const categories = this.loadCategories(type);
    const category = categories.find(cat => cat.category_id === categoryId);
    return category ? category.enabled : false;
  }

  /**
   * Load titles metadata for a specific type
   * Loads from centralized file: data/titles/{providerId}/{type}.json
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @returns {TitleData[]} Array of title data objects
   */
  loadTitles(type) {
    try {
      const titles = this.data.get('titles', this.providerId, `${type}.json`);
      return Array.isArray(titles) ? titles : [];
    } catch (error) {
      this.logger.debug(`No titles file found for ${type}: ${error.message}`);
      return [];
    }
  }

  /**
   * Save titles metadata to a centralized file per provider per media type
   * Saves all titles to: data/titles/{providerId}/{type}.json
   * @param {string} type - Title type ('movies' or 'tvshows')
   * @param {TitleData[]} titles - Array of title data objects to save
   * @returns {Promise<{saved: number}>} Number of titles saved
   */
  async saveTitles(type, titles) {
    this.logger.debug(`Saving ${titles.length} titles for ${type}`);

    const now = new Date().toISOString();
    const titlesCacheKey = ['titles', this.providerId, `${type}.json`];
    
    // Load existing titles to preserve createdAt timestamps
    const existingTitles = this.data.get(...titlesCacheKey) || [];
    const existingTitleMap = new Map(existingTitles.map(t => [t.title_id, t]));

    // Merge new titles with existing ones
    const mergedTitles = titles.map(title => {
      if (!title.title_id) return null;

      const existingTitle = existingTitleMap.get(title.title_id);
      
      return {
        ...title,
        createdAt: existingTitle?.createdAt || now,
        lastUpdated: now
      };
    }).filter(Boolean);

    // Combine with existing titles that weren't updated
    const updatedTitleIds = new Set(mergedTitles.map(t => t.title_id));
    const unchangedTitles = existingTitles.filter(t => t.title_id && !updatedTitleIds.has(t.title_id));

    const allTitles = [...unchangedTitles, ...mergedTitles];

    try {
      this.data.set(allTitles, ...titlesCacheKey);
      this.logger.info(`Saved ${mergedTitles.length} titles for ${type}`);
      return { saved: mergedTitles.length };
    } catch (error) {
      this.logger.error(`Error saving titles for ${type}: ${error.message}`);
      throw error;
    }    
  }

  /**
   * Load ignored titles from JSON file
   * Loads from: data/titles/{providerId}/{type}.ignored.json
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @returns {Object<string, string>} Object mapping title_id to reason for ignoring
   */
  loadIgnoredTitles(type) {
    try {
      const ignored = this.data.get('titles', this.providerId, `${type}.ignored.json`);
      return ignored && typeof ignored === 'object' && !Array.isArray(ignored) ? ignored : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Save ignored titles to JSON file
   * Saves to: data/titles/{providerId}/{type}.ignored.json
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {Object<string, string>} ignoredTitles - Object mapping title_id to reason for ignoring
   */
  saveIgnoredTitles(type, ignoredTitles) {
    try {
      this.data.set(ignoredTitles, 'titles', this.providerId, `${type}.ignored.json`);
      const count = Object.keys(ignoredTitles).length;
      this.logger.info(`Saved ${count} ignored ${type} titles`);
    } catch (error) {
      this.logger.error(`Error saving ignored titles for ${type}: ${error.message}`);
    }
  }

  /**
   * Add a title to the ignored list with a reason
   * @param {string} type - Media type ('movies' or 'tvshows')
   * @param {string} titleId - Title ID to ignore
   * @param {string} reason - Reason for ignoring (e.g., "Extended info fetch failed", "TMDB matching failed")
   */
  addIgnoredTitle(type, titleId, reason) {
    const ignoredTitles = this.loadIgnoredTitles(type);
    ignoredTitles[titleId] = reason;
    this.saveIgnoredTitles(type, ignoredTitles);
  }
}

