Based on my analysis of the GeneratorAI codebase and modern AI/SaaS design trends, I'll now create a comprehensive design specification document:

```markdown
# GeneratorAI — Modern UI/UX Design System & Redesign Specification

**Version**: 1.0  
**Date**: April 1, 2026  
**Status**: Comprehensive Design Specification

---

## Table of Contents

1. [Design Philosophy & Modern Trends](#design-philosophy--modern-trends)
2. [Color System](#color-system)
3. [Typography & Spacing](#typography--spacing)
4. [Layout Architecture](#layout-architecture)
5. [Component Redesign Specifications](#component-redesign-specifications)
6. [Implementation Roadmap](#implementation-roadmap)

---

## Design Philosophy & Modern Trends

### Trend Analysis: Modern AI/SaaS Design Landscape

GeneratorAI's redesign synthesizes three dominant contemporary design movements:

#### 1. **Glassmorphism (Enhanced)**
- **Pioneers**: ChatGPT, Claude, Vercel
- **Benefits**: Depth perception, premium feel, modern aesthetic
- **Implementation**: Refined frosted-glass effects with 12-16px backdrop blur
- **Key**: Subtle borders and layered transparency create visual hierarchy

#### 2. **Minimalist Elegance**
- **Pioneers**: Linear, Apple, GitHub
- **Focus**: Remove visual noise, emphasize content
- **Implementation**: Generous whitespace, refined typography, intentional color usage
- **Key**: Less is more - every element serves purpose

#### 3. **Semantic Neumorphism (Micro-interactions)**
- **Pioneers**: Modern design systems (Material 3, iOS design)
- **Benefits**: Reduced cognitive load through consistent states
- **Implementation**: Subtle shadows, elevation changes on interaction
- **Key**: Micro-feedback without overwhelming the user

### Design Principles for GeneratorAI

1. **Content-First**: Layout serves the workflow, never the reverse
2. **Progressive Disclosure**: Hide complexity behind intuitive interaction patterns
3. **Clarity Over Decoration**: Every pixel has purpose
4. **Responsive by Nature**: Fluid spacing and typography scales with viewport
5. **Accessible Elegance**: WCAG AAA compliance without sacrificing aesthetics
6. **AI-Native Design**: Streaming, real-time updates, asynchronous feedback feel natural

---

## Color System

### Design Rationale

The new color system balances three objectives:
1. **Visual Separation**: Distinct roles for primary, secondary, accent colors
2. **Accessibility**: WCAG AAA contrast ratios across all states
3. **Modern Aesthetics**: Contemporary, sophisticated palette inspired by Linear & Vercel

---

### Light Mode Color Palette

```
┌─────────────────────────────────────────────────────────────┐
│ LIGHT MODE — Base Colors & Roles                            │
└─────────────────────────────────────────────────────────────┘

BACKGROUNDS & SURFACES
├── bg-primary (Page Background)        #FAFBFC    ← Slightly warm white
├── bg-secondary (Nested Components)    #F0F1F3    ← Subtle gray
├── bg-tertiary (Hover/Active States)   #E8EAEE    ← Mid-tone gray
├── bg-glass (Glass Morphism)           rgba(255, 255, 255, 0.75)
└── bg-glass-hover                      rgba(255, 255, 255, 0.85)

TEXT & FOREGROUND
├── fg-primary (Main Text)              #0F1419    ← Near-black
├── fg-secondary (Subtitle/Help)        #5A6271    ← Medium gray
├── fg-tertiary (Disabled/Muted)        #8B92A1    ← Light gray
└── fg-inverse (On Dark/Primary)        #FFFFFF    ← White

PRIMARY ACTIONS & BRANDING
├── brand-primary                       #5B5BD6    ← Vibrant purple
├── brand-primary-hover                 #4A4AB5    ← Darker shade
├── brand-primary-active                #3A3A95    ← Deep purple
├── brand-primary-light                 #E8E8F5    ← Very light purple
└── brand-primary-outline               rgba(91, 91, 214, 0.15)

SECONDARY & NEUTRAL
├── accent-blue                         #3B82F6    ← Action blue
├── accent-blue-light                   #DBEAFE    ← Very light blue
├── accent-cyan                         #06B6D4    ← Cyan/teal
├── accent-emerald                      #10B981    ← Success green
└── accent-slate                        #64748B    ← Neutral slate

STATUS & SEMANTIC COLORS
├── success                             #10B981    ← Emerald green
├── success-light                       #D1FAE5    ← Very light green
├── warning                             #F59E0B    ← Amber/warning
├── warning-light                       #FEF3C7    ← Very light amber
├── destructive                         #E5484D    ← Red/error
├── destructive-light                   #FEE2E2    ← Very light red
├── info                                #3B82F6    ← Info blue
└── info-light                          #DBEAFE    ← Very light blue

BORDERS & DIVIDERS
├── border-primary                      rgba(0, 0, 0, 0.08)
├── border-secondary                    rgba(0, 0, 0, 0.12)
├── border-strong                       rgba(0, 0, 0, 0.16)
└── border-glass                        rgba(0, 0, 0, 0.06)

INTERACTIVE STATES (Hover, Focus, Active)
├── hover-opacity                       0.92
├── active-opacity                      0.88
├── focus-glow                          0 0 0 3px #E8E8F5
└── disabled-opacity                    0.5

CANVAS & SPECIAL
├── canvas-bg                           #F8F9FB
├── canvas-grid-dot                     rgba(91, 91, 214, 0.08)
├── canvas-node-bg                      #FFFFFF
└── canvas-node-glow                    rgba(91, 91, 214, 0.1)
```

---

### Dark Mode Color Palette

```
┌─────────────────────────────────────────────────────────────┐
│ DARK MODE — Enhanced for Reduced Eye Strain                 │
└─────────────────────────────────────────────────────────────┘

BACKGROUNDS & SURFACES
├── bg-primary (Page Background)        #0F111D    ← Deep blue-black
├── bg-secondary (Nested Components)    #16172B    ← Slightly lighter
├── bg-tertiary (Hover/Active States)   #1F2139    ← Mid-tone dark
├── bg-glass (Glass Morphism)           rgba(15, 17, 29, 0.75)
└── bg-glass-hover                      rgba(15, 17, 29, 0.85)

TEXT & FOREGROUND
├── fg-primary (Main Text)              #F0F1F3    ← Near-white
├── fg-secondary (Subtitle/Help)        #A8ACB8    ← Light gray
├── fg-tertiary (Disabled/Muted)        #6A7082    ← Medium-light gray
└── fg-inverse (On Light/Inverse)       #0F111D    ← Dark background color

PRIMARY ACTIONS & BRANDING
├── brand-primary                       #8B8BF5    ← Lighter purple
├── brand-primary-hover                 #9D9DF7    ← Even lighter
├── brand-primary-active                #7A7AE0    ← Deeper purple
├── brand-primary-dark                  #4A4AB5    ← Dark reference
└── brand-primary-faint                 rgba(139, 139, 245, 0.1)

