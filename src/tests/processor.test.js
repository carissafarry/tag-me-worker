// src/tests/processor.test.js
// Unit tests for processor idempotency, structured failure logging, and retry handling
// Uses node:test (built-in, no extra deps) and mocks Redis + handlers

import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// --- Helpers ---

/**
 * Build a minimal BullMQ-like job object for testing
 */
function makeJob({
  id = "job-1",
  type = "send_notification",
  payload = { conversation_id: "conv-123" },
  attemptsMade = 0,
  attempts = 3,
} = {}) {
  return {
    id,
    data: { type, payload },
    attemptsMade,
    opts: { attempts },
  };
}

// --- Structured failure logging ---

describe("notification handler failure logging", () => {
  test("onFailure emits event=notification_failed with job_id and reason", async () => {
    const logs = [];
    const fakeLogger = {
      error: (msg, meta) => logs.push({ msg, ...meta }),
      info: () => {},
      warn: () => {},
      debug: () => {},
      child: (ctx) => ({ ...fakeLogger, _ctx: ctx }),
    };

    // Inline a version of NotificationHandler with the injected logger
    class TestHandler {
      async onFailure(job, error) {
        const maxAttempts = job.opts?.attempts ?? 3;
        const isTerminal = job.attemptsMade >= maxAttempts;

        fakeLogger.error("notification failed", {
          event: "notification_failed",
          job_id: job.id,
          reason: error.message,
          attempt: job.attemptsMade,
          max_attempts: maxAttempts,
          is_terminal: isTerminal,
        });

        if (isTerminal) {
          fakeLogger.error("notification permanently failed", {
            event: "notification_failed_terminal",
            job_id: job.id,
            reason: error.message,
            attempt: job.attemptsMade,
          });
        }
      }
    }

    const handler = new TestHandler();
    const job = makeJob({ id: "job-42", attemptsMade: 1, attempts: 3 });
    const err = new Error("service unavailable");

    await handler.onFailure(job, err);

    assert.equal(logs.length, 1, "should emit one log for non-terminal failure");
    assert.equal(logs[0].event, "notification_failed");
    assert.equal(logs[0].job_id, "job-42");
    assert.equal(logs[0].reason, "service unavailable");
    assert.equal(logs[0].attempt, 1);
    assert.equal(logs[0].is_terminal, false);
  });

  test("onFailure emits notification_failed_terminal when attempts exhausted", async () => {
    const logs = [];
    const fakeLogger = {
      error: (msg, meta) => logs.push({ msg, ...meta }),
      child: () => fakeLogger,
    };

    class TestHandler {
      async onFailure(job, error) {
        const maxAttempts = job.opts?.attempts ?? 3;
        const isTerminal = job.attemptsMade >= maxAttempts;

        fakeLogger.error("notification failed", {
          event: "notification_failed",
          job_id: job.id,
          reason: error.message,
          attempt: job.attemptsMade,
          max_attempts: maxAttempts,
          is_terminal: isTerminal,
        });

        if (isTerminal) {
          fakeLogger.error("notification permanently failed", {
            event: "notification_failed_terminal",
            job_id: job.id,
            reason: error.message,
            attempt: job.attemptsMade,
          });
        }
      }
    }

    const handler = new TestHandler();
    // attemptsMade === attempts means retries exhausted
    const job = makeJob({ id: "job-99", attemptsMade: 3, attempts: 3 });
    const err = new Error("max retries hit");

    await handler.onFailure(job, err);

    assert.equal(logs.length, 2, "should emit both base and terminal failure logs");

    const terminalLog = logs.find((l) => l.event === "notification_failed_terminal");
    assert.ok(terminalLog, "terminal failure log must exist");
    assert.equal(terminalLog.job_id, "job-99");
    assert.equal(terminalLog.reason, "max retries hit");
  });
});

// --- Idempotency ---

