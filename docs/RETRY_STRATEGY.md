# Retry Strategy and Failure Observability

## Overview

This document describes how the notification worker handles failures, retries, and observability to ensure reliable job processing.

## Retry Configuration

### Policy
- **Max attempts**: 3 (configurable via `JOB_ATTEMPTS` env var)
- **Backoff type**: Exponential
- **Initial delay**: 2000ms (configurable via `JOB_BACKOFF_DELAY` env var)


### Backoff Calculation

Each retry attempt uses exponential backoff, where the delay is calculated based on the attempt number:

```
delay = base_delay * 2^(attempt - 1)

Attempt 1 (first try) → failure → wait 2000ms before retry
Attempt 2 (first retry) → failure → wait 4000ms before retry
Attempt 3 (second retry) → failure → wait 8000ms before retry
Attempt 4 (third retry) → terminal (no more retries)
```

**Note**: `JOB_ATTEMPTS` (default: 4) includes the initial attempt plus retries. The sequence above shows 3 retries with delays of 2s, 4s, and 8s respectively.

Each retry attempt uses exponential backoff:
```
delay = base_delay * 2^(attempt - 1)

Attempt 1 failure → wait 2000ms
Attempt 2 failure → wait 4000ms
Attempt 3 failure → terminal (no more retries)
```

## Structured Failure Logging

All failures are logged with structured JSON format for machine parsing:

### Non-Terminal Failure
When a job fails but retries remain:
```json
{
  "timestamp": "2026-04-16T10:30:45.123Z",
  "level": "error",
  "event": "notification_failed",
  "job_id": "job-123",
  "reason": "Service timeout",
  "attempt": 1,
  "max_attempts": 3,
  "next_retry_delay_ms": 2000
}
```

### Terminal Failure
When a job fails after exhausting all retries:
```json
{
  "timestamp": "2026-04-16T10:30:45.123Z",
  "level": "error",
  "event": "notification_failed_terminal",
  "job_id": "job-123",
  "reason": "Service unavailable",
  "attempt": 3,
  "max_attempts": 3
}
```

Terminal failures are automatically moved to the Dead Letter Queue (DLQ) for later inspection.

## Idempotency

### Why Idempotency Matters
When retries occur after transient failures, the same job can be processed multiple times. Idempotency ensures we only create one success state per job, even with multiple processing attempts.

### Implementation
- Redis-backed deduplication with 24-hour TTL
- Job marked as processed **only after confirmed success**
- If a retry arrives after success, it is skipped with reason `already_processed`

### Flow
```
Job 1 (attempt 0) → Success → Mark processed in Redis
Job 1 (retry, attempt 1) → Check Redis → Skip (already_processed)
Result: Only one success state created
```

## Dead Letter Queue (DLQ)

### Purpose
Jobs that fail after exhausting all retries are moved to a separate DLQ queue for investigation and potential manual intervention.

### What Goes to DLQ
- All terminal failures (3 failed attempts)
- Original job ID, type, payload preserved for debugging
- Includes failure reason and timestamp

### Monitoring DLQ
Monitor the DLQ queue for:
- Provider integration failures
- Misconfigured job payloads
- System-level issues (Redis, database down)

## Edge Cases Handled

### Intermittent Provider Recovery
If a provider is temporarily down but recovers within retry window, the exponential backoff ensures we retry after the provider is back.

### Duplicate Retry Scheduling
Idempotency prevents the same job from being processed twice, even if retry scheduling is delayed or duplicated in the queue.

### Poisoned Jobs
Jobs that will never succeed (e.g., invalid payload, missing handler) are identified after 3 failures and moved to DLQ automatically.

### Retry Exhaustion
Clear logging indicates when retry attempts are exhausted, with terminal failure events that separate from transient failures.

### Redis Downtime
If Redis is unavailable, the worker will fail to:
- Retrieve idempotency state (job may be reprocessed)
- Mark jobs as processed
- Move failed jobs to DLQ

Recovery: Once Redis is restored, normal operation resumes. Previously unacknowledged jobs may be reprocessed due to BullMQ's delivery guarantees.

## Testing

Run the test suite to verify retry behavior:
```bash
npm test
```

Tests cover:
- Failure logging with retry counts and delays
- Exponential backoff calculation
- Idempotency during retries
- DLQ movement for poisoned jobs
- Terminal vs. non-terminal failures