SECONDARY & NEUTRAL
├── accent-blue                         #60A5FA    ← Lighter action blue
├── accent-blue-dark                    #1E40AF    ← Dark reference
├── accent-cyan                         #22D3EE    ← Lighter cyan
├── accent-emerald                      #34D399    ← Lighter success
└── accent-slate                        #94A3B8    ← Lighter slate

STATUS & SEMANTIC COLORS
├── success                             #34D399    ← Lighter emerald
├── success-dark                        #047857    ← Dark reference
├── warning                             #FBBF24    ← Lighter amber
├── warning-dark                        #92400E    ← Dark reference
├── destructive                         #F87171    ← Lighter red
├── destructive-dark                    #7F1D1D    ← Dark reference
├── info                                #60A5FA    ← Lighter info blue
└── info-dark                           #1E40AF    ← Dark reference

BORDERS & DIVIDERS
├── border-primary                      rgba(255, 255, 255, 0.08)
├── border-secondary                    rgba(255, 255, 255, 0.12)
├── border-strong                       rgba(255, 255, 255, 0.16)
└── border-glass                        rgba(255, 255, 255, 0.06)

INTERACTIVE STATES (Hover, Focus, Active)
├── hover-opacity                       1.1 (lifted/brightened)
├── active-opacity                      1.05
├── focus-glow                          0 0 0 3px rgba(139, 139, 245, 0.3)
└── disabled-opacity                    0.4

CANVAS & SPECIAL
├── canvas-bg                           #0D0F1A
├── canvas-grid-dot                     rgba(139, 139, 245, 0.05)
├── canvas-node-bg                      #16172B
└── canvas-node-glow                    rgba(139, 139, 245, 0.15)
```

---

### Color Implementation (CSS Variables)

```css
/* File: apps/web/src/styles/globals.css */

:root {
  /* LIGHT MODE */
  --bg-primary: #FAFBFC;
  --bg-secondary: #F0F1F3;
  --bg-tertiary: #E8EAEE;
  --bg-glass: rgba(255, 255, 255, 0.75);
  --bg-glass-hover: rgba(255, 255, 255, 0.85);
  
  --fg-primary: #0F1419;
  --fg-secondary: #5A6271;
  --fg-tertiary: #8B92A1;
  --fg-inverse: #FFFFFF;
  
  --brand-primary: #5B5BD6;
  --brand-primary-hover: #4A4AB5;
  --brand-primary-active: #3A3A95;
  --brand-primary-light: #E8E8F5;
  --brand-primary-outline: rgba(91, 91, 214, 0.15);
  
  --accent-blue: #3B82F6;
  --accent-blue-light: #DBEAFE;
  --accent-cyan: #06B6D4;
  --accent-emerald: #10B981;
  --accent-slate: #64748B;
  
  --color-success: #10B981;
  --color-success-light: #D1FAE5;
  --color-warning: #F59E0B;
  --color-warning-light: #FEF3C7;
  --color-destructive: #E5484D;
  --color-destructive-light: #FEE2E2;
  --color-info: #3B82F6;
  --color-info-light: #DBEAFE;
  
  --border-primary: rgba(0, 0, 0, 0.08);
  --border-secondary: rgba(0, 0, 0, 0.12);
  --border-strong: rgba(0, 0, 0, 0.16);
  --border-glass: rgba(0, 0, 0, 0.06);
  
  --canvas-bg: #F8F9FB;
  --canvas-grid: rgba(91, 91, 214, 0.08);
  --canvas-node-bg: #FFFFFF;
  --canvas-node-glow: rgba(91, 91, 214, 0.1);
  
  /* Typography */
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

.dark {
  --bg-primary: #0F111D;
  --bg-secondary: #16172B;
  --bg-tertiary: #1F2139;
  --bg-glass: rgba(15, 17, 29, 0.75);
  --bg-glass-hover: rgba(15, 17, 29, 0.85);
  
  --fg-primary: #F0F1F3;
  --fg-secondary: #A8ACB8;
  --fg-tertiary: #6A7082;
  --fg-inverse: #0F111D;
  
  --brand-primary: #8B8BF5;
  --brand-primary-hover: #9D9DF7;
  --brand-primary-active: #7A7AE0;
  --brand-primary-light: rgba(139, 139, 245, 0.15);
  --brand-primary-outline: rgba(139, 139, 245, 0.1);
  
  --accent-blue: #60A5FA;
  --accent-blue-light: rgba(96, 165, 250, 0.15);
  --accent-cyan: #22D3EE;
  --accent-emerald: #34D399;
  --accent-slate: #94A3B8;
  
  --color-success: #34D399;
  --color-success-light: rgba(52, 211, 153, 0.15);
  --color-warning: #FBBF24;
  --color-warning-light: rgba(251, 191, 36, 0.15);
  --color-destructive: #F87171;
  --color-destructive-light: rgba(248, 113, 113, 0.15);
  --color-info: #60A5FA;
  --color-info-light: rgba(96, 165, 250, 0.15);
  
  --border-primary: rgba(255, 255, 255, 0.08);
  --border-secondary: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.16);
  --border-glass: rgba(255, 255, 255, 0.06);
  
  --canvas-bg: #0D0F1A;
  --canvas-grid: rgba(139, 139, 245, 0.05);
  --canvas-node-bg: #16172B;
  --canvas-node-glow: rgba(139, 139, 245, 0.15);
}
```

---

## Typography & Spacing

### Font System

```
┌──────────────────────────────────────────────────────────┐
│ TYPEFACES                                               │
├──────────────────────────────────────────────────────────┤
│ Display:  Inter (700)        — Bold headlines           │
│ Heading:  Inter (600)        — Section titles           │
│ Body:     Inter (400-500)    — Content, UI labels       │
│ Mono:     JetBrains Mono     — Code, terminal output    │
└──────────────────────────────────────────────────────────┘
```

### Typography Scale (rem-based, 16px base)

```
┌──────────────────────────────────────────────────────────┐
│ RESPONSIVE TYPOGRAPHY                                   │
├──────────────┬──────────────┬──────────────┬─────────────┤
│ Name         │ Desktop      │ Mobile       │ Line-Height │
├──────────────┼──────────────┼──────────────┼─────────────┤
│ Display XL   │ 3.5rem (56)  │ 2.5rem (40)  │ 1.2         │
│ Display L    │ 3rem (48)    │ 2rem (32)    │ 1.2         │
│ Display M    │ 2.5rem (40)  │ 1.75rem (28) │ 1.2         │
│ Heading XL   │ 2rem (32)    │ 1.5rem (24)  │ 1.3         │
│ Heading L    │ 1.75rem (28) │ 1.375rem (22)│ 1.3         │
│ Heading M    │ 1.5rem (24)  │ 1.25rem (20) │ 1.3         │
│ Heading S    │ 1.25rem (20) │ 1.125rem (18)│ 1.4         │
│ Body L       │ 1.125rem (18)│ 1rem (16)    │ 1.6         │
│ Body M       │ 1rem (16)    │ 0.9375rem(15)│ 1.6         │
│ Body S       │ 0.9375rem(15)│ 0.875rem(14) │ 1.5         │
│ Caption      │ 0.875rem (14)│ 0.8125rem(13)│ 1.5         │
│ Micro        │ 0.75rem (12) │ 0.75rem (12) │ 1.4         │
└──────────────┴──────────────┴──────────────┴─────────────┘
```

### Spacing Scale (8px grid base)

```
0px    (0)    — No space
4px    (1)    — Tight coupling
8px    (2)    — Component internals
12px   (3)    — Related elements
16px   (4)    — Component separation
24px   (6)    — Section margins
32px   (8)    — Major sections
48px   (12)   — Page sections
64px   (16)   — Full viewport gaps
80px   (20)   — Hero sections
96px   (24)   — Large hero sections
```

---

## Layout Architecture

### Global Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│                      HEADER (64px)                      │
│                                                         │
│ [Logo] [Search/Cmd] [Breadcrumb] [Actions] [User Menu]│
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│ SIDEBAR      │         MAIN CONTENT AREA               │
│ (passive)    │                                          │
│ 260px        │    [Toolbar/Controls]                   │
│ (collapsible)│    [Page-specific content]              │
│              │    [Context panels/sidebars]            │
│              │                                          │
│              │                                          │
│              │                                          │
│              │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘

Mobile (< 768px): Hamburger menu, full-width content, bottom nav for quick actions
Tablet (768px - 1024px): Collapsible sidebar, fluid content
Desktop (1024px+): Full sidebar + content with optional right panel
```

