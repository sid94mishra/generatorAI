# GeneratorAI — Design Specification v2.0

> **Last updated:** March 2, 2026  
> **Status:** Implementation-Ready  
> **Stack:** React 19 · Tailwind CSS 4 · @xyflow/react 12 · Zustand · Lucide Icons · Inter + JetBrains Mono  

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Color Palette & Theme](#2-color-palette--theme)
3. [Typography](#3-typography)
4. [Spacing, Radius & Elevation](#4-spacing-radius--elevation)
5. [Animation & Motion](#5-animation--motion)
6. [Component Library](#6-component-library)
7. [Sidebar Navigation](#7-sidebar-navigation)
8. [Dashboard Page](#8-dashboard-page)
9. [Chat Page](#9-chat-page)
10. [Workflow List Page](#10-workflow-list-page)
11. [Workflow Builder Canvas](#11-workflow-builder-canvas)
12. [Workflow Run Monitoring](#12-workflow-run-monitoring)
13. [Responsive Breakpoints](#13-responsive-breakpoints)
14. [Accessibility](#14-accessibility)
15. [Dark Mode Implementation Notes](#15-dark-mode-implementation-notes)

---

## 1. Design Philosophy

Inspired by the best traits of modern workflow & developer tools:

| Inspiration | Trait Adopted |
|---|---|
| **n8n** | Clean node-based canvas with clear handles, grid background, floating toolbar |
| **Langflow** | Dark-first palette, animated edges showing data flow, compact stage cards |
| **Retool Workflows** | Professional two-column builder (canvas + properties panel), status badges |
| **Temporal UI** | Timeline-based run monitoring, stage-status pills, streaming log output |
| **Linear** | Ultra-fast keyboard-first navigation, minimal chrome sidebar, subtle transitions |
| **Vercel Dashboard** | Card-based stats, clean typography hierarchy, restrained color use |

**Core Principles:**

1. **Density without clutter** — Show maximum information with generous whitespace and smart hierarchy.
2. **Status at a glance** — Color, icon, and animation communicate state before text is read.
3. **Keyboard-first** — Every action reachable via shortcut, tabbed navigation fully accessible.
4. **Progressive disclosure** — Properties slide in on demand; details expand on click.
5. **Consistent surfaces** — Three elevations only (background → surface/card → popover).

---

## 2. Color Palette & Theme

### 2.1 CSS Custom Properties (Design Tokens)

Already wired in `apps/web/src/styles/globals.css`. The canonical token list:

```css
/* ── LIGHT THEME ── */
:root {
  /* Backgrounds */
  --color-background:       #FFFFFF;    /* Page background                */
  --color-surface:          #F8FAFC;    /* Slightly elevated containers   */
  --color-card:             #FFFFFF;    /* Card backgrounds               */
  --color-card-foreground:  #0F172A;
  --color-popover:          #FFFFFF;    /* Dropdowns, tooltips            */
  --color-popover-foreground: #0F172A;

  /* Brand */
  --color-primary:          #2563EB;    /* Blue-600 — buttons, links      */
  --color-primary-foreground: #FFFFFF;
  --color-primary-hover:    #1D4ED8;    /* Blue-700                       */
  --color-primary-muted:    #DBEAFE;    /* Blue-100 — soft badge bg       */

  /* Secondary & Accent */
  --color-secondary:        #F1F5F9;    /* Slate-100                      */
  --color-secondary-foreground: #0F172A;
  --color-accent:           #F1F5F9;    /* Hover bg for interactive items */
  --color-accent-foreground: #0F172A;

  /* Muted */
  --color-muted:            #F1F5F9;    /* Subtle backgrounds             */
  --color-muted-foreground: #64748B;    /* Slate-500 — secondary text     */

  /* Destructive */
  --color-destructive:      #EF4444;    /* Red-500                        */
  --color-destructive-foreground: #FFFFFF;

  /* Borders */
  --color-border:           #E2E8F0;    /* Slate-200                      */
  --color-border-hover:     #CBD5E1;    /* Slate-300                      */
  --color-input:            #E2E8F0;
  --color-ring:             #2563EB;    /* Focus ring                     */

  /* Status */
  --color-success:          #22C55E;    /* Green-500                      */
  --color-success-bg:       #F0FDF4;    /* Green-50                       */
  --color-success-border:   #86EFAC;    /* Green-300                      */
  --color-warning:          #F59E0B;    /* Amber-500                      */
  --color-warning-bg:       #FFFBEB;    /* Amber-50                       */
  --color-warning-border:   #FCD34D;    /* Amber-300                      */
  --color-error:            #EF4444;    /* Red-500                        */
  --color-error-bg:         #FEF2F2;    /* Red-50                         */
  --color-error-border:     #FCA5A5;    /* Red-300                        */
  --color-info:             #3B82F6;    /* Blue-500                       */
  --color-info-bg:          #EFF6FF;    /* Blue-50                        */
  --color-info-border:      #93C5FD;    /* Blue-300                       */

  /* Text */
  --color-foreground:       #0F172A;    /* Slate-900 — primary text       */
  --text-secondary:         #475569;    /* Slate-600 — body text          */
  --text-muted:             #94A3B8;    /* Slate-400 — captions           */

  /* Sidebar */
  --color-sidebar:          #F8FAFC;
  --color-sidebar-foreground: #334155;
  --color-sidebar-border:   #E2E8F0;
  --color-sidebar-accent:   #EFF6FF;
  --color-sidebar-accent-foreground: #1E40AF;

  /* Canvas */
  --canvas-dot:             #E2E8F0;    /* Dot grid                       */
  --canvas-edge:            #94A3B8;    /* Default edge color             */
  --canvas-edge-active:     #2563EB;    /* Active/animated edge           */

  /* Gradients */
  --gradient-primary:       linear-gradient(135deg, #2563EB 0%, #7C3AED 100%);
  --gradient-surface:       linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%);
  --gradient-card-hover:    linear-gradient(135deg, rgba(37,99,235,0.04) 0%, rgba(124,58,237,0.04) 100%);

  --radius:                 0.5rem;     /* 8px base radius                */
}

/* ── DARK THEME ── */
.dark {
  --color-background:       #0B1222;    /* Deep navy                      */
  --color-surface:          #111827;    /* Gray-900                       */
  --color-card:             #1E293B;    /* Slate-800                      */
  --color-card-foreground:  #F1F5F9;
  --color-popover:          #1E293B;
  --color-popover-foreground: #F1F5F9;

  --color-primary:          #3B82F6;    /* Blue-500                       */
  --color-primary-foreground: #FFFFFF;
  --color-primary-hover:    #60A5FA;    /* Blue-400                       */
  --color-primary-muted:    #1E3A5F;

  --color-secondary:        #1E293B;
  --color-secondary-foreground: #F1F5F9;
  --color-accent:           #1E293B;
  --color-accent-foreground: #F1F5F9;

  --color-muted:            #1E293B;
  --color-muted-foreground: #94A3B8;

  --color-destructive:      #DC2626;
  --color-destructive-foreground: #FFFFFF;

  --color-border:           #334155;    /* Slate-700                      */
  --color-border-hover:     #475569;    /* Slate-600                      */
  --color-input:            #334155;
  --color-ring:             #3B82F6;

  --color-success:          #22C55E;
  --color-success-bg:       rgba(34,197,94,0.1);
  --color-success-border:   rgba(34,197,94,0.3);
  --color-warning:          #F59E0B;
  --color-warning-bg:       rgba(245,158,11,0.1);
  --color-warning-border:   rgba(245,158,11,0.3);
  --color-error:            #EF4444;
  --color-error-bg:         rgba(239,68,68,0.1);
  --color-error-border:     rgba(239,68,68,0.3);
  --color-info:             #60A5FA;
  --color-info-bg:          rgba(96,165,250,0.1);
  --color-info-border:      rgba(96,165,250,0.3);

  --color-foreground:       #F1F5F9;
  --text-secondary:         #CBD5E1;
  --text-muted:             #64748B;

  --color-sidebar:          #0B1222;
  --color-sidebar-foreground: #CBD5E1;
  --color-sidebar-border:   #253248;
  --color-sidebar-accent:   #1E3A5F;
  --color-sidebar-accent-foreground: #93C5FD;

  --canvas-dot:             #253248;
  --canvas-edge:            #475569;
  --canvas-edge-active:     #3B82F6;

  --gradient-primary:       linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
  --gradient-surface:       linear-gradient(180deg, #111827 0%, #0B1222 100%);
  --gradient-card-hover:    linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(139,92,246,0.06) 100%);
}
```

### 2.2 Stage Status Color Map

| Status | Light bg | Light border | Dark bg | Dark border | Icon | Tailwind Ring |
|---|---|---|---|---|---|---|
| **pending** | `gray-50` | `gray-300` | `gray-800` | `gray-600` | `Clock` gray-400 | — |
| **queued** | `blue-50` | `blue-300` | `blue-900/30` | `blue-600` | `Clock` blue-500 | — |
| **running** | `yellow-50` | `yellow-400` | `yellow-900/20` | `yellow-500` | `Play` yellow-600 `animate-pulse` | `ring-yellow-400/30` |
| **paused** | `orange-50` | `orange-300` | `orange-900/20` | `orange-500` | `Pause` orange-500 | — |
| **completed** | `green-50` | `green-400` | `green-900/20` | `green-500` | `Check` green-600 | — |
| **failed** | `red-50` | `red-400` | `red-900/20` | `red-500` | `X` red-600 | `ring-red-400/30` |
| **cancelled** | `gray-100` | `gray-400` | `gray-700` | `gray-500` | `X` gray-500 | — |
| **skipped** | `gray-50` | `gray-300` | `gray-800` | `gray-600` | `SkipForward` gray-400 | — |

---

## 3. Typography

### 3.1 Font Families

```css
--font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Loaded via Google Fonts:
```
Inter: 400, 500, 600, 700
JetBrains Mono: 400, 500
```

### 3.2 Type Scale

| Token | Size | Line Height | Weight | Use |
|---|---|---|---|---|
| `text-2xl` | 24px / 1.5rem | 32px | 700 | Page titles (Dashboard, Workflows) |
| `text-xl` | 20px / 1.25rem | 28px | 700 | Section headings |
| `text-lg` | 18px / 1.125rem | 28px | 600 | Card titles, dialog headings |
| `text-base` | 16px / 1rem | 24px | 400 | Body text, descriptions |
| `text-sm` | 14px / 0.875rem | 20px | 400–500 | Most UI text: labels, buttons, list items |
| `text-xs` | 12px / 0.75rem | 16px | 400–500 | Captions, badges, timestamps, metadata |
| `text-[11px]` | 11px | 14px | 500 | Minimap labels, tiny indicators |

### 3.3 Letter Spacing

| Context | Value |
|---|---|
| Page titles | `-0.025em` (`tracking-tight`) |
| Section headings | `-0.01em` |
| Body text | `0em` (default) |
| Uppercase badges | `0.05em` (`tracking-wide`) |
| Code / mono | `0em` |

---

## 4. Spacing, Radius & Elevation

### 4.1 Spacing Scale

Uses Tailwind default 4px base. Common app-level patterns:

| Context | Value | Tailwind |
|---|---|---|
| Page padding | 24px | `p-6` |
| Card internal padding | 16px–20px | `p-4` / `p-5` |
| Section gap | 24px | `gap-6` |
| Element gap (within card) | 12px | `gap-3` |
| Tight element gap | 8px | `gap-2` |
| Between icon and label | 6px–8px | `gap-1.5` / `gap-2` |
| Input padding-x | 12px | `px-3` |
| Input padding-y | 8px–10px | `py-2` / `py-2.5` |
| Sidebar width collapsed | 56px | `w-14` |
| Sidebar width expanded | 288px | `w-72` |
| Properties panel width | 384px | `w-96` |

### 4.2 Border Radius

| Element | Value | Tailwind | CSS var |
|---|---|---|---|
| Buttons, inputs, selects | 8px | `rounded-lg` | `var(--radius)` |
| Cards, panels | 12px | `rounded-xl` | — |
| Stage nodes | 10px | `rounded-[10px]` | — |
| Badges, pills | 9999px | `rounded-full` | — |
| Avatars | 9999px | `rounded-full` | — |
| Tooltips | 6px | `rounded-md` | — |
| Page-level containers | 16px | `rounded-2xl` | — |
| Handle connectors | 9999px | `rounded-full` | — |

### 4.3 Shadows (Elevation)

```css
/* Level 0 — Flush (most cards at rest) */
--shadow-none: none;

/* Level 1 — Subtle lift (cards, toolbar buttons) */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);

/* Level 2 — Hover state, dropdowns */
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.07),
             0 2px 4px -2px rgba(0, 0, 0, 0.05);

/* Level 3 — Modals, slide-over panels */
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08),
             0 4px 6px -4px rgba(0, 0, 0, 0.04);

/* Level 4 — Command palette, toast */
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
             0 8px 10px -6px rgba(0, 0, 0, 0.04);

/* Colored glow (selected stage nodes) */
--shadow-primary-glow: 0 0 0 3px rgba(37, 99, 235, 0.15),
                       0 4px 12px rgba(37, 99, 235, 0.1);

/* Dark mode adjustments — double opacity */
.dark {
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.3),
               0 2px 4px -2px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4),
               0 4px 6px -4px rgba(0, 0, 0, 0.2);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5),
               0 8px 10px -6px rgba(0, 0, 0, 0.3);
}
```

| Tailwind usage | Element |
|---|---|
| `shadow-sm` | Cards at rest, toolbar buttons |
| `shadow-md` | Cards on hover, dropdowns |
| `shadow-lg` | Properties panel, modals |
| `shadow-xl` | Command palette overlay |
| Custom ring | Selected stage node: `ring-2 ring-[var(--color-primary)]/20 shadow-md` |

---

## 5. Animation & Motion

### 5.1 Transition Defaults

```css
/* Standard interactive elements */
transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);  /* Tailwind: transition-all */

/* Sidebar expand/collapse */
transition: width 200ms ease-in-out;   /* Tailwind: transition-all duration-200 ease-in-out */

/* Properties panel slide-in */
transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);

/* Canvas zoom/pan */
transition: transform 300ms ease;
```

### 5.2 Keyframe Animations

```css
/* Streaming cursor blink */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.streaming-cursor { animation: blink 0.8s step-end infinite; }

/* Running stage pulse */
@keyframes stage-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.3); }
  50% { box-shadow: 0 0 0 6px rgba(234, 179, 8, 0); }
}
.stage-running { animation: stage-pulse 2s ease-in-out infinite; }

/* Edge flow animation (dashed stroke traveling along path) */
@keyframes edge-flow {
  from { stroke-dashoffset: 24; }
  to { stroke-dashoffset: 0; }
}
.edge-animated {
  stroke-dasharray: 6 6;
  animation: edge-flow 0.6s linear infinite;
}

/* Slide in from right (properties panel) */
@keyframes slide-in-right {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.animate-slide-in-right { animation: slide-in-right 200ms ease-out; }

/* Fade in up (cards, list items) */
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up { animation: fade-in-up 200ms ease-out; }

/* Spinner */
@keyframes spin { to { transform: rotate(360deg); } }
.animate-spin { animation: spin 1s linear infinite; }

/* Skeleton shimmer */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.animate-shimmer {
  background: linear-gradient(
    90deg,
    var(--color-muted) 25%,
    var(--color-accent) 50%,
    var(--color-muted) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

/* Dialog entrance */
@keyframes dialog-in {
  from { opacity: 0; transform: scale(0.95) translateY(4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.animate-dialog-in { animation: dialog-in 200ms ease-out; }

/* Toast slide up */
@keyframes toast-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-toast-in { animation: toast-in 300ms ease-out; }
```

---

## 6. Component Library

### 6.1 Button

Four variants, three sizes:

```tsx
/* Base classes (all buttons): */
className="inline-flex items-center justify-center font-medium transition-all
           focus-visible:outline-2 focus-visible:outline-offset-1 
           focus-visible:outline-[var(--color-ring)]
           disabled:pointer-events-none disabled:opacity-50
           active:scale-[0.98]"

/* Variants: */
// Primary  — filled
"bg-[var(--color-primary)] text-[var(--color-primary-foreground)]
 hover:brightness-110 shadow-sm"

// Secondary — subtle fill
"bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]
 hover:bg-[var(--color-accent)] border border-[var(--color-border)]"

// Ghost — transparent
"text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"

// Destructive — red filled
"bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]
 hover:brightness-110"

/* Sizes: */
// sm:   "h-8  px-3  text-xs  rounded-md  gap-1.5"
// md:   "h-9  px-4  text-sm  rounded-lg  gap-2"    (default)
// lg:   "h-11 px-6  text-sm  rounded-lg  gap-2.5"

// Icon-only button
// sm:   "h-8  w-8   rounded-md"
// md:   "h-9  w-9   rounded-lg"
```

**Example (Primary, medium):**
```tsx
<button className="inline-flex items-center justify-center gap-2 rounded-lg
                    bg-[var(--color-primary)] px-4 py-2 text-sm font-medium
                    text-[var(--color-primary-foreground)] shadow-sm
                    transition-all hover:brightness-110 active:scale-[0.98]
                    focus-visible:outline-2 focus-visible:outline-offset-1
                    focus-visible:outline-[var(--color-ring)]
                    disabled:pointer-events-none disabled:opacity-50">
  <Plus className="h-4 w-4" />
  New Workflow
</button>
```

### 6.2 Input / Textarea

```tsx
<input className="w-full rounded-lg border border-[var(--color-border)]
                  bg-[var(--color-background)] px-3 py-2 text-sm
                  text-[var(--color-foreground)]
                  placeholder:text-[var(--color-muted-foreground)]
                  focus:border-[var(--color-primary)]
                  focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]
                  transition-colors" />

/* With search icon prefix: */
<div className="relative">
  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2
                     text-[var(--color-muted-foreground)]" />
  <input className="... pl-9" placeholder="Search workflows..." />
</div>
```

### 6.3 Badge / Pill

```tsx
/* Status badges (small, colored) */
// success
<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5
                 text-xs font-medium bg-[var(--color-success-bg)]
                 text-[var(--color-success)] border border-[var(--color-success-border)]">
  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
  Active
</span>

// warning
<span className="... bg-[var(--color-warning-bg)] text-[var(--color-warning)]
                 border-[var(--color-warning-border)]">Draft</span>

// neutral
<span className="inline-flex items-center rounded-full px-2 py-0.5
                 text-xs font-medium bg-[var(--color-muted)]
                 text-[var(--color-muted-foreground)]">Archived</span>

/* Tag badges */
<span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5
                 text-xs bg-[var(--color-accent)]
                 text-[var(--color-muted-foreground)]">
  <Tag className="h-3 w-3" /> code-review
</span>
```

### 6.4 Card

```tsx
/* Standard card: */
<div className="rounded-xl border border-[var(--color-border)]
                bg-[var(--color-card)] p-5 shadow-sm
                transition-all hover:shadow-md
                hover:border-[var(--color-border-hover)]">
  {/* content */}
</div>

/* Interactive card (clickable — e.g., workflow card): */
<div className="group cursor-pointer rounded-xl border border-[var(--color-border)]
                bg-[var(--color-card)] p-5 shadow-sm
                transition-all duration-150
                hover:shadow-md hover:border-[var(--color-primary)]/30
                active:scale-[0.99]">
  {/* hover overlay gradient */}
  <div className="absolute inset-0 rounded-xl opacity-0
                  group-hover:opacity-100 transition-opacity
                  bg-gradient-to-br from-[var(--color-primary)]/[0.02]
                  to-[var(--color-primary)]/[0.04] pointer-events-none" />
  {/* content */}
</div>

/* Stats card (dashboard): */
<div className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)]
                bg-[var(--color-card)] p-5">
  <span className="text-xs font-medium text-[var(--color-muted-foreground)]
                   uppercase tracking-wide">Total Workflows</span>
  <span className="text-2xl font-bold text-[var(--color-foreground)]
                   tracking-tight">24</span>
  <span className="text-xs text-[var(--color-success)]">↑ 12% this week</span>
</div>
```

### 6.5 Select / Dropdown

```tsx
<select className="w-full rounded-lg border border-[var(--color-border)]
                   bg-[var(--color-background)] px-3 py-2 text-sm
                   text-[var(--color-foreground)] appearance-none
                   bg-[url('data:image/svg+xml,...chevron-svg...')]
                   bg-no-repeat bg-[right_12px_center]
                   focus:border-[var(--color-primary)]
                   focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]">
  <option>Option 1</option>
</select>
```

### 6.6 Toggle / Switch

```tsx
<button role="switch" aria-checked={enabled}
  className={cn(
    "relative h-5 w-9 rounded-full transition-colors",
    enabled ? "bg-[var(--color-primary)]" : "bg-[var(--color-muted)]"
  )}>
  <span className={cn(
    "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
    enabled && "translate-x-4"
  )} />
</button>
```

### 6.7 Skeleton

```tsx
/* Text line skeleton */
<div className="h-4 w-3/4 rounded animate-shimmer" />

/* Card skeleton */
<div className="rounded-xl border border-[var(--color-border)] p-5 space-y-3">
  <div className="h-4 w-1/2 rounded animate-shimmer" />
  <div className="h-3 w-full rounded animate-shimmer" />
  <div className="h-3 w-2/3 rounded animate-shimmer" />
</div>
```

### 6.8 Tooltip

```tsx
/* CSS-only tooltip (appears on hover via group/peer): */
<div className="group relative">
  <button>Hover me</button>
  <div className="absolute bottom-full left-1/2 z-50 -translate-x-1/2 mb-2
                  rounded-md bg-[var(--color-foreground)] px-2.5 py-1.5
                  text-xs text-[var(--color-background)] shadow-lg
                  opacity-0 group-hover:opacity-100 transition-opacity
                  pointer-events-none whitespace-nowrap">
    Tooltip text
    <div className="absolute top-full left-1/2 -translate-x-1/2
                    border-4 border-transparent
                    border-t-[var(--color-foreground)]" />
  </div>
</div>
```

### 6.9 Confirm Dialog / Modal

```tsx
{/* Backdrop */}
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50
                backdrop-blur-sm animate-fade-in">
  {/* Dialog */}
  <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)]
                  bg-[var(--color-card)] p-6 shadow-xl animate-dialog-in">
    <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
      Delete Workflow?
    </h2>
    <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
      This action cannot be undone.
    </p>
    <div className="mt-6 flex justify-end gap-3">
      <button className="/* Secondary button styles */">Cancel</button>
      <button className="/* Destructive button styles */">Delete</button>
    </div>
  </div>
</div>
```

---

## 7. Sidebar Navigation

**Design inspiration:** Linear's ultra-clean, icon-labeled sidebar with collapsible sections.

### 7.1 Layout Structure

```
┌──────────────────────────────┐
│ ⚡ GeneratorAI      [collapse]│  ← Brand header, 56px tall
├──────────────────────────────┤
│ [Chats] [Sessions] [Workflow]│  ← Tab bar (3 tabs)
├──────────────────────────────┤
│ [+ New Chat]                 │  ← Primary CTA, context-aware
├──────────────────────────────┤
│ ○ Project Setup Chat   2m   │  ← Scrollable list
│ ● Code Review Chat     5m   │    ● = unread / active
│ ○ Refactoring Help    12m   │
│ ... (scrollable)             │
├──────────────────────────────┤
│ 📋 Templates                 │  ← Bottom nav
│ ⚙  Settings                 │
└──────────────────────────────┘
```

### 7.2 Component Specifications

**Container:**
```tsx
<aside className={cn(
  "flex flex-col border-r border-[var(--color-sidebar-border)]",
  "bg-[var(--color-sidebar)] transition-all duration-200 ease-in-out",
  expanded ? "w-72" : "w-0 overflow-hidden",
  // Mobile: fixed overlay
  "fixed inset-y-0 left-0 z-50 md:relative md:z-auto"
)}>
```

**Brand header (56px):**
```tsx
<div className="flex items-center justify-between border-b
                border-[var(--color-sidebar-border)] px-4 py-3">
  <div className="flex items-center gap-2">
    <Zap className="h-5 w-5 text-[var(--color-primary)]" />
    <span className="text-sm font-semibold text-[var(--color-foreground)]">
      GeneratorAI
    </span>
  </div>
  <button className="rounded-md p-1 text-[var(--color-muted-foreground)]
                     hover:bg-[var(--color-accent)]">
    <PanelLeftClose className="h-4 w-4" />
  </button>
</div>
```

**Tab bar:**
```tsx
<button className={cn(
  "flex flex-1 items-center justify-center gap-1.5",
  "px-3 py-2.5 text-xs font-medium transition-colors",
  active
    ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
    : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
)}>
  <MessageSquare className="h-3.5 w-3.5" />
  Chats
</button>
```

**List item (chat/session/workflow in sidebar):**
```tsx
<button className={cn(
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
  isActive
    ? "bg-[var(--color-sidebar-accent)] text-[var(--color-sidebar-accent-foreground)] font-medium"
    : "text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)]"
)}>
  <MessageSquare className="h-4 w-4 shrink-0" />
  <span className="flex-1 truncate text-left">{title}</span>
  <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">2m</span>
</button>
```

**CTA button (full-width):**
```tsx
<button className="flex w-full items-center justify-center gap-2 rounded-lg
                   bg-[var(--color-primary)] px-3 py-2 text-sm font-medium
                   text-[var(--color-primary-foreground)]
                   transition-all hover:brightness-110 active:scale-[0.98]">
  <Plus className="h-4 w-4" />
  New Chat
</button>
```

### 7.3 Behavior

- **Collapse:** Desktop — sidebar width transitions `w-72 → w-0` with `overflow-hidden`. Mobile — slides out of view under a backdrop overlay (`bg-black/50 backdrop-blur-sm`).
- **Keyboard:** `Cmd/Ctrl+B` toggles sidebar.
- **Tab persistence:** Current tab syncs with the URL pathname (`/chats/*` → Chats, `/workflows/*` → Workflows).

---

## 8. Dashboard Page

**Design inspiration:** Vercel dashboard card layout + Linear's clean information density.

### 8.1 Layout

```
┌────────────────────────────────────────────────────────────┐
│ Dashboard                                  [+ New Chat ▼] │  ← Page header
├──────────┬──────────┬──────────┬──────────────────────────┤
│ Total    │ Active   │ Total   │ Success Rate             │
│ Workflows│ Runs     │ Chats   │                          │
│   24     │    3     │   47    │   94%                    │
│ ↑12%     │ ▼ 1     │ ↑ 5     │ ↑ 2% vs last week       │
├──────────┴──────────┴──────────┴──────────────────────────┤
│                                                            │
│  Recent Chats                             [View All →]    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│  │ 💬 Name     │ │ 💬 Name     │ │ 💬 Name     │         │
│  │ Last msg... │ │ Last msg... │ │ Last msg... │         │
│  │      2m ago │ │      5m ago │ │     12m ago │         │
│  └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                            │
│  Recent Workflows                         [View All →]    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│  │ 🔀 Name     │ │ 🔀 Name     │ │ 🔀 Name     │         │
│  │ 3 stages ● │ │ 5 stages ● │ │ 2 stages ○ │         │
│  │ Run: 2m ago │ │ Draft      │ │ Run: 1h ago │         │
│  └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                            │
│  Activity Feed                                            │
│  ── Today ───────────────────────────────                 │
│  ✅ Workflow "Code Review" completed         2 min ago   │
│  💬 New chat "API Design" created            15 min ago  │
│  ❌ Workflow "Test Gen" failed at stage 3    1 hr ago    │
│  ── Yesterday ───────────────────────────────             │
│  ✅ Workflow "Refactor" completed            18 hr ago   │
└────────────────────────────────────────────────────────────┘
```

### 8.2 Stats Cards Row

```tsx
<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
  {/* Stat card */}
  <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--color-border)]
                  bg-[var(--color-card)] p-5 transition-all hover:shadow-sm">
    {/* Icon + Label */}
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg
                      bg-[var(--color-primary)]/10">
        <GitBranch className="h-4 w-4 text-[var(--color-primary)]" />
      </div>
      <span className="text-xs font-medium uppercase tracking-wide
                       text-[var(--color-muted-foreground)]">
        Total Workflows
      </span>
    </div>
    {/* Value */}
    <span className="text-2xl font-bold tracking-tight text-[var(--color-foreground)]">
      24
    </span>
    {/* Trend */}
    <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
      <TrendingUp className="h-3 w-3" />
      +12% this week
    </span>
  </div>
  {/* ... repeat for Active Runs, Total Chats, Success Rate */}
