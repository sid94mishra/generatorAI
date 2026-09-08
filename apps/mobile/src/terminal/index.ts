// ────────────────────────────────────────────────────────────────
// Terminal — public surface.
//
// `terminalHtml.ts` and `xtermBundle.generated.ts` are deliberately NOT
// re-exported: the vendored renderer is loaded lazily by `TerminalView`
// and must stay off every screen's static import graph.
// ────────────────────────────────────────────────────────────────

export { TerminalView, type TerminalViewProps, type ConnectionState } from './TerminalView';
export { TerminalTabs, MAX_TERMINAL_TABS } from './TerminalTabs';
export { AgentConsole } from './AgentConsole';
export {
  agentConsoleRows,
  rowFromToolCall,
  isShellTool,
  MAX_OUTPUT_CHARS,
  type AgentConsoleRow,
} from './agentConsoleRows';
export {
  OutputBatcher,
  parseFromWebView,
  splitBatch,
  isOpenableLink,
  type ToWebView,
  type FromWebView,
} from './bridgeProtocol';
