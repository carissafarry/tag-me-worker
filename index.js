// index.js - Worker runner

import { Worker } from "bullmq";
import config from "./src/config.js";
import { getSharedConnection, closeConnection } from "./src/connection.js";
import { processJob, registry, NotificationHandler } from "./processor.js";
import { moveToDeadLetter } from "./src/dlq.js";

// Register handlers
const notificationHandler = new NotificationHandler();
registry.register("send_notification", notificationHandler);

console.log("[worker] registered handlers:", registry.list());

// Create worker
const worker = new Worker(config.worker.queueName, processJob, {
  connection: getSharedConnection(),
  concurrency: config.worker.concurrency,
  limiter: config.worker.limiter,
});

worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  const maxAttempts = job?.opts?.attempts ?? 3;
  const attempt = Math.max(1, job?.attemptsMade ?? 0);
  const isTerminal = attempt >= maxAttempts;
  const backoffDelay = job?.opts?.backoff?.delay ?? 2000;

  // Log all failures with structured format
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: "error",
    event: isTerminal ? "notification_failed_terminal" : "notification_failed",
    job_id: job?.id,
    reason: err.message,
    attempt,
    max_attempts: maxAttempts,
  };

  // Add retry delay for non-terminal failures
  if (!isTerminal && backoffDelay) {
    const backoffType =
      job?.opts?.backoff?.type ?? config.queue.backoff?.type ?? "exponential";
    if (backoffType === "exponential") {
      logEntry.next_retry_delay_ms = backoffDelay * Math.pow(2, attempt - 1);
    } else if (backoffType === "fixed") {
      logEntry.next_retry_delay_ms = backoffDelay;
    }
  }

  console.error(JSON.stringify(logEntry));

  // Move poisoned jobs to DLQ after retry exhaustion
  if (isTerminal) {
    moveToDeadLetter(job, err);
  }
});

worker.on("error", (err) => {
  console.error("[worker] error:", err);
});

console.log(`[worker] started, listening to "${config.worker.queueName}" queue`);

// Graceful shutdown
async function shutdown() {
  console.log("[worker] shutting down gracefully");
  await worker.close();
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);