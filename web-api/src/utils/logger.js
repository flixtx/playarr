import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { LogStreamTransport, LOG_LEVELS } from './logStreamTransport.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../../../logs');
const apiLogPath = path.join(logsDir, 'api.log');

fs.ensureDirSync(logsDir);

// Start fresh each run — clear previous content
if (fs.existsSync(apiLogPath)) {
  fs.truncateSync(apiLogPath, 0);
}

const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf((info) => {
    const { timestamp, level, message, context, ...metadata } = info;
    const contextStr = context ? `[${context}]` : '';
    let output = `${timestamp} ${contextStr} ${level.toUpperCase()}: ${message}`;
    
    // Include metadata if present (exclude Winston internal fields)
    const metadataKeys = Object.keys(metadata).filter(key => 
      !['splat', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(key)
    );
    if (metadataKeys.length > 0) {
      const cleanMetadata = {};
      metadataKeys.forEach(key => {
        cleanMetadata[key] = metadata[key];
      });
      output += `\n${JSON.stringify(cleanMetadata, null, 2)}`;
    }
    
    return output;
  })
);

const baseLogger = winston.createLogger({
  format: baseFormat,
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { timestamp, level, message, context, ...metadata } = info;
          const contextStr = context ? `[${context}]` : '';
          let output = `${timestamp} ${contextStr} ${level}: ${message}`;
          
          // Include metadata if present (exclude Winston internal fields)
          const metadataKeys = Object.keys(metadata).filter(key => 
            !['splat', 'Symbol(level)', 'Symbol(message)', 'Symbol(splat)'].includes(key)
          );
          if (metadataKeys.length > 0) {
            const cleanMetadata = {};
            metadataKeys.forEach(key => {
              cleanMetadata[key] = metadata[key];
            });
            output += `\n${JSON.stringify(cleanMetadata, null, 2)}`;
          }
          
          return output;
        })
      )
    }),
    new winston.transports.File({
      level: 'debug',
      filename: apiLogPath,
      maxsize: 10485760, // 10MB per file
      maxFiles: 5,        // Keep 5 files max
      tailable: true       // Keeps order: api.log → api1.log → api2.log...
    })
  ]
});

const loggerCache = new Map();

// Store reference to log stream transport
let logStreamTransportInstance = null;

// Create log stream transport instance
logStreamTransportInstance = new LogStreamTransport({
  maxLines: 1000,
  level: 'info' // Default level
});

// Add log stream transport to base logger
baseLogger.add(logStreamTransportInstance);

export function createLogger(context) {
  if (!loggerCache.has(context)) {
    const child = baseLogger.child({ context });
    loggerCache.set(context, child);
  }
  return loggerCache.get(context);
}

/**
 * Set WebSocket service on log stream transport
 * @param {object} webSocketService - WebSocketService instance
 */
export function setLogStreamWebSocketService(webSocketService) {
  if (logStreamTransportInstance) {
    logStreamTransportInstance.setWebSocketService(webSocketService);
    logStreamTransportInstance.clearBuffer(); // Clear on startup
  }
}

/**
 * Get current log buffer, optionally filtered by level
 * @param {string} [filterLevel] - Optional level to filter by
 * @returns {Array<string>} Array of log lines
 */
export function getLogBuffer(filterLevel = null) {
  return logStreamTransportInstance ? logStreamTransportInstance.getLogBuffer(filterLevel) : [];
}

/**
 * Set log stream level
 * @param {string} level - Log level (error, warn, info, debug)
 */
export function setLogStreamLevel(level) {
  if (logStreamTransportInstance) {
    logStreamTransportInstance.setLevel(level);
  }
}

/**
 * Get current log stream level
 * @returns {string} Current log level
 */
export function getLogStreamLevel() {
  return logStreamTransportInstance ? logStreamTransportInstance.getLevel() : 'info';
}

/**
 * Get available log levels
 * @returns {Array<string>} Array of available log levels
 */
export function getAvailableLogLevels() {
  return ['error', 'warn', 'info'];
}
