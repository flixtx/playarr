import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createRequireAdmin } from '../middleware/admin.js';

/**
 * Categories router for handling category endpoints
 */
class CategoriesRouter {
  /**
   * @param {CategoriesManager} categoriesManager - Categories manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(categoriesManager, database) {
    this._categoriesManager = categoriesManager;
    this._database = database;
    this._requireAuth = createRequireAuth(database);
    this._requireAdmin = createRequireAdmin(this._requireAuth);
    this.router = express.Router();
    this._setupRoutes();
  }

  /**
   * Setup all routes for this router
   * @private
   */
  _setupRoutes() {
    /**
     * GET /api/iptv/providers/:provider_id/categories
     * Get categories for a specific IPTV provider
     */
    this.router.get('/providers/:provider_id/categories', this._requireAuth, async (req, res) => {
      try {
        const { provider_id } = req.params;
        const result = await this._categoriesManager.getCategories(provider_id);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get provider categories error:', error);
        return res.status(500).json({ error: 'Failed to get categories' });
      }
    });

    /**
     * PUT /api/iptv/providers/:provider_id/categories/:category_key
     * Update a specific category for an IPTV provider (admin only)
     */
    this.router.put('/providers/:provider_id/categories/:category_key', this._requireAdmin, async (req, res) => {
      try {
        const { provider_id, category_key } = req.params;
        const categoryData = req.body;

        if (!categoryData || Object.keys(categoryData).length === 0) {
          return res.status(400).json({ error: 'Request body is required' });
        }

        const result = await this._categoriesManager.updateCategory(provider_id, category_key, categoryData);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update provider category error:', error);
        return res.status(500).json({ error: 'Failed to update category' });
      }
    });
  }
}

export default CategoriesRouter;
