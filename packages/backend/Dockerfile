# packages/backend/Dockerfile
# Stage 1 - Build
FROM node:18-bookworm-slim AS build

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

RUN yarn install --frozen-lockfile && \
    yarn tsc && \
    yarn build:backend

# Stage 2 - Runtime
FROM node:18-bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built application
COPY --from=build /app/packages/backend/dist/bundle.tar.gz .
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# Copy production config
COPY app-config.production.yaml .

# Set production env
ENV NODE_ENV=production

EXPOSE 7007

CMD ["node", "packages/backend", "--config", "app-config.production.yaml"]
