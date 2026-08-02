Based on my analysis of the `UI_REDESIGN_PLAN.md` and the current `apps/web/src` structure, here's a comprehensive list of all files that need modification for the full UI redesign:

## **UI Redesign Implementation File List**

### **📋 Phase 1: Foundation - Color System & Typography**

#### [apps/web/src/styles/globals.css](apps/web/src/styles/globals.css)
- Add new CSS variables for all light mode colors (bg-*, fg-*, brand-*, accent-*, status colors)
- Add dark mode color variables (`.dark` class)
- Add canvas and special colors
- Update typography scale (display, heading, body, caption sizes)
- Define spacing utility scale (4px, 8px, 12px, 16px, etc.)
- Add interactive state variables (hover-opacity, active-opacity, focus-glow)   

#### [apps/web/src/styles/animations.css](apps/web/src/styles/animations.css) **[NEW]**
- Define keyframes for spinner rotation (1.2s linear)
- Create skeleton pulse animation (1s fade)
- Add transition utilities for 150ms/200ms easing
- Add scale/lift animations for button/card hover states
- Define bounce animation for dot pulse loading
- Add pulsing animation for status badges

---

### **🎨 Phase 2: Generic UI Components (Create new or heavily modify)**        

#### [apps/web/src/components/common/Button.tsx](apps/web/src/components/common/Button.tsx) **[NEW]**
- Implement variants: `primary` (glassmorphic), `secondary` (outlined), `ghost`, `danger`
- Add sizes: `xs` (28px), `sm` (32px), `md` (40px), `lg` (48px), `xl` (56px)    
- Implement loading state with spinner
- Add disabled state styling
- Add icon positioning (left/right)
- Apply shadow effects and hover/active transitions

#### [apps/web/src/components/common/Input.tsx](apps/web/src/components/common/Input.tsx) **[NEW]**
- Create standard input field with height 40px
- Add focus state with 2px outline + shadow
- Implement error state (red border + error icon)
- Add success state (green border + checkmark)
- Support sizes: `sm` (32px), `md` (40px), `lg` (48px)
- Add label styling above input

#### [apps/web/src/components/common/Card.tsx](apps/web/src/components/common/Card.tsx) **[NEW]**
- Implement variants: `standard` (glass), `interactive` (clickable), `surface` (page-level), `status`, `gradient`
- Add hover lift effect (box-shadow increase)
- Apply border and rounded styling (12px)
- Add padding variations (16px for standard, 24px for surface)

#### [apps/web/src/components/common/Modal.tsx](apps/web/src/components/common/Modal.tsx) **[NEW]**
- Create modal overlay with backdrop blur (4px)
- Design modal dialog container (max-width 600px/800px, rounded 16px)
- Implement modal header with close button and divider
- Create modal body with scrollable content
- Add modal footer with action buttons
- Add fade-in animation (150ms) and slide-up animation (200ms)

#### [apps/web/src/components/common/Dropdown.tsx](apps/web/src/components/common/Dropdown.tsx) **[NEW]**
- Create dropdown menu container with shadow and border
- Implement dropdown items (40px height, hover state)
- Add separators between item groups
- Support submenu (nested items)
- Add keyboard navigation (arrows, enter, escape)
- Implement disabled item styles

#### [apps/web/src/components/common/Spinner.tsx](apps/web/src/components/common/Spinner.tsx) **[NEW]**
- Implement circular spinner (SVG, --brand-primary color)
- Add sizes: `sm` (16px), `md` (24px), `lg` (32px)
- Create skeleton variant (pulse effect)
- Add progress bar variant (linear)
- Implement dot-pulse loading (3 bouncing dots)
- Add loading label with optional status text

#### [apps/web/src/components/common/Upload.tsx](apps/web/src/components/common/Upload.tsx) **[NEW]**
- Create drag-and-drop upload area with dashed border
- Add hover/drag-over states with visual feedback
- Implement progress bar during upload
- Add success/error state displays
- Create uploaded files list with remove buttons
- Add file type validation

#### [apps/web/src/components/common/Icon.tsx](apps/web/src/components/common/Icon.tsx) **[NEW]**
- Wrap Lucide React icons with color/size mapping
- Implement icon sizes: `xs` (12px), `sm` (16px), `md` (20px), `lg` (24px), `xl` (32px), `2xl` (48px)
- Add color variants: `primary`, `secondary`, `success`, `warning`, `destructive`
- Create animation helpers for loading/pulse/bounce

---

### **🏗️ Phase 3: Layout Components**

#### [apps/web/src/components/layout/Header.tsx](apps/web/src/components/layout/Header.tsx)
- Redesign to 64px fixed sticky height
- Add hamburger menu toggle (left side)
- Implement app logo/icon (32px)
- Add breadcrumb trail or page title
- Add command palette trigger (Cmd+K)
- Add notification bell (right side, with badge)
- Add quick actions dropdown
- Add user profile menu
- Add theme toggle (sun/moon icon)
- Implement glass background or solid --bg-secondary
- Add subtle bottom border and shadow on scroll

