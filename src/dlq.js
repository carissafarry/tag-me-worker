// src/dlq.js - Dead Letter Queue management for poisoned jobs
// Handles terminal failures that exhaust retry attempts

import { Queue } from "bullmq";
import config from "./config.js";
import { getSharedConnection } from "./connection.js";
import logger from "./logger.js";

const log = logger.child("dlq");
const connection = getSharedConnection();

const dlqName = `${config.worker.queueName}:dlq`;

/**
 * Dead Letter Queue for jobs that exhausted retries
 * BullMQ will automatically move failed jobs here after max attempts
 */
export const deadLetterQueue = new Queue(dlqName, { connection });

/**
 * Move a job to the DLQ (typically called when retries exhausted)
 * @param {Object} job - BullMQ job object
 * @param {Error} error - Error that caused the failure
 */
export async function moveToDeadLetter(job, error) {
  try {
    await deadLetterQueue.add(
      "poisoned",
      {
        originalJobId: job.id,
        originalType: job.data?.type,
        originalPayload: job.data?.payload,
        failureReason: error.message,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts?.attempts ?? 3,
        failedAt: new Date().toISOString(),
      },
      {
        priority: 1,
        removeOnComplete: false,
      }
    );

    log.info("job moved to DLQ", {
      event: "job_moved_to_dlq",
      job_id: job.id,
      reason: error.message,
      attempts: job.attemptsMade,
    });
  } catch (dlqError) {
    log.error("failed to move job to DLQ", {
      job_id: job.id,
      error: dlqError.message,
    });
  }
}

export default deadLetterQueue;
