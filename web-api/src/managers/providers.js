import { DatabaseCollections, DataProvider } from '../config/collections.js';
import { toCollectionName } from '../config/collections.js';
import { createLogger } from '../utils/logger.js';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('ProvidersManager');

/**
 * Providers manager for handling IPTV provider operations
 * Uses DatabaseService collection-based methods for all data access
 */
class ProvidersManager {
  /**
   * @param {import('../services/database.js').DatabaseService} database - Database service instance
   * @param {import('../services/websocket.js').WebSocketService} webSocketService - WebSocket service instance
   * @param {import('./titles.js').TitlesManager} titlesManager - Titles manager instance
   */
  constructor(database, webSocketService, titlesManager) {
    this._database = database;
    this._webSocketService = webSocketService;
    this._titlesManager = titlesManager;
    this._providersCollection = toCollectionName(DatabaseCollections.IPTV_PROVIDERS);
  }

  /**
   * Get IPTV provider types
   */
  _getIPTVProviderTypes() {
    return [DataProvider.AGTV, DataProvider.XTREAM];
  }

  /**
   * Get ignored titles for a specific provider
   * Reads from data/titles/{providerId}.ignored.json
   * Enriches with title information from provider's titles data
   * @param {string} providerId - Provider ID
   * @returns {Promise<{response: object, statusCode: number}>}
   */
  async getIgnoredTitles(providerId) {
    try {
      // Validate provider exists
      const providerResult = await this.getProvider(providerId);
      if (providerResult.statusCode !== 200) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Load ignored titles from collection
      const collectionName = `${providerId}.ignored`;
      const ignoredTitles = await this._database.getDataObject(collectionName);

      if (!ignoredTitles || typeof ignoredTitles !== 'object') {
        return {
          response: [],
          statusCode: 200,
        };
      }

      // Get provider titles data to enrich ignored titles with name and year
      const providerTitlesCollection = `${providerId}.titles`;
      const providerTitlesArray = await this._database.getDataList(providerTitlesCollection);
      
      // Create a Map keyed by title_key for quick lookup
      const providerTitlesMap = new Map();
      if (Array.isArray(providerTitlesArray)) {
        for (const title of providerTitlesArray) {
          if (title.title_key) {
            providerTitlesMap.set(title.title_key, title);
          }
        }
      }

      // Transform to array format: [{ title_key, issue, name, year }]
      const ignoredList = Object.entries(ignoredTitles).map(([titleKey, issue]) => {
        const titleData = providerTitlesMap.get(titleKey);
        const year = titleData?.release_date ? new Date(titleData.release_date).getFullYear() : null;
        
        return {
          title_key: titleKey,
          issue: issue || 'Unknown issue',
          name: titleData?.title || null,
          year: year || null
        };
      });

      return {
        response: ignoredList,
        statusCode: 200,
      };
    } catch (error) {
      logger.error(`Error getting ignored titles for provider ${providerId}:`, error);
      return {
        response: { error: 'Failed to get ignored titles' },
        statusCode: 500,
      };
    }
  }

  /**
   * Normalize provider URLs
   */
  _normalizeUrls(providerData, existingProvider = null) {
    const providerType = providerData.type || (existingProvider ? existingProvider.type : null);
    
    // Use streams_urls as provided
    let urls = providerData.streams_urls || [];

    // Only Xtream supports multiple stream URLs
    if (providerType !== DataProvider.XTREAM && urls.length > 1) {
      urls = urls.slice(0, 1);
    }

    providerData.streams_urls = urls;

    return providerData;
  }

  /**
   * Read all providers from collection
   * Uses DatabaseService collection-based methods
   * @private
   */
  async _readAllProviders() {
    try {
      const providers = await this._database.getDataList(this._providersCollection);
      return Array.isArray(providers) ? providers : [];
    } catch (error) {
      logger.error('Error reading providers:', error);
      return [];
    }
  }

  /**
   * Write all providers to collection
   * Uses DatabaseService collection-based methods
   * @private
   */
  async _writeAllProviders(providers) {
    // Delete all existing providers and insert new ones
    // This is a simple approach - in production, you might want to update individual items
    const existingProviders = await this._database.getDataList(this._providersCollection);
    
    // Delete all existing
    for (const provider of existingProviders) {
      await this._database.deleteData(this._providersCollection, { id: provider.id });
    }
    
    // Insert all new
    if (providers.length > 0) {
      await this._database.insertDataList(this._providersCollection, providers);
    }
  }

