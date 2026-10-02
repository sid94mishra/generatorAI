// The terminal tab (MB-27). `./engine/terminalHtml` and `./engine/xtermBundle.generated` are deliberately not
// exported: the vendored renderer is loaded lazily by TerminalView and stays off every static import graph.
export { TerminalPanel, type TerminalPanelProps } from './TerminalPanel';
export { TerminalView, type ConnectionState, type TerminalViewProps } from './TerminalView';
export { KeyRow, type KeyRowProps } from './KeyRow';
export { AgentCommands } from './AgentCommands';
export * from './model/keyRow';
export { agentConsoleRows, isShellTool, rowFromToolCall, type AgentConsoleRow } from './engine/agentConsoleRows';