</div>
```

### 8.3 Recent Section (Chats or Workflows)

```tsx
{/* Section header */}
<div className="flex items-center justify-between">
  <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
    Recent Chats
  </h2>
  <button className="text-xs font-medium text-[var(--color-primary)]
                     hover:underline underline-offset-2">
    View All →
  </button>
</div>

{/* Horizontal scroll on mobile, grid on desktop */}
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {/* Chat preview card */}
  <div className="group cursor-pointer rounded-xl border border-[var(--color-border)]
                  bg-[var(--color-card)] p-4 transition-all hover:shadow-md
                  hover:border-[var(--color-primary)]/30">
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center
                      rounded-lg bg-[var(--color-primary)]/10">
        <MessageSquare className="h-4 w-4 text-[var(--color-primary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-[var(--color-foreground)]">
          API Design Discussion
        </h3>
        <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]">
          Let's review the endpoint structure for...
        </p>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between text-xs
                    text-[var(--color-muted-foreground)]">
      <span>12 messages</span>
      <span>2 min ago</span>
    </div>
  </div>
</div>
```

### 8.4 Activity Feed

```tsx
<div className="space-y-1">
  {/* Date separator */}
  <div className="py-2 text-xs font-medium uppercase tracking-wide
                  text-[var(--color-muted-foreground)]">
    Today
  </div>

  {/* Activity item */}
  <div className="flex items-start gap-3 rounded-lg px-3 py-2.5
                  hover:bg-[var(--color-accent)] transition-colors">
    {/* Status icon */}
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center
                    rounded-full bg-[var(--color-success-bg)]">
      <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
    </div>
    {/* Text */}
    <div className="min-w-0 flex-1">
      <p className="text-sm text-[var(--color-foreground)]">
        Workflow <span className="font-medium">"Code Review"</span> completed
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
        All 4 stages finished in 1m 23s
      </p>
    </div>
    {/* Timestamp */}
    <span className="shrink-0 text-xs text-[var(--color-muted-foreground)] tabular-nums">
      2m ago
    </span>
  </div>
