# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install workspace dependencies from manifests only.
# Source is copied later so app edits do not rerun npm ci.
# --ignore-scripts skips the root postinstall (it needs source + Prisma schema).
# node-pty's install script is rebuilt explicitly so its native binary is present.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24 AS deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY api/package.json api/
COPY dashboard/package.json dashboard/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild node-pty

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build shared (dashboard and API both depend on its dist/)
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS shared-build

COPY shared/ shared/
RUN npm run build -w @novacode/shared

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Build the Vue dashboard
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS dashboard-builder

COPY --from=shared-build /app/shared ./shared
COPY dashboard/ dashboard/
RUN npm run build -w novacode-dashboard

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Build the Fastify API (prisma generate && tsc)
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS api-builder

COPY --from=shared-build /app/shared ./shared
COPY api/ api/
RUN --mount=type=cache,target=/root/.cache/prisma \
    npm run build -w novacode-api

# ─────────────────────────────────────────────────────────────────────────────
# Stage 5: Runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24

# Keep build tools at runtime — node-pty's native addon needs them for the
# platform-specific binary. Also install git, gosu (for entrypoint chown+drop).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash gosu openssh-client ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally so "Login to Claude" works in the app
ARG CLAUDE_CODE_VERSION=2.1.278
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Ensure user-local and global bin dirs are on PATH before any CLI installs
ENV PATH="/root/.local/bin:/root/.opencode/bin:/usr/local/bin:${PATH}"

# Install Cursor agent CLI (official installer does not expose a version pin)
RUN curl https://cursor.com/install -fsS | bash

# Install Mistral Vibe CLI (official installer does not expose a version pin)
RUN curl -LsSf https://mistral.ai/vibe/install.sh | bash

# Install OpenCode CLI
ARG OPENCODE_VERSION=1.18.32
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version "${OPENCODE_VERSION}"

# Install Codex + Codex ACP adapter
ARG CODEX_VERSION=0.155.1
ARG CODEX_ACP_VERSION=1.12.0
RUN npm install -g "@openai/codex@${CODEX_VERSION}" "@agentclientprotocol/codex-acp@${CODEX_ACP_VERSION}"

# Install Playwright core so agents can connect to a Playwright server
ARG PLAYWRIGHT_CORE_VERSION=1.63.0
RUN npm install -g "playwright-core@${PLAYWRIGHT_CORE_VERSION}"

# App runs as the host UID via gosu; agent CLIs live under /root.
RUN chmod a+x /root \
    && chmod -R a+rX /root/.local \
    && if [ -d /root/.opencode ]; then chmod -R a+rX /root/.opencode; fi

WORKDIR /app

# Copy compiled API
COPY --from=api-builder /app/api/build ./build
# Hoisted workspace node_modules from the API build so Prisma engines
# downloaded during `prisma generate` are included. @novacode/shared
# symlinks to /app/shared.
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/shared ./shared
COPY --from=api-builder /app/api/package.json ./package.json

# Prisma schema, migrations, and config (required by docker-entrypoint for `prisma migrate deploy`)
COPY --from=api-builder /app/api/prisma ./prisma
COPY --from=api-builder /app/api/prisma.config.ts ./

# Copy built dashboard into a location the API can serve
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard-dist

# Config directory for SQLite DB (mounted as a named volume)
RUN mkdir -p /config

# Entrypoint: optional /config chown, then run app as the host user
COPY api/docker-entrypoint.dev.sh /docker-entrypoint.sh
COPY api/scripts/startup-page.mjs /startup-page.mjs
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3030}/api/health" || exit 1

ENV NODE_ENV=production
ENV HOME=/config

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "build/src/index.js"]
