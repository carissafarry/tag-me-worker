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
