const codeTheme={plain:{color:'var(--app-foreground)',backgroundColor:'var(--app-card)'},styles:[{types:['comment','prolog'],style:{color:'var(--app-muted)'}},{types:['keyword','builtin'],style:{color:'var(--app-code-keyword)'}},{types:['string','char'],style:{color:'var(--app-code-string)'}},{types:['number','boolean','constant'],style:{color:'var(--app-code-number)'}},{types:['function','class-name'],style:{color:'var(--app-primary)'}}]};
import fs from 'node:fs';
const paletteData=JSON.parse(fs.readFileSync(new URL('./src/theme-data/palettes.json', import.meta.url),'utf8'));
const base = process.env.DOCS_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('DOCS_BASE must start and end with /');
export default {
  title: 'GeneratorAI',
  tagline: 'The complete guide to your agent workspace',
  favicon: 'img/logo.svg',
  url: process.env.DOCS_URL || 'https://docs.example.com',
  baseUrl: base,
  trailingSlash: true,
  headTags: [{tagName:'script',attributes:{},innerHTML:`try{var p=localStorage.getItem('generatorai:docs:palette');var a=localStorage.getItem('generatorai:docs:accent');document.documentElement.dataset.palette=${JSON.stringify(paletteData.themes.map(t=>t.id))}.includes(p)?p:'github';document.documentElement.dataset.accent=${JSON.stringify(paletteData.accents.map(a=>a.id))}.includes(a)?a:'blue';}catch(e){}`}],
  onBrokenLinks: 'throw',
  markdown: { format: 'md', hooks: { onBrokenMarkdownLinks: 'throw', onBrokenMarkdownImages: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [['classic', {
    docs: { routeBasePath: '/', sidebarPath: './sidebars.js', showLastUpdateTime: false, showLastUpdateAuthor: false },
    blog: false,
    theme: { customCss: './src/css/custom.css' },
    sitemap: { changefreq: 'weekly', priority: 0.5 },
  }]],
  themes: [['@easyops-cn/docusaurus-search-local', {
    hashed: 'filename', language: ['en'], indexDocs: true, indexBlog: false, indexPages: true,
    docsRouteBasePath: '/', highlightSearchTermsOnTargetPage: true,
    searchResultLimits: 12, explicitSearchResultPath: true,
  }]],
  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: false },
    navbar: { title: 'GeneratorAI', logo: { alt: 'GeneratorAI', src: 'img/logo.svg' }, items: [
      { to: '/guide/introduction/', label: 'Documentation', position: 'left' },
      { to: '/clients/overview/', label: 'Clients', position: 'left' },
      { to: '/architecture/overview/', label: 'Architecture', position: 'left' },
      { to: '/configuration/', label: 'Configuration', position: 'left' },
      { type: 'custom-appearance', position: 'right' },
    ] },
    footer: { style: 'dark', links: [
      {title: 'Learn', items: [{label: 'Get started', to: '/guide/quickstart/'},{label:'Explore features',to:'/features/'}]},
      {title:'Build',items:[{label:'System architecture',to:'/architecture/overview/'},{label:'API reference',to:'/reference/api/'}]},
      {title:'Maintain',items:[{label:'Operations',to:'/operations/deployment/'},{label:'Documentation coverage',to:'/reference/coverage/'},{label:'About this site',to:'/about/site/'}]},
    ], copyright: 'GeneratorAI · Source-based documentation · Alpha' },
    docs: { sidebar: { hideable: true, autoCollapseCategories: true } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    prism: { theme: codeTheme, darkTheme: codeTheme, additionalLanguages: ['bash','json','typescript','toml','diff'] },
  },
};
