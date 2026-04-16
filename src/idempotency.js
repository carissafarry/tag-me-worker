// src/idempotency.js - Redis-backed idempotency for job deduplication
// Prevents duplicate success states when a job is retried after a transient failure

import { getSharedConnection } from "./connection.js";

const KEY_PREFIX = "idem:processed:";
const DEFAULT_TTL_SECONDS = 86400; // 24 hours

/**
 * Build the Redis key for a given job ID
 * @param {string} jobId
 * @returns {string}
 */
function buildKey(jobId) {
  return `${KEY_PREFIX}${jobId}`;
}

/**
 * Check whether a job has already been processed successfully
 * @param {string} jobId
 * @returns {Promise<boolean>}
 */
export async function isAlreadyProcessed(jobId) {
  const redis = getSharedConnection();
  const value = await redis.get(buildKey(jobId));
  return value !== null;
}

/**
 * Mark a job as successfully processed
 * @param {string} jobId
 * @param {number} [ttlSeconds]
 * @returns {Promise<void>}
 */
export async function markProcessed(jobId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const redis = getSharedConnection();
  await redis.set(buildKey(jobId), "1", "EX", ttlSeconds);
}