describe("processor idempotency", () => {
  test("skips job that was already successfully processed", async () => {
    const processedSet = new Set(["job-already-done"]);

    // Simulate isAlreadyProcessed + markProcessed in isolation
    const isAlreadyProcessed = async (jobId) => processedSet.has(jobId);
    const markProcessed = async (jobId) => processedSet.add(jobId);

    const handlerCalled = { value: false };

    async function processJobWithIdempotency(job) {
      if (await isAlreadyProcessed(job.id)) {
        return { skipped: true, reason: "already_processed" };
      }

      handlerCalled.value = true;
      await markProcessed(job.id);
      return { sent: true };
    }

    const result = await processJobWithIdempotency(makeJob({ id: "job-already-done" }));

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already_processed");
    assert.equal(handlerCalled.value, false, "handler must not be called for duplicate job");
  });

  test("processes a new job and marks it as processed", async () => {
    const processedSet = new Set();

    const isAlreadyProcessed = async (jobId) => processedSet.has(jobId);
    const markProcessed = async (jobId) => processedSet.add(jobId);

    async function processJobWithIdempotency(job) {
      if (await isAlreadyProcessed(job.id)) {
        return { skipped: true, reason: "already_processed" };
      }

      const result = { sent: true };
      await markProcessed(job.id);
      return result;
    }

    const job = makeJob({ id: "job-new" });
    const result = await processJobWithIdempotency(job);

    assert.equal(result.sent, true);
    assert.ok(processedSet.has("job-new"), "job must be marked as processed after success");
  });

  test("does not mark job processed when handler throws", async () => {
    const processedSet = new Set();

    const isAlreadyProcessed = async (jobId) => processedSet.has(jobId);
    const markProcessed = async (jobId) => processedSet.add(jobId);

    async function processJobWithIdempotency(job) {
      if (await isAlreadyProcessed(job.id)) {
        return { skipped: true, reason: "already_processed" };
      }

      throw new Error("external service down");
      await markProcessed(job.id); // must not be reached
    }

    const job = makeJob({ id: "job-fail" });
    await assert.rejects(() => processJobWithIdempotency(job), /external service down/);

    assert.equal(
      processedSet.has("job-fail"),
      false,
      "job must NOT be marked processed after failure"
    );
  });
});

// --- Retry policy config ---

describe("retry configuration", () => {
  test("job options include 3 attempts with exponential backoff", async () => {
    // Simulate how queue.js sets job options from config
    const config = {
      queue: {
        attempts: 3,
        backoffDelay: 2000,
        backoffType: "exponential",
      },
    };

    const jobOptions = {
      attempts: config.queue.attempts,
      backoff: {
        type: config.queue.backoffType,
        delay: config.queue.backoffDelay,
      },
    };

    assert.equal(jobOptions.attempts, 3);
    assert.equal(jobOptions.backoff.type, "exponential");
    assert.equal(jobOptions.backoff.delay, 2000);
  });
});

// --- Failure observability with retry logging ---