</div>
```

### 8.5 Quick Actions Header

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold tracking-tight text-[var(--color-foreground)]">
    Dashboard
  </h1>
  <div className="flex items-center gap-2">
    <button className="/* Primary button sm */">
      <Plus className="h-4 w-4" /> New Chat
    </button>
    <button className="/* Secondary button sm */">
      <GitBranch className="h-4 w-4" /> New Workflow
    </button>
  </div>
</div>
```

---

## 9. Chat Page

**Design inspiration:** Clean messaging UI similar to ChatGPT/Claude, with tool expansion cards inspired by Langflow.

### 9.1 Layout

```
┌────────────────────────────────────────────┐
│ 🤖  Project Setup Chat          [Archive] │  ← Header with title
├────────────────────────────────────────────┤
│                                            │
│         ┌──────────────────────┐           │
│         │ 👤 User              │           │
│         │ How do I set up the  │           │  ← Messages (scrollable)
│         │ auth middleware?     │           │
│         └──────────────────────┘           │
│                                            │
│  ┌──────────────────────────────┐          │
│  │ 🤖 Assistant                │          │
│  │                              │          │
│  │ 💭 Thinking...              │ ← collapsible
│  │ ┌─ read_file(auth.ts) ────┐ │          │
│  │ │  Tool result preview     │ │ ← expandable card
│  │ └─────────────────────────┘ │          │
│  │                              │          │
│  │ Here's how to set up the    │          │
│  │ authentication middleware:  │          │
│  │ ```ts                       │          │
│  │ app.use(authMiddleware);    │          │
│  │ ```                         │          │
│  └──────────────────────────────┘          │
│                                            │
│  ┌──────────────────────────────┐          │
│  │ 🤖 ▊ (streaming cursor)    │ ← live stream
│  └──────────────────────────────┘          │
│                                            │
├────────────────────────────────────────────┤
│ [📎] [Type your message...        ] [Send]│  ← Input area
└────────────────────────────────────────────┘
```

