import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

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

export function createLogger(context) {
  if (!loggerCache.has(context)) {
    const child = baseLogger.child({ context });
    loggerCache.set(context, child);
  }
  return loggerCache.get(context);
}
