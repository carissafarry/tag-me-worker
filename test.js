import { Queue } from "bullmq";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

const queue = new Queue("notification", { connection: redis });

async function addTestJob() {
  const simulateFailure = Math.random() < 0.3;

  const jobData = {
    type: "send_notification",
    payload: {
      conversation_id: "test-123",
      message: simulateFailure ? "FAIL_TEST" : "Hello from test",
      owner_contact: "dummy",
    },
  };

  try {
    const job = await queue.add("send_notification", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    });

    console.log(`[test] Job added: ${job.id}`);
    console.log(`[test] Job data:`, JSON.stringify(jobData, null, 2));
    if (simulateFailure) {
      console.log("[test] ⚠️  Failure simulation enabled - job will fail");
    }
  } catch (err) {
    console.error("[test] Error adding job:", err.message);
  } finally {
    await queue.close();
    await redis.quit();
  }
}

addTestJob();
