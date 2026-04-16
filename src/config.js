// src/config.js - Centralized configuration
// All environment variables and defaults in one place

const config = {
  // Redis
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  // Worker
  worker: {
    queueName: process.env.WORKER_QUEUE_NAME || "notification",
    concurrency: parseInt(process.env.WORKER_CONCURRENCY, 10) || 5,
    limiter: {
      max: parseInt(process.env.WORKER_LIMITER_MAX, 10) || 10,
      duration: parseInt(process.env.WORKER_LIMITER_DURATION, 10) || 1000,
    },
  },

  // Queue Job Options
  queue: {
    attempts: parseInt(process.env.JOB_ATTEMPTS, 10) || 3,
    backoffDelay: parseInt(process.env.JOB_BACKOFF_DELAY, 10) || 2000,
    backoffType: process.env.JOB_BACKOFF_TYPE || "exponential",
  },

  // Bull Board Dashboard
  dashboard: {
    port: parseInt(process.env.BULL_BOARD_PORT, 10) || 3010,
    path: process.env.BULL_BOARD_PATH || "/admin/queues",
  },

  // App
  app: {
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT, 10) || 3000,
  },
};

export default config;