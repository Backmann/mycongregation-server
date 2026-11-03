# Multi-stage production build for NestJS

# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Build deps for native modules (если есть)
RUN apk add --no-cache python3 make g++

# Copy package files for layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (incl. dev — needed for build)
RUN npm ci

# Copy source
COPY . .

# Compile TypeScript -> dist/
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:20-alpine AS production

WORKDIR /app

# wget for healthchecks; tini for proper signal handling
RUN apk add --no-cache wget tini

# Copy package files
COPY package.json package-lock.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built dist from builder
COPY --from=builder /app/dist ./dist

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs && \
    chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

# Tini handles SIGTERM properly for graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main"]
