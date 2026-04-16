// index.js - Worker runner

import { Worker } from "bullmq";
import config from "./src/config.js";
import { getSharedConnection, closeConnection } from "./src/connection.js";
import { processJob, registry, NotificationHandler } from "./processor.js";

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
  const isTerminal = (job?.attemptsMade ?? 0) >= maxAttempts;

  if (isTerminal) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "notification_failed_terminal",
        job_id: job?.id,
        reason: err.message,
        attempt: job?.attemptsMade,
      })
    );
  } else {
    console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}/${maxAttempts}):`, err.message);
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