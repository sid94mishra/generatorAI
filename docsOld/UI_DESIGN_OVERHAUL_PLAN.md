# GeneratorAI — Complete UI Design Overhaul Plan

> **Status:** Design Specification Ready  
> **Target:** Complete visual overhaul of the Web UI (`apps/web/`)  
> **Inspiration:** GitHub Copilot Desktop App (dark-first, developer-native, clean chrome)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Audit](#2-current-state-audit)
3. [Inspiration Analysis](#3-inspiration-analysis)
4. [Design Principles](#4-design-principles)
5. [Color System](#5-color-system)
6. [Typography](#6-typography)
7. [Layout Architecture](#7-layout-architecture)
8. [Component Library](#8-component-library)
9. [Page-by-Page Redesign](#9-page-by-page-redesign)
10. [Motion & Interaction](#10-motion--interaction)
11. [Responsive Strategy](#11-responsive-strategy)
12. [Implementation Plan](#12-implementation-plan)
13. [File Change Manifest](#13-file-change-manifest)

---

## 1. Executive Summary

### Problem Statement

The current GeneratorAI web UI has a **consumer-app aesthetic** (bright gradients, glassmorphism, pastel backgrounds, rounded cards) that doesn't match its audience: **developers building AI workflows**. The UI feels playful rather than professional and lacks the information density that power users expect.

### Vision

Transform the UI into a **dark-first, developer-native tool** inspired by GitHub Copilot's desktop app — clean chrome, high information density, minimal decoration, and a focus on content over containers. The design should feel like a natural extension of a developer's IDE environment.

### Key Transformations

| Aspect | Current | Target |
|--------|---------|--------|
| **Theme** | Light-first with pastel gradients | Dark-first with deep navy/charcoal tones |
| **Background** | Animated gradient orbs + glassmorphism | Solid flat backgrounds with subtle noise |
| **Cards** | Frosted glass with heavy blur | Flat cards with 1px borders, no blur |
| **Colors** | Indigo/purple rainbow gradients | Muted blue accent + semantic status colors |
| **Typography** | Decorative with varied sizes | Compact, uniform, high-density |
| **Layout** | Wide sidebar (288px) + centered content | Narrow sidebar (240px) + full-width content |
| **Spacing** | Generous (16-32px padding) | Compact (8-12px padding) |
| **Border Radius** | Large (14-18px) | Small (6-8px) |
| **Shadows** | Heavy glassmorphic dropdowns | None or 1px borders |
| **Icons** | Colorful with gradient backgrounds | Monochrome, 16px standard size |
| **Empty States** | Large illustrations with CTAs | Simple text with inline action |
| **Sidebar** | Tab-based with gradient CTA | Hierarchical tree with collapsible groups |

---

## 2. Current State Audit

### Screenshots Captured

| Page | Key Issues |
|------|-----------|
| **Dashboard** | Oversized stat cards; rainbow gradient icon; excessive whitespace; playful "Quick Actions" cards with hover overlays |
| **Chats List** | Good search/filter pattern but card styling too heavy; pastel palette feels consumer-grade |
| **Workflows** | Error state has too much whitespace; sidebar shows "Failed to load" in red — needs graceful degradation |
| **Automations** | Clean empty state but oversized lightning bolt icon; CTA button too prominent |
| **Templates** | Sparse; just search + "No templates found" — lacks categorization |
| **Settings** | Clean tabs but cards have too much padding; "About" section feels placeholder-like |
| **Workflow Builder** | DAG canvas is functional; right panel "No stage selected" placeholder is good; but toolbar has inconsistent button styles |

### Styling System Issues

1. **Glassmorphism overuse** — `backdrop-filter: blur()` on sidebar, header, cards, inputs, buttons. Performance-heavy and visually busy
2. **Gradient gradient orbs** — Animated background orbs (`bg-orbs`) are distracting in a productivity tool
3. **Inconsistent border-radius** — Mixes `rounded-xl` (12px), `rounded-2xl` (16px), `rounded-full` without pattern
4. **Semi-transparent backgrounds** — `rgba()` values everywhere create layering confusion
5. **Excessive animation** — `animate-bounce`, `float-orb`, `glow-pulse` feel toy-like
6. **Color inconsistency** — Primary switches between indigo, teal/cyan (system theme), purple (gradients)
7. **Large sidebar (288px)** — Takes excessive horizontal space; content area feels cramped on 1280px screens

---

## 3. Inspiration Analysis

### GitHub Copilot Desktop App (Screenshots Analyzed)

**Screenshot 1 — Main Session View:**
- **Background:** Deep charcoal/navy (#0d1117 range)
- **Sidebar:** Dark with subtle border separator, no background effects
  - Session groups: "DATA", "GENERATORAI", "SERVER" — uppercase category labels
  - Session items: Simple text with relative time ("2 mos ago"), chat icon
  - "New Session" button: Outlined, not filled — `Ctrl+N` shortcut shown
- **Main area:** Clean centered input with model selector dropdown
  - "New session in GeneratorAI" with folder selector
  - Bottom toolbar: `+ Agent` dropdown, model dropdown, `Copilot CLI`, `Autopilot (Preview)`, `Folder`, branch selector (`dev`)
  - Input area: Minimal, no decorative elements
- **Header:** Session title + minimal icons (run, terminal, panels)

**Screenshot 2 — Chat Customizations Panel:**
- **Modal/Panel:** Dark card overlay
- **Left sidebar:** Simple text list — Agents, Skills, Instructions, Prompts, Hooks, MCP Servers, Plugins
- **Skills list:** Two sections — "Workspace" (1 skill) and "Built-In" (10 skills)
  - Each skill: Name + `UI Integration` badge + single-line description
  - Green circle icon (●) for each skill
  - Clean separation between items
- **Search bar:** Simple text input at top
- **"+ New Skill (Workspace)"** button: Outlined with dropdown

**Screenshot 3 — Changes Panel (right sidebar):**
- **Two tabs:** "Changes" and "Files"
- **"Initialize Repository"** button: Blue/teal filled, full-width in changes tab
- **Empty state:** Simple centered text "Changed files and other session artifacts will appear here." with a subtle (+) icon
- **Clean, minimal** — No illustrations, no gradients, just text

**Screenshot 4 — File Explorer Panel:**
- **Tree view:** Standard file explorer with expand/collapse arrows
- **File icons:** Language-specific (JS, TS, JSON, YAML) — small, monochrome
- **Hierarchy:** `.github/`, `.playwright/`, `apps/`, `docs/`, etc.
- **No decoration** — Just the tree with subtle indentation

### Key Patterns Extracted from Inspiration

1. **Flat, dark surfaces** — No glass, no blur, no gradients. Just solid colors with 1px borders
2. **Hierarchical sidebar** — Collapsible groups with uppercase labels, not tabs
3. **Content-first empty states** — Simple text, no large illustrations or CTAs
4. **Compact information density** — Small text (12-13px), tight spacing (4-8px)
5. **Monochrome icons** — Single color (muted gray), consistent 16px size
6. **Minimal chrome** — Header is thin; no breadcrumbs; context from sidebar position
7. **Badge system** — Small, inline pills (`UI Integration`) not colored circles
8. **Input areas** — Clean, no decoration, just border-bottom or subtle bg
9. **Status indicators** — Tiny (●) dots or icons, not full badges
10. **Keyboard shortcuts** — Shown inline (e.g., `Ctrl+N` next to "New Session")

---

## 4. Design Principles

### P1. Dark-First
Default theme is dark. Light theme becomes secondary. All design decisions start in dark mode.

### P2. Content Over Chrome
Remove all decorative elements that don't serve functionality. Every pixel should convey information or enable interaction.

### P3. Information Density
Minimize spacing, reduce card padding, use smaller text. A developer should see more items per screen without scrolling.

### P4. Flat Surfaces
No glassmorphism, no backdrop-filter, no gradient backgrounds. Use solid colors with 1px borders for hierarchy.

### P5. Monochrome + Semantic Color
UI chrome is monochrome (grays). Color is reserved for semantic meaning: status (green/red/amber), interactive (blue), destructive (red).

### P6. Consistent Scale
One border-radius (6px). One shadow style (none, or subtle on dropdowns). One transition duration (150ms). No exceptions.

### P7. IDE-Native Feel
The app should feel like a panel in VS Code or a GitHub tool — not a consumer SaaS product.

---

## 5. Color System

### Dark Theme (Primary — Default)

```css
:root {
  /* Surfaces */
  --color-bg-base:        #0d1117;    /* Page background */
  --color-bg-raised:      #161b22;    /* Sidebar, cards, raised surfaces */
  --color-bg-overlay:     #1c2129;    /* Modals, dropdowns, overlays */
  --color-bg-subtle:      #21262d;    /* Hover states, muted backgrounds */
  --color-bg-emphasis:    #30363d;    /* Active states, selected rows */
  
  /* Borders */
  --color-border-default: #30363d;    /* Standard borders */
  --color-border-muted:   #21262d;    /* Subtle dividers */
  --color-border-emphasis:#484f58;    /* Emphasized borders (focus, active) */
  
  /* Text */
  --color-text-primary:   #e6edf3;    /* Primary text */
  --color-text-secondary: #8b949e;    /* Secondary text, labels */
  --color-text-muted:     #656d76;    /* Disabled text, placeholders */
  --color-text-link:      #58a6ff;    /* Links */
  
  /* Accent (Interactive) */
  --color-accent:         #58a6ff;    /* Primary buttons, active tabs */
  --color-accent-emphasis:#388bfd;    /* Hover state for accent */
  --color-accent-muted:   #1f6feb26;  /* Subtle accent backgrounds */
  
  /* Status: Success */
  --color-success:        #3fb950;    /* Success text/icons */
  --color-success-emphasis:#238636;   /* Success backgrounds */
  --color-success-muted:  #23863626;  /* Subtle success bg */
  
  /* Status: Warning */
  --color-warning:        #d29922;    /* Warning text/icons */
  --color-warning-emphasis:#9e6a03;   /* Warning backgrounds */
  --color-warning-muted:  #9e6a0326;  /* Subtle warning bg */
  
  /* Status: Danger */
  --color-danger:         #f85149;    /* Error text/icons */
  --color-danger-emphasis:#da3633;    /* Error backgrounds */
  --color-danger-muted:   #da363326;  /* Subtle error bg */
  
  /* Status: Info */
  --color-info:           #58a6ff;    /* Info text/icons */
  --color-info-muted:     #58a6ff26;  /* Subtle info bg */
  
  /* Special */
  --color-done:           #a371f7;    /* Completed/merged purple */
  --color-sponsors:       #db61a2;    /* Highlight/feature pink */
}
```

### Light Theme (Secondary)

```css
.light {
  /* Surfaces */
  --color-bg-base:        #ffffff;
  --color-bg-raised:      #f6f8fa;
  --color-bg-overlay:     #ffffff;
  --color-bg-subtle:      #f0f3f6;
  --color-bg-emphasis:    #dfe2e5;
  
  /* Borders */
  --color-border-default: #d0d7de;
  --color-border-muted:   #d8dee4;
  --color-border-emphasis:#868e96;
  
  /* Text */
  --color-text-primary:   #1f2328;
  --color-text-secondary: #656d76;
  --color-text-muted:     #8b949e;
  --color-text-link:      #0969da;
  
  /* Accent */
  --color-accent:         #0969da;
  --color-accent-emphasis:#0550ae;
  --color-accent-muted:   #0969da1a;
  
  /* Status colors follow same pattern with lighter values */
  --color-success:        #1a7f37;
  --color-success-emphasis:#2da44e;
  --color-warning:        #9a6700;
  --color-danger:         #d1242f;
  --color-danger-emphasis:#cf222e;
}
```

### Color Usage Rules

| Context | Color Token |
|---------|-------------|
| Page background | `--color-bg-base` |
| Sidebar / Card | `--color-bg-raised` |
| Modal / Dropdown | `--color-bg-overlay` |
| Hover row | `--color-bg-subtle` |
| Active/Selected item | `--color-bg-emphasis` |
| All borders | `--color-border-default` |
| Primary text | `--color-text-primary` |
| Labels, metadata | `--color-text-secondary` |
| Placeholders, disabled | `--color-text-muted` |
| Primary buttons, links | `--color-accent` |
| Running stage | `--color-success` |
| Failed/Error | `--color-danger` |
| Pending/Paused | `--color-warning` |
| Completed | `--color-done` |
| Cancelled/Neutral | `--color-text-muted` |

---

## 6. Typography

### Font Stack

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

**Rationale:** Remove Google Fonts dependency (Inter, JetBrains Mono). Use system fonts for faster load, better OS integration, and IDE-native feel.

### Type Scale

| Token | Size | Weight | Line Height | Use |
|-------|------|--------|-------------|-----|
| `--text-xs` | 11px | 400 | 16px | Badges, metadata, timestamps |
| `--text-sm` | 12px | 400 | 18px | Body text, list items, labels |
| `--text-base` | 14px | 400 | 20px | Primary content, input text |
| `--text-lg` | 16px | 600 | 24px | Section headings |
| `--text-xl` | 20px | 600 | 28px | Page titles |
| `--text-2xl` | 24px | 700 | 32px | Dashboard hero only |

### Weight Rules

- `400` (regular) — All body text, descriptions, labels
- `500` (medium) — Navigation items, sidebar entries
- `600` (semibold) — Headings, button text, active states
- `700` (bold) — Page titles only

---

## 7. Layout Architecture

### Overall Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header (40px)                                    [actions] │
├──────────┬─────────────────────────────────────────────────┤
│          │                                                 │
│ Sidebar  │        Main Content Area                        │
│ (240px)  │        (fluid, scrollable)                      │
│          │                                                 │
│          │                                                 │
│          │                                                 │
│          │                                                 │
│          │                                                 │
│          │                                                 │
└──────────┴─────────────────────────────────────────────────┘
```

### Sidebar (240px → down from 288px)

```
┌──────────────────────┐
│ ⚡ GeneratorAI   [+] │  ← Logo + New button
├──────────────────────┤
│ ☰ Dashboard          │  ← Primary navigation
│ 💬 Chats          12 │  ← With count badge
│ ⚡ Workflows       5 │
│ ↻ Automations      2 │
├──────────────────────┤
│ RECENT CHATS         │  ← Collapsible section (uppercase label)
│  Chat about login... │
│  API design review   │
│  Bug fix for #234    │
├──────────────────────┤
│ RECENT RUNS          │  ← Collapsible section
│  ● code-gen run #4   │  ← Status dot + name
│  ✓ review run #3     │
│  ✕ test run #2       │
├──────────────────────┤
│ 📋 Templates         │  ← Bottom fixed section
│ ⚙ Settings           │
└──────────────────────┘
```

**Key changes from current:**
- Width reduced from 288px → 240px
- Tab navigation (Chats|Workflows|Auto) → **Vertical list** with count badges
- Gradient CTA button → Small `[+]` icon button in header
- Error message in sidebar → Graceful skeleton or empty text
- Collapsible recent items sections replace the empty sidebar area
- No glassmorphism — solid `bg-raised` background with right border

### Header (40px → down from 56px)

```
┌──────────────────────────────────────────────────────────────┐
│ [≡] Page Title                              [⌨] [🔔] [👤]  │
└──────────────────────────────────────────────────────────────┘
```

- **Left:** Sidebar toggle (mobile) + page title (text only, no icon)
- **Right:** Keyboard shortcuts hint, notifications (future), user avatar (future)
- No breadcrumbs — sidebar provides context
- No glassmorphism — solid background with bottom border
- Compact: 40px height vs current 56px

### Content Area

- **No max-width constraint** — Content fills available space (list pages)
- **Workflow builder / Canvas** — Full height, no padding
- **Detail pages** — `max-w-4xl` centered with `px-8 py-6`
- **Scrollable** — Only main content scrolls, sidebar and header are fixed

---

## 8. Component Library

### Cards

```css
/* Standard Card */
.card {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  /* No shadow, no blur, no gradient */
}

/* Interactive Card (clickable) */
.card-interactive {
  /* extends .card */
  cursor: pointer;
  transition: background 150ms ease;
}
.card-interactive:hover {
  background: var(--color-bg-subtle);
}
.card-interactive:active {
  background: var(--color-bg-emphasis);
}
```

**No glassmorphism.** Flat colors with borders.

### Buttons

| Variant | Background | Text | Border | Use |
|---------|-----------|------|--------|-----|
| **Primary** | `--color-accent` | `white` | none | Main CTA per page |
| **Secondary** | `transparent` | `--color-text-primary` | `--color-border-default` | Toolbar actions |
| **Ghost** | `transparent` | `--color-text-secondary` | none | Icon buttons, low-emphasis |
| **Danger** | `--color-danger-emphasis` | `white` | none | Destructive actions |
| **Subtle** | `--color-bg-subtle` | `--color-text-primary` | none | Filter pills, toggles |

```css
/* Button sizes */
.btn-sm   { height: 28px; padding: 0 12px; font-size: 12px; border-radius: 6px; }
.btn-md   { height: 32px; padding: 0 16px; font-size: 13px; border-radius: 6px; }
.btn-lg   { height: 36px; padding: 0 20px; font-size: 14px; border-radius: 6px; }
.btn-icon { height: 32px; width: 32px; padding: 0; border-radius: 6px; }
```

**No `.btn-glow`.** No gradient buttons. No scale transforms on click.

### Status Badges

```css
/* Tiny inline badge */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  height: 20px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 10px;
  /* Color set per status */
}
```

| Status | Background | Text |
|--------|-----------|------|
| Running | `--color-success-muted` | `--color-success` |
| Completed | `--color-done` + muted | `--color-done` |
| Failed | `--color-danger-muted` | `--color-danger` |
| Pending | `--color-warning-muted` | `--color-warning` |
| Paused | `--color-warning-muted` | `--color-warning` |
| Cancelled | `--color-bg-subtle` | `--color-text-muted` |
| Created | `--color-bg-subtle` | `--color-text-muted` |

### Status Dots

For compact indicators (sidebar, lists):
```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot-running   { background: var(--color-success); }
.status-dot-completed { background: var(--color-done); }
.status-dot-failed    { background: var(--color-danger); }
.status-dot-pending   { background: var(--color-warning); }
```

### Inputs

```css
.input {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
}
.input:focus {
  border-color: var(--color-accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--color-accent-muted);
}
.input::placeholder {
  color: var(--color-text-muted);
}
```

**No glassmorphism on inputs.**

### Tabs

Underline-style tabs (like GitHub):
```css
.tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
}
.tab:hover {
  color: var(--color-text-primary);
  border-color: var(--color-border-muted);
}
.tab-active {
  color: var(--color-text-primary);
  border-color: var(--color-accent);
}
```

### Empty States

Minimal — just text, no illustrations:
```
No chats yet
Start a conversation to get started.     [New Chat]
```

- Simple centered paragraph
- Inline action button (not a large CTA below)
- No large icons, no gradient circles, no dashed borders

### Dialogs/Modals

```css
.dialog-overlay {
  background: rgba(0, 0, 0, 0.5);
}
.dialog {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  max-width: 480px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}
```

### Sidebar Navigation Item

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-radius: 6px;
}
.nav-item:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text-primary);
}
.nav-item-active {
  background: var(--color-bg-emphasis);
  color: var(--color-text-primary);
}
```

---

## 9. Page-by-Page Redesign

### 9.1 Dashboard

**Current:** Hero section + 4 stat cards + 3 quick action cards + 2 recent sections + workflow grid  
**New:** Compact overview — minimal, quick navigation hub

```
┌─────────────────────────────────────────────────┐
│ Dashboard                                        │
├─────────────────────────────────────────────────┤
│ [Overview]  [Activity]                           │
│                                                  │
│  Stats Row:                                      │
│  Active Chats: 3  │  Workflows: 12  │  Runs: 2  │  Completed: 48  │
│                                                  │
│  ┌─ Recent Activity ──────────────────────────┐  │
│  │ ● code-gen run #4 completed  · 5m ago      │  │
│  │ ○ API design chat updated    · 12m ago     │  │
│  │ ✕ test run #2 failed         · 1h ago      │  │
│  │ ✓ review run #3 completed    · 2h ago      │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Quick Start                                     │
│  [+ New Chat]  [+ New Workflow]  [Browse Templates] │
└─────────────────────────────────────────────────┘
```

**Changes:**
- Remove hero section with gradient icon
- Stats become a **single row of inline metrics** (not 4 large cards)
- Quick Actions become a **simple button row** (not icon cards)
- Recent items become a **single unified activity feed** (not 2 separate sections)
- Remove "Your Workflows" section (redundant — Workflows page exists)
- Reduce overall height: everything visible above the fold

### 9.2 Chats List

**Current:** Title + subtitle + search/filter + card list  
**New:** Compact list view with inline actions

```
┌─────────────────────────────────────────────────┐
│ Chats                              [+ New Chat] │
├─────────────────────────────────────────────────┤
│ 🔍 Search chats...    [All] [Active] [Archived] │
├─────────────────────────────────────────────────┤
│ 💬 API design review       gpt-4.1  · 5m ago  ● │
│ 💬 Bug fix for login        claude   · 1h ago  ● │
│ 💬 Architecture planning    gpt-4.1  · 2d ago  ○ │
│ 📦 Old test chat           gpt-4.1  · 1w ago  ─ │
└─────────────────────────────────────────────────┘
```

**Changes:**
- Remove subtitle "Your AI conversations"
- Compact list rows (40px height vs current ~72px)
- No card wrappers around each item — flat list with hover highlight
- Model shown as subtle monospace badge
- Status as trailing dot (●/○/─) instead of colored pill
- Bulk select mode: checkbox appears on hover like GitHub
- No dashed-border empty state — just text: "No chats yet. [New Chat]"

### 9.3 Chat Page (Conversation)

**Current:** Full chat with gradient bubbles and avatar badges  
**New:** Clean message thread like GitHub Copilot

```
┌─────────────────────────────────────────────────┐
│ API design review               [model ▾] [···] │
├─────────────────────────────────────────────────┤
│                                                  │
│  You · 2:30 PM                                   │
│  Help me design a REST API for user management   │
│                                                  │
│  ─────────────────────────────────────────────── │
│                                                  │
│  Assistant · 2:30 PM                             │
│  Here's a proposed API design:                   │
│  ```                                             │
│  POST /api/users                                 │
│  GET  /api/users/:id                             │
│  ```                                             │
│                                                  │
│  🔧 Tool: create_file (3 files)                 │
│                                                  │
├─────────────────────────────────────────────────┤
│ Type a message...                          [⏎]  │
└─────────────────────────────────────────────────┘
```

**Changes:**
- Remove colored avatar circles — use "You" / "Assistant" text labels
- No gradient message bubbles — flat separation with horizontal rule
- Tool calls shown as **compact collapsible blocks**
- Thinking blocks shown as a **subtle italic section** (not separate card)
- Input area: simple border-top with text input + send button
- Model selector in header (not in input area)
- Streaming indicator: subtle pulsing dot next to "Assistant" label

### 9.4 Workflows List

**Current:** Error fallback or card grid  
**New:** Table/list view with inline metadata

```
┌─────────────────────────────────────────────────┐
│ Workflows                       [+ New Workflow] │
├─────────────────────────────────────────────────┤
│ 🔍 Search...  [All] [System] [Custom]  [Import] │
├───────────────────────────────────┬──────┬──────┤
│ Name                              │ Runs │ Last │
├───────────────────────────────────┼──────┼──────┤
│ ⚡ Code Generation (system)       │  12  │ 5m   │
│ ⚡ Code Review (system)           │   8  │ 1h   │
│   Custom API Builder              │   3  │ 2d   │
│   Data Pipeline                   │   1  │ 1w   │
└───────────────────────────────────┴──────┴──────┘
```

**Changes:**
- Switch from card grid → **table view** (higher density)
- System templates distinguished by ⚡ icon and "(system)" label
- Show run count and last run time inline
- Import button in toolbar (not separate action card)
- Row click → navigate to workflow detail

### 9.5 Workflow Builder

**Current:** Good foundation — DAG canvas + right properties panel  
**New:** Refine styling to match dark theme

**Changes:**
- Canvas background: solid `--color-bg-base` with subtle dot grid
- Remove glassmorphism from toolbar
- Toolbar buttons: `btn-secondary` style (outlined, compact)
- Stage nodes: flat cards with status border-left color
- Properties panel: flat background, standard form inputs
- Remove "Auto-Layout" floating button — put in toolbar
- "Add Stage" button → compact `btn-primary btn-sm` at canvas bottom
- Zoom controls: minimal icon buttons (same as VS Code minimap)

### 9.6 Workflow Run Page

**Current:** Split pane with runtime DAG + stage output  
**New:** Keep split but restyle

**Changes:**
- Left pane: Runtime DAG with status dots on nodes (not gradient backgrounds)
- Right pane: tabs — [Output] [Timeline] [Artifacts] [Messages]
- Run controls (pause/resume/cancel): compact icon buttons in header
- Progress: thin accent-colored progress bar at top of page
- Stage output: monospace rendering for code, standard markdown for text
- Timeline: compact event list with timestamps (not cards)

### 9.7 Automations

**Current:** Title + subtitle + empty state  
**New:** Same structure, refined styling

```
┌─────────────────────────────────────────────────┐
│ Automations                  [+ New Automation] │
├─────────────────────────────────────────────────┤
│ No automations yet.                              │
│ Create an automation to run workflows on         │
│ schedule or via webhook. [Create Automation]     │
└─────────────────────────────────────────────────┘
```

**Changes:**
- Remove large lightning bolt illustration
- Inline the CTA with the description text
- When automations exist: table view like workflows

### 9.8 Templates

**Current:** Search + "No templates found"  
**New:** Category grid with system templates

```
┌──────────────────────────────────────────────────┐
│ Templates                                         │
├──────────────────────────────────────────────────┤
│ 🔍 Search templates...                            │
│                                                   │
│ SYSTEM TEMPLATES                                  │
│ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│ │ Code Gen     │ │ Code Review  │ │ E2E Testing│ │
│ │ 4 stages     │ │ 4 stages     │ │ 4 stages   │ │
│ │ [Use →]      │ │ [Use →]      │ │ [Use →]    │ │
│ └──────────────┘ └──────────────┘ └────────────┘ │
│                                                   │
│ CUSTOM TEMPLATES                                  │
│ No custom templates. [Import JSON]                │
└──────────────────────────────────────────────────┘
```

**Changes:**
- Two sections: System vs Custom
- Compact template cards (not full-card wrappers)
- Show stage count
- "Use" action inline

### 9.9 Settings

**Current:** 3 tabs (General/Copilot/Advanced)  
**Good foundation** — keep tab structure

**Changes:**
- Remove card wrappers — use section headings with borders
- Compact form inputs
- Theme switcher: simple segmented control (not button group)
- Copilot tab: model selection, API config
- Advanced tab: paths, debug, sandbox config

---

## 10. Motion & Interaction

### Keep

- `animate-fade-in` (200ms ease-out) — page transitions
- `animate-spin` — loading indicators only
- 150ms transitions on hover/focus

### Remove

- `animate-bounce` — bouncing dots (replace with simple pulse)
- `float-orb` — background orb animation
- `glow-pulse` — glow effects
- `stage-pulse` — pulsing shadows
- `shimmer` — shimmer loading (replace with opacity pulse)
- `btn-glow` active scale transform
- `dialog-in` scale animation (use fade only)
- All `backdrop-filter: blur()` effects

### Add

- Subtle `opacity` transition for skeleton loading
- Smooth `height: auto` expanding for collapsible sections
- `translate-x` for sidebar slide on mobile

---

## 11. Responsive Strategy

### Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Mobile | < 768px | Sidebar hidden, hamburger menu, full-width content |
| Tablet | 768-1024px | Sidebar collapsed to icons (48px), full content |
| Desktop | > 1024px | Full sidebar (240px) + content |
| Wide | > 1440px | Same, content doesn't stretch beyond max-width |

### Mobile-Specific

- Sidebar: full-screen overlay with backdrop (current approach is fine, just restyle)
- No workflow canvas on mobile (show list view of stages instead)
- Chat input: sticky bottom with safe-area padding

---

## 12. Implementation Plan

### Phase 1: Foundation (CSS Variables + Layout)

| Task | Files | Effort |
|------|-------|--------|
| Replace CSS variables in globals.css | `apps/web/src/styles/globals.css` | Medium |
| Remove glassmorphism utility classes | `globals.css` | Small |
| Remove background orbs | `globals.css`, `AppLayout.tsx` | Small |
| Switch fonts to system stack | `globals.css`, `index.html` | Small |
| Update Sidebar component | `Sidebar.tsx` | Large |
| Update Header component | `Header.tsx` | Medium |
| Update AppLayout | `AppLayout.tsx` | Small |
| Set dark theme as default | `ThemeProvider.tsx`, `index.html` | Small |

### Phase 2: Components

| Task | Files | Effort |
|------|-------|--------|
| Restyle buttons (remove .btn-glow) | `globals.css`, all pages | Large |
| Restyle cards (remove glass-card) | `globals.css`, all pages | Large |
| Restyle inputs (remove glass-input) | `globals.css`, all pages | Medium |
| Update status badges | `RunStatusBadge.tsx`, status/ | Medium |
| Update empty states | All pages | Medium |
| Update tabs component | Settings, filters | Small |

### Phase 3: Pages

| Task | Files | Effort |
|------|-------|--------|
| Redesign Dashboard | `DashboardPage.tsx` | Large |
| Redesign Chats list | `ChatsListPage.tsx` | Medium |
| Redesign Chat page | `ChatPage.tsx`, chat components | Large |
| Redesign Workflow list | `WorkflowListPage.tsx` | Medium |
| Restyle Workflow builder | `WorkflowBuilderPage.tsx`, DAG components | Large |
| Redesign Workflow run | `WorkflowRunPage.tsx` | Medium |
| Redesign Automations | `AutomationsPage.tsx`, `CreateAutomationPage.tsx` | Medium |
| Redesign Templates | `TemplateExplorer.tsx` | Small |
| Restyle Settings | `Settings.tsx` | Small |

### Phase 4: Polish

| Task | Files | Effort |
|------|-------|--------|
| Update all Lucide icon sizes to 16px | All components | Medium |
| Remove excessive animations | `globals.css` | Small |
| Test dark/light theme consistency | All | Medium |
| Mobile responsive fixes | Sidebar, layout | Medium |
| Accessibility audit (focus states, contrast) | All | Medium |

---

## 13. File Change Manifest

### CSS Files

| File | Action | Changes |
|------|--------|---------|
| `apps/web/src/styles/globals.css` | **Major rewrite** | Replace all CSS variables; remove glassmorphism classes (`.glass`, `.glass-card`, `.glass-sidebar`, `.glass-header`, `.glass-input`, `.glass-btn`, `.glass-strong`, `.glass-subtle`); remove `.btn-glow`; remove `.bg-orbs`; remove gradient keyframes; update all component base styles; new flat card/button/input styles |
| `apps/web/index.html` | **Edit** | Remove Google Fonts links (Inter, JetBrains Mono); update theme script to default to dark |

### Layout Components

| File | Action | Changes |
|------|--------|---------|
| `apps/web/src/components/layout/AppLayout.tsx` | **Edit** | Remove `bg-orbs` div; update classes to flat `bg-[var(--color-bg-base)]`; sidebar width from `w-72` → `w-60` |
| `apps/web/src/components/layout/Sidebar.tsx` | **Major rewrite** | Replace tab navigation with vertical nav list; add collapsible sections (Recent Chats, Recent Runs); replace glassmorphism with flat background; reduce padding; add count badges; remove gradient CTA button |
| `apps/web/src/components/layout/Header.tsx` | **Edit** | Reduce height from `h-14` → `h-10`; remove glassmorphism; flat bg with bottom border; simplify content |
| `apps/web/src/providers/ThemeProvider.tsx` | **Edit** | Default theme = `'dark'` instead of `'system'`; remove system-theme special CSS |

### Page Components

| File | Action | Changes |
|------|--------|---------|
| `apps/web/src/pages/DashboardPage.tsx` | **Major rewrite** | Flatten layout; stats as inline row; remove hero section and gradient icon; merge recent sections into activity feed; simplify quick actions to button row |
| `apps/web/src/pages/ChatsListPage.tsx` | **Edit** | Compact list rows; remove card wrappers; flat hover states; smaller badges |
| `apps/web/src/pages/ChatPage.tsx` | **Edit** | Remove gradient message bubbles; flat message separation; simplify avatars to text labels; compact input area |
| `apps/web/src/pages/WorkflowListPage.tsx` | **Edit** | Switch to table/list view; compact rows; inline metadata |
| `apps/web/src/pages/WorkflowBuilderPage.tsx` | **Edit** | Restyle toolbar; flat canvas bg; compact controls |
| `apps/web/src/pages/WorkflowRunPage.tsx` | **Edit** | Flat split pane; compact timeline; thin progress bar |
| `apps/web/src/pages/AutomationsPage.tsx` | **Edit** | Minimal empty state; flat card when populated |
| `apps/web/src/pages/CreateAutomationPage.tsx` | **Edit** | Flat form styling |
| `apps/web/src/pages/TemplateExplorer.tsx` | **Edit** | Two-section layout (system/custom); compact cards |
| `apps/web/src/pages/Settings.tsx` | **Edit** | Remove card wrappers; section borders; compact inputs |
| `apps/web/src/pages/AutomationDetailPage.tsx` | **Edit** | Flat styling updates |
| `apps/web/src/pages/WorkflowDefinitionPage.tsx` | **Edit** | Flat styling updates |

### Shared Components

| File | Action | Changes |
|------|--------|---------|
| `apps/web/src/components/chat/ChatMessageList.tsx` | **Edit** | Remove gradient bubbles; flat message styling |
| `apps/web/src/components/chat/StreamingMessage.tsx` | **Edit** | Compact streaming indicator |
| `apps/web/src/components/chat/ChatInput.tsx` | **Edit** | Flat input with border-top |
| `apps/web/src/components/chat/AssistantMessage.tsx` | **Edit** | Remove avatar gradient; text label |
| `apps/web/src/components/chat/UserMessage.tsx` | **Edit** | Remove avatar gradient; text label |
| `apps/web/src/components/chat/ToolMessage.tsx` | **Edit** | Compact collapsible block |
| `apps/web/src/components/workflow/DAGCanvas.tsx` | **Edit** | Flat canvas bg, compact nodes |
| `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx` | **Edit** | Status dot nodes |
| `apps/web/src/components/workflow/StageNode.tsx` | **Edit** | Flat card with status border-left |
| `apps/web/src/components/workflow/StagePropertiesPanel.tsx` | **Edit** | Flat background, compact forms |
| `apps/web/src/components/workflow/WorkflowConfigPanel.tsx` | **Edit** | Flat styling |
| `apps/web/src/components/workflow/RunControls.tsx` | **Edit** | Compact icon buttons |
| `apps/web/src/components/workflow/VariableInputModal.tsx` | **Edit** | Flat dialog |
| `apps/web/src/components/GlobalSSEManager.tsx` | No change | Logic only |
| `apps/web/src/components/ConfirmDialog.tsx` | **Edit** | Flat dialog styling |
| `apps/web/src/components/Skeleton.tsx` | **Edit** | Replace shimmer with opacity pulse |
| `apps/web/src/components/ErrorBoundary.tsx` | **Edit** | Compact error display |

---

## Design Validation Against Inspiration Screenshots

### Checklist

| Inspiration Element | Plan Coverage | Notes |
|----|---|---|
| ✅ Deep dark background (#0d1117) | `--color-bg-base: #0d1117` | Exact match |
| ✅ Flat sidebar with right border | Sidebar redesign Phase 1 | No glassmorphism |
| ✅ Hierarchical sidebar groups | "RECENT CHATS", "RECENT RUNS" sections | Uppercase labels |
| ✅ Compact session list with timestamps | Chat list redesign | Relative time, status dots |
| ✅ Simple "New Session" button | `[+]` icon in sidebar header | Not gradient CTA |
| ✅ Clean centered input for new chat | ChatPage input area | Border-top, minimal |
| ✅ Model selector dropdown | Model dropdown in chat header | Not in input area |
| ✅ Bottom toolbar (Agent, model, tools) | Chat page header actions | Compact controls |
| ✅ Skills/customizations panel | Templates page | Simple list with descriptions |
| ✅ `UI Integration` badges | Badge system for template types | Small inline pills |
| ✅ Changes/Files tab panel | Workflow run → Output/Timeline/Artifacts tabs | Same tab pattern |
| ✅ "Initialize Repository" button | CTA buttons in empty states | Teal/blue fill |
| ✅ Simple empty state text | All empty states | No illustrations |
| ✅ File tree explorer | Not applicable (but sidebar hierarchy matches) | Tree pattern |
| ✅ Monochrome icons | All icons → `text-secondary`, 16px | Consistent |
| ✅ No gradients anywhere | All gradient utilities removed | Flat colors |
| ✅ 1px borders for separation | `border-default` tokens | No shadows |
| ✅ Compact 40px header | Header redesign | Down from 56px |
| ✅ System font stack | Removed Google Fonts | OS-native feel |

### Gap Analysis

All major inspiration elements are covered. The plan captures:
- Dark-first color system matching GitHub's color primitives
- Flat surface hierarchy (base → raised → overlay)
- Compact typography and spacing
- Monochrome icon treatment
- Hierarchical sidebar with collapsible groups
- Content-first empty states
- Status dots and inline badges

The only elements NOT directly applicable from the inspiration:
- Git branch selector (we don't need this in the header)
- Copilot CLI / Autopilot toggles (we have different features)
- These are feature-specific to GitHub Copilot, not design patterns

---

*End of Design Overhaul Plan*
