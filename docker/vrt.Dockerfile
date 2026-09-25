# ────────────────────────────────────────────────────────────────
# Visual-regression runner (D-34; docs/redesign/09-verification.md §4.4).
#
# The ONE environment VRT baselines are rendered in: text rasterises
# differently on every OS, so macOS, Windows and Linux hosts all run the
# same pinned Linux image through `pnpm vrt` (scripts/redesign/vrt.mjs).
# Context filter: docker/vrt.Dockerfile.dockerignore (BuildKit picks it over
# the server image's root .dockerignore, which drops agent-tests).
#
#   pnpm vrt                              build + run every project
#   docker build -f docker/vrt.Dockerfile -t generatorai/vrt .
# ────────────────────────────────────────────────────────────────

# The tag MUST equal @playwright/test in agent-tests (pnpm-lock.yaml);
# scripts/redesign/vrt.mjs refuses to run when they differ, and
# scripts/__tests__/redesign-rails.test.mjs fails on a mismatch.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# UI and mono text come from the app's bundled Fontsource files (D-16); system
# fonts only back emoji and missing glyphs, and are fixed by this image.
# The toolchain builds the workspace's native addons (node-pty, better-sqlite3)
# that `pnpm install` compiles when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-color-emoji fontconfig python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

# Browsers are baked into the image (/ms-playwright); the desktop app's
# Electron binary is never needed here.
ENV TZ=UTC \
    LANG=en_US.UTF-8 \
    GAI_VRT_CONTAINER=1 \
    CI=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN npm install -g pnpm@10.29.2

WORKDIR /repo

# Lockfile first: `pnpm fetch` downloads every package into the store from the
# lockfile alone, so a source-only change reuses this layer.
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile

# The static Storybook the `stories` project screenshots (served by `vite
# preview` on :6007 from playwright.vrt.config.ts). turbo builds the web app's
# workspace dependencies first (`build-storybook` dependsOn ^build).
# TODO(P3-08): the `routes` project also needs the server bundle and the app
# build: `pnpm --filter @generatorai/server bundle && pnpm --filter @generatorai/web build`.
RUN pnpm turbo run build-storybook --filter=@generatorai/web

CMD ["pnpm", "--filter", "@generatorai/agent-tests", "exec", "playwright", "test", "-c", "vrt/playwright.vrt.config.ts"]
