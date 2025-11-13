import { createLogger } from '../utils/logger.js';

/**
 * Base class for all managers in the web API
 * Provides common functionality: logger
 * @abstract
 */
export class BaseManager {
  /**
   * @param {string} managerName - Name identifier for this manager (used in logging)
   */
  constructor(managerName) {
    if (this.constructor === BaseManager) {
      throw new Error('BaseManager is an abstract class and cannot be instantiated directly');
    }

    if (!managerName) {
      throw new Error('Manager name is required');
    }

    this.managerName = managerName;
    this.logger = createLogger(managerName);
  }
}

