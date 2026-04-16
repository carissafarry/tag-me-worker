// queue.js - Queue setup with configurable job options

import { Queue } from "bullmq";
import config from "./src/config.js";
import { getSharedConnection } from "./src/connection.js";

const connection = getSharedConnection();

export const notificationQueue = new Queue(config.worker.queueName, {
  connection,
  defaultJobOptions: {
    attempts: config.queue.attempts,
    backoff: {
      type: config.queue.backoffType,
      delay: config.queue.backoffDelay,
    },
  },
});

// Export for Bull Board
export { connection };

export default notificationQueue;