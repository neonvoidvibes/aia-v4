import pino from 'pino';

// Create the logger with a unified configuration.
// It will now output JSON in both development and production.
// The `pino-pretty` CLI is used in the `dev` script to format these logs for readability.
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Helper function to create a child logger with request context
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

// Helper function to sanitize sensitive data from logs
export function sanitizeForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };
  
  // Remove or truncate sensitive fields
  if (sanitized.messages && Array.isArray(sanitized.messages)) {
    sanitized.messageCount = sanitized.messages.length;
    // In production, don't log full message content
    if (process.env.NODE_ENV === 'production') {
      delete sanitized.messages;
    } else {
      // In development, truncate long messages
      sanitized.messages = sanitized.messages.map((msg: any) => ({
        ...msg,
        content: typeof msg.content === 'string' && msg.content.length > 200 
          ? msg.content.substring(0, 200) + '...' 
          : msg.content
      }));
    }
  }

  // Remove other sensitive fields
  const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}
