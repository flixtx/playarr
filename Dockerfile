# Multi-stage build for Playarr
# Currently includes the engine component, will be extended with web UI and API
# Stage 1: Build dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY engine/package.json engine/package-lock.json* ./engine/

# Install dependencies
WORKDIR /app/engine
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Runtime
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/engine/node_modules ./engine/node_modules

# Copy engine source code
COPY engine/ ./engine/

# Create logs directory (configurations, data, and cache will be mounted as volumes)
RUN mkdir -p /app/logs

# Set environment variables
ENV NODE_ENV=production
ENV CACHE_DIR=/app/cache
ENV DATA_DIR=/app/data
ENV LOGS_DIR=/app/logs

# Expose port for future API (if needed)
EXPOSE 3000

# Health check (simple file system check)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD test -d /app/data && test -d /app/cache || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the engine
CMD ["node", "engine/index.js"]