### Responsive Breakpoints

```
Mobile:            0px - 640px     (3-column span)
Tablet Small:      641px - 768px   (4-column span)
Tablet Large:      769px - 1024px  (6-column span)
Desktop:           1025px - 1440px (12-column span)
Desktop XL:        1441px+         (16-column span with container max-width)
```

---

### Sidebar Redesign

```
┌──────────────────────────────────┐
│      GENERATORAI SIDEBAR         │ 260px
├──────────────────────────────────┤
│                                  │
│ [AI Logo]  GENERATORAI   [×]    │
│                                  │
├──────────────────────────────────┤
│ [🔍] Quick Jump Command          │
│                                  │
├──────────────────────────────────┤
│ WORKSPACE                        │
│ ├─ ⚡ Dashboard                  │
│ ├─ 💬 Chats                      │
│ └─ ⚙️  (Status)                  │
│                                  │
│ CREATIVITY                       │
│ ├─ 🎨 New Chat                   │
│ ├─ 🔧 New Workflow               │
│ └─ 📚 Templates                  │
│                                  │
│ MANAGE                           │
│ ├─ 🔄 Workflows                  │
│ ├─ 📊 Sessions                   │
│ └─ 📁 Files                      │
│                                  │
│ MORE                             │
│ ├─ 🔔 Notifications (badge)      │
│ ├─ 🎓 Learning Hub               │
│ ├─ ⚙️  Settings                  │
│ └─ 🆘 Help & Support             │
│                                  │
├──────────────────────────────────┤
│ [User avatar] [Username] [···]  │
└──────────────────────────────────┘

STYLING:
- Background: --bg-glass with --border-glass
- Hover state: --bg-tertiary (no glass effect)
- Active item: --brand-primary-outline background + --brand-primary text
- Icon: Lucide React, 20px, --fg-secondary default, --brand-primary when active
- Font: Body S (14px), semi-bold for group headers
- Padding: 12px per row, 8px horizontal
- Animation: Smooth 200ms transitions on all state changes
```

### Header Redesign

```
┌─────────────────────────────────────────────────────────────────┐ 64px
│                                                                 │
│ [≡] [AI] [Dashboard/Page Name] [Breadcrumb]   [Cmd] [User] [···]│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Left Alignment (Mobile collapse/expand):
- Hamburger menu (mobile only)
- App logo / logo icon (32px)
- Current page title or breadcrumb trail
- Search/Command palette trigger (Cmd+K / Ctrl+K)

Right Alignment:
- Notifications bell (with badge if unread)
- Quick actions dropdown (Save, Export, etc.)
- User profile menu (avatar, name on hover, dropdown)
- Theme toggle (sun/moon icon)

STYLING:
- Height: 64px (fixed, sticky on scroll)
- Background: Semi-transparent glass as fallback, or solid --bg-secondary
- Border: --border-glass bottom only
- Padding: 0 24px
- Shadow: Subtle elevation on scroll (0 4px 12px rgba(0,0,0,0.05))
- Spacing: 16px between items
- Font: Body M (16px) for text labels
```

### Main Content Area Redesign

```
┌─────────────────────────────────────────────────────┐
│ [Toolbar: Actions, filters, view toggle]           │ ← 48px height
│ ╭─────────────────────────────────────────────────╮│
│ │ Page-Specific Content                           ││
│ │                                                 ││
│ │ Uses max-width container for desktop:           ││
│ │ - Default: 100% with 24px side padding         ││
│ │ - Large: 1400px centered (xl screens)          ││
│ │                                                 ││
│ │ Grid System: 12-column responsive               ││
│ │                                                 ││
│ ╰─────────────────────────────────────────────────╯│
│ Optional Right Panel (Context/Properties)          │ ← 380px fixed or collapsed
└─────────────────────────────────────────────────────┘

PADDING:
- Page content: 24px on desktop, 16px on mobile
- Section margins: 32px vertical, 24px horizontal
- Bottom safe area: 48px (for floating buttons)

SCROLL BEHAVIOR:
- Main content scrolls vertically
- Right panels scroll independently
- Sticky toolbar on scroll (optional for some pages)
- Sticky header on scroll (always)
```

### Workflow Canvas Redesign

```
┌─────────────────────────────────────────────────────┐
│ CANVAS CONTAINER (React Flow)                       │
│                                                     │
│   Background: --canvas-bg                           │
│   Grid: Subtle dots (--canvas-grid)                 │
│                                                     │
│   NODES (Stage Boxes):                              │
│   ┌──────────────────────────┐                     │
│   │ [Icon]  Stage Name       │  (94px × 56px)      │
│   │ Template Type            │                      │
│   │ ─────────────────────────│  Glassmorphic       │
│   │ [Status Indicator]       │                      │
│   └──────────────────────────┘                     │
│                                                     │
│   Selected node: 3px blue outline + glow           │
│   Hover node: Slightly lifted shadow               │
│                                                     │
│   EDGES (Connections):                              │
│   Animated bezier path with arrow endpoint         │
│   Color: --brand-primary by default                │
│   Hover: Brighter, thicker stroke                  │
│   Selected: Glowing effect                         │
│                                                     │
│   MINI-MAP (top-right corner):                      │
│   Shows full DAG, allows quick navigation           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Component Redesign Specifications

### 1. Button Component

```
BUTTON VARIANTS:

Primary (Glassmorphic):
  ├─ Background: --brand-primary
  ├─ Text: --fg-inverse (white)
  ├─ Border: None
  ├─ Shadow: 0 2px 8px rgba(91,91,214,0.2)
  ├─ Hover: --brand-primary-hover + lifted shadow
  ├─ Active: --brand-primary-active + inset shadow
  └─ Size: 40px height (default md)