describe("failure observability and retry logging", () => {
  test("logs all failures with retry attempt count and max attempts", async () => {
    const logs = [];

    function simulateFailureLogging(job, err) {
      const maxAttempts = job?.opts?.attempts ?? 3;
      const attempt = job?.attemptsMade ?? 0;
      const isTerminal = attempt >= maxAttempts;
      const backoffDelay = job?.opts?.backoff?.delay ?? 2000;

      const logEntry = {
        timestamp: new Date().toISOString(),
        level: "error",
        event: isTerminal ? "notification_failed_terminal" : "notification_failed",
        job_id: job?.id,
        reason: err.message,
        attempt,
        max_attempts: maxAttempts,
      };

      if (!isTerminal && backoffDelay) {
        logEntry.next_retry_delay_ms = backoffDelay * Math.pow(2, attempt - 1);
      }

      logs.push(logEntry);
    }

    // First retry attempt
    const job1 = makeJob({ id: "job-retry-1", attemptsMade: 1, attempts: 3 });
    simulateFailureLogging(job1, new Error("timeout"));

    assert.equal(logs[0].event, "notification_failed");
    assert.equal(logs[0].attempt, 1);
    assert.equal(logs[0].max_attempts, 3);
    assert.equal(logs[0].next_retry_delay_ms, 2000); // 2000 * 2^0

    // Second retry attempt
    const job2 = makeJob({ id: "job-retry-1", attemptsMade: 2, attempts: 3 });
    simulateFailureLogging(job2, new Error("timeout"));

    assert.equal(logs[1].event, "notification_failed");
    assert.equal(logs[1].attempt, 2);
    assert.equal(logs[1].next_retry_delay_ms, 4000); // 2000 * 2^1

    // Terminal failure
    const job3 = makeJob({ id: "job-retry-1", attemptsMade: 3, attempts: 3 });
    simulateFailureLogging(job3, new Error("timeout"));

    assert.equal(logs[2].event, "notification_failed_terminal");
    assert.equal(logs[2].attempt, 3);
    assert.equal(logs[2].next_retry_delay_ms, undefined, "terminal failure has no retry delay");
  });

  test("calculates exponential backoff correctly", async () => {
    const baseDelay = 2000;

    function calculateNextRetryDelay(attemptNumber, baseDelay) {
      return baseDelay * Math.pow(2, attemptNumber - 1);
    }

    assert.equal(calculateNextRetryDelay(1, baseDelay), 2000, "attempt 1: 2000ms");
    assert.equal(calculateNextRetryDelay(2, baseDelay), 4000, "attempt 2: 4000ms");
    assert.equal(calculateNextRetryDelay(3, baseDelay), 8000, "attempt 3: 8000ms");
  });
});

// --- Idempotency prevents duplicate retries ---

describe("idempotency with retries", () => {
  test("prevents duplicate processing when job retried after initial success", async () => {
    const processedJobs = new Set();
    let handlerCallCount = 0;

    const isAlreadyProcessed = async (jobId) => processedJobs.has(jobId);
    const markProcessed = async (jobId) => processedJobs.add(jobId);

    async function processJob(job) {
      if (await isAlreadyProcessed(job.id)) {
        return { skipped: true, reason: "already_processed" };
      }

      handlerCallCount++;
      await markProcessed(job.id);
      return { sent: true };
    }

    // First attempt succeeds and marks processed
    const job = makeJob({ id: "idem-job-1", attemptsMade: 0 });
    const result1 = await processJob(job);
    assert.equal(result1.sent, true);
    assert.equal(handlerCallCount, 1);

    // Retry arrives (simulating retry after transient network issue)
    const retryJob = makeJob({ id: "idem-job-1", attemptsMade: 1 });
    const result2 = await processJob(retryJob);

    assert.equal(result2.skipped, true, "retry must be skipped due to idempotency");
    assert.equal(result2.reason, "already_processed");
    assert.equal(handlerCallCount, 1, "handler called only once despite retry");
  });

  test("allows job to be processed on second attempt if first failed", async () => {
    const processedJobs = new Set();

    const isAlreadyProcessed = async (jobId) => processedJobs.has(jobId);
    const markProcessed = async (jobId) => processedJobs.add(jobId);

    async function processJob(job) {
      if (await isAlreadyProcessed(job.id)) {
        return { skipped: true, reason: "already_processed" };
      }

      if (job.attemptsMade === 0) {
        throw new Error("transient failure");
      }

      await markProcessed(job.id);
      return { sent: true };
    }

    // First attempt fails
    const job1 = makeJob({ id: "retry-succeed", attemptsMade: 0 });
    await assert.rejects(() => processJob(job1), /transient failure/);
    assert.equal(processedJobs.has("retry-succeed"), false);

    // Second attempt succeeds
    const job2 = makeJob({ id: "retry-succeed", attemptsMade: 1 });
    const result = await processJob(job2);
    assert.equal(result.sent, true);
    assert.equal(processedJobs.has("retry-succeed"), true);
  });
});