#### [apps/web/src/components/layout/Sidebar.tsx](apps/web/src/components/layout/Sidebar.tsx)
- Redesign to 260px width (collapsible on mobile)
- Apply glass morphism styling (--bg-glass with border)
- Reorganize menu structure into groups: WORKSPACE, CREATIVITY, MANAGE, MORE    
- Add quick jump command search at top
- Implement active state styling (--brand-primary-outline background)
- Add icon styling (20px, Lucide React)
- Implement smooth transitions (200ms) on state changes
- Add user profile section at bottom

#### [apps/web/src/components/layout/AppLayout.tsx](apps/web/src/components/layout/AppLayout.tsx)
- Update main content area padding (24px desktop, 16px mobile)
- Implement responsive grid layout (12-column grid)
- Add sticky header on scroll
- Implement main content max-width container (1400px for XL screens)
- Add bottom safe area padding (48px)
- Support collapsible sidebar on tablet/mobile

#### [apps/web/src/components/layout/Breadcrumb.tsx](apps/web/src/components/layout/Breadcrumb.tsx)
- Update styling to use new color variables
- Implement responsive sizing (smaller on mobile)
- Add proper separator styling

---

### **💬 Phase 4: Chat Components**

#### [apps/web/src/components/chat/ChatInput.tsx](apps/web/src/components/chat/ChatInput.tsx)
- Redesign input area with sticky bottom positioning
- Apply gradient background (--bg-primary to --bg-secondary)
- Implement text input with max-height scrolling (200px max)
- Add attachment button (paperclip icon, left side)
- Add send button (right side, --brand-primary when enabled)
- Implement focus state with border highlight
- Add keyboard support (Shift+Enter for new line, Enter to send)
- Apply proper padding and spacing

#### [apps/web/src/components/chat/ChatMessageList.tsx](apps/web/src/components/chat/ChatMessageList.tsx)
- Update message styling with new color scheme
- Implement proper spacing between messages (16px)
- Add hover effects for message actions
- Update font sizes and line-heights from new typography scale

#### [apps/web/src/components/chat/StreamingMessage.tsx](apps/web/src/components/chat/StreamingMessage.tsx)
- Update styling for streaming message bubble
- Implement loading animation (dot pulse)
- Apply new background/text colors

#### [apps/web/src/components/chat/ChatMessageList.tsx](apps/web/src/components/chat/ChatMessageList.tsx)
- Update all message components (SystemMessage, AssistantMessage, UserMessage, ToolMessage)
- Apply consistent message bubble styling

---

### **⚙️ Phase 5: Workflow Canvas Components**

#### [apps/web/src/components/workflow/StageNode.tsx](apps/web/src/components/workflow/StageNode.tsx)
- Redesign to glassmorphic style (--bg-glass with 12px border-radius)
- Update size to 180px × 100px
- Implement hover state (scale 1.02, lifted shadow)
- Add selected state (--brand-primary border, glow effect)
- Update icon styling (20px, left-aligned)
- Add stage name text (Body S, semi-bold)
- Implement template type badge (--brand-primary-light background)
- Add status indicator with status-appropriate colors
- Implement connection handles (blue for input, green for output)
- Add editing mode with inline input field

#### [apps/web/src/components/workflow/StageEdge.tsx](apps/web/src/components/workflow/StageEdge.tsx)
- Update edge color to --brand-primary (2px stroke)
- Implement smooth bezier curve
- Add arrow endpoint
- Implement hover state (3px stroke, highlighted)
- Add animated dashes for runtime execution
- Update selected state with glow effect

#### [apps/web/src/components/workflow/RuntimeStageNode.tsx](apps/web/src/components/workflow/RuntimeStageNode.tsx)
- Apply same styling as StageNode
- Add runtime-specific status coloring
- Implement pulse animation during execution
- Add completion checkmark overlay

#### [apps/web/src/components/workflow/RuntimeStageEdge.tsx](apps/web/src/components/workflow/RuntimeStageEdge.tsx)
- Same as StageEdge but with status-based coloring during runtime

#### [apps/web/src/components/workflow/DAGCanvas.tsx](apps/web/src/components/workflow/DAGCanvas.tsx)
- Update canvas background to --canvas-bg
- Implement subtle grid dots (--canvas-grid color)
- Add mini-map in top-right corner
- Update React Flow styling
- Implement proper zoom/pan controls

#### [apps/web/src/components/workflow/RuntimeDAGCanvas.tsx](apps/web/src/components/workflow/RuntimeDAGCanvas.tsx)
- Similar updates to DAGCanvas but with runtime-specific styling

