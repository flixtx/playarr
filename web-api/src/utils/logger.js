import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────
// Setup log directory and rotation
// ─────────────────────────────────────────────
const logsDir = process.env.LOGS_DIR || path.join(__dirname, '../../../logs');
const apiLogPath = path.join(logsDir, 'api.log');

fs.ensureDirSync(logsDir); // ensures directory exists, recursively

if (fs.existsSync(apiLogPath)) {
  const stats = fs.statSync(apiLogPath);
  const createdAt = stats.birthtime;
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const archivedLog = path.join(logsDir, `api_${timestamp}.log`);
  fs.renameSync(apiLogPath, archivedLog);
}

// ─────────────────────────────────────────────
// Create base Winston logger (shared globally)
// ─────────────────────────────────────────────
const baseFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
    const contextStr = context ? `[${context}]` : '';
    return `${timestamp} ${contextStr} ${level.toUpperCase()}: ${message}`;
  })
);

const baseLogger = winston.createLogger({
  format: baseFormat,
  transports: [
    new winston.transports.Console({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, context }) => {
          const contextStr = context ? `[${context}]` : '';
          return `${timestamp} ${contextStr} ${level}: ${message}`;
        })
      )
    }),
    new winston.transports.File({
      level: 'debug',
      filename: apiLogPath,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// ─────────────────────────────────────────────
// Cache for per-class loggers
// ─────────────────────────────────────────────
const loggerCache = new Map();

/**
 * Returns a cached Winston logger for a given context/class.
 * @param {string} context - Context name (e.g., 'UserService', 'ProvidersService')
 * @returns {winston.Logger} Child Winston logger
 */
export function createLogger(context) {
  if (!loggerCache.has(context)) {
    const child = baseLogger.child({ context });
    loggerCache.set(context, child);
  }
  return loggerCache.get(context);
}