# Multi-stage production build for NestJS

# Node is pinned to an exact release, not a moving tag. node:20-alpine was
# pulled once and then reused from the server's cache, so production ran
# 20.20.1 while CI built 20.20.2 — and Node 20 left support on 30 April 2026.
# An exact tag is the same image on the server and in CI, and every change to
# it arrives as a reviewed pull request. Alpine 3.23 is the release the old
# image already ran on, so only Node moves.

# ---- Stage 1: Build ----
FROM node:24.22.2-alpine3.23 AS builder

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
FROM node:24.22.2-alpine3.23 AS production

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
