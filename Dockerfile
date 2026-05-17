# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build the Vue dashboard
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS dashboard-builder

WORKDIR /build/dashboard
COPY dashboard/package*.json ./
COPY .env .env
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build the Fastify API
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24 AS api-builder

WORKDIR /build/api
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24

# Keep build tools at runtime — node-pty's native addon needs them for the
# platform-specific binary. Also install git, gosu (for entrypoint chown+drop).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash gosu openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally so "Login to Claude" works in the app
RUN npm install -g @anthropic-ai/claude-code

# Ensure user-local and global bin dirs are on PATH before any CLI installs
ENV PATH="/root/.local/bin:/root/.opencode/bin:/usr/local/bin:${PATH}"

# Install Cursor agent CLI
RUN curl https://cursor.com/install -fsS | bash

# Install Cursor ACP adapter
RUN npm install -g @blowmage/cursor-agent-acp

# Install Mistral Vibe CLI
RUN curl -LsSf https://mistral.ai/vibe/install.sh | bash

# Install OpenCode CLI
RUN curl -fsSL https://opencode.ai/install | bash

# Install Codex + Codex ACP adapter
RUN npm install -g @openai/codex @zed-industries/codex-acp

WORKDIR /app

# Copy compiled API
COPY --from=api-builder /build/api/build ./build
COPY --from=api-builder /build/api/node_modules ./node_modules
COPY --from=api-builder /build/api/package.json ./

# Prisma schema, migrations, and config (required by docker-entrypoint for `prisma migrate deploy`)
COPY --from=api-builder /build/api/prisma ./prisma
COPY --from=api-builder /build/api/prisma.config.ts ./

# Copy built dashboard into a location the API can serve
COPY --from=dashboard-builder /build/dashboard/dist ./dashboard-dist

# Config directory for SQLite DB (mounted as a named volume)
RUN mkdir -p /config

# Entrypoint: chown /config to host UID/GID, then run app as that user
COPY api/docker-entrypoint.dev.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production
ENV HOME=/config

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "build/src/index.js"]

