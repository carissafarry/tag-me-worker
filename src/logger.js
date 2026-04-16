// src/logger.js - Structured logging utility

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function formatMessage(level, context, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    context,
    message,
    ...meta,
  };
  return JSON.stringify(logEntry);
}

export const logger = {
  error(context, message, meta) {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(formatMessage("error", context, message, meta));
    }
  },

  warn(context, message, meta) {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", context, message, meta));
    }
  },

  info(context, message, meta) {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(formatMessage("info", context, message, meta));
    }
  },

  debug(context, message, meta) {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(formatMessage("debug", context, message, meta));
    }
  },

  child(context) {
    return {
      error: (msg, meta) => logger.error(context, msg, meta),
      warn: (msg, meta) => logger.warn(context, msg, meta),
      info: (msg, meta) => logger.info(context, msg, meta),
      debug: (msg, meta) => logger.debug(context, msg, meta),
    };
  },
};

export default logger;