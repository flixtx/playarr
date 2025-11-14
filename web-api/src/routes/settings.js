import BaseRouter from './BaseRouter.js';

/**
 * Settings router for handling settings endpoints
 * Uses parameterized routes to support any setting key dynamically
 */
class SettingsRouter extends BaseRouter {
  /**
   * @param {SettingsManager} settingsManager - Settings manager instance
   * @param {import('../middleware/Middleware.js').default} middleware - Middleware instance
   */
  constructor(settingsManager, middleware) {
    super(middleware, 'SettingsRouter');
    this._settingsManager = settingsManager;
  }

  /**
   * Initialize routes for this router
   */
  initialize() {
    /**
     * GET /api/settings/:key
     * Get any setting by key
     */
    this.router.get('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const result = await this._settingsManager.getSetting(key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to get setting', `Get setting error: ${error.message}`);
      }
    });

    /**
     * POST /api/settings/:key
     * Set any setting by key
     */
    this.router.post('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const { value } = req.body;

        if (value === undefined) {
          return this.returnErrorResponse(res, 400, 'value is required');
        }

        const result = await this._settingsManager.setSetting(key, value);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to set setting', `Set setting error: ${error.message}`);
      }
    });

    /**
     * DELETE /api/settings/:key
     * Delete any setting by key
     */
    this.router.delete('/:key', this.middleware.requireAuth, async (req, res) => {
      try {
        const { key } = req.params;
        const result = await this._settingsManager.deleteSetting(key);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        return this.returnErrorResponse(res, 500, 'Failed to delete setting', `Delete setting error: ${error.message}`);
      }
    });
  }
}

export default SettingsRouter;
