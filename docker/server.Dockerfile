# ────────────────────────────────────────────────────────────────
# GeneratorAI server image.
#
# The operations guide has documented `docker build -f docker/server.Dockerfile`
# for a while, and `.dockerignore` and `docker/stage-server-runtime.mjs` were
# both written against it — but the Dockerfile itself did not exist, so a
# self-hoster following the guide had no working deployment path at all
# (review 6.7 / Phase 4).
#
# Two stages. The builder holds the whole pnpm workspace and its toolchain; the
# runtime holds only the esbuild bundle, the handful of packages that bundle
# leaves external, the built web client and the workflow templates. That is
# what `stage-server-runtime.mjs` assembles, and it is also why the runtime
# image does not need pnpm, the monorepo, or any source.
#
#   docker build -t generatorai/server -f docker/server.Dockerfile .
#   docker run -p 3100:3100 -v generatorai_data:/data generatorai/server
# ────────────────────────────────────────────────────────────────

# Pinned to the major the workspace declares (`engines.node: >=22`). Native
# addons (better-sqlite3, node-pty) are compiled in the builder against THIS
# image's ABI, so the two stages must stay on the same major.
FROM node:22-bookworm AS builder

# Native addons need a toolchain; python3 is required by node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /build

# Manifests first so a dependency-only change is the sole cache miss.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY templates ./templates

RUN pnpm install --frozen-lockfile

# The SPA the server serves from WEB_DIST_DIR, then the server bundle itself.
RUN pnpm --filter @generatorai/web build \
  && pnpm --filter @generatorai/server bundle

# Assembles /runtime: server.mjs, the external-only node_modules, web/, templates/.
RUN node docker/stage-server-runtime.mjs /runtime

# ── Runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# `git` is not optional: workspace checkpoints, the change summary and every
# diff the product shows shell out to it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# These are the names the CODE reads. The operations guide used to document
# `GENERATORAI_`-prefixed spellings that nothing reads, so following it
# configured nothing at all.
ENV PORT=3100
ENV DB_PATH=/data/data.db
ENV WORKSPACES_DIR=/data/workspaces
ENV ARTIFACTS_DIR=/data/artifacts
ENV TEMPLATES_DIR=/app/templates
ENV WEB_DIST_DIR=/app/web

WORKDIR /app
COPY --from=builder /runtime /app

# `node` (uid 1000) ships with the base image. The server writes only under
# /data, which is the volume, so the application directory stays read-only in
# practice and nothing runs as root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 3100

# The server binds loopback by default; a container needs every interface, and
# the container boundary is what limits reach.
ENV GENERATORAI_BIND_HOST=0.0.0.0

# `tini` reaps the agent/pty/browser child processes this server spawns.
# Without an init, PID 1 is node and those become zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Timeout is 15s, not the usual 5s, and it is measured rather than guessed:
# this server does synchronous better-sqlite3 work on its only thread, so a
# busy instance stalls its event loop for seconds at a time. Under live chat
# load `/api/health` was observed taking over 10 s while still answering
# normally at 0.22 s when idle. A 5 s timeout marks a merely BUSY container
# unhealthy and has the orchestrator restart it mid-turn, which is the
# opposite of what a health check is for. `retries=5` means an instance has
# to keep failing for over two minutes before it is declared dead.
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
