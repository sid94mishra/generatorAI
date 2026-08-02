# Workflow Canvas Builder — UI/UX Design Specification

> Research-backed design specification based on analysis of **n8n**, **Excalidraw**, **Retool Workflows**, and **Langflow** canvas builders. Maps to the existing GeneratorAI `WorkflowBuilderPage`, `DAGCanvas`, `StageNode`, `StageEdge`, and `StagePropertiesPanel` components.

---

## Table of Contents

1. [Research Summary](#1-research-summary)
2. [Overall Layout Architecture](#2-overall-layout-architecture)
3. [Node Addition — "Add Stage" Placement](#3-node-addition--add-stage-placement)
4. [Canvas Controls — Zoom, Fit, Minimap](#4-canvas-controls--zoom-fit-minimap)
5. [Properties Panel — Right Sidebar](#5-properties-panel--right-sidebar)
6. [Form Element Modernization](#6-form-element-modernization)
7. [Node Design — StageNode](#7-node-design--stagenode)
8. [Edge Design — StageEdge](#8-edge-design--stageedge)
9. [Empty States & Onboarding](#9-empty-states--onboarding)
10. [Animation & Motion Reference](#10-animation--motion-reference)
11. [Z-Index Map](#11-z-index-map)
12. [Responsive Breakpoints](#12-responsive-breakpoints)
13. [Keyboard Shortcuts Summary](#13-keyboard-shortcuts-summary)
14. [Implementation Checklist](#14-implementation-checklist)

---

## 1. Research Summary

### n8n (v2.x Canvas)
- **Node Addition**: Uses a `+` button rendered *on the output handle of each node* (appears on hover), plus a central "Add first step" CTA in empty state. The node catalog opens as a searchable slide-up panel from the bottom. There is NO floating action button.
- **Canvas Controls**: Bottom-left corner — vertical stack of zoom in, zoom out, fit-to-view, reset zoom (100%). Minimap is togglable and appears bottom-right.
- **Properties Panel**: Full-height right-side drawer (400px wide) that slides in from the right edge. Has a header bar with node icon + name, tabbed sections (Parameters, Settings, Output), collapsible parameter groups, and rich form controls (custom selects, code editors, toggle switches).
- **Edges**: Smooth bezier curves with animated dashed flow, directional markers, labels on hover.
- **Node Design**: Rounded rectangle cards (~200px wide), category-colored left border strip, icon + title header, subtitle with operation name. Selected state shows a colored border ring + shadow.

### Excalidraw
- **Canvas Controls**: Bottom-center horizontal toolbar for tools; zoom controls in bottom-left corner as a compact cluster. No minimap.
- **Properties Panel**: Right-side panel appears contextually when an element is selected. Uses inline property editors (color pickers, stroke widgets, etc.).
- **Element interaction**: Glow outline on hover, resize handles with cursor changes.

### Retool Workflows
- **Node Addition**: Bottom-center pill-shaped "+" button for adding steps in a sequential workflow. On a DAG, uses handle-attached `+` buttons.
- **Canvas Controls**: Bottom-left zoom controls. Top-left breadcrumb/navigation.
- **Properties Panel**: Right drawer (~380px) with tabbed "Configure" / "Test" sections. Uses styled form elements with collapsible sections.
- **Empty State**: Large CTA card in center canvas.

### Langflow
- **Node Addition**: Left sidebar component palette (draggable). Nodes are dropped onto canvas. Each node output handle shows a `+` on hover to add a connected node.
- **Canvas Controls**: Bottom-left zoom cluster. Optional minimap bottom-right.
- **Properties Panel**: Inline on-node editing for simple params, but opens a modal/drawer for complex config.
- **Node Design**: Wider cards (~260px) with input/output ports clearly labeled, type-colored header bands, tag badges.

---

## 2. Overall Layout Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  TOOLBAR (h-12, z-50)                                                  │
│  [← Back] [name] [undo|redo] [settings] [validate] [panel] [save][run]│
├────────────────────────────────────────────────────────────────────────┤
│  VALIDATION BANNER (conditional, z-40)                                 │
├───────────────────────────────────┬────────────────────────────────────┤
│                                   │  PROPERTIES PANEL (w-80 xl:w-96)  │
│                                   │  z-30                              │
│         CANVAS (flex-1)           │  ┌──────────────────────────────┐ │
│         z-0                       │  │ Header: icon + stage name    │ │
│                                   │  │ + close button               │ │
│  ┌──────────┐                     │  ├──────────────────────────────┤ │
│  │ Controls │ (bottom-left, z-20) │  │ Tabs: Properties | Advanced │ │
│  │ zoom +/- │                     │  ├──────────────────────────────┤ │
│  │ fit      │                     │  │ Scrollable form body         │ │
│  │ reset    │                     │  │  ▸ Section: Basic            │ │
│  └──────────┘                     │  │  ▸ Section: Model            │ │
│                                   │  │  ▸ Section: Prompts          │ │
│     ┌────────────────┐            │  │  ▸ Section: Execution        │ │
│     │  ADD STAGE btn │            │  │  ▸ Section: Variables        │ │
│     │ (bottom-center,│            │  └──────────────────────────────┘ │
│     │  z-20)         │            │                                    │
│     └────────────────┘            │                                    │
│                     ┌─────────┐   │                                    │
│                     │ MiniMap │   │                                    │
│                     │(btm-rt) │   │                                    │
│                     │ z-20    │   │                                    │
│                     └─────────┘   │                                    │
└───────────────────────────────────┴────────────────────────────────────┘
```

### Current Bug — FAB overlaps Controls
**Current code** in `WorkflowBuilderPage.tsx`:
```tsx
{/* Floating Add Stage Button */}
<button className="absolute bottom-6 left-6 z-10 ...">
```
React Flow's `<Controls>` component defaults to **bottom-left**. This causes an overlap.

**Fix**: Move the "Add Stage" button to **bottom-center** of the canvas area, above the React Flow controls.

---

## 3. Node Addition — "Add Stage" Placement

### Design Decision
Following n8n and Retool Workflows, **two complementary approaches**:

#### A) Bottom-Center Canvas Button (Primary)
Positioned at the bottom-center of the canvas viewport, NOT overlapping any React Flow controls.

```tsx
{/* In DAGCanvas.tsx, inside <ReactFlow>, as a <Panel> */}
<Panel position="bottom-center">
  <button className={cn(
    // Positioning
    "mb-4",
    // Shape — pill capsule like Retool
    "flex items-center gap-2 rounded-full",
    // Sizing
    "px-5 py-2.5",
    // Colors
    "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
    // Shadows — floating but not aggressive
    "shadow-[0_4px_14px_rgba(79,70,229,0.25)]",
    // Interactions
    "transition-all duration-200 ease-out",
    "hover:shadow-[0_8px_25px_rgba(79,70,229,0.35)] hover:scale-[1.03]",
    "active:scale-[0.97] active:shadow-[0_2px_8px_rgba(79,70,229,0.2)]",
    // Focus
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2",
  )}>
    <Plus className="h-4 w-4" />
    <span className="text-sm font-medium">Add Stage</span>
  </button>
</Panel>
```

**Why `<Panel position="bottom-center">`:** React Flow's `<Panel>` component is canvas-aware and automatically avoids other built-in controls. Using absolute positioning outside the ReactFlow tree (as current code does) has no awareness of control placement.

**Z-index**: React Flow Panels get `z-index: 5` by default, which is correct — the same layer as Controls and MiniMap but non-overlapping because `Panel` positions are a CSS grid.

#### B) Handle-Attached "+" Button (Secondary — n8n pattern)
On each `StageNode`, show a `+` button on the **output (right) handle** when hovering the node. This creates a "connect and add" affordance.

```tsx
{/* In StageNode.tsx, next to the output Handle */}
<div className="absolute -right-3 top-1/2 -translate-y-1/2">
  <Handle type="source" position={Position.Right} ... />
  {/* Add-from-handle button — appears on node hover */}
  <button
    onClick={(e) => { e.stopPropagation(); onAddConnectedStage(id); }}
    className={cn(
      "absolute left-full ml-1 top-1/2 -translate-y-1/2",
      "flex h-6 w-6 items-center justify-center rounded-full",
      "bg-[var(--color-primary)] text-white",
      "opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100",
      "transition-all duration-200 ease-out",
      "shadow-sm hover:shadow-md",
      "z-10",
    )}
    title="Add connected stage"
  >
    <Plus className="h-3 w-3" />
  </button>
</div>
```

---

## 4. Canvas Controls — Zoom, Fit, Minimap

### Controls Placement: Bottom-Left (n8n standard)
React Flow's `<Controls>` already defaults to bottom-left. Keep it there.

```tsx
<Controls
  showInteractive={!readonly}
  position="bottom-left"      // explicit (already default)
  className={cn(
    // Override React Flow's default styles
    "[&>button]:!rounded-lg",
    "[&>button]:!border [&>button]:!border-[var(--color-border)]",
    "[&>button]:!bg-[var(--color-card)]",
    "[&>button]:!fill-[var(--color-foreground)]",
    "[&>button]:!shadow-sm",
    "[&>button:hover]:!bg-[var(--color-accent)]",
    "[&>button:hover]:!border-[var(--color-primary)]/30",
    // Transitions
    "[&>button]:!transition-all [&>button]:!duration-150",
    // Spacing
    "!bg-transparent !border-none !shadow-none",
    "!gap-1.5 !p-0 !m-3",
  )}
  style={{ zIndex: 20 }}
/>
```

**Z-index**: `20` — above canvas elements (z: 0–10) but below toolbar (z: 50) and modals (z: 100+).

### MiniMap Placement: Bottom-Right
```tsx
<MiniMap
  position="bottom-right"
  nodeColor={minimapNodeColor}
  maskColor="rgba(0, 0, 0, 0.08)"
  pannable
  zoomable
  className={cn(
    "!rounded-lg !border !border-[var(--color-border)]",
    "!bg-[var(--color-card)] !shadow-sm",
    "!m-3",
  )}
  style={{
    width: 160,
    height: 100,
    zIndex: 20,
  }}
/>
```

### Auto-Layout Button: Top-Right (keep current)
Already positioned correctly with `<Panel position="top-right">`. No change needed.

---

## 5. Properties Panel — Right Sidebar

### Slide-In Animation
**Current issue**: Panel appears/disappears instantly with a conditional render (`{propertiesPanelOpen && <div>...`).

**Fix**: Always render the panel, animate with `translate-x` + `opacity`.

```tsx
{/* In WorkflowBuilderPage.tsx — replace the conditional render */}
<div
  className={cn(
    // Base
    "shrink-0 border-l border-[var(--color-border)]",
    "bg-[var(--color-card)]",
    "shadow-[-2px_0_8px_rgba(0,0,0,0.04)]",
    "overflow-hidden",
    // Animation
    "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
    // States
    propertiesPanelOpen
      ? "w-80 xl:w-96 opacity-100 translate-x-0"
      : "w-0 opacity-0 translate-x-full",
  )}
  style={{ zIndex: 30 }}
>
  <div className="w-80 xl:w-96 h-full">
    <StagePropertiesPanel onClose={() => setPropertiesPanelOpen(false)} />
  </div>
</div>
```

**Animation timing**: `300ms` with `cubic-bezier(0.16, 1, 0.3, 1)` — this is the "ease-out-expo" curve used by n8n and Radix UI. Fast entry, smooth settle.

### Panel Header Bar
The panel header should prominently show the stage name and provide tab navigation:

```tsx
{/* Header */}
<div className="flex flex-col border-b border-[var(--color-border)]">
  {/* Title row */}
  <div className="flex items-center justify-between px-4 py-3">
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10">
        <Settings2 className="h-4 w-4 text-[var(--color-primary)]" />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-[var(--color-foreground)]">
          {stage.name}
        </h3>
        <p className="truncate text-[11px] text-[var(--color-muted-foreground)]">
          {stage.templateId ?? 'Custom stage'}
        </p>
      </div>
    </div>
    <button
      onClick={onClose}
      className={cn(
        "rounded-lg p-1.5",
        "text-[var(--color-muted-foreground)]",
        "transition-colors duration-150",
        "hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
      )}
    >
      <X className="h-4 w-4" />
    </button>
  </div>

  {/* Tab bar */}
  <div className="flex px-4 gap-1">
    {['Properties', 'Advanced'].map(tab => (
      <button
        key={tab}
        onClick={() => setActiveTab(tab)}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors",
          activeTab === tab
            ? "bg-[var(--color-background)] text-[var(--color-foreground)] border border-b-0 border-[var(--color-border)]"
            : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
        )}
      >
        {tab}
      </button>
    ))}
  </div>
</div>
```

### Scroll Behavior
```tsx
{/* Scrollable form body */}
<div className={cn(
  "flex-1 overflow-y-auto",
  "scrollbar-thin scrollbar-track-transparent",
  "scrollbar-thumb-[var(--color-border)] hover:scrollbar-thumb-[var(--color-muted-foreground)]",
)}>
  <div className="p-4 space-y-1">
    {/* Sections go here as <CollapsibleSection> components */}
  </div>
</div>
```

### Collapsible Sections (Accordion Pattern)
Each property group should be collapsible. Use a shared component:

```tsx
interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}

function CollapsibleSection({ title, icon, defaultOpen = true, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center justify-between px-4 py-2.5",
          "text-xs font-semibold uppercase tracking-wider",
          "text-[var(--color-muted-foreground)]",
          "hover:bg-[var(--color-accent)]/50",
          "transition-colors duration-150",
        )}
      >
        <div className="flex items-center gap-2">
          {icon}
          {title}
          {badge && (
            <span className="rounded-full bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-primary)] normal-case">
              {badge}
            </span>
          )}
        </div>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="px-4 pb-4 pt-1 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}
```

**Section organization**:
- **Basic** (default open): Name, Description
- **Template & Model** (default open): Template select, Model override
- **Prompts** (default open): PromptEditor
- **Execution** (default closed): Run condition, Retry policy, Timeout
- **Variables** (default closed): Key-value editor

### Responsive Breakpoints
```
≤ 768px (md):  Panel collapses into a full-screen overlay/drawer
≤ 1024px (lg): Panel width 320px (w-80)
≥ 1280px (xl): Panel width 384px (w-96)
≥ 1536px (2xl): Panel width 448px (w-[28rem])
```

```tsx
className={cn(
  // Mobile: full overlay
  "max-md:fixed max-md:inset-0 max-md:z-50 max-md:w-full",
  // Tablet+: sidebar
  "md:relative md:w-80",
  "xl:w-96",
  "2xl:w-[28rem]",
)}
```

---

## 6. Form Element Modernization

### 6.1 Custom Select Dropdown (replace native `<select>`)

**Current code** (in `StagePropertiesPanel.tsx`):
```tsx
<select className="w-full rounded-md border ...">
  <option value="">No template</option>
  ...
</select>
```

**Replacement Pattern** — Styled custom dropdown using a `<Listbox>` or custom component:

```tsx
interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

function StyledSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center justify-between",
          "rounded-lg border border-[var(--color-border)]",
          "bg-[var(--color-background)] px-3 py-2",
          "text-sm text-left",
          "transition-all duration-150",
          "hover:border-[var(--color-primary)]/50",
          "focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20",
          open && "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20",
        )}
      >
        <span className={cn(
          selected ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]",
        )}>
          {selected?.label ?? placeholder ?? 'Select...'}
        </span>
        <ChevronDown className={cn(
          "h-4 w-4 text-[var(--color-muted-foreground)]",
          "transition-transform duration-200",
          open && "rotate-180",
        )} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          "absolute z-50 mt-1 w-full",
          "rounded-lg border border-[var(--color-border)]",
          "bg-[var(--color-card)] shadow-lg shadow-black/10",
          "py-1 max-h-60 overflow-y-auto",
          // Entrance animation
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
          "duration-150",
        )}>
          {options.map(option => (
            <button
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm",
                "transition-colors duration-100",
                option.value === value
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]",
              )}
            >
              {option.icon}
              <div>
                <div className="font-medium">{option.label}</div>
                {option.description && (
                  <div className="text-xs text-[var(--color-muted-foreground)]">
                    {option.description}
                  </div>
                )}
              </div>
              {option.value === value && (
                <Check className="ml-auto h-4 w-4" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 6.2 Toggle Switch (replace checkboxes for booleans)

**Current code**:
```tsx
<input type="checkbox" checked={!!stage.retryPolicy} ... />
```

**Replacement**:

```tsx
function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div>
        <span className="text-sm font-medium text-[var(--color-foreground)]">{label}</span>
        {description && (
          <p className="text-xs text-[var(--color-muted-foreground)]">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
          "transition-colors duration-200 ease-in-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2",
          checked
            ? "bg-[var(--color-primary)]"
            : "bg-[var(--color-muted-foreground)]/30",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
            "transform transition-transform duration-200 ease-in-out",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </button>
    </label>
  );
}
```

### 6.3 Number Input with Stepper Buttons

**Current code**:
```tsx
<input type="number" value={stage.retryPolicy.maxRetries} ... />
```

**Replacement**:

```tsx
function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  label,
  unit,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
}) {
  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-medium text-[var(--color-foreground)]">
          {label}
        </label>
      )}
      <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] overflow-hidden">
        {/* Decrement */}
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
          className={cn(
            "flex h-9 w-9 items-center justify-center",
            "text-[var(--color-muted-foreground)]",
            "hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
            "transition-colors duration-100",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            "border-r border-[var(--color-border)]",
          )}
        >
          <Minus className="h-3 w-3" />
        </button>

        {/* Value display */}
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className={cn(
            "flex-1 h-9 text-center text-sm font-medium",
            "bg-transparent text-[var(--color-foreground)]",
            "outline-none border-none",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
          )}
        />

        {/* Unit */}
        {unit && (
          <span className="pr-2 text-xs text-[var(--color-muted-foreground)]">{unit}</span>
        )}

        {/* Increment */}
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
          className={cn(
            "flex h-9 w-9 items-center justify-center",
            "text-[var(--color-muted-foreground)]",
            "hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
            "transition-colors duration-100",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            "border-l border-[var(--color-border)]",
          )}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
```

### 6.4 Text Input with Floating Label

```tsx
function FloatingInput({
  value,
  onChange,
  label,
  placeholder,
  type = 'text',
  mono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  const hasValue = value.length > 0;

  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ' '}
        className={cn(
          "peer w-full rounded-lg border border-[var(--color-border)]",
          "bg-[var(--color-background)] px-3 pt-5 pb-2",
          "text-sm text-[var(--color-foreground)]",
          "placeholder:text-transparent",
          "transition-all duration-150",
          "focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20",
          "focus:outline-none",
          mono && "font-mono",
        )}
      />
      <label
        className={cn(
          "absolute left-3 top-1/2 -translate-y-1/2",
          "text-sm text-[var(--color-muted-foreground)]",
          "transition-all duration-200 ease-out",
          "pointer-events-none",
          // Float up when focused or has value
          "peer-focus:top-2 peer-focus:text-[10px] peer-focus:text-[var(--color-primary)]",
          hasValue && "top-2 text-[10px]",
        )}
      >
        {label}
      </label>
    </div>
  );
}
```

### 6.5 Segmented Control (for enum selections like Run Condition)

```tsx
function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className={cn(
      "flex rounded-lg border border-[var(--color-border)]",
      "bg-[var(--color-accent)]/50 p-0.5",
    )}>
      {options.map(option => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5",
            "rounded-md px-3 py-1.5 text-xs font-medium",
            "transition-all duration-150",
            option.value === value
              ? "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-sm"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

---

## 7. Node Design — StageNode

### Connection Handle Glow/Pulse on Hover

Add a CSS animation for handles when hovering to connect:

```tsx
{/* Input Handle (left) */}
<Handle
  type="target"
  position={Position.Left}
  className={cn(
    "!h-3 !w-3 !border-2",
    "!border-[var(--color-primary)] !bg-[var(--color-background)]",
    // Glow on parent hover
    "group-hover:!bg-[var(--color-primary)]/20",
    "group-hover:!shadow-[0_0_8px_var(--color-primary)]",
    // Pulse animation when React Flow is in connecting mode
    "connecting:!animate-pulse connecting:!bg-[var(--color-primary)]",
    // Smooth transitions
    "!transition-all !duration-200",
  )}
/>

{/* Output Handle (right) */}
<Handle
  type="source"
  position={Position.Right}
  className={cn(
    "!h-3 !w-3 !border-2",
    "!border-[var(--color-primary)] !bg-[var(--color-background)]",
    "group-hover:!bg-[var(--color-primary)]/20",
    "group-hover:!shadow-[0_0_8px_var(--color-primary)]",
    "!transition-all !duration-200",
  )}
/>
```

Add these CSS keyframes to your global stylesheet:

```css
/* Handle glow pulse — applied when React Flow is in connecting state */
.react-flow__handle.connecting,
.react-flow__handle-connecting {
  animation: handle-pulse 1.5s ease-in-out infinite;
}

@keyframes handle-pulse {
  0%, 100% {
    box-shadow: 0 0 4px var(--color-primary);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 12px var(--color-primary), 0 0 24px rgba(var(--color-primary-rgb), 0.3);
    transform: scale(1.3);
  }
}

/* Global handle hover enhancement */
.react-flow__handle:hover {
  transform: scale(1.4);
  box-shadow: 0 0 10px var(--color-primary);
  background-color: var(--color-primary) !important;
  border-color: var(--color-primary) !important;
  transition: all 0.15s ease-out;
}
```

### Node Entrance Animation

When a node is added to the canvas, animate it in:

```tsx
function StageNodeComponent({ id, data, selected }: NodeProps<Node<StageNodeData>>) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger entrance animation after mount
    requestAnimationFrame(() => setMounted(true));
  }, []);

  return (
    <div
      className={cn(
        // ...existing classes...
        // Entrance animation
        "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        mounted
          ? "opacity-100 scale-100 translate-y-0"
          : "opacity-0 scale-90 translate-y-2",
      )}
    >
      {/* ...node content... */}
    </div>
  );
}
```

### Node Selected State (enhanced)

```tsx
className={cn(
  // Base
  "group relative min-w-[240px] max-w-[320px] rounded-xl border-2 px-4 py-3",
  "bg-[var(--color-card)] text-[var(--color-card-foreground)]",
  // Transition
  "transition-all duration-200 ease-out",
  // Default state
  !selected && "border-[var(--color-border)] shadow-sm",
  !selected && "hover:border-[var(--color-primary)]/40 hover:shadow-md hover:-translate-y-0.5",
  // Selected state (n8n-style prominent ring)
  selected && "border-[var(--color-primary)] shadow-lg shadow-[var(--color-primary)]/10",
  selected && "ring-4 ring-[var(--color-primary)]/15",
)}
```

---

## 8. Edge Design — StageEdge

### Smooth Bezier Curves with Directional Arrows

**Current code** already uses `getBezierPath` with `curvature: 0.25` — good.

Add a directional arrowhead marker:

```tsx
{/* In DAGCanvas.tsx, add SVG defs for arrow markers */}
<ReactFlow
  ...
  defaultEdgeOptions={{
    type: 'stageEdge',
    animated: true,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 15,
      height: 15,
      color: 'var(--color-primary)',
    },
  }}
>
```

### Edge Animation — Flowing Dash Pattern

```tsx
<BaseEdge
  id={id}
  path={edgePath}
  markerEnd={markerEnd}
  style={{
    stroke: color,
    strokeWidth: selected ? 3 : 2,
    opacity: selected ? 1 : 0.7,
    strokeDasharray: selected ? 'none' : '8 4',
    strokeDashoffset: 0,
    animation: !selected ? 'edge-flow 1s linear infinite' : undefined,
    filter: selected ? `drop-shadow(0 0 4px ${color}40)` : undefined,
    transition: 'stroke-width 0.2s, opacity 0.2s, filter 0.2s',
  }}
/>
```

Add to global CSS:
```css
@keyframes edge-flow {
  to {
    stroke-dashoffset: -12;
  }
}
```

---

## 9. Empty States & Onboarding

### Canvas Empty State (when no nodes exist)

```tsx
<Panel position="top-center">
  <div className={cn(
    "mt-[20vh] flex flex-col items-center",
    "rounded-2xl border border-dashed border-[var(--color-border)]",
    "bg-[var(--color-card)]/95 backdrop-blur-sm",
    "px-12 py-10 text-center",
    "shadow-sm",
    // Entrance animation
    "animate-in fade-in-0 zoom-in-95 duration-500",
  )}>
    {/* Illustration / icon */}
    <div className={cn(
      "mb-4 flex h-16 w-16 items-center justify-center",
      "rounded-2xl bg-[var(--color-primary)]/10",
    )}>
      <Workflow className="h-8 w-8 text-[var(--color-primary)]" />
    </div>

    <h3 className="text-base font-semibold text-[var(--color-foreground)]">
      Build your workflow
    </h3>
    <p className="mt-2 max-w-[280px] text-sm text-[var(--color-muted-foreground)]">
      Add your first stage to start building an AI workflow pipeline
    </p>

    {/* Primary CTA */}
    <button
      onClick={handleAddStage}
      className={cn(
        "mt-5 flex items-center gap-2 rounded-lg",
        "bg-[var(--color-primary)] px-5 py-2.5",
        "text-sm font-medium text-[var(--color-primary-foreground)]",
        "shadow-md shadow-[var(--color-primary)]/20",
        "transition-all duration-200",
        "hover:shadow-lg hover:scale-[1.02]",
        "active:scale-[0.98]",
      )}
    >
      <Plus className="h-4 w-4" />
      Add First Stage
    </button>

    {/* Secondary hint */}
    <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
      or press <kbd className="rounded bg-[var(--color-accent)] px-1.5 py-0.5 font-mono text-[10px]">N</kbd> to quick-add
    </p>
  </div>
</Panel>
```

### Properties Panel Empty State

Already exists but should be enhanced:

```tsx
<div className="flex h-full flex-col items-center justify-center p-8 text-center">
  <div className={cn(
    "mb-4 flex h-14 w-14 items-center justify-center",
    "rounded-2xl bg-[var(--color-accent)]",
  )}>
    <MousePointer2 className="h-6 w-6 text-[var(--color-muted-foreground)]" />
  </div>
  <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
    No stage selected
  </h3>
  <p className="mt-1.5 max-w-[200px] text-xs leading-relaxed text-[var(--color-muted-foreground)]">
    Click a stage on the canvas to view and edit its properties
  </p>
</div>
```

---

## 10. Animation & Motion Reference

| Element | Animation | Duration | Easing | Trigger |
|---|---|---|---|---|
| Properties panel slide | `translateX(100%) → 0` + `opacity` | `300ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | Panel open/close |
| Node entrance | `scale(0.9) → 1` + `opacity` + `translateY(8px → 0)` | `300ms` | `cubic-bezier(0.16, 1, 0.3, 1)` | Node added |
| Node hover lift | `translateY(-2px)` + shadow increase | `200ms` | `ease-out` | Mouse enter |
| Handle glow pulse | `scale(1 → 1.3)` + box-shadow | `1500ms` | `ease-in-out` (infinite) | Connecting mode |
| Handle hover | `scale(1.4)` + glow | `150ms` | `ease-out` | Mouse enter handle |
| Edge flow | `stroke-dashoffset: 0 → -12` | `1000ms` | `linear` (infinite) | Always (animated edges) |
| Dropdown open | `scaleY(0.95 → 1)` + `opacity` + `translateY(-4px → 0)` | `150ms` | `ease-out` | Click trigger |
| Section collapse | `max-height` transition | `200ms` | `ease-out` | Toggle section |
| Add button press | `scale(0.97)` | `100ms` | `ease-out` | Active state |
| FitView zoom | React Flow `fitView` | `300ms` | Built-in | Auto-layout |
| Validation banner | `height(0 → auto)` + `opacity` | `200ms` | `ease-out` | Errors found |
| Toggle switch | `translateX` of knob | `200ms` | `ease-in-out` | Value change |
| Save success flash | `opacity(0 → 1 → 0)` | `3000ms` total | `ease-in-out` | After save |

---

## 11. Z-Index Map

Strict layering to prevent overlap:

| Layer | Z-Index | Elements |
|---|---|---|
| Canvas elements (nodes, edges) | `0` | React Flow default |
| Node action buttons | `5` | Duplicate, delete on node hover |
| Canvas controls (Controls, MiniMap) | `5` (RF Panel default) | React Flow `<Panel>` components |
| Add Stage button (bottom-center) | `5` (RF Panel default) | React Flow `<Panel position="bottom-center">` |
| Auto-layout button | `5` (RF Panel default) | React Flow `<Panel position="top-right">` |
| Empty state overlay | `5` (RF Panel default) | React Flow `<Panel position="top-center">` |
| Properties panel | `30` | Right sidebar |
| Toolbar | `40` | Top bar |
| Dropdown/popover menus | `50` | Select dropdowns, context menus |
| Modal overlays | `100` | ConfirmDialog, VariableInputModal |
| Toast notifications | `110` | Success/error toasts |

**Critical rule**: The "Add Stage" button MUST be a `<Panel>` component inside `<ReactFlow>`, NOT an absolutely-positioned element outside the ReactFlow tree. React Flow's Panel system uses CSS grid to avoid overlap between Controls, MiniMap, and custom Panels.

---

## 12. Responsive Breakpoints

| Breakpoint | Layout Changes |
|---|---|
| `< 640px` (sm) | Toolbar wraps to 2 rows; Panel becomes full-screen overlay; Canvas controls smaller |
| `640px–767px` (sm→md) | Toolbar single row with overflow menu; Panel full-screen overlay |
| `768px–1023px` (md→lg) | Panel slides in as 320px sidebar; Canvas shrinks |
| `1024px–1279px` (lg→xl) | Panel 320px sidebar; full toolbar |
| `1280px–1535px` (xl→2xl) | Panel 384px sidebar |
| `≥ 1536px` (2xl) | Panel 448px sidebar; comfortable canvas space |

### Mobile Panel (< 768px)
```tsx
/* On screens below md, render panel as a sheet overlay */
className={cn(
  // Mobile: full-screen overlay with backdrop
  "max-md:fixed max-md:inset-0 max-md:z-50",
  "max-md:bg-[var(--color-card)]",
  "max-md:animate-in max-md:slide-in-from-bottom",
  // Desktop: inline sidebar
  "md:relative md:border-l md:border-[var(--color-border)]",
  "md:w-80 xl:w-96",
)}
```

---

## 13. Keyboard Shortcuts Summary

| Shortcut | Action |
|---|---|
| `N` | Add new stage (focus must be on canvas) |
| `Delete` / `Backspace` | Remove selected node or edge |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save workflow |
| `Ctrl+D` | Duplicate selected stage |
| `Escape` | Deselect all / Close properties panel |
| `Space` (hold) | Pan canvas (hand tool) |
| `Ctrl+Shift+F` | Fit to view |
| `Ctrl+0` | Reset zoom to 100% |
| `Ctrl++` / `Ctrl+-` | Zoom in / out |

---

## 14. Implementation Checklist

### Priority 1 — Fix Overlap & Core Layout
- [ ] **Move "Add Stage" button** from absolute-positioned `<button>` in `WorkflowBuilderPage.tsx` to `<Panel position="bottom-center">` inside `DAGCanvas.tsx`
- [ ] Remove the `z-10` hack from the old FAB button
- [ ] Verify Controls (bottom-left) and MiniMap (bottom-right) don't conflict with any elements

### Priority 2 — Properties Panel Animation
- [ ] Replace conditional render with always-mounted panel + CSS transform animation
- [ ] Add `transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]` for slide-in
- [ ] Implement collapsible sections (`CollapsibleSection` component)
- [ ] Add header bar with stage name + icon + tab bar

### Priority 3 — Form Element Modernization
- [ ] Create `StyledSelect` component to replace all native `<select>` elements
- [ ] Create `ToggleSwitch` component to replace boolean `<input type="checkbox">`
- [ ] Create `NumberStepper` component for retry count, timeout, etc.
- [ ] Create `FloatingInput` component for text fields
- [ ] Create `SegmentedControl` for enum choices (run condition type)

### Priority 4 — Node & Edge Polish
- [ ] Add handle glow/pulse CSS animations
- [ ] Add node entrance animation (opacity + scale + translateY)
- [ ] Add node hover lift effect (`-translate-y-0.5`)
- [ ] Enhance selected state with `ring-4` glow
- [ ] Add `+` button on output handle (n8n pattern)
- [ ] Add directional arrow markers on edges
- [ ] Add edge flow animation (animated dash)

### Priority 5 — Empty States & Onboarding
- [ ] Enhance canvas empty state with illustration + CTA
- [ ] Enhance properties panel empty state
- [ ] Add `N` keyboard shortcut for quick-add

### Priority 6 — Responsive
- [ ] Add responsive width classes to properties panel
- [ ] Add mobile overlay mode for panel (< md breakpoint)
- [ ] Ensure toolbar doesn't overflow on small screens

---

## File Change Map

| File | Changes |
|---|---|
| `WorkflowBuilderPage.tsx` | Move "Add Stage" to canvas Panel; animate properties panel; responsive panel classes |
| `DAGCanvas.tsx` | Add `<Panel position="bottom-center">` for Add Stage; style Controls & MiniMap; add edge markers |
| `StageNode.tsx` | Handle glow CSS; entrance animation; hover lift; output handle `+` button |
| `StageEdge.tsx` | Arrow marker; flowing dash animation; enhanced selected state |
| `StagePropertiesPanel.tsx` | Collapsible sections; replace native selects/checkboxes/inputs; header redesign |
| `globals.css` (or equivalent) | `@keyframes handle-pulse`, `@keyframes edge-flow`, handle hover styles |
| New: `components/ui/StyledSelect.tsx` | Custom dropdown select |
| New: `components/ui/ToggleSwitch.tsx` | Toggle switch component |
| New: `components/ui/NumberStepper.tsx` | Number input with +/- |
| New: `components/ui/CollapsibleSection.tsx` | Accordion section wrapper |
| New: `components/ui/SegmentedControl.tsx` | Segmented button group |