#### [apps/web/src/components/workflow/RunTimeline.tsx](apps/web/src/components/workflow/RunTimeline.tsx)
- Redesign as vertical scrollable stack (--bg-secondary background)
- Implement timeline entries with vertical left line (status-colored)
- Add timeline dots (12px, status-colored)
- Add pulse animation for running stages
- Implement entry content (stage name, status badge, timestamp)
- Add expandable details section with output preview
- Implement error display with red background
- Add logs section (scrollable, monospace font)
- Add copy button for logs

#### [apps/web/src/components/workflow/StagePropertiesPanel.tsx](apps/web/src/components/workflow/StagePropertiesPanel.tsx)
- Update styling to use new color variables
- Implement right-side panel styling (380px fixed or collapsed)
- Update form controls styling

#### [apps/web/src/components/workflow/RunStatusBadge.tsx](apps/web/src/components/workflow/RunStatusBadge.tsx)
- Update status badge colors (running=yellow, success=green, error=red, pending=gray)
- Implement pulse animation for running state

---

### **📁 Phase 6: Specialized Components**

#### [apps/web/src/components/Skeleton.tsx](apps/web/src/components/Skeleton.tsx)
- Update skeleton styling with new pulse animation
- Apply --border-primary background color
- Update rounded corners (match element shape)

#### [apps/web/src/components/Tooltip.tsx](apps/web/src/components/Tooltip.tsx) 
- Update background to --bg-secondary
- Add border: 1px --border-primary
- Implement shadow: 0 4px 12px rgba(0,0,0,0.12)
- Update text color to --fg-primary

#### [apps/web/src/components/ConfirmDialog.tsx](apps/web/src/components/ConfirmDialog.tsx)
- Update to use new Modal component styling
- Add icon styling for confirmation state
- Update button styling (primary/ghost variants)

#### [apps/web/src/components/ErrorBoundary.tsx](apps/web/src/components/ErrorBoundary.tsx)
- Update error display styling with new colors
- Add Card component for error container

---

### **📄 Phase 7: Page Components**

#### All page components in [apps/web/src/pages/](apps/web/src/pages/)
The following pages should be updated to use new components and spacing:        
- **[DashboardPage.tsx](apps/web/src/pages/DashboardPage.tsx)** - Update status cards, layout spacing
- **[ChatPage.tsx](apps/web/src/pages/ChatPage.tsx)** - Update ChatInput, ChatMessageList styling
- **[ChatsListPage.tsx](apps/web/src/pages/ChatsListPage.tsx)** - Update card styling, spacing
- **[WorkflowBuilderPage.tsx](apps/web/src/pages/WorkflowBuilderPage.tsx)** - Update DAGCanvas, toolbar styling, right panel
- **[WorkflowListPage.tsx](apps/web/src/pages/WorkflowListPage.tsx)** - Update workflow card styling
- **[WorkflowRunPage.tsx](apps/web/src/pages/WorkflowRunPage.tsx)** - Update RunTimeline, RunStatusBadge
- **[AutomationsPage.tsx](apps/web/src/pages/AutomationsPage.tsx)** - Update list styling, filters
- **[CreateAutomationPage.tsx](apps/web/src/pages/CreateAutomationPage.tsx)** - Update form styling
- **[TemplateExplorer.tsx](apps/web/src/pages/TemplateExplorer.tsx)** - Update template cards, grid layout
- **[Settings.tsx](apps/web/src/pages/Settings.tsx)** - Update form styling, sections

---

### **🔧 Configuration & Utilities**

#### [apps/web/src/App.tsx](apps/web/src/App.tsx)
- Update root element styling
- Ensure theme provider is set up correctly for dark mode toggle

#### Tailwind Configuration Updates **(if applicable)**
- Extend color palette with new design token variables
- Update typography scales
- Add animation/transition presets

---

## **Summary Table**

| Category | File Count | Status |
|----------|-----------|--------|
| Styles | 2 files | Create globals.css vars + new animations.css |
| Generic UI Components | 8 files | Create all common components |
| Layout | 4 files | Modify existing layout components |
| Chat Components | 5 files | Modify existing chat components |
| Workflow Components | 10 files | Modify canvas, nodes, edges, timeline |      
| Other Components | 4 files | Modify Skeleton, Tooltip, ConfirmDialog, ErrorBoundary |
| Pages | 10 files | Update all pages to use new styling |
| **TOTAL** | **~43 files** | **NEW: 8, MODIFY: 35** |

---

**Key Implementation Priority:**
1. **First:** Setup color variables and typography in globals.css
2. **Second:** Create generic UI components (Button, Input, Card, Modal, Spinner)
3. **Third:** Redesign layout components (Header, Sidebar, AppLayout)
4. **Fourth:** Update workflow and chat components
5. **Fifth:** Refresh all page components to use new styled components