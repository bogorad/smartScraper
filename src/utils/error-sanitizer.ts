/**
 * Error sanitization utilities
 * Sanitizes internal errors for client consumption
 */

/**
 * Sanitizes an error for client response
 * Returns a generic message to avoid information disclosure
 */
export function sanitizeErrorForClient(error: unknown): string {
  // Map known safe error types to messages
  if (error instanceof Error) {
    // Check for specific known error types
    if (error.message.includes('Invalid URL')) {
      return 'Invalid URL provided';
    }
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return 'Request timed out';
    }
    if (error.message.includes('CAPTCHA')) {
      return 'CAPTCHA challenge failed';
    }
    if (error.message.includes('rate limit')) {
      return 'Rate limit exceeded';
    }
  }

  // Default generic message for unknown errors
  return 'An error occurred while processing the request';
}

/**
 * Sanitizes error for logging (keeps full details)
 */
export function formatErrorForLogging(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack || ''}`;
  }
  return String(error);
}