### 9.2 Message Components

**User message bubble:**
```tsx
<div className="flex justify-end gap-3 px-4 py-2">
  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--color-primary)]
                  px-4 py-2.5 text-sm text-[var(--color-primary-foreground)]
                  shadow-sm">
    <p>How do I set up the auth middleware?</p>
  </div>
  <div className="flex h-8 w-8 shrink-0 items-center justify-center
                  rounded-full bg-[var(--color-muted)]">
    <User className="h-4 w-4 text-[var(--color-muted-foreground)]" />
  </div>
</div>
```

**Assistant message:**
```tsx
<div className="flex gap-3 px-4 py-2">
  {/* Avatar */}
  <div className="flex h-8 w-8 shrink-0 items-center justify-center
                  rounded-full bg-gradient-to-br from-[var(--color-primary)]
                  to-purple-500">
    <Bot className="h-4 w-4 text-white" />
  </div>
  {/* Content */}
  <div className="min-w-0 max-w-[85%] space-y-2">
    <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
      Copilot
    </span>
    <div className="rounded-2xl rounded-tl-md bg-[var(--color-card)]
                    border border-[var(--color-border)] px-4 py-3 shadow-sm">
      <div className="markdown-content text-sm">
        {/* Rendered markdown */}
      </div>
    </div>
  </div>
</div>
```

