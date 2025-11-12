import { BaseManager } from './BaseManager.js';
import { DatabaseCollections, toCollectionName } from '../config/collections.js';

/**
 * Categories manager for handling IPTV provider categories
 * Matches Python's CategoriesService
 * Uses DatabaseService collection-based methods for all data access
 */
class CategoriesManager extends BaseManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('./providers.js').ProvidersManager} providersManager - Providers manager instance
   */
  constructor(database, providersManager) {
    super('CategoriesManager', database);
    this._providersManager = providersManager;
  }

  /**
   * Get provider by ID (from providers manager)
   */
  async _getProviderById(providerId) {
    try {
      const result = await this._providersManager.getProvider(providerId);
      return result.statusCode === 200 ? result.response : null;
    } catch (error) {
      this.logger.error(`Error getting provider ${providerId}:`, error);
      return null;
    }
  }

  /**
   * Get collection name for provider-specific categories
   * @private
   */
  _getCategoriesCollectionName(providerId) {
    return toCollectionName(DatabaseCollections.CATEGORIES, providerId);
  }

  /**
   * Transform category from engine format to API format
   * @private
   * @param {Object} cat - Category object from database
   * @param {Set<string>} enabledCategoryKeys - Set of enabled category keys from provider config
   */
  _transformCategoryToApiFormat(cat, enabledCategoryKeys = null) {
    const categoryKey = cat.category_key || `${cat.type}-${cat.category_id}`;
    // If enabledCategoryKeys is provided, use it; otherwise default to false
    const enabled = enabledCategoryKeys ? enabledCategoryKeys.has(categoryKey) : (cat.enabled !== undefined ? cat.enabled : false);
    return {
      key: categoryKey,
      type: cat.type, // Use engine type directly (tvshows or movies)
      category_id: cat.category_id,
      category_name: cat.category_name,
      enabled: enabled
    };
  }

  /**
   * Get categories for a specific provider
   * Reads enabled status from provider config's enabled_categories field
   * Matches Python's CategoriesService.get_categories()
   */
  async getCategories(providerId) {
    try {
      // Validate provider exists
      const provider = await this._getProviderById(providerId);
      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Load categories from collection (database service handles caching internally)
      const collectionName = this._getCategoriesCollectionName(providerId);
      const categories = await this._database.getDataList(collectionName);

      if (!categories || !Array.isArray(categories)) {
        return {
          response: [],
          statusCode: 200,
        };
      }

      // Get enabled categories from provider config
      const enabledCategories = provider.enabled_categories || { movies: [], tvshows: [] };
      const enabledCategoryKeys = new Set([
        ...(enabledCategories.movies || []),
        ...(enabledCategories.tvshows || [])
      ]);

      // Transform categories to API format with enabled status from provider config
      const transformedCategories = categories.map(cat => this._transformCategoryToApiFormat(cat, enabledCategoryKeys));

      return {
        response: transformedCategories,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error getting categories:', error);
      return {
        response: { error: 'Failed to get categories' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update enabled categories in batch for a provider
   * Updates provider document's enabled_categories field and triggers engine action
   * @param {string} providerId - Provider ID
   * @param {Object} enabledCategories - Object with movies and tvshows arrays of category keys
   * @param {Array<string>} enabledCategories.movies - Array of enabled movie category keys
   * @param {Array<string>} enabledCategories.tvshows - Array of enabled TV show category keys
   * @returns {Promise<{response: Object, statusCode: number}>}
   */
  async updateCategoriesBatch(providerId, enabledCategories) {
    try {
      // Validate provider exists
      const provider = await this._getProviderById(providerId);
      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Validate enabledCategories structure
      if (!enabledCategories || typeof enabledCategories !== 'object') {
        return {
          response: { error: 'enabledCategories must be an object with movies and tvshows arrays' },
          statusCode: 400,
        };
      }

      if (!Array.isArray(enabledCategories.movies) || !Array.isArray(enabledCategories.tvshows)) {
        return {
          response: { error: 'enabledCategories must have movies and tvshows arrays' },
          statusCode: 400,
        };
      }

      // Update provider document's enabled_categories field
      const collection = this._database.getCollection('iptv_providers');
      const now = new Date();
      
      await collection.updateOne(
        { id: providerId },
        {
          $set: {
            enabled_categories: {
              movies: enabledCategories.movies || [],
              tvshows: enabledCategories.tvshows || []
            },
            lastUpdated: now
          }
        }
      );

      // Perform cleanup for disabled categories
      try {
        // Remove provider from titles for disabled categories
        const { titlesUpdated, streamsRemoved, titleKeys } = 
          await this._database.removeProviderFromTitles(providerId, null, enabledCategories);
        
        // Delete titles without streams
        const deletedEmptyTitles = await this._database.deleteTitlesWithoutStreams(titleKeys);
        
        this.logger.info(
          `Provider ${providerId} categories changed cleanup: ${titlesUpdated} titles updated, ` +
          `${streamsRemoved} streams removed, ${deletedEmptyTitles} empty titles deleted`
        );
      } catch (error) {
        this.logger.error(`Error cleaning up categories for provider ${providerId}: ${error.message}`);
      }

      // Get updated provider config for engine
      const updatedProvider = await this._getProviderById(providerId);

      // Trigger engine notification for categories changed
      await this._notifyEngineProviderChanged(providerId, 'categories-changed', updatedProvider);

      return {
        response: {
          success: true,
          message: 'Categories updated successfully',
          enabled_categories: enabledCategories
        },
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating categories batch:', error);
      return {
        response: { error: 'Failed to update categories' },
        statusCode: 500,
      };
    }
  }

  /**
   * Notify engine of provider change
   * @private
   * @param {string} providerId - Provider ID
   * @param {string} action - Action type
   * @param {Object} [providerConfig] - Optional provider config
   */
  async _notifyEngineProviderChanged(providerId, action, providerConfig = null) {
    try {
      const axios = (await import('axios')).default;
      const engineApiUrl = process.env.ENGINE_API_URL || 'http://127.0.0.1:3002';
      
      await axios.post(
        `${engineApiUrl}/api/providers/${providerId}/changed`,
        {
          action,
          providerId,
          ...(providerConfig && { providerConfig })
        },
        { timeout: 5000 }
      );
      
      this.logger.info(`Notified engine: provider ${providerId} ${action}`);
    } catch (error) {
      this.logger.error(`Failed to notify engine for provider ${providerId}: ${error.message}`);
      // Don't throw - category update should succeed even if engine notification fails
    }
  }

  /**
   * Update a category for a specific provider (deprecated - use updateCategoriesBatch instead)
   * Updates provider's enabled_categories field for a single category
   * Kept for backward compatibility but should use batch updates
   */
  async updateCategory(providerId, categoryKey, categoryData) {
    try {
      // Validate provider exists
      const provider = await this._getProviderById(providerId);
      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Validate required fields
      if (categoryData.enabled === undefined) {
        return {
          response: { error: 'Missing required field: enabled' },
          statusCode: 400,
        };
      }

      if (categoryData.type === undefined) {
        return {
          response: { error: 'Missing required field: type' },
          statusCode: 400,
        };
      }

      // Validate type value
      if (!['movies', 'tvshows'].includes(categoryData.type)) {
        return {
          response: {
            error: "Invalid type. Must be one of: movies, tvshows",
          },
          statusCode: 400,
        };
      }

      // Parse category key: format is "{type}-{category_id}"
      const keyParts = categoryKey.split('-');
      if (keyParts.length < 2) {
        return {
          response: { error: 'Invalid category key format' },
          statusCode: 400,
        };
      }

      // Use type directly
      const categoryId = keyParts.slice(1).join('-'); // Handle category_id that might contain dashes
      const engineCategoryKey = `${categoryData.type}-${categoryId}`;

      // Get current enabled categories from provider
      const enabledCategories = provider.enabled_categories || { movies: [], tvshows: [] };
      const typeArray = enabledCategories[categoryData.type] || [];

      // Update the array
      let updatedArray;
      if (categoryData.enabled) {
        // Add if not already present
        updatedArray = typeArray.includes(engineCategoryKey) 
          ? typeArray 
          : [...typeArray, engineCategoryKey];
      } else {
        // Remove if present
        updatedArray = typeArray.filter(key => key !== engineCategoryKey);
      }

      // Update provider document
      const collection = this._database.getCollection('iptv_providers');
      const now = new Date();
      
      await collection.updateOne(
        { id: providerId },
        {
          $set: {
            [`enabled_categories.${categoryData.type}`]: updatedArray,
            lastUpdated: now
          }
        }
      );

      // Get updated provider config for engine
      const updatedProvider = await this._getProviderById(providerId);
      
      // Trigger engine notification for categories changed
      await this._notifyEngineProviderChanged(providerId, 'categories-changed', updatedProvider);

      // Get updated category for response
      const collectionName = this._getCategoriesCollectionName(providerId);
      const category = await this._database.getData(collectionName, { category_key: engineCategoryKey });
      
      if (!category) {
        return {
          response: { error: 'Category not found' },
          statusCode: 404,
        };
      }

      // Return in API format with updated enabled status
      const enabledCategoryKeys = new Set([engineCategoryKey]);
      const categoryResponse = this._transformCategoryToApiFormat(category, enabledCategoryKeys);
      categoryResponse.enabled = categoryData.enabled;

      return {
        response: categoryResponse,
        statusCode: 200,
      };
    } catch (error) {
      this.logger.error('Error updating category:', error);
      return {
        response: { error: 'Failed to update category' },
        statusCode: 500,
      };
    }
  }
}

// Export class
export { CategoriesManager };

