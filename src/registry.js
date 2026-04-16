// src/registry.js - Handler registry for dynamic job type handling

import logger from "./logger.js";

const log = logger.child("registry");

/**
 * Registry for job handlers
 * Allows dynamic registration of handlers for different job types
 */
class HandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Register a handler for a job type
   * @param {string} jobType - Job type identifier (e.g., "send_notification")
   * @param {BaseHandler} handler - Handler instance
   */
  register(jobType, handler) {
    if (this.handlers.has(jobType)) {
      log.warn("overwriting existing handler", { jobType, oldHandler: this.handlers.get(jobType).name });
    }
    this.handlers.set(jobType, handler);
    log.info("handler registered", { jobType, handlerName: handler.name });
  }

  /**
   * Get handler for a job type
   * @param {string} jobType - Job type identifier
   * @returns {BaseHandler|undefined}
   */
  get(jobType) {
    return this.handlers.get(jobType);
  }

  /**
   * Check if a handler exists for a job type
   * @param {string} jobType - Job type identifier
   * @returns {boolean}
   */
  has(jobType) {
    return this.handlers.has(jobType);
  }

  /**
   * List all registered job types
   * @returns {string[]}
   */
  list() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get all handlers
   * @returns {Map<string, BaseHandler>}
   */
  getAll() {
    return new Map(this.handlers);
  }
}

// Singleton instance
export const registry = new HandlerRegistry();

export default registry;