**Thinking section (collapsible accordion):**
```tsx
<button onClick={toggle}
  className="flex items-center gap-2 rounded-lg border border-[var(--color-border)]
             bg-[var(--color-muted)] px-3 py-2 text-xs font-medium
             text-[var(--color-muted-foreground)]
             transition-colors hover:bg-[var(--color-accent)]">
  <Brain className="h-3.5 w-3.5 animate-pulse text-purple-500" />
  {isStreaming ? 'Thinking...' : `Thought for ${duration}`}
  <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
</button>
{open && (
  <div className="mt-1 rounded-lg border border-[var(--color-border)]
                  bg-[var(--color-muted)] p-3 text-xs
                  text-[var(--color-muted-foreground)] font-mono leading-relaxed">
    {thinkingContent}
  </div>
)}
```

**Tool call expansion card:**
```tsx
<div className="rounded-lg border border-[var(--color-border)]
                bg-[var(--color-background)] overflow-hidden">
  {/* Header — always visible */}
  <button onClick={toggle}
    className="flex w-full items-center gap-2 px-3 py-2 text-xs
               hover:bg-[var(--color-accent)] transition-colors">
    <Wrench className="h-3.5 w-3.5 text-[var(--color-primary)]" />
    <span className="font-medium text-[var(--color-foreground)]">read_file</span>
    <span className="text-[var(--color-muted-foreground)]">auth.ts</span>
    <span className="ml-auto">
      {isLoading
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      }
    </span>
  </button>
  {/* Expandable body */}
  {open && (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)]
                    p-3 max-h-48 overflow-y-auto">
      <pre className="text-xs font-mono text-[var(--color-foreground)] whitespace-pre-wrap">
        {toolResult}
      </pre>
    </div>
  )}
</div>
```

**Streaming indicator:**
```tsx
<span className="inline-block h-5 w-0.5 rounded-full bg-[var(--color-foreground)]
                 streaming-cursor align-text-bottom ml-0.5" />
```

### 9.3 Chat Input Area

```tsx
<div className="border-t border-[var(--color-border)] bg-[var(--color-card)] p-4">
  <div className="flex items-end gap-2 rounded-xl border border-[var(--color-border)]
                  bg-[var(--color-background)] px-3 py-2
                  focus-within:border-[var(--color-primary)]
                  focus-within:ring-1 focus-within:ring-[var(--color-primary)]
                  transition-colors">
    {/* Attachment button */}
    <button className="shrink-0 rounded-lg p-2 text-[var(--color-muted-foreground)]
                       hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]
                       transition-colors">
      <Paperclip className="h-4 w-4" />
    </button>

    {/* Textarea (auto-grows) */}
    <textarea
      rows={1}
      placeholder="Type a message..."
      className="flex-1 resize-none bg-transparent py-1.5 text-sm
                 text-[var(--color-foreground)]
                 placeholder:text-[var(--color-muted-foreground)]
                 focus:outline-none max-h-32 overflow-y-auto"
    />

    {/* Send button */}
    <button className="shrink-0 rounded-lg bg-[var(--color-primary)] p-2
                       text-[var(--color-primary-foreground)] shadow-sm
                       transition-all hover:brightness-110 active:scale-95
                       disabled:opacity-40 disabled:pointer-events-none">
      <Send className="h-4 w-4" />
    </button>
  </div>

  {/* Footer hint */}
  <p className="mt-1.5 text-center text-[11px] text-[var(--color-muted-foreground)]">
    Copilot may produce inaccurate responses. Verify important information.
  </p>
</div>
```

---

## 10. Workflow List Page

**Design inspiration:** Vercel project list + Retool workflow list with status badges.

### 10.1 Layout

```
┌────────────────────────────────────────────────────────────┐
│ Workflows                              [+ New Workflow]   │
├────────────────────────────────────────────────────────────┤
│ [🔍 Search workflows...]   [Tag ▼]   [Grid|List]         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ 🔀 Code Review   │  │ 🔀 Test Gen      │               │
│  │ Review PRs with  │  │ Generate tests   │               │
│  │ AI assistance    │  │ for components   │               │
│  │                  │  │                  │               │
│  │ ●Active  3stages │  │ ○Draft  5stages  │               │
│  │ code-review TS   │  │ testing jest     │               │
│  │ Updated 2m ago   │  │ Updated 1h ago   │               │
│  │ [Edit][Run][⋯]   │  │ [Edit][Run][⋯]   │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                            │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ 🔀 Refactoring   │  │ ...              │               │
│  │ ...              │  │                  │               │
│  └──────────────────┘  └──────────────────┘               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 10.2 Search + Filter Bar

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  {/* Search */}
  <div className="relative flex-1 max-w-md">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2
                       text-[var(--color-muted-foreground)]" />
    <input
      type="text"
      placeholder="Search workflows..."
      className="w-full rounded-lg border border-[var(--color-border)]
                 bg-[var(--color-background)] pl-9 pr-3 py-2 text-sm
                 text-[var(--color-foreground)]
                 placeholder:text-[var(--color-muted-foreground)]
                 focus:border-[var(--color-primary)]
                 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
    />
  </div>

  <div className="flex items-center gap-2">
    {/* Tag filter pills (horizontally scrollable) */}
    <div className="flex items-center gap-1.5 overflow-x-auto">
      <button className={cn(
        "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
      )}>
        All
      </button>
      {tags.map(tag => (
        <button key={tag} className="/* same pattern */">{tag}</button>
      ))}
    </div>

    {/* View toggle */}
    <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
      <button className={cn(
        "p-2 transition-colors",
        viewMode === 'grid'
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
      )}>
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button className="/* same for list */">
        <List className="h-4 w-4" />
      </button>
    </div>
  </div>
</div>
```

### 10.3 Workflow Card (Grid View)