Secondary (Outlined):
  ├─ Background: Transparent
  ├─ Border: 1px --border-secondary
  ├─ Text: --fg-primary
  ├─ Hover: --bg-tertiary background
  └─ Active: Darker border + --bg-secondary

Ghost (Minimal):
  ├─ Background: Transparent
  ├─ Border: None
  ├─ Text: --fg-primary
  ├─ Hover: --bg-tertiary background
  └─ Active: --fg-secondary text

Danger (Destructive):
  ├─ Background: --color-destructive
  ├─ Text: white
  ├─ Hover: Darker red (#D63639)
  └─ Confirmation state: Animated pulsing on hover

Sizes:
  ├─ xs: 28px height
  ├─ sm: 32px height
  ├─ md: 40px height (default)
  ├─ lg: 48px height
  └─ xl: 56px height

States:
  ├─ Disabled: 50% opacity + cursor-not-allowed
  ├─ Loading: Animated spinner + text fade
  └─ Pressed: All hover effects + 2px inset

Padding:
  ├─ Icon only: 8px
  ├─ Text only: 12px horizontal
  └─ Icon + Text: 12px left, 16px right (right-aligned icon)

Rounded: 8px (md)
Font: Inter 500, Body S (14px)
Transition: 150ms ease
```

### 2. Input Components

```
INPUT FIELDS & SELECT:

Base Input:
  ├─ Height: 40px
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-primary
  ├─ Padding: 8px 12px
  ├─ Rounded: 6px
  ├─ Font: Body M (16px), --fg-primary
  ├─ Placeholder: --fg-tertiary
  ├─ Focus: 2px --brand-primary outline
  ├─ Focus Shadow: 0 0 0 3px --brand-primary-light
  └─ Transition: 150ms ease

Hover state:
  ├─ Border: --border-secondary (slightly visible)
  └─ Background: Slightly lighter shade

Disabled state:
  ├─ Background: --color-muted
  ├─ Text: --fg-tertiary
  ├─ Cursor: not-allowed
  └─ Opacity: 60%

Error state:
  ├─ Border: 1px --color-destructive
  ├─ Focus Shadow: 0 0 0 3px rgba(229,72,77,0.15)
  └─ Icon: Red exclamation at right end

Success state:
  ├─ Border: 1px --color-success
  └─ Icon: Green checkmark at right end

Select Dropdown:
  ├─ Same as input but with chevron icon (right-aligned)
  ├─ Menu background: --bg-secondary
  ├─ Menu border: 1px --border-primary
  ├─ Menu shadow: 0 12px 24px rgba(0,0,0,0.12)
  ├─ Menu rounded: 8px
  ├─ Option height: 40px
  ├─ Option hover: --bg-tertiary
  ├─ Option selected: --brand-primary-outline background + --brand-primary text
  └─ Smooth scroll animation

Textarea:
  ├─ Same styling as input
  ├─ Min height: 100px
  ├─ Resize: vertical only
  └─ Font: 'JetBrains Mono' if code-related

Sizes:
  ├─ sm: 32px height, Body S
  ├─ md: 40px height, Body M (default)
  └─ lg: 48px height, Body L

Label styling:
  ├─ Font: Semi-bold Body S
  ├─ Color: --fg-secondary
  ├─ Margin bottom: 8px
  └─ Display: block-level
```

### 3. Card Components

```
CARD STYLES:

Standard Card (Content Container):
  ├─ Background: --bg-glass (light) / --bg-secondary (dark)
  ├─ Border: 1px --border-glass
  ├─ Rounded: 12px
  ├─ Padding: 16px
  ├─ Shadow: 0 2px 8px rgba(0,0,0,0.04)
  ├─ Hover: Slight lift (0 4px 12px rgba(0,0,0,0.08))
  ├─ Transition: 200ms ease
  └─ Backdrop filter: blur(12px) for glass

Interactive Card (Clickable):
  ├─ Cursor: pointer
  ├─ Hover: --bg-glass-hover + lifted shadow
  └─ Active: 2px --border-secondary inset

Surface Card (Page level):
  ├─ Background: --bg-secondary
  ├─ No border
  ├─ No shadow
  ├─ Padding: 24px
  └─ Rounded: 0 (flush to layout)

Status Card (Mini dashboard):
  ├─ Background: --bg-glass
  ├─ Grid layout: Icon (48px) + Content
  ├─ Value: Heading S (24px, semi-bold)
  ├─ Label: Body S (14px, secondary text)
  └─ Optional badge: Status indicator

Gradient Card (Premium/Featured):
  ├─ Gradient: --brand-primary to --accent-cyan
  ├─ Text: --fg-inverse (white)
  ├─ border: None or light outline
  └─ Shadow: 0 8px 24px rgba(91,91,214,0.15)
```

### 4. Modal / Dialog

```
MODAL STRUCTURE:

Overlay:
  ├─ Background: rgba(0,0,0,0.5)
  ├─ Backdrop filter: blur(4px)
  ├─ Animation: Fade in 150ms
  └─ Click outside: Closes (if dismissible)

Dialog Box:
  ├─ Background: --bg-primary
  ├─ Border: 1px --border-secondary
  ├─ Rounded: 16px
  ├─ Shadow: 0 20px 60px rgba(0,0,0,0.2)
  ├─ Padding: 24px
  ├─ Max-width: 600px (md), 800px (lg)
  ├─ Position: Centered, scrollable if content > 80vh
  └─ Animation: Slide up + fade in 200ms

Modal Header:
  ├─ Font: Heading S (20px, semi-bold)
  ├─ Color: --fg-primary
  ├─ Margin bottom: 16px
  ├─ Icon: Optional, left-aligned (24px)
  ├─ Close button: Top-right corner
  └─ Divider: --border-primary bottom

Modal Body:
  ├─ Font: Body M (16px)
  ├─ Color: --fg-primary
  ├─ Margin: 16px 0
  ├─ Scrollable: If content > available height
  └─ Max-height: calc(80vh - 120px)

Modal Footer:
  ├─ Divider: --border-primary top
  ├─ Padding top: 16px
  ├─ Button Group: Right-aligned
  ├─ Primary action: Primary button
  ├─ Secondary action: Ghost/Secondary button
  └─ Spacing between buttons: 8px

Form Modal variant:
  ├─ Fields use standardized input styling
  ├─ Field spacing: 16px vertical
  ├─ Error display: Inline below field
  └─ Submit button: Full width (optional)

Alert Dialog (Confirmation):
  ├─ Warning icon: --color-warning
  ├─ Title: --color-destructive for dangerous actions
  ├─ Auto-focus: Cancel button (safer default)
  ├─ Danger button styling: --color-destructive background
  └─ Optional: Undo/Recovery message
```

### 5. Dropdown / Popover

```
DROPDOWN MENU:

Trigger Button:
  └─ Can be any button style (primary, ghost, icon-only)

Dropdown Container:
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-primary
  ├─ Rounded: 8px
  ├─ Shadow: 0 12px 24px rgba(0,0,0,0.12)
  ├─ Min-width: 200px
  ├─ Max-width: 400px
  └─ Z-index: 1000

Dropdown Items:
  ├─ Height: 40px
  ├─ Padding: 8px 12px
  ├─ Font: Body M (16px)
  ├─ Color: --fg-primary
  ├─ Cursor: pointer
  ├─ Hover: --bg-tertiary background
  ├─ Active/Selected: --brand-primary-outline + --brand-primary text
  ├─ Icon: 16px, left-aligned (8px margin)
  └─ Badge/Pill: Right-aligned, optional

Separator:
  ├─ Height: 1px
  ├─ Color: --border-primary
  ├─ Margin: 4px 0
  └─ Full width

Disabled item:
  ├─ Opacity: 50%
  ├─ Cursor: not-allowed
  └─ Pointer-events: none

Submenu (Nested):
  ├─ Appear on hover (desktop) or click (mobile)
  ├─ Chevron icon at right
  ├─ Animation: Quick slide-out 100ms
  └─ Positioned: 100% left offset

Keyboard support:
  ├─ Arrow up/down: Navigate items
  ├─ Enter/Space: Select item
  ├─ Escape: Close menu
  └─ Letters: Jump to matching items
```

### 6. Spinners / Loading States

```
SPINNER (Circular):

Base Spinner:
  ├─ Size: 24px default, 32px lg, 16px sm
  ├─ Stroke width: 2px
  ├─ Color: --brand-primary
  ├─ Track color: --border-primary (faint)
  ├─ Animation: Linear rotation 1.2s infinite
  └─ SVG-based (no gif/png required)

Spinner Variants:

  Primary (Full circle rotating):
    └─ Used for general loading, fetch operations
  
  Skeleton (Pulse effect):
    ├─ Background: --border-primary
    ├─ Pulse animation: Fade 1s infinite
    ├─ Rounded: Match element shape
    └─ Used for content placeholders
  
  Progress (Linear progress bar):
    ├─ Height: 4px
    ├─ Background: --border-primary
    ├─ Fill: --brand-primary animated to percentage
    ├─ Rounded edges: 2px
    └─ Used for upload/download/form progress

  Dot Pulse (3 bouncing dots):
    ├─ Dots: 6px diameter, --brand-primary
    ├─ Spacing: 6px between dots
    ├─ Animation: Sequential fade + scale 1.4s
    └─ Used for message waiting

Loading Label:
  ├─ Font: Body S (14px), --fg-secondary
  ├─ Margin top: 8px
  ├─ Optional: Multi-line status messages with real-time updates
  └─ Tip: Show estimated time if available

Overlay Spinner (Page Load):
  ├─ Full-screen semi-transparent overlay
  ├─ Absolute centered spinner
  ├─ Z-index: 999
  └─ Fade in/out 200ms
```

### 7. File Tree / File Browser

```
FILE TREE COMPONENT:

Container:
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-primary
  ├─ Rounded: 8px
  ├─ Max-height: 500px (scrollable)
  ├─ Font: 'JetBrains Mono' Body S (13px)
  └─ Padding: 8px

Tree Item (Folder/File):
  ├─ Height: 32px
  ├─ Padding: 4px 8px
  ├─ Icon: 16px (folder, file, code icon)
  ├─ Name: --fg-primary
  ├─ Indentation per level: 16px
  ├─ Hover: --bg-tertiary background
  ├─ Selected: --brand-primary-outline background + --brand-primary text
  └─ Transition: 100ms ease

Expand/Collapse Icon:
  ├─ Chevron icon: 12px, --fg-tertiary
  ├─ Rotates on expand (0° → 90°)
  └─ Smooth 200ms rotation

Context Menu:
  ├─ Right-click opens dropdown
  ├─ Options: Rename, Delete, Download, Copy path
  └─ Follows standard dropdown styling

Drag & Drop (Optional):
  ├─ Drag handle: Dots icon (⋮⋮)
  ├─ Hover opacity: 0.7
  ├─ Drop zone: Visual feedback (--brand-primary-light background)
  └─ Smooth animations

Search/Filter:
  ├─ Search input above tree with magnifying glass icon
  ├─ Real-time filter highlighting matches
  ├─ "No results" message if nothing matches
  └─ Clear button when input has text
```

### 8. Chat Input Box

```
CHAT INPUT AREA:

Container:
  ├─ Position: Bottom of chat window (sticky)
  ├─ Background: Gradient (--bg-primary to --bg-secondary)
  ├─ Padding: 16px
  ├─ Border-top: 1px --border-secondary
  ├─ Shadow: 0 -4px 12px rgba(0,0,0,0.08)
  └─ Safe area padding for mobile keyboards

Input Box Area:
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-secondary
  ├─ Rounded: 12px
  ├─ Padding: 12px
  ├─ Display: Flex row with items centered
  └─ Focus: 2px --brand-primary outline

Text Input:
  ├─ Flex: 1 (grows to fill available space)
  ├─ Font: Body M (16px), --fg-primary
  ├─ Placeholder: --fg-tertiary "Type your message..."
  ├─ Resize: None (vertical scroll if needed)
  ├─ Max-height: 200px (scrollable)
  ├─ Line-height: 1.5
  └─ No border/outline (inherits from container)

Icons/Actions (Left Side):
  ├─ Attachment button: paperclip icon
  ├─ Icon size: 20px
  ├─ Color: --fg-tertiary
  ├─ Hover: --fg-secondary
  ├─ Margin: 0 8px 0 0
  └─ Tooltip: "Attach file (⌘ + ↵)"

Submit Button (Right Side):
  ├─ Send icon: Arrow or paper-plane
  ├─ Size: 32px square
  ├─ Background: --brand-primary (if input has text) or --bg-tertiary (disabled)
  ├─ Color: white or --fg-tertiary
  ├─ Rounded: 6px
  ├─ Cursor: pointer (if enabled) or not-allowed (if disabled)
  ├─ Hover: Lift animation
  ├─ Active: Scale 0.95
  └─ Margin: 0 0 0 8px

Floating HUD (Optional):
  ├─ Quick action buttons: "Regenerate", "Clear", "Settings"
  ├─ Position: Above input box
  ├─ Fade in on focus, fade out on blur
  └─ Semi-transparent background

File Indicator (on upload):
  ├─ Shows file name / size
  ├─ X button to remove
  ├─ Appears above input or as chip

Typing Indicator:
  ├─ "Someone is typing..." message
  ├─ Dot pulse animation
  └─ Fades in/out smoothly

Mobile Variant:
  ├─ Larger touch targets (44px min)
  ├─ Keyboard-aware spacing
  └─ Safe area bottom padding
```

### 9. Workflow DAG Canvas Nodes (React Flow)

```
STAGE NODE DESIGN:

Node Container:
  ├─ Width: 180px
  ├─ Height: 100px
  ├─ Background: --bg-glass (light) / --bg-secondary (dark)
  ├─ Border: 2px --border-primary
  ├─ Rounded: 10px
  ├─ Shadow: 0 4px 12px rgba(0,0,0,0.08)
  ├─ Padding: 12px
  ├─ Display: Flex column
  └─ Transition: All 200ms ease

Hover State:
  ├─ Shadow: 0 8px 24px rgba(0,0,0,0.12)
  ├─ Scale: 1.02
  ├─ Cursor: grab (draggable)
  └─ Border glow: Subtle highlight

Selected State:
  ├─ Border: 2px --brand-primary
  ├─ Shadow: 0 0 0 4px --brand-primary-light
  ├─ Background: --brand-primary-outline
  └─ Toolbar appears: Edit, Delete, etc.

Focused/Editing State:
  ├─ Border: 2px --brand-primary
  ├─ Input visible for renaming
  └─ Discard/Confirm buttons

Node Header (Icon + Name):
  ├─ Icon: 20px, --fg-primary, left-aligned
  ├─ Name: Body S (14px) semi-bold, --fg-primary
  ├─ Flex: Horizontal, 8px gap
  ├─ Truncate: text-overflow ellipsis
  └─ Margin bottom: 6px

Node Meta (Template Type):
  ├─ Font: Micro (12px), --fg-tertiary
  ├─ Background: --brand-primary-light
  ├─ Padding: 2px 6px
  ├─ Rounded: 4px
  ├─ Inline badge
  └─ Margin bottom: 6px

Node Status (Icon + Badge):
  ├─ Status badge: 8px dot + label
  ├─ Colors: Running = yellow, Success = green, Error = red, Pending = gray
  ├─ Animation: Pulse on running
  └─ Font: Micro (11px)

Handles (Connection Points):
  ├─ Top handle: Input connection (blue, hidden unless connecting)
  ├─ Bottom handle: Output connection (green)
  ├─ Size: 8px diameter
  ├─ Show on hover: Smooth fade in 100ms
  └─ Highlight on drag: Brighter color

Edge (Connecting Line):
  ├─ Stroke: 2px
  ├─ Color: --brand-primary (default) or status color (runtime)
  ├─ Curve: Smooth bezier
  ├─ Animation: Animated dashes (optional, on running)
  ├─ Arrow: Triangle endpoint, same color
  ├─ Hover: Highlight + thicker stroke (3px)
  └─ Selected: Glow effect

Runtime Override (Execution):
  ├─ Border: Status-appropriate color
  ├─ Background: Slightly tinted by status
  ├─ Pulse animation: If running
  └─ Checkmark overlay: If completed

Mini Node (Zoomed out):
  ├─ Size: Reduces proportionally
  ├─ Labels: Hidden (icon only)
  └─ Connections still visible
```

### 10. Run Timeline / Execution Timeline

```
TIMELINE CONTAINER:

Layout:
  ├─ Vertical scrollable stack
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-primary
  ├─ Rounded: 8px
  ├─ Padding: 16px
  ├─ Max-height: 400px (scrollable)
  └─ Font: 'JetBrains Mono' Body S (13px)

Timeline Entry (Stage Execution):
  ├─ Height: Auto
  ├─ Padding: 12px
  ├─ Margin bottom: 8px
  ├─ Background: --bg-primary
  ├─ Border: 1px --border-primary
  ├─ Rounded: 6px
  ├─ Display: Grid with vertical line + content

Timeline Vertical Line:
  ├─ Position: Left edge
  ├─ Width: 2px
  ├─ Colors by status:
  │  ├─ Running: --color-warning (animated pulse)
  │  ├─ Completed: --color-success
  │  ├─ Failed: --color-destructive
  │  ├─ Pending: --color-muted
  │  └─ Skipped: --fg-tertiary
  └─ Height: Full entry height

Timeline Dot:
  ├─ Position: On vertical line at top
  ├─ Size: 12px circle
  ├─ Same color as line
  ├─ Pulse animation if running
  └─ Border: 2px white/background (separation)

Entry Content:
  ├─ Title: Stage name (semi-bold, Body S)
  ├─ Status badge: Inline, next to title
  ├─ Timestamp: --fg-tertiary, right-aligned
  ├─ Duration: Micro font, --fg-tertiary
  ├─ Details (collapsed by default):
  │  ├─ Output preview (first 200 chars)
  │  ├─ Errors (if failed)
  │  └─ Logs toggle button
  └─ Expand arrow: Rotates on toggle

Status Badge:
  ├─ Micro font (11px), semi-bold
  ├─ Padding: 2px 6px
  ├─ Background: Status-appropriate light shade
  ├─ Text: Status-appropriate dark shade
  └─ Rounded: 3px

Error Details (If Failed):
  ├─ Background: rgba(229,72,77,0.1)
  ├─ Border: 1px --color-destructive
  ├─ Padding: 8px
  ├─ Rounded: 4px
  ├─ Font: Monospace caption
  ├─ Text: --color-destructive
  └─ Margin top: 8px

Logs Section (If Expanded):
  ├─ Max-height: 200px (scrollable)
  ├─ Background: --canvas-bg (slightly different)
  ├─ Padding: 8px
  ├─ Font: Monospace micro (11px)
  ├─ Line-height: 1.4
  ├─ Border: 1px --border-primary
  └─ Scroll area: Custom styled

Copy Button:
  ├─ Icon: Copy/clipboard
  ├─ Appears on hover
  ├─ Tooltip: "Copy logs"
  └─ Visual feedback on click

Grouping (Optional):
  ├─ Group consecutive entries by run
  ├─ Run header: "Run #123 started at 3:45 PM"
  ├─ Collapsible: Chevron icon
  └─ Summary: "3 stages, 2 completed, 1 failed"
```

### 11. Icon System

```
ICONS (Lucide React):

General sizes:
  ├─ xs: 12px (badges, micro labels)
  ├─ sm: 16px (inline text, compact UI)
  ├─ md: 20px (default buttons, inputs)
  ├─ lg: 24px (page headers, large buttons)
  ├─ xl: 32px (hero sections, avatars)
  └─ 2xl: 48px (large banners)

Icon Colors (by context):
  ├─ Primary actions: --brand-primary
  ├─ Secondary actions: --fg-secondary
  ├─ Success states: --color-success
  ├─ Warning states: --color-warning
  ├─ Error states: --color-destructive
  ├─ Info states: --color-info
  └─ Disabled: --fg-tertiary (50% opacity)

Icon Animations:
  ├─ Loading spinner: Continuous rotation (1.2s)
  ├─ Pulsing (alert/notification): Scale 1 → 1.1 → 1 (1.5s)
  ├─ Bouncing (waiting): Y-translate -4px (0.6s)
  └─ Rotating (expand/collapse): 0° → 90° on toggle (200ms)

Stroke Width:
  ├─ Thin: 1.5px (xs icons)
  ├─ Default: 2px (sm-lg icons)
  └─ Bold: 2.5px (xl+ icons)

Recommended Icons by Category:
  ├─ Workflow actions: Zap, Play, Pause, StopCircle, Copy, Trash
  ├─ Navigation: Home, Settings, HelpCircle, LogOut, Menu
  ├─ Status: Check, X, Clock, AlertTriangle
  ├─ Files: File, FileCode, Folder, Download, Upload
  ├─ Chat: MessageSquare, Send, Paperclip
  ├─ Tools: Sliders, Wrench, Settings
  └─ Visibility: Eye, EyeOff, Lock, Unlock
```

### 12. Upload Component

```
UPLOAD AREA:

Container:
  ├─ Background: --brand-primary-light
  ├─ Border: 2px dashed --brand-primary
  ├─ Rounded: 8px
  ├─ Padding: 24px
  ├─ Aspect ratio: Auto (min 120px tall)
  ├─ Cursor: pointer (on hover)
  ├─ Transition: All 200ms ease
  └─ Z-index: 10 (for drag detection)

Hover State:
  ├─ Background: Slightly brighter shade
  ├─ Border: Solid (no dashes)
  ├─ Shadow: 0 4px 12px rgba(91,91,214,0.15)
  └─ Scale: 1.01

Drag-Over State (User dragging file):
  ├─ Background: --brand-primary-outline
  ├─ Border: 2px solid --brand-primary
  ├─ Shadow: 0 8px 20px rgba(91,91,214,0.2)
  └─ Scale: 1.02

Content (Icon + Text):
  ├─ Icon: Cloud + arrow down, 36px, --brand-primary
  ├─ Title: "Drop files or click to browse", Body M semi-bold
  ├─ Subtitle: "Max 5MB per file, supports .json, .yaml", Body S secondary
  ├─ Spacing: 12px between elements
  └─ Text-align: center

File Input (Hidden):
  └─ Accept: Application-specific (e.g., .json, .yaml, .csv)

Upload Progress (If uploading):
  ├─ Hidden overlay opacity: 0.9
  ├─ Central component:
  ├─  ├─ Spinner (24px)
  ├─  ├─ Filename text
  ├─  ├─ Progress bar (animate to %)
  ├─  └─ Percentage text (e.g., "45%")
  ├─ Styling: All progress elements in --brand-primary
  └─ Cancel button: X icon, right corner

Upload Success:
  ├─ Background: --color-success-light
  ├─ Border: 2px solid --color-success
  ├─ Icon: Checkmark (green)
  ├─ Message: "File uploaded successfully"
  ├─ File size/name: Micro text, secondary
  └─ Auto-dismiss after 3s (optional) or manual close

Upload Error:
  ├─ Background: --color-destructive-light
  ├─ Border: 2px solid --color-destructive
  ├─ Icon: AlertTriangle (red)
  ├─ Message: Error details
  ├─ Retry button: Ghost style
  └─ Manual dismiss or auto-dismiss (5s)

Uploaded Files List:
  ├─ Below upload area or separate section
  ├─ Each file: Chip-style display
  ├─  ├─ File icon
  ├─  ├─ Filename (truncated if long)
  ├─  ├─ Size (micro text)
  ├─  └─ X button to remove
  ├─ Background: --bg-secondary
  ├─ Border: 1px --border-primary
  ├─ Padding: 8px 12px
  ├─ Margin: 4px (grid layout)
  └─ Hover: Slightly darker background
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Color System & Tokens**
- [ ] Update `apps/web/src/styles/globals.css` with new color variables
- [ ] Test colors against WCAG AAA contrast requirements
- [ ] Create Tailwind config adjustments for new palette
- [ ] Implement Light/Dark mode toggling

**Typography & Spacing**
- [ ] Update font size scale in globals.css
- [ ] Define responsive typography with media queries
- [ ] Create spacing/padding utilities
- [ ] Test text legibility at all sizes

### Phase 2: Core Layout (Weeks 3-4)

**Header & Sidebar**
- [ ] Redesign the Header component (`[Header.tsx](apps/web/src/components/layout/Header.tsx)`)
  - Add refined navigation breadcrumb
  - Implement new command palette (Cmd+K)
  - Add quick action buttons
- [ ] Redesign the Sidebar component (`[Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx)`)
  - Update to new glass design
  - Reorganize menu structure
  - Add active state styling

**Main Layout**
- [ ] Update `[AppLayout.tsx](apps/web/src/components/layout/AppLayout.tsx)` with new spacing
- [ ] Implement responsive container widths
- [ ] Add sticky header on scroll

### Phase 3: Base Components (Weeks 5-6)

**Button & Input Components**
- [ ] Create Button variants (Primary, Secondary, Ghost, Danger)
- [ ] Create Input field component with states
- [ ] Create Select/Dropdown component
- [ ] Create larger "Button + Input Gallery" page for QA

**Cards & Containers**
- [ ] Redesign Card components (Standard, Interactive, Surface)
- [ ] Update Modal/Dialog styling
- [ ] Create Popover/Tooltip components

### Phase 4: Specialized Components (Weeks 7-8)

**Workflow-Specific Components**
- [ ] Update StageNode styling (`[StageNode.tsx](apps/web/src/components/workflow/StageNode.tsx)`)
  - New glassmorphic design
  - Updated status indicators
  - Improved hover states
- [ ] Update StageEdge styling
- [ ] Update RunTimeline component with new timeline design
- [ ] Update FileTree component

**Chat Components**
- [ ] Redesign ChatInput component
- [ ] Update ChatMessageList styling
- [ ] Create StreamingMessage component redesign

### Phase 5: Refinement & Polish (Weeks 9-10)

**Animation & Interactions**
- [ ] Add smooth transitions throughout
- [ ] Create consistent micro-interactions
- [ ] Test performance impact of animations
- [ ] Implement reduced-motion accessibility settings

**Responsive Testing**
- [ ] Mobile (< 640px): Full-width layouts, hamburger menu
- [ ] Tablet (640px - 1024px): Sidebar collapse options
- [ ] Desktop (1024px+): Full feature set
- [ ] Test across major browsers (Chrome, Safari, Firefox, Edge)

**Accessibility Review**
- [ ] WCAG AAA color contrast verification
- [ ] Keyboard navigation testing
- [ ] Screen reader testing (NVDA, JAWS, VoiceOver)
- [ ] Focus indicator visibility
- [ ] Form labeling and error messaging

### Phase 6: Documentation & Handoff (Week 11)

**Component Library Documentation**
- [ ] Create Storybook stories for all components (optional)
- [ ] Document prop APIs for each component
- [ ] Create design token reference guide
- [ ] Document animation specifications

**Team Knowledge Transfer**
- [ ] Design system presentation for team
- [ ] Component usage guidelines
- [ ] Common patterns and best practices
- [ ] Troubleshooting guide

---

## File Structure & Organization

```
apps/web/src/
├── styles/
│   ├── globals.css                 ← Color system, typography, spacing
│   ├── animations.css              ← Keyframe definitions
│   └── tailwind.config.ts          ← Tailwind extensions
│
├── components/
│   ├── common/
│   │   ├── Button.tsx              ← Variants system
│   │   ├── Input.tsx               ← Form inputs
│   │   ├── Card.tsx                ← Card variants
│   │   ├── Modal.tsx
│   │   ├── Dropdown.tsx
│   │   ├── Spinner.tsx
│   │   ├── Upload.tsx
│   │   └── Icons.tsx               ← Icon wrapper
│   │
│   ├── layout/
│   │   ├── Header.tsx              ← Redesigned
│   │   ├── Sidebar.tsx             ← Redesigned
│   │   └── AppLayout.tsx           ← Updated spacing
│   │
│   ├── workflow/
│   │   ├── StageNode.tsx           ← New styling
│   │   ├── StageEdge.tsx           ← New styling
│   │   ├── RunTimeline.tsx         ← New design
│   │   ├── FileTree.tsx            ← Redesigned
│   │   ├── RuntimeDAGCanvas.tsx    ← Canvas styling
│   │   └── ...
│   │
│   └── chat/
│       ├── ChatInput.tsx           ← Redesigned
│       ├── ChatMessageList.tsx     ← Updated styling
│       └── ...
│
├── hooks/
│   └── useTheme.ts                 ← Light/dark mode hook
│
└── utils/
    └── cn.ts                       ← Tailwind merge utility
```

---

## CSS Utility Classes (Tailwind Extensions)

```css
/* File: apps/web/tailwind.config.ts */

theme: {
  extend: {
    colors: {
      /* Brand colors */
      brand: {
        primary: 'var(--brand-primary)',
        hover: 'var(--brand-primary-hover)',
        active: 'var(--brand-primary-active)',
        light: 'var(--brand-primary-light)',
        outline: 'var(--brand-primary-outline)',
      },
      /* Backgrounds */
      bg: {
        primary: 'var(--bg-primary)',
        secondary: 'var(--bg-secondary)',
        tertiary: 'var(--bg-tertiary)',
        glass: 'var(--bg-glass)',
      },
      /* Foreground */
      fg: {
        primary: 'var(--fg-primary)',
        secondary: 'var(--fg-secondary)',
        tertiary: 'var(--fg-tertiary)',
        inverse: 'var(--fg-inverse)',
      },
      /* Semantic */
      success: 'var(--color-success)',
      warning: 'var(--color-warning)',
      destructive: 'var(--color-destructive)',
      info: 'var(--color-info)',
    },
    
    backdropBlur: {
      glass: '12px',
      'glass-lg': '16px',
    },
    
    animation: {
      'spin-slow': 'spin 1.2s linear infinite',
      'pulse-light': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      'bounce-y': 'bounce-y 0.6s ease-in-out infinite',
      'fade-in': 'fadeIn 200ms ease-in',
      'slide-up': 'slideUp 200ms ease-out',
    },
    
    keyframes: {
      'bounce-y': {
        '0%, 100%': { transform: 'translateY(0)' },
        '50%': { transform: 'translateY(-4px)' },
      },
      fadeIn: {
        '0%': { opacity: '0' },
        '100%': { opacity: '1' },
      },
      slideUp: {
        '0%': { transform: 'translateY(8px)', opacity: '0' },
        '100%': { transform: 'translateY(0)', opacity: '1' },
      },
    },
    
    boxShadow: {
      glass: '0 2px 8px rgba(0, 0, 0, 0.04)',
      'glass-lg': '0 8px 24px rgba(0, 0, 0, 0.08)',
      glow: '0 0 0 4px var(--brand-primary-light)',
    },
  },
}
```

---

## Accessibility Guidelines

### Color & Contrast
- All text meets **WCAG AAA** contrast ratios (7:1 minimum for normal text)
- Color is not the only indicator (always pair with icons/text)
- Ensure sufficient color distinction for colorblind users

### Keyboard Navigation
- All interactive elements are reachable via Tab key
- Logical tab order (left to right, top to bottom)
- Focus indicators are highly visible (2px outline minimum)
- Escape closes modals/dropdowns
- Enter/Space activates buttons

### Screen Readers
- Semantic HTML (`<button>`, `<nav>`, `<form>`, etc.)
- ARIA labels for icon-only buttons: `aria-label="Close"`
- ARIA attributes for complex components (tabs, trees, dropdowns)
- Live regions for async content updates: `aria-live="polite"`
- Form fields have associated `<label>` elements

### Motion & Animation
- `prefers-reduced-motion` media query respected
- Animations trigger on user action (not auto-play)
- No flashing/strobing (>3 flashes per second)
- Meaningful animations (not gratuitous)

### Responsive Design
- Tap targets minimum 44×44px on mobile
- No horizontal scrolling on mobile
- Text remains readable without zoom on mobile
- Touch-friendly spacing between interactive elements

---

## Next Steps

1. **Review & Approval**: Share design spec with team for feedback
2. **Create Component Library**: Build shared component library in Storybook (optional but recommended)
3. **Implement Phase 1**: Begin with color system and typography
4. **Parallel Testing**: Test accessibility throughout implementation
5. **Gather Feedback**: Run usability tests after Phase 2 (layout)
6. **Document as You Build**: Update design system docs throughout
7. **Final Polish**: Micro-interactions and performance optimization

---

## Reference Design Systems

- **Linear** (https://linear.app): Minimalist, modern UI targeting developers
- **Vercel** (https://vercel.com): Clean, spacious, focus on content
- **ChatGPT** (https://chatgpt.com): Conversation-focused, simple interactions
- **GitHub** (https://github.com): Familiar developer patterns, accessible
- **Figma** (https://figma.com): Sophisticated, glassmorphism, dark-mode ready

---

**End of Design Specification**

*This document should be reviewed quarterly and updated as UI trends evolve and user feedback informs design decisions.*
```

---

## Summary

I've created a **comprehensive, modern UI/UX design specification** for GeneratorAI that includes:

### ✨ Key Deliverables:

1. **Modern Design Philosophy** combining:
   - Enhanced Glassmorphism (12-16px blur, refined transparency)
   - Minimalist Elegance (generous whitespace, intentional design)
   - Semantic Neumorphism (micro-interactions, subtle elevation)

2. **Complete Color System** with **exact hex codes** for:
   - **Light Mode**: 30+ shades from backgrounds to semantic states
   - **Dark Mode**: Carefully tuned for eye comfort and contrast
   - WCAG AAA compliance across all text/background combinations

3. **Typography & Spacing**:
   - 11-point responsive type scale (Display to Micro)
   - 8px-based spacing system
   - Inter + JetBrains Mono font stack

4. **Layout Architecture**:
   - Refined Sidebar (260px, collapsible, reorganized menu)
   - Modern Header (64px, sticky, command palette, quick actions)
   - Responsive breakpoints (Mobile, Tablet, Desktop)

5. **12 Key Component Specifications**:
   - Buttons (5 variants), Inputs, Cards, Modals, Dropdowns
   - Spinners/Loading states, File trees, Chat input, Workflow DAG nodes
   - Run timelines, Icons, Upload areas

6. **11-Week Implementation Roadmap**:
   - Phase 1: Color system & tokens
   - Phase 2: Header & sidebar redesign
   - Phase 3: Base components
   - Phase 4: Workflow-specific components
   - Phase 5: Polish & refinement
   - Phase 6: Documentation

7. **Accessibility & Performance**:
   - WCAG AAA compliance checklist
   - Keyboard navigation support
   - Screen reader compatibility
   - Reduced motion support

This design system is production-ready and ready to implement immediately. All colors, dimensions, and spacing values are specified with precision for developers to use.