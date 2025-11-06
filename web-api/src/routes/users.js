import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createRequireAdmin } from '../middleware/admin.js';

/**
 * Users router for handling user management endpoints
 */
class UsersRouter {
  /**
   * @param {UserManager} userManager - User manager instance
   * @param {DatabaseService} database - Database service instance
   */
  constructor(userManager, database) {
    this._userManager = userManager;
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
     * GET /api/users
     * List all users (admin only)
     */
    this.router.get('/', this._requireAdmin, async (req, res) => {
      try {
        const result = await this._userManager.getAllUsers();
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get all users error:', error);
        return res.status(500).json({ error: 'Failed to get users' });
      }
    });

    /**
     * POST /api/users
     * Create a new user (admin only)
     */
    this.router.post('/', this._requireAdmin, async (req, res) => {
      try {
        const { username, first_name, last_name, password, role } = req.body;

        if (!username || !first_name || !last_name || !password) {
          return res.status(400).json({
            error: 'Username, first_name, last_name, and password are required',
          });
        }

        const result = await this._userManager.createUserWithResponse(
          username,
          first_name,
          last_name,
          password,
          role
        );

        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ error: 'Failed to create user' });
      }
    });

    /**
     * GET /api/users/:username
     * Get user details (admin only)
     */
    this.router.get('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.getUser(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({ error: 'Failed to get user' });
      }
    });

    /**
     * PUT /api/users/:username
     * Update user (admin only)
     */
    this.router.put('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const { first_name, last_name, status, role } = req.body;

        const updates = {};
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;
        if (status !== undefined) updates.status = status;
        if (role !== undefined) updates.role = role;

        const result = await this._userManager.updateUser(username, updates);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ error: 'Failed to update user' });
      }
    });

    /**
     * DELETE /api/users/:username
     * Deactivate user (admin only)
     */
    this.router.delete('/:username', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const result = await this._userManager.deleteUser(username);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Delete user error:', error);
        return res.status(500).json({ error: 'Failed to delete user' });
      }
    });

    /**
     * POST /api/users/:username/reset-password
     * Reset user password (admin only)
     */
    this.router.post('/:username/reset-password', this._requireAdmin, async (req, res) => {
      try {
        const { username } = req.params;
        const { password } = req.body;

        if (!password) {
          return res.status(400).json({ error: 'Password is required' });
        }

        const result = await this._userManager.resetPassword(username, password);
        return res.status(result.statusCode).json(result.response);
      } catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ error: 'Failed to reset password' });
      }
    });
  }
}

export default UsersRouter;
