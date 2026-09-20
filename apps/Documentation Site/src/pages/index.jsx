import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
const paths = [
  ['01','Start with a client','Set up your workspace, connect a provider, and run your first task.','/guide/quickstart/','Get started'],
  ['02','Explore every feature','Chats, projects, agents, workflows, automation, and the tools around them.','/features/','Explore features'],
  ['03','Understand the system','Follow a request from the client through orchestration, providers, and storage.','/architecture/overview/','Read the architecture'],
];
const clients = [
  ['Desktop','An Electron workspace with native tools and a local or remote server.','/clients/desktop/'],
  ['Web','The shared React workspace, available in your browser.','/clients/web/'],
  ['Mobile','An Expo companion for iOS and Android, connected to your host.','/clients/mobile/'],
  ['CLI & TUI','Script the platform or work in an interactive terminal workspace.','/clients/cli/'],
];
export default function Home(){return <Layout title="Documentation" description="Source-based guides to every GeneratorAI client, feature, module, and integration.">
  <div className="docs-shell"><aside className="home-sidebar" aria-label="Documentation navigation"><nav><strong>Workspace handbook</strong>{[['Overview','/'],['Projects','/features/projects/'],['Chats','/features/chats/'],['Agents','/features/agents/'],['Workflows','/features/workflows/'],['Scripts','/features/workflow-scripts/'],['Automations','/features/automations/']].map(([name,to])=><Link key={name} to={to} aria-current={to==='/'?'page':undefined}><span className="nav-icon" aria-hidden="true">{to==='/'?'▦':'◇'}</span>{name}</Link>)}<strong>Build & operate</strong>{[['All clients','/clients/overview/'],['Configuration','/configuration/'],['Architecture','/architecture/overview/'],['Examples','/configuration/examples/'],['Operations','/operations/deployment/']].map(([name,to])=><Link key={name} to={to}><span className="nav-icon" aria-hidden="true">◇</span>{name}</Link>)}</nav></aside><main className="docs-home">
    <section className="home-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">DOCUMENTATION / OVERVIEW <span>ALPHA</span></p>
        <h1 id="hero-title">GeneratorAI documentation</h1>
        <p className="hero-description">Set up a client, configure your agents, and follow the systems behind every chat, workflow, and automation.</p>
        <div className="hero-actions"><Link className="button button--primary button--lg" to="/guide/quickstart/">Start building <span aria-hidden="true">↗</span></Link><Link className="button button--outline button--secondary button--lg" to="/reference/coverage/">Browse the source map</Link></div>
      </div>
      <div className="system-card" aria-label="GeneratorAI system overview">
        <div className="system-card-top"><img src={useBaseUrl('/img/logo.svg')} alt="" width="28" height="28"/><span>ONE CONNECTED WORKSPACE</span><span className="status-dot"/></div>
        <div className="client-chips">{['Desktop','Web','Mobile','CLI'].map(c=><span key={c}>{c}</span>)}</div>
        <div className="connector" aria-hidden="true">↓</div>
        <div className="engine-box"><span className="mini-label">GENERATORAI SERVER</span><strong>Plan. Execute. Review.</strong><div>Chats · Workflows · Automations</div></div>
        <div className="connector" aria-hidden="true">↓</div>
        <div className="system-bottom"><span>Agent providers</span><span>Workspaces & data</span></div>
        <p className="system-caption">Four clients. Shared services. Clear boundaries.</p>
      </div>
    </section>
    <section className="home-section" aria-labelledby="explore-title"><div className="section-heading"><p className="eyebrow">FIND YOUR PATH</p><h2 id="explore-title">Explore the workspace</h2></div><div className="path-grid">{paths.map(([n,title,text,to,cta])=><Link className="path-card" to={to} key={n}><span className="card-number">{n}</span><h3>{title}</h3><p>{text}</p><span className="card-cta">{cta} <span aria-hidden="true">→</span></span></Link>)}</div></section>
    <section className="home-section clients-section" aria-labelledby="clients-title"><div className="section-heading"><p className="eyebrow">WORK WHERE YOU WORK</p><h2 id="clients-title">Clients</h2><p>Capabilities, setup, controls, and the differences that matter.</p></div><div className="client-grid">{clients.map(([name,text,to])=><Link className="client-card" to={to} key={name}><h3>{name}<span aria-hidden="true">↗</span></h3><p>{text}</p></Link>)}</div></section>
    <section className="reference-strip"><div><p className="eyebrow">BUILT FROM THE SOURCE</p><h2>Go from a feature to its implementation.</h2><p>Field-by-field configuration, validated examples, module maps, HTTP routes, and operations.</p></div><Link className="button button--primary" to="/reference/coverage/">Open the coverage inventory →</Link></section>
  </main></div>
</Layout>}
