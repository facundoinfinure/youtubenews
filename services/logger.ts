/**
 * Structured Logger Service
 * 
 * Provides consistent logging across the application with:
 * - Log levels (debug, info, warn, error)
 * - Structured data logging
 * - Production-safe (debug logs disabled in prod)
 * - Emoji prefixes for visual scanning
 * - Optional persistence to Supabase for error tracking
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, any>;
}

// Check if we're in development mode
const isDev = () => {
  try {
    return import.meta.env.DEV || 
           import.meta.env.MODE === 'development' ||
           window.location.hostname === 'localhost';
  } catch {
    return false;
  }
};

// Check if verbose logging is enabled (for debugging production issues)
const isVerbose = () => {
  try {
    return localStorage.getItem('chimpnews_verbose_logs') === 'true';
  } catch {
    return false;
  }
};

// Log level configuration
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Minimum log level (debug in dev, warn in prod unless verbose)
const getMinLogLevel = (): LogLevel => {
  if (isDev()) return 'debug';
  if (isVerbose()) return 'info';
  return 'warn'; // In production, only show warnings and errors by default
};

// Emoji prefixes for each level
const LEVEL_EMOJI: Record<LogLevel, string> = {
  debug: '🔍',
  info: '📋',
  warn: '⚠️',
  error: '❌'
};

// Category-specific emojis
const CATEGORY_EMOJI: Record<string, string> = {
  'auth': '🔐',
  'channel': '📺',
  'production': '🎬',
  'news': '📰',
  'script': '📝',
  'audio': '🔊',
  'video': '🎥',
  'upload': '☁️',
  'cache': '💾',
  'cost': '💰',
  'api': '🔗',
  'db': '🗄️',
  'storage': '📦',
  'config': '⚙️',
  'ui': '🖥️',
  'shotstack': '🎞️',
  'wavespeed': '🌊',
  'openai': '🤖',
  'gemini': '✨',
  'serpapi': '🔍',
  'youtube': '▶️',
};

// In-memory log buffer for debugging
const logBuffer: LogEntry[] = [];
const MAX_BUFFER_SIZE = 100;

/**
 * Main logger class
 */
class Logger {
  private minLevel: LogLevel;

  constructor() {
    this.minLevel = getMinLogLevel();
  }

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel) {
    this.minLevel = level;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  /**
   * Format log message with category and emoji
   */
  private formatMessage(level: LogLevel, category: string, message: string): string {
    const levelEmoji = LEVEL_EMOJI[level];
    const categoryEmoji = CATEGORY_EMOJI[category] || '•';
    return `${levelEmoji} [${category.toUpperCase()}] ${categoryEmoji} ${message}`;
  }

  /**
   * Add entry to buffer
   */
  private addToBuffer(entry: LogEntry) {
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      logBuffer.shift();
    }
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, category: string, message: string, data?: Record<string, any>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data
    };

    this.addToBuffer(entry);

    const formattedMessage = this.formatMessage(level, category, message);

    switch (level) {
      case 'debug':
        if (data) {
          console.log(formattedMessage, data);
        } else {
          console.log(formattedMessage);
        }
        break;
      case 'info':
        if (data) {
          console.info(formattedMessage, data);
        } else {
          console.info(formattedMessage);
        }
        break;
      case 'warn':
        if (data) {
          console.warn(formattedMessage, data);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case 'error':
        if (data) {
          console.error(formattedMessage, data);
        } else {
          console.error(formattedMessage);
        }
        break;
    }
  }

  // Public logging methods

  /**
   * Debug log - only shown in development
   */
  debug(category: string, message: string, data?: Record<string, any>) {
    this.log('debug', category, message, data);
  }

  /**
   * Info log - general information
   */
  info(category: string, message: string, data?: Record<string, any>) {
    this.log('info', category, message, data);
  }

  /**
   * Warning log - potential issues
   */
  warn(category: string, message: string, data?: Record<string, any>) {
    this.log('warn', category, message, data);
  }

  /**
   * Error log - errors and failures
   */
  error(category: string, message: string, data?: Record<string, any>) {
    this.log('error', category, message, data);
  }

  // Convenience methods for common categories

  api(level: LogLevel, message: string, data?: Record<string, any>) {
    this.log(level, 'api', message, data);
  }

  production(level: LogLevel, message: string, data?: Record<string, any>) {
    this.log(level, 'production', message, data);
  }

  cache(level: LogLevel, message: string, data?: Record<string, any>) {
    this.log(level, 'cache', message, data);
  }

  /**
   * Get recent logs from buffer
   */
  getRecentLogs(count: number = 50): LogEntry[] {
    return logBuffer.slice(-count);
  }

  /**
   * Clear log buffer
   */
  clearBuffer() {
    logBuffer.length = 0;
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(logBuffer, null, 2);
  }

  /**
   * Enable verbose logging (useful for debugging production issues)
   */
  enableVerbose() {
    try {
      localStorage.setItem('chimpnews_verbose_logs', 'true');
      this.minLevel = 'debug';
      console.info('🔍 Verbose logging enabled. Reload the page for full effect.');
    } catch {
      console.warn('Could not enable verbose logging');
    }
  }

  /**
   * Disable verbose logging
   */
  disableVerbose() {
    try {
      localStorage.removeItem('chimpnews_verbose_logs');
      this.minLevel = getMinLogLevel();
      console.info('Verbose logging disabled');
    } catch {
      // Ignore
    }
  }

  /**
   * Check if currently in verbose mode
   */
  isVerbose(): boolean {
    return isVerbose() || this.minLevel === 'debug';
  }
}

// Singleton instance
export const logger = new Logger();

// Expose logger globally for debugging in production console
if (typeof window !== 'undefined') {
  (window as any).chimpLogger = {
    enableVerbose: () => logger.enableVerbose(),
    disableVerbose: () => logger.disableVerbose(),
    getLogs: () => logger.getRecentLogs(),
    exportLogs: () => logger.exportLogs(),
  };
}

// Export for convenience
export default logger;
