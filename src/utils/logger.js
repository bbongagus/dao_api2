/**
 * Logger Utility - Centralized logging for dao_api2
 * Replaces console.log with environment-aware logging
 */

const DEBUG = process.env.NODE_ENV !== 'production';
const VERBOSE = process.env.LOG_VERBOSE === 'true';

// Color codes for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/**
 * Format timestamp for logs
 */
function getTimestamp() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

/**
 * Logger object with different log levels
 */
export const logger = {
  /**
   * Debug logs - only in development or when VERBOSE is enabled
   * Use for detailed operation tracing
   */
  debug: (...args) => {
    if (DEBUG || VERBOSE) {
      console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.cyan}🔧${colors.reset}`, ...args);
    }
  },

  /**
   * Info logs - always shown
   * Use for important state changes
   */
  info: (...args) => {
    console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.blue}ℹ️${colors.reset}`, ...args);
  },

  /**
   * Success logs - always shown
   * Use for successful operations
   */
  success: (...args) => {
    console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.green}✅${colors.reset}`, ...args);
  },

  /**
   * Warning logs - always shown
   * Use for non-critical issues
   */
  warn: (...args) => {
    console.warn(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.yellow}⚠️${colors.reset}`, ...args);
  },

  /**
   * Error logs - always shown
   * Use for errors and failures
   */
  error: (...args) => {
    console.error(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.red}❌${colors.reset}`, ...args);
  },

  /**
   * Operation logs - only in development
   * Use for tracking graph operations
   */
  operation: (type, details) => {
    if (DEBUG || VERBOSE) {
      console.log(
        `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.magenta}🔧 ${type}${colors.reset}`,
        details ? JSON.stringify(details, null, 0) : ''
      );
    }
  },

  /**
   * WebSocket logs - only in development
   * Use for WebSocket events
   */
  ws: (event, clientId, details) => {
    if (DEBUG || VERBOSE) {
      console.log(
        `${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.cyan}🔌 [Client ${clientId}] ${event}${colors.reset}`,
        details || ''
      );
    }
  },

  /**
   * Analytics logs - only in verbose mode
   * Use for analytics tracking
   */
  analytics: (...args) => {
    if (VERBOSE) {
      console.log(`${colors.dim}[${getTimestamp()}]${colors.reset} ${colors.green}📊${colors.reset}`, ...args);
    }
  },

  /**
   * Performance timing helper
   */
  time: (label) => {
    if (DEBUG || VERBOSE) {
      console.time(label);
    }
  },

  timeEnd: (label) => {
    if (DEBUG || VERBOSE) {
      console.timeEnd(label);
    }
  }
};

export default logger;
