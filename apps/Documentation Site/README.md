# GeneratorAI Documentation Site

React + Docusaurus. Product guides are plain Markdown in `docs/`. The site uses the application's 17 palettes, six accents, and compact workspace styling.

```bash
cd 'apps/Documentation Site'
npm ci
npm run dev
```

Open http://127.0.0.1:4317.

For production search and layout verification:

```bash
npm run reference:generate
npm run configuration:generate
npm run theme:generate
npm run build
npm run preview
# In another terminal in this folder:
npm run test:browser
```

Publish `build/`. Set `DOCS_URL` and optional `DOCS_BASE` before building. See [hosting](docs/about/hosting.md), [coverage](docs/reference/coverage.md), [site decisions](docs/about/site.md), and [validation](docs/about/validation.md).

See the [delivery and audit report](AUDIT-REPORT.md) for the completed scope, browser results, screenshots, research, and limitations.

This folder has its own npm lockfile and dependencies. No root workspace files are required to be modified. Reference generation reads product source from the surrounding repository; ordinary build/hosting uses the checked-in generated Markdown. No changes have been committed.

Source regeneration needs the surrounding product checkout and its installed dependencies. Ordinary builds and static hosting use the generated snapshots already inside this folder. See [configuration and examples](docs/configuration/index.md) and the [theme/configuration follow-up report](THEME-COVERAGE-REPORT.md).
