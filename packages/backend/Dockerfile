# Stage 1 - Create skeleton
FROM node:20-bookworm-slim AS build
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    sqlite3 \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Build the workspace to generate dist and skeleton
RUN yarn install --frozen-lockfile && \
    yarn tsc && \
    yarn build:backend

# Stage 2 - Production Install
FROM node:20-bookworm-slim AS production
WORKDIR /app

# Copy the built backend bundle and its production dependencies
COPY --from=build /app/packages/backend/dist/skeleton.tar.gz .
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

# Install production dependencies only
RUN yarn install --frozen-lockfile --production --network-timeout 600000

# Copy the actual backend bundle
COPY --from=build /app/packages/backend/dist/bundle.tar.gz .
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# Copy production config
COPY app-config.production.yaml .

# Set production env
ENV NODE_ENV=production

EXPOSE 7007

# Use non-root user
USER node

CMD ["node", "packages/backend", "--config", "app-config.production.yaml"]