  /**
   * Get all IPTV providers
   */
  async getProviders() {
    try {
      const providers = await this._readAllProviders();

      return {
        response: { providers },
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error getting providers:', error);
      return {
        response: { error: 'Failed to get providers', providers: [] },
        statusCode: 500,
      };
    }
  }

  /**
   * Get a specific IPTV provider
   */
  async getProvider(providerId) {
    try {
      const providers = await this._readAllProviders();
      const provider = providers.find(p => p.id === providerId);

      if (!provider) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      return {
        response: provider,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error getting provider:', error);
      return {
        response: { error: 'Failed to get provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Create a new IPTV provider
   */
  async createProvider(providerData) {
    try {
      // Validate provider type
      const providerType = providerData.type;
      const validTypes = this._getIPTVProviderTypes();
      if (!validTypes.includes(providerType)) {
        return {
          response: {
            error: `Invalid provider type. Must be one of: ${validTypes.join(', ')}`
          },
          statusCode: 400,
        };
      }

      // Require manual ID on creation (no auto-generation)
      const providedId = (providerData.id || '').trim();
      if (!providedId) {
        return {
          response: { error: 'Provider id is required and must be unique' },
          statusCode: 400,
        };
      }
      // Slugify provider ID once at creation - use consistently everywhere after
      providerData.id = slugify(providedId, { lower: true, strict: true });

      // Check if provider already exists
      const providers = await this._readAllProviders();
      if (providers.some(p => p.id === providerData.id)) {
        return {
          response: { error: 'Provider with this id already exists' },
          statusCode: 409,
        };
      }

      // Normalize URLs
      this._normalizeUrls(providerData);

      // Set default values
      if (providerData.enabled === undefined) {
        providerData.enabled = true;
      }

      if (providerData.priority === undefined) {
        const maxPriority = Math.max(
          ...providers.map(p => p.priority || 0),
          0
        );
        providerData.priority = maxPriority + 1;
      }

      // Add provider to array and save
      providers.push(providerData);
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerData.id,
        action: 'created'
      });

      return {
        response: providerData,
        statusCode: 201,
      };
    } catch (error) {
      logger.error('Error creating provider:', error);
      return {
        response: { error: 'Failed to create provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update an existing IPTV provider
   */
  async updateProvider(providerId, providerData) {
    try {
      // Load all providers
      const providers = await this._readAllProviders();
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      const existingProvider = providers[providerIndex];

      // Check if provider is being disabled
      const wasEnabled = existingProvider.enabled !== false;
      const willBeEnabled = providerData.enabled !== false;

      // If provider is being disabled, remove it from all stream sources
      if (wasEnabled && !willBeEnabled && this._titlesManager) {
        try {
          await this._titlesManager.removeProviderFromStreams(providerId);
        } catch (error) {
          // Log error but don't fail the provider update
          logger.error(`Error removing provider ${providerId} from streams:`, error);
        }
      }

      // Normalize URLs
      this._normalizeUrls(providerData, existingProvider);

      // Update provider data (preserve id)
      const updatedProvider = {
        ...existingProvider,
        ...providerData,
        id: providerId, // Ensure id doesn't change
      };

      // Update in array and save
      providers[providerIndex] = updatedProvider;
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'updated'
      });

      return {
        response: updatedProvider,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error updating provider:', error);
      return {
        response: { error: 'Failed to update provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Delete an IPTV provider
   */
  async deleteProvider(providerId) {
    try {
      // Load all providers
      const providers = await this._readAllProviders();
      const providerIndex = providers.findIndex(p => p.id === providerId);

      if (providerIndex === -1) {
        return {
          response: { error: 'Provider not found' },
          statusCode: 404,
        };
      }

      // Remove provider from array and save
      providers.splice(providerIndex, 1);
      await this._writeAllProviders(providers);

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: providerId,
        action: 'deleted'
      });

      return {
        response: {},
        statusCode: 204,
      };
    } catch (error) {
      logger.error('Error deleting provider:', error);
      return {
        response: { error: 'Failed to delete provider' },
        statusCode: 500,
      };
    }
  }

  /**
   * Get all provider priorities
   */
  async getProviderPriorities() {
    try {
      return await this.getProviders();
    } catch (error) {
      logger.error('Error getting provider priorities:', error);
      return {
        response: { error: 'Failed to get provider priorities' },
        statusCode: 500,
      };
    }
  }

  /**
   * Update provider priorities
   */
  async updateProviderPriorities(prioritiesData) {
    try {
      const allProviders = await this._readAllProviders();
      const priorityUpdates = prioritiesData.providers || [];

      // Update each provider's priority
      for (const update of priorityUpdates) {
        const providerId = update.id;
        const priority = update.priority;

        if (providerId && priority !== undefined && priority !== null) {
          const providerIndex = allProviders.findIndex(p => p.id === providerId);
          if (providerIndex !== -1) {
            allProviders[providerIndex].priority = priority;
          }
        }
      }

      // Save all providers
      await this._writeAllProviders(allProviders);

      // Broadcast WebSocket event
      this._webSocketService.broadcastEvent('provider_changed', {
        provider_id: 'all',
        action: 'updated'
      });

      return {
        response: prioritiesData,
        statusCode: 200,
      };
    } catch (error) {
      logger.error('Error updating provider priorities:', error);
      return {
        response: { error: 'Failed to update provider priorities' },
        statusCode: 500,
      };
    }
  }
}

// Export class
export { ProvidersManager };