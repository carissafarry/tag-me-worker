// src/handlers/notification.js - Notification handler for various notification types

import { BaseHandler } from "./base.js";
import logger from "../logger.js";

const log = logger.child("notification-handler");

/**
 * Notification job types
 */
export const NotificationType = {
  NEW_MESSAGE: "new_message",
  REMINDER: "reminder",
};

/**
 * Notification handler - handles all notification-related jobs
 */
export class NotificationHandler extends BaseHandler {
  constructor() {
    super("NotificationHandler");
  }

  async process(job) {
    const { payload } = job.data;
    const { type, conversation_id, owner_contact } = payload;

    log.info("processing notification", { type, jobId: job.id, conversationId: conversation_id });

    switch (type) {
      case NotificationType.NEW_MESSAGE:
        return await this.handleNewMessage(job, payload);
      case NotificationType.REMINDER:
        return await this.handleReminder(job, payload);
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
  }

  async handleNewMessage(job, payload) {
    log.info("handling new_message", { jobId: job.id, ...payload });

    // Simulate sending notification
    await this.simulateExternalCall();

    return {
      sent: true,
      type: NotificationType.NEW_MESSAGE,
      conversationId: payload.conversation_id,
      recipient: payload.owner_contact,
    };
  }

  async handleReminder(job, payload) {
    log.info("handling reminder", { jobId: job.id, ...payload });

    // Simulate sending notification
    await this.simulateExternalCall();

    return {
      sent: true,
      type: NotificationType.REMINDER,
      conversationId: payload.conversation_id,
      recipient: payload.owner_contact,
    };
  }

  /**
   * Simulate external notification service call
   * @throws {Error} Random failure for testing retry behavior
   */
  async simulateExternalCall() {
    // Simulate 30% random failure
    if (Math.random() < 0.3) {
      throw new Error("External notification service unavailable");
    }
  }

  async onStart(job) {
    log.debug("job started", { jobId: job.id, type: job.data.payload?.type });
  }

  async onComplete(job, result) {
    log.info("job completed", { jobId: job.id, result });
  }

  async onFailure(job, error) {
    const maxAttempts = job.opts?.attempts ?? 3;
    const isTerminal = job.attemptsMade >= maxAttempts;

    log.error("notification failed", {
      event: "notification_failed",
      job_id: job.id,
      reason: error.message,
      attempt: job.attemptsMade,
      max_attempts: maxAttempts,
      is_terminal: isTerminal,
    });

    if (isTerminal) {
      log.error("notification permanently failed", {
        event: "notification_failed_terminal",
        job_id: job.id,
        reason: error.message,
        attempt: job.attemptsMade,
      });
    }
  }
}

export default NotificationHandler;