# Screenshot evidence

Captures preserve the audit sequence, including initial defects, work in progress and successful retests. See [the audit report](../REPORT.md) for the verified outcome of each journey and [the gallery](../gallery.html) for browsing. A screenshot proves a visible state, not that every control on the page passed.

Most screenshots have a JSON sidecar with route, viewport/DPR, document overflow, and scroll-container measurements. Early screenshots used renderer capture. Later screenshots use native Electron `BrowserWindow.capturePage` after disabling device emulation, so native browser surfaces and terminal scale are represented correctly. Native tests primarily used 1280 × 800 and 860 × 600 windows, DPR 2.

The gallery omits these misleading or incomplete technical captures, which remain here for provenance:

- `20-agents-narrow`: the name is misleading; the actual viewport was 1440 px.
- `38-terminal-command`, `40-terminal-native-scale`, `41-terminal-detail`, `41-terminal-server`, `42-terminal-native`: terminal/native surface captures affected by device emulation. Use `89-terminal-native` and `90-terminal-find` instead.
- `45-native-window`: native capture taken before resize settled; clipped.
- `84-brownfield-chat-completed`: also caught a loading state; use `85-chat-files` and subsequent brownfield/review captures.
- `66-completed-workflow-replay`: captured a loading state, not proof of completion. Use `128-completed-three-stage-workflow`.

Screens 104–105 include the widget's initial failure/empty states; 109–110, 117 and 121–124 document successful rendering, interaction, restart recovery and final responsive design. Screens 18–19 show earlier agent forms; 126–127 show corrected provider/model behavior and scroll ownership. Early upload screenshots alone do not prove capability delivery; 97–98 and 108/113 show actual skill consumption.

The generated release console and designer content are audit fixtures, not GeneratorAI's own product pages. In particular, the generated widget's inner HTML can still scroll horizontally at a narrow preview width; the surrounding extension controls were redesigned and retested separately.

The gap follow-up adds native captures from 136 onward. These include file recovery, real two-editor conflict recovery, successful CSV import, keyboard review, loop/scheduled batch runs, agent export and plain uploads. Screenshot 157 deliberately preserves a provider error incorrectly labelled Completed before the fix; 160–162 and 168–170 show successful reruns. Screenshot 163 is the earlier missing-upload/partial-answer state; 165 shows the corrected completed result. Screens 166–167 retain the existing pointer interaction. See [the follow-up report](../GAPS-FOLLOWUP.md) for the scope and remaining gaps.
