// src/processor.js - Job processor that dispatches to registered handlers

import logger from "./logger.js";
import { registry } from "./registry.js";
import { isAlreadyProcessed, markProcessed } from "./idempotency.js";

const log = logger.child("processor");

/**
 * Process a job by dispatching to the appropriate handler
 * @param {Object} job - BullMQ job object
 * @returns {Promise<Object>}
 */
export async function processJob(job) {
  const { type, payload } = job.data;

  log.info("received job", { jobId: job.id, type, payload });

  // Idempotency guard: skip jobs that already completed successfully
  if (await isAlreadyProcessed(job.id)) {
    log.warn("duplicate job skipped", { jobId: job.id, type, event: "job_duplicate_skipped" });
    return { skipped: true, reason: "already_processed" };
  }

  const handler = registry.get(type);

  if (!handler) {
    const error = new Error(`No handler registered for job type: ${type}`);
    log.error("handler not found", { jobId: job.id, type, availableTypes: registry.list() });
    throw error;
  }

  try {
    await handler.onStart(job);
    const result = await handler.process(job);
    await handler.onComplete(job, result);

    // Mark as processed only after confirmed success
    await markProcessed(job.id);

    log.info("job processed successfully", { jobId: job.id, type });
    return result;
  } catch (error) {
    await handler.onFailure(job, error);
    throw error;
  }
}

export default processJob;