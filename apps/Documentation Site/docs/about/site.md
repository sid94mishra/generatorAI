# About this documentation site

This is a **React-based Docusaurus site**, with authored content stored as ordinary Markdown. The whole site—including configuration, dependencies, generated references, audit evidence, and build output—lives inside `apps/Documentation Site`.

## Framework decision

Docusaurus fits this project's React requirement and provides documentation navigation, static page generation, theming, and extensible React components. It avoids requiring a bespoke application just to publish the handbook. See the [Docusaurus introduction](https://docusaurus.io/docs).

| Option | Assessment for this project |
| --- | --- |
| **Docusaurus 3** | Selected: React ecosystem, purpose-built documentation conventions, static output |
| Next.js with a documentation theme | React-compatible alternative; useful when docs need broader application behavior |
| Astro Starlight | Documentation-focused alternative, but the requested implementation should center React |
| VitePress | Vue-based; excluded by the user's React requirement |

This is a project-specific choice, not a claim that one framework is universally best. The implementation pins Docusaurus `3.10.2` and React `19.2.0`. Local npm overrides pin `serialize-javascript` to `7.0.5` and SockJS’s `uuid` to `11.1.1` to address inherited build/development dependency advisories; production build and browser checks validate this combination. The [official search guide](https://docusaurus.io/docs/search) distinguishes hosted search from community local-search options. This site uses [EasyOps local search](https://github.com/easyops-cn/docusaurus-search-local), with a build-generated index served alongside the static files. Searches do not require a hosted search account.

## Site capabilities

- Plain Markdown guides grouped by learning path, feature, client, architecture, design, reference, and operations.
- A custom React landing page with direct paths into the handbook.
- Responsive sidebar, page outline, breadcrumbs, previous/next navigation, and heading links.
- The application's 17 palettes, six accents, light/dark appearances, keyboard navigation, visible focus, and reduced-motion support.
- Local full-text search on the production build.
- Syntax-highlighted code blocks with copy controls.
- Static hosting with configurable origin and base path.
- Generated coverage, HTTP routes, environment reads, CLI/TUI references, 90 expanded configuration schemas, 35 route-local validators, and 24 validated JSON examples.
- Strict build-time link checks plus reproducible browser verification.

## Content authority

Current implementation takes precedence over older README claims. Each authored technical guide points to source evidence. Generated indexes describe structure and include their limitations. Source review found and documented differences involving relay trust, SDK status, extension contributions, provider support, native host wiring, validation behavior, and client capabilities.

These docs are a working-tree snapshot. They include product changes already present at the start of the task. They do not replace a release-specific compatibility guarantee or a full runtime audit of the product.

## Maintain the site

1. Edit the relevant file in `docs/`. Use one H1 and a descriptive first paragraph.
2. Prefer relative `.md` links between pages; they are checked by Docusaurus and remain useful in a Markdown reader.
3. Add a new Markdown page under an existing category; `sidebars.js` includes it automatically.
4. Verify instructions against the current source. Label experimental, optional, client-specific, and unwired behavior.
5. Run `npm run reference:generate`, `npm run configuration:generate`, and `npm run theme:generate` after corresponding product-source changes.
6. Run `npm run check`, `npm run build`, and the browser checks before publishing.

The generator reads public source files and writes only inside this site. It does not inspect `.env` values, start the application host, execute prompts, or modify product source.

## Validation and hosting

See the [validation report](./validation.md) for the observed checks, screenshots, and limitations, and [hosting guide](./hosting.md) for the local commands and deployment settings.
