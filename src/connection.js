// src/connection.js - Redis connection factory
// Provides reusable connection instances for Queue, Worker, and Bull Board

import Redis from "ioredis";
import config from "./config.js";

let sharedConnection = null;

/**
 * Create a new Redis connection
 * @param {Object} options - Override default config options
 * @returns {Redis} Redis client instance
 */
export function createConnection(options = {}) {
  const url = options.url || config.redis.url;
  const connectionOptions = {
    maxRetriesPerRequest: null, // Required for BullMQ
    ...options,
  };

  return new Redis(url, connectionOptions);
}

/**
 * Get or create a shared Redis connection
 * Use this when you need the same connection across multiple components
 * @returns {Redis} Shared Redis client instance
 */
export function getSharedConnection() {
  if (!sharedConnection) {
    sharedConnection = createConnection();
  }
  return sharedConnection;
}

/**
 * Close the shared connection
 * Call this during graceful shutdown
 */
export async function closeConnection() {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}

/**
 * Health check for Redis connection
 * @returns {Promise<boolean>}
 */
export async function isHealthy() {
  try {
    const result = await sharedConnection?.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

export default { createConnection, getSharedConnection, closeConnection, isHealthy };