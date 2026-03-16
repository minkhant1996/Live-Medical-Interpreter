# =============================================================================
# Medical Interpreter - Multi-stage Docker Build (Monorepo)
# =============================================================================

# Build client
FROM node:20-alpine AS client-build
WORKDIR /app

# Copy root package files for workspaces
COPY package.json package-lock.json ./
COPY client/package.json ./client/

# Install client dependencies using workspaces
RUN npm ci --workspace=client

# Copy client source and build
COPY client/ ./client/
RUN npm run build --workspace=client

# Build server
FROM node:20-alpine AS server-build
WORKDIR /app

# Copy root package files for workspaces
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# Install server dependencies using workspaces
RUN npm ci --workspace=server

# Copy server source and build
COPY server/ ./server/
RUN npm run build --workspace=server

# Prune dev dependencies
RUN npm prune --workspace=server --omit=dev

# Production
FROM node:20-alpine
WORKDIR /app

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built artifacts
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/server/package.json ./server/
COPY --from=client-build /app/client/dist ./client/dist

# Set ownership to non-root user
RUN chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
