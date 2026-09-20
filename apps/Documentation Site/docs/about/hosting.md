# Run and host this site

The documentation site is self-contained. It uses its own `package.json`, `package-lock.json`, and `.npmrc` so installation does not require updating the root pnpm lockfile.

## Local development

From the repository root:

```bash
cd 'apps/Documentation Site'
npm ci
npm run dev
```

Open `http://127.0.0.1:4317`. The dev server binds to loopback. Local search is generated during a production build; verify it using preview.

## Production build and preview

```bash
npm run check
npm run build
npm run preview
```

The generated site is in `build/`. This folder contains the deployable static HTML, JavaScript, styles, assets, and search index. No GeneratorAI server, provider login, database, or React server runtime is needed to host it.

## Domain and subdirectory

Set the intended public origin before building so canonical URLs and the sitemap are correct:

```bash
DOCS_URL=https://docs.your-domain.example npm run build
```

For a subdirectory deployment, build with a base path that begins and ends with `/`:

```bash
DOCS_URL=https://your-domain.example DOCS_BASE=/generatorai/ npm run build
DOCS_BASE=/generatorai/ npm run preview
```

Then open `http://127.0.0.1:4317/generatorai/`. Rebuild when changing the base path; do not simply copy a root-path build into a subdirectory. `docs.example.com` is a configuration placeholder, not a deployed site.

Search uses a filename-hashed index. This avoids query-string asset redirects in the local preview server when using a subdirectory and preserves cache invalidation when content changes.

## Static host settings

| Setting | Value |
| --- | --- |
| Project root | `apps/Documentation Site` |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Publish directory | `build` |
| Runtime | Node.js 22+ for building; static hosting for serving |
| Environment | `DOCS_URL`; `DOCS_BASE` when needed |

Any host that serves directory `index.html` files can serve this output, including a static CDN, GitHub Pages, Netlify, Vercel static hosting, or nginx. Docusaurus uses trailing-slash pages here, so deep links must serve their generated directory indexes. Configure the host's error document to `404.html`.

The repository's product container and reverse proxy configuration are independent. No root CI/release configuration was changed for this site. Hosting setup and actual publication are left to the deployment environment; this task creates and verifies the site locally.

## Reproducible verification

With preview running in another terminal:

```bash
npm run test:browser
```

The test script uses Playwright. It can use an installed Chrome executable via `DOCS_BROWSER_EXECUTABLE`; otherwise it checks the macOS Chrome location and then Playwright's Chromium. If Chromium must be installed, keep its download inside the documentation folder:

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browser-cache" npm run test:browser
```

Set `DOCS_TEST_URL` when preview uses another URL or base path. Reports and screenshots are written under `audit/`.

For framework hosting details, see [Docusaurus deployment](https://docusaurus.io/docs/deployment).