```tsx
<div className="group relative cursor-pointer rounded-xl border border-[var(--color-border)]
                bg-[var(--color-card)] p-5 shadow-sm transition-all duration-150
                hover:shadow-md hover:border-[var(--color-primary)]/30
                animate-fade-in-up"
     style={{ animationDelay: `${index * 50}ms` }}>
  {/* Hover gradient overlay */}
  <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0
                  transition-opacity group-hover:opacity-100"
       style={{ background: 'var(--gradient-card-hover)' }} />

  {/* Header */}
  <div className="flex items-start justify-between gap-2 relative">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
                      bg-gradient-to-br from-[var(--color-primary)]/15 to-purple-500/10">
        <GitBranch className="h-4.5 w-4.5 text-[var(--color-primary)]" />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-[var(--color-foreground)]">
          {definition.name}
        </h3>
        <p className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">
          {definition.description}
        </p>
      </div>
    </div>
    {/* Status badge */}
    <StatusBadge status={definition.status} />
  </div>

  {/* Meta row */}
  <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
    <span className="flex items-center gap-1">
      <Box className="h-3 w-3" />
      {definition.stages.length} stages
    </span>
    <span>•</span>
    <span className="flex items-center gap-1">
      <Clock className="h-3 w-3" />
      {timeAgo(definition.updatedAt)}
    </span>
  </div>

  {/* Tags */}
  <div className="mt-3 flex flex-wrap gap-1.5">
    {definition.tags.map(tag => (
      <span key={tag}
        className="rounded-md bg-[var(--color-accent)] px-1.5 py-0.5 text-xs
                   text-[var(--color-muted-foreground)]">
        {tag}
      </span>
    ))}
  </div>

  {/* Action buttons (visible on hover) */}
  <div className="mt-4 flex items-center gap-2 opacity-0 transition-opacity
                  group-hover:opacity-100 relative">
    <button className="flex items-center gap-1.5 rounded-md border
                       border-[var(--color-border)] bg-[var(--color-background)]
                       px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground)]
                       hover:bg-[var(--color-accent)] transition-colors">
      <Edit3 className="h-3 w-3" /> Edit
    </button>
    <button className="flex items-center gap-1.5 rounded-md bg-[var(--color-primary)]
                       px-2.5 py-1.5 text-xs font-medium
                       text-[var(--color-primary-foreground)]
                       hover:brightness-110 transition-all">
      <Play className="h-3 w-3" /> Run
    </button>
    <button className="ml-auto rounded-md border border-[var(--color-border)]
                       p-1.5 text-[var(--color-muted-foreground)]
                       hover:bg-red-50 hover:text-red-600 hover:border-red-200
                       dark:hover:bg-red-900/20 dark:hover:border-red-800
                       transition-colors">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  </div>
</div>
```

### 10.4 Empty State

```tsx
<div className="flex flex-col items-center justify-center py-20 text-center">
  <div className="flex h-16 w-16 items-center justify-center rounded-2xl
                  bg-[var(--color-muted)]">
    <GitBranch className="h-8 w-8 text-[var(--color-muted-foreground)]" />
  </div>
  <h3 className="mt-4 text-lg font-semibold text-[var(--color-foreground)]">
    No workflows yet
  </h3>
  <p className="mt-1 max-w-sm text-sm text-[var(--color-muted-foreground)]">
    Create your first workflow to automate multi-step AI tasks
    with visual DAG pipelines.
  </p>
  <button className="mt-6 /* Primary button md */">
    <Plus className="h-4 w-4" /> Create Workflow
  </button>
</div>
```

---

## 11. Workflow Builder Canvas

**Design inspiration:** n8n's node canvas + Retool's properties panel + Langflow's edge animations.

### 11.1 Overall Layout

```
┌────────────────────────────────────────────────────┬──────────────┐
│ Toolbar:  [+ Stage] [Auto-Layout] [Undo] [Redo]   │              │
│           [Fit] [Zoom In] [Zoom Out] [Save] [Run]  │  Properties  │
├────────────────────────────────────────────────────┤   Panel      │
│                                                    │  (384px)     │
│         ┌─────────┐       ┌─────────┐             │              │
│         │ Stage 1 │──────▶│ Stage 2 │             │  Stage Name  │
│         └─────────┘       └────┬────┘             │  [________]  │
│                                │                   │              │
│                           ┌────▼────┐             │  Template    │
│          ·  ·  ·  ·  ·   │ Stage 3 │  ·  ·  ·   │  [dropdown]  │
│                           └─────────┘             │              │
│                                                    │  Prompts     │
│          Canvas (React Flow)                       │  [editor]    │
│          Dot grid background                       │              │
│                                                    │  Retry       │
│  ┌─────────────────┐                              │  [settings]  │
│  │ Minimap         │                              │              │
│  │ ┌──────┐  ┌──┐ │                              │              │
│  │ └──────┘  └──┘ │                              │              │
│  └─────────────────┘                              │              │
├────────────────────────────────────────────────────┴──────────────┤
│  Controls: [+] [-] [◻] [🔒]                                      │
└───────────────────────────────────────────────────────────────────┘
```

### 11.2 Canvas Configuration

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={{ stageNode: StageNode }}
  edgeTypes={{ stageEdge: StageEdge }}
  defaultEdgeOptions={{
    type: 'stageEdge',
    animated: true,
  }}
  fitView
  snapToGrid
  snapGrid={[20, 20]}
  connectionLineStyle={{
    stroke: 'var(--color-primary)',
    strokeWidth: 2,
    strokeDasharray: '6 3',
  }}
  proOptions={{ hideAttribution: true }}
  className="bg-[var(--color-background)]"
>
  <Background
    variant={BackgroundVariant.Dots}
    gap={20}
    size={1}
    color="var(--canvas-dot)"
  />
  <Controls className="/* themed overrides */" />
  <MiniMap
    nodeColor={nodeColor}
    maskColor="rgba(0,0,0,0.08)"
    className="!border-[var(--color-border)] !bg-[var(--color-card)]
               !rounded-lg !shadow-md"
    pannable
    zoomable
  />
</ReactFlow>
```

### 11.3 Stage Node Design

```
┌──────────────── 240–320px ──────────────────┐
│  ◄── Handle (target, left)                  │
│                                              │
│  [icon] Stage Name               [⎘] [🗑]   │   ← Header row
│                                              │
│  ┌─ code-review ─┐  2 prompts  ×3 retry    │   ← Meta row
│  └───────────────┘                          │
│  Review and analyze pull request code...    │   ← Description (truncated)
│                                              │
│                              Handle (source)►│
└──────────────────────────────────────────────┘
```

**Node wrapper classes:**
```tsx
className={cn(
  "group relative min-w-[240px] max-w-[320px]",
  "rounded-[10px] border-2 px-4 py-3 shadow-sm",
  "bg-[var(--color-card)] text-[var(--color-card-foreground)]",
  "transition-all duration-150",
  selected
    ? "border-[var(--color-primary)] shadow-[var(--shadow-primary-glow)]"
    : "border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:shadow-md",
)}
```

**Handle styling:**
```tsx
<Handle
  type="target"
  position={Position.Left}
  className="!h-3 !w-3 !rounded-full !border-2
             !border-[var(--color-primary)] !bg-[var(--color-background)]
             hover:!bg-[var(--color-primary)] hover:!scale-125
             !transition-all"
/>
```

### 11.4 Edge Styling

**StageEdge component (custom curved bezier):**
```tsx
/* Default edge */
stroke="var(--canvas-edge)"
strokeWidth={2}
strokeLinecap="round"

/* Animated — dashed flow with CSS animation */
strokeDasharray="6 6"
className="edge-animated"

/* Selected / active edge */
stroke="var(--canvas-edge-active)"
strokeWidth={2.5}
filter="drop-shadow(0 0 3px rgba(37,99,235,0.3))"

/* Path type: smoothstep or bezier  */
/* Using smoothstep for grid-like feel (n8n style): */
type="smoothstep"
borderRadius={12}
```

### 11.5 Builder Toolbar

```tsx
<div className="flex items-center gap-2 border-b border-[var(--color-border)]
                bg-[var(--color-background)] px-4 py-2">
  {/* Left group — canvas actions */}
  <div className="flex items-center gap-1.5">
    <button className="flex items-center gap-1.5 rounded-lg
                       bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium
                       text-[var(--color-primary-foreground)] shadow-sm
                       hover:brightness-110 transition-all">
      <Plus className="h-3.5 w-3.5" /> Add Stage
    </button>
    <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />  {/* Separator */}
    <ToolbarButton icon={Undo2} label="Undo" shortcut="Ctrl+Z" />
    <ToolbarButton icon={Redo2} label="Redo" shortcut="Ctrl+Shift+Z" />
    <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />
    <ToolbarButton icon={AlignHorizontalDistributeCenter} label="Auto-Layout" />
  </div>

  {/* Spacer */}
  <div className="flex-1" />

  {/* Right group — workflow actions */}
  <div className="flex items-center gap-1.5">
    <button className="/* Secondary button xs — Save */">
      <Save className="h-3.5 w-3.5" /> Save
    </button>
    <button className="/* Primary button xs — Run */">
      <Play className="h-3.5 w-3.5" /> Run
    </button>
  </div>
