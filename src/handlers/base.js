// src/handlers/base.js - Handler interface base class

/**
 * Base class for job handlers
 * All custom handlers should extend this class
 */
export class BaseHandler {
  /**
   * @param {string} name - Handler name for logging
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Process the job
   * @param {Object} job - BullMQ job object
   * @param {Object} job.data - Job payload
   * @returns {Promise<Object>} - Result object
   */
  async process(job) {
    throw new Error(`Handler ${this.name} must implement process(job)`);
  }

  /**
   * Called before processing starts
   * @param {Object} job - BullMQ job object
   */
  async onStart(job) {
    // Optional: override for pre-processing logic
  }

  /**
   * Called after successful completion
   * @param {Object} job - BullMQ job object
   * @param {Object} result - Processing result
   */
  async onComplete(job, result) {
    // Optional: override for post-processing logic
  }

  /**
   * Called on failure
   * @param {Object} job - BullMQ job object
   * @param {Error} error - Error that occurred
   */
  async onFailure(job, error) {
    // Optional: override for failure handling
  }
}

export default BaseHandler;