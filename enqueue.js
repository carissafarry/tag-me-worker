import { notificationQueue } from "./queue.js";

export async function enqueueNotification(data) {
  const { type, conversation_id, owner_contact } = data;

  if (!type || !conversation_id) {
    throw new Error("enqueueNotification requires type and conversation_id");
  }

  const job = await notificationQueue.add("send_notification", {
    type: "send_notification",
    payload: {
      type,
      conversation_id,
      owner_contact: owner_contact || "dummy",
    },
  });

  console.log(`[enqueue] job ${job.id} added to notification queue`);
  return job;
}