</div>
```

**ToolbarButton component:**
```tsx
<button
  title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
  className="rounded-md p-1.5 text-[var(--color-muted-foreground)]
             hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]
             transition-colors disabled:opacity-40"
>
  <Icon className="h-4 w-4" />
</button>
```

### 11.6 Properties Panel (Slide-in)

```tsx
{/* Panel container — slides in from right */}
<div className={cn(
  "absolute right-0 top-0 h-full w-96 z-20",
  "border-l border-[var(--color-border)]",
  "bg-[var(--color-card)] shadow-lg",
  "animate-slide-in-right"
)}>
  {/* Header */}
  <div className="flex items-center justify-between border-b
                  border-[var(--color-border)] px-4 py-3">
    <div className="flex items-center gap-2">
      <Settings2 className="h-4 w-4 text-[var(--color-primary)]" />
      <h3 className="text-sm font-semibold">Stage Properties</h3>
    </div>
    <button className="rounded-md p-1 text-[var(--color-muted-foreground)]
                       hover:bg-[var(--color-accent)]">
      <X className="h-4 w-4" />
    </button>
  </div>

  {/* Scrollable form body */}
  <div className="flex-1 overflow-y-auto p-4 space-y-5">
    {/* Field group pattern: */}
    <div>
      <label className="mb-1.5 block text-xs font-medium
                        text-[var(--color-foreground)]">
        Stage Name
      </label>
      <input className="/* Standard input */" />
    </div>

    {/* Section divider */}
    <div className="pt-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase
                     tracking-wide text-[var(--color-muted-foreground)]">
        <FileText className="h-3.5 w-3.5" /> Prompts
      </h4>
      <div className="mt-2 space-y-2">
        {/* PromptEditor cards */}
      </div>
    </div>

    {/* Collapsible advanced section */}
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-2 text-xs
                          font-semibold uppercase tracking-wide
                          text-[var(--color-muted-foreground)]
                          hover:text-[var(--color-foreground)]">
        <ChevronRight className="h-3.5 w-3.5 transition-transform
                                 group-open:rotate-90" />
        Advanced Settings
      </summary>
      <div className="mt-3 space-y-4 pl-5">
        {/* Retry policy, timeout, condition, etc. */}
      </div>
    </details>
  </div>
</div>
```

---

## 12. Workflow Run Monitoring

**Design inspiration:** Temporal UI's execution timeline + n8n's run view + live streaming from chat.

### 12.1 Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ ← Back    Code Review / Run #abc123               [⏸] [⏹] [🔄]  │  ← Breadcrumb + controls
│           ● Running   3/5 stages   ⏱ 1m 23s                      │
├─────────────────────────────────────────────┬──────────────────────┤
│                                             │  Stage Output        │
│        ┌───────┐      ┌───────┐            │                      │
│        │ ✅ S1 │─────▶│ 🔵 S2 │            │  [S2: Analyze Code] │
│        └───────┘      └───┬───┘            │                      │
│                           │                 │  💭 Thinking...      │
│                      ┌────▼────┐           │  Analyzing the PR... │
│                      │ ○ S3    │           │                      │
│                      └────┬────┘           │  🔧 read_file        │
│               ┌───────────┼───────────┐    │  ├ src/auth.ts       │
│          ┌────▼────┐ ┌────▼────┐      │    │  └ 142 lines        │
│          │ ○ S4    │ │ ○ S5    │      │    │                      │
│          └─────────┘ └─────────┘      │    │  Streaming output... │
│                                        │    │  ▊                   │
│  Canvas with runtime status overlays   │    │                      │
├────────────────────────────────────────┴────┴──────────────────────┤
│ 📊 Timeline   ▼                                                   │
│ ┌──S1──────┐┌──S2────────────────┐┌──S3──┐                        │
│ │ ✅ 12s   ││ 🔵 running...     ││ ○    │ ○ S4  ○ S5            │
│ └──────────┘└────────────────────┘└──────┘                        │
└────────────────────────────────────────────────────────────────────┘
```

### 12.2 Run Header / Controls Bar

```tsx
<div className="flex items-center justify-between border-b border-[var(--color-border)]
                bg-[var(--color-background)] px-4 py-3">
  {/* Left: Breadcrumb + info */}
  <div className="flex items-center gap-4">
    <Breadcrumb items={[
      { label: 'Workflows', href: '/workflows' },
      { label: definition.name, href: `/workflows/${definitionId}` },
      { label: `Run #${runId.slice(0, 8)}` },
    ]} />
    <div className="flex items-center gap-3 text-sm text-[var(--color-muted-foreground)]">
      <RunStatusBadge status={run.status} />
      <span className="flex items-center gap-1">
        <Box className="h-3.5 w-3.5" />
        {completedStages}/{stageCount} stages
      </span>
      <span className="flex items-center gap-1 tabular-nums">
        <Timer className="h-3.5 w-3.5" />
        {formatDuration(elapsedMs)}
      </span>
    </div>
  </div>

  {/* Right: Controls */}
  <div className="flex items-center gap-2">
    <button className="/* Secondary xs */" title="Pause">
      <Pause className="h-3.5 w-3.5" />
    </button>
    <button className="/* Destructive ghost xs */" title="Cancel">
      <Square className="h-3.5 w-3.5" />
    </button>
    <button className="/* Secondary xs */" title="Restart">
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  </div>
</div>
```

### 12.3 RunStatusBadge

```tsx
const statusConfig = {
  pending:   { bg: 'bg-gray-100 dark:bg-gray-800',       text: 'text-gray-600 dark:text-gray-400',    dot: 'bg-gray-400' },
  queued:    { bg: 'bg-blue-50 dark:bg-blue-900/20',      text: 'text-blue-600 dark:text-blue-400',    dot: 'bg-blue-500' },
  running:   { bg: 'bg-blue-50 dark:bg-blue-900/20',      text: 'text-blue-600 dark:text-blue-400',    dot: 'bg-blue-500 animate-pulse' },
  paused:    { bg: 'bg-orange-50 dark:bg-orange-900/20',   text: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
  completed: { bg: 'bg-green-50 dark:bg-green-900/20',     text: 'text-green-600 dark:text-green-400',  dot: 'bg-green-500' },
  failed:    { bg: 'bg-red-50 dark:bg-red-900/20',         text: 'text-red-600 dark:text-red-400',      dot: 'bg-red-500' },
  cancelled: { bg: 'bg-gray-100 dark:bg-gray-800',         text: 'text-gray-600 dark:text-gray-400',    dot: 'bg-gray-400' },
};

<span className={cn(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  config.bg, config.text
)}>
  <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
  {status}
</span>
```

### 12.4 Split View (Canvas + Output)

```tsx
<div className="flex flex-1 overflow-hidden">
  {/* Left: Runtime DAG Canvas */}
  <div className="flex-1 relative">
    <ReactFlowProvider>
      <RuntimeDAGCanvas />
    </ReactFlowProvider>
  </div>

  {/* Resizable divider */}
  <div className="w-px bg-[var(--color-border)] cursor-col-resize
                  hover:w-1 hover:bg-[var(--color-primary)]/50 transition-all" />

  {/* Right: Stage Output Panel */}
  <div className="w-[420px] flex flex-col border-l border-[var(--color-border)]
                  bg-[var(--color-card)]">
    {/* Panel header */}
    <div className="flex items-center gap-2 border-b border-[var(--color-border)]
                    px-4 py-3">
      <span className="text-sm font-semibold text-[var(--color-foreground)]">
        Stage Output
      </span>
      <RunStatusBadge status={selectedStage?.status ?? 'pending'} />
    </div>

    {/* Streaming output area */}
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Thinking block */}
      {/* Tool call blocks */}
      {/* Text output with markdown rendering */}
      {/* Streaming cursor if running */}
    </div>
  </div>
</div>
```

### 12.5 Runtime Stage Node (augmented)

Same as builder StageNode but with runtime status overlay:

```tsx
{/* Running indicator — animated ring */}
{status === 'running' && (
  <div className="absolute -inset-1 rounded-[12px] border-2 border-blue-400/50
                  animate-pulse pointer-events-none" />
)}

{/* Completed checkmark overlay */}
{status === 'completed' && (
  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center
                  rounded-full bg-[var(--color-success)] shadow-sm">
    <Check className="h-3 w-3 text-white" strokeWidth={3} />
  </div>
)}

{/* Failed X overlay */}
{status === 'failed' && (
  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center
                  rounded-full bg-[var(--color-error)] shadow-sm">
    <X className="h-3 w-3 text-white" strokeWidth={3} />
  </div>
)}

{/* Duration badge (bottom) */}
{duration && (
  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2
                  rounded-full bg-[var(--color-card)] border border-[var(--color-border)]
                  px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted-foreground)]
                  tabular-nums shadow-sm">
    {formatDuration(duration)}
  </div>
)}
```

### 12.6 Execution Timeline (Bottom Panel)

```tsx
<div className={cn(
  "border-t border-[var(--color-border)] bg-[var(--color-card)]",
  "transition-all duration-200",
  timelineOpen ? "h-28" : "h-10"
)}>
  {/* Toggle header */}
  <button onClick={toggleTimeline}
    className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium
               text-[var(--color-muted-foreground)]
               hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)]">
    <BarChart3 className="h-3.5 w-3.5" />
    Timeline
    <ChevronUp className={cn("h-3.5 w-3.5 ml-auto transition-transform",
                              !timelineOpen && "rotate-180")} />
  </button>

  {/* Timeline track */}
  {timelineOpen && (
    <div className="flex items-center gap-1 overflow-x-auto px-4 pb-3">
      {stageRuns.map((stageRun, i) => {
        const widthPct = Math.max(
          (stageRun.durationMs / totalDurationMs) * 100,
          8 /* minimum visible width */
        );
        return (
          <div key={stageRun.id}
            className={cn(
              "relative flex h-10 items-center justify-center rounded-lg",
              "px-3 text-xs font-medium cursor-pointer transition-all",
              "hover:brightness-110",
              statusBarColors[stageRun.status]
            )}
            style={{ width: `${widthPct}%`, minWidth: 80 }}
            onClick={() => selectStage(stageRun.stageId)}>
            <span className="truncate">{stageRun.stageName}</span>
            {stageRun.durationMs && (
              <span className="ml-1.5 text-[10px] opacity-75 tabular-nums">
                {formatDuration(stageRun.durationMs)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  )}
</div>
```

**Timeline bar colors:**
```tsx
const statusBarColors = {
  pending:   'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  queued:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  running:   'bg-blue-200 text-blue-800 dark:bg-blue-800/60 dark:text-blue-200 animate-pulse',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  skipped:   'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
  paused:    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};
```

### 12.7 Stage Output Panel Content Blocks

```tsx
{/* Each block rendered based on type: */}

{/* TEXT block — markdown rendered */}
<div className="rounded-lg border border-[var(--color-border)]
                bg-[var(--color-background)] p-3">
  <div className="markdown-content text-sm">{renderedMarkdown}</div>
</div>

{/* THINKING block */}
<div className="rounded-lg border border-purple-200 dark:border-purple-800/40
                bg-purple-50/50 dark:bg-purple-900/10 p-3">
  <div className="flex items-center gap-2 mb-1.5">
    <Brain className="h-3.5 w-3.5 text-purple-500" />
    <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
      Thinking
    </span>
  </div>
  <p className="text-xs text-[var(--color-muted-foreground)] font-mono leading-relaxed">
    {thinkingText}
  </p>
</div>

{/* TOOL_USE block */}
<div className="rounded-lg border border-[var(--color-border)]
                bg-[var(--color-muted)] overflow-hidden">
  <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
    <Wrench className="h-3.5 w-3.5 text-[var(--color-primary)]" />
    <span className="text-xs font-semibold text-[var(--color-foreground)]">
      {toolName}
    </span>
    <code className="text-xs text-[var(--color-muted-foreground)] font-mono">
      {JSON.stringify(toolInput)}
    </code>
  </div>
  <pre className="p-3 text-xs font-mono text-[var(--color-foreground)]
                  overflow-x-auto max-h-40 overflow-y-auto">
    {toolResult}
  </pre>
</div>

{/* ERROR block */}
<div className="rounded-lg border border-[var(--color-error-border)]
                bg-[var(--color-error-bg)] p-3">
  <div className="flex items-center gap-2 mb-1">
    <AlertCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
    <span className="text-xs font-semibold text-[var(--color-error)]">Error</span>
  </div>
  <pre className="text-xs font-mono text-[var(--color-error)] whitespace-pre-wrap">
    {errorMessage}
  </pre>
</div>
```

---

## 13. Responsive Breakpoints

| Breakpoint | Tailwind | Behavior |
|---|---|---|
| `< 640px` (mobile) | default | Sidebar hidden, full screen content, single column cards, hamburger menu |
| `≥ 640px` (sm) | `sm:` | 2-column card grid, inline search bar |
| `≥ 768px` (md) | `md:` | Sidebar becomes relative (not overlay), header shows breadcrumbs |
| `≥ 1024px` (lg) | `lg:` | 3-column card grid, workflow run split view side-by-side |
| `≥ 1280px` (xl) | `xl:` | 4-column stats row, wider properties panel |
| `≥ 1536px` (2xl) | `2xl:` | Max content width `max-w-7xl mx-auto` for ultra-wide |

### Key Responsive Patterns

**Sidebar:**
- Mobile: Fixed overlay + backdrop, close on outside click.
- Desktop: Relative positioned, collapsible via icon button or `Ctrl+B`.

**Workflow Builder:**
- Mobile: Canvas full-width, properties panel becomes full-screen modal overlay.
- Desktop: Side-by-side split, panel slides in as fixed 384px right panel.

**Workflow Run:**
- Mobile: Stacked vertically — canvas on top, output below.
- Desktop: Horizontal split with resizable divider.

---

## 14. Accessibility

### WCAG 2.1 AA Compliance Checklist

| Requirement | Implementation |
|---|---|
| **Focus indicators** | 2px solid `var(--color-ring)`, 1px offset on all interactive elements |
| **Color contrast** | All text/bg combinations meet 4.5:1 minimum (verified for both themes) |
| **Keyboard navigation** | Tab order follows visual layout, Escape closes panels/modals |
| **ARIA labels** | All icon-only buttons have `aria-label`, tabs use `role="tab"` + `aria-selected` |
| **Screen reader** | `aria-live="polite"` on streaming output, `role="status"` on progress counters |
| **Reduced motion** | `@media (prefers-reduced-motion: reduce)` disables edge animation, pulse, shimmer |
| **Focus trap** | Modals/dialogs trap focus within, restore on close |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 15. Dark Mode Implementation Notes

- Toggle via class strategy: `<html class="dark">` applied via `useEffect` reading `localStorage.theme` or `prefers-color-scheme`.
- All color references use CSS custom properties (`var(--color-*)`) — never hardcoded hex in JSX except for status-specific Tailwind utilities which use `dark:` variants.
- Transition on theme change: `transition-colors duration-200` on `<body>`.
- Canvas components (React Flow) must use `var()` tokens in inline styles — React Flow's built-in controls get Tailwind overrides via bracket notation `[&>button]:!bg-...`.

---

## Appendix: Icon Library

All icons sourced from **Lucide React** (`lucide-react`). Key icons by context:

| Context | Icons |
|---|---|
| **Navigation** | `MessageSquare`, `GitBranch`, `FolderCog`, `Settings`, `LayoutTemplate`, `PanelLeft`, `PanelLeftClose` |
| **Actions** | `Plus`, `Play`, `Pause`, `Square` (stop), `RotateCcw` (restart), `Save`, `Edit3`, `Trash2`, `Copy`, `Send` |
| **Status** | `Check`, `X`, `Clock`, `Loader2` (spinner), `AlertCircle`, `AlertTriangle`, `SkipForward` |
| **Canvas** | `AlignHorizontalDistributeCenter`, `ZoomIn`, `ZoomOut`, `Maximize2` (fit view), `Box` |
| **Chat** | `Bot`, `User`, `Brain`, `Wrench`, `Paperclip`, `ChevronDown`, `ChevronRight` |
| **Dashboard** | `Zap`, `TrendingUp`, `BarChart3`, `Activity`, `Calendar`, `Tag` |
| **Data** | `FileText`, `Settings2`, `Search`, `Filter`, `LayoutGrid`, `List`, `Timer` |

---

*End of Design Specification — GeneratorAI v2.0*
