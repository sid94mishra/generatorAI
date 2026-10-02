// lucide glyph for EVERY concept: the iOS fallback (no SymbolModule in the client, or a release-build SF miss), Jest and the web preview. Android never imports it.
// Static map so Metro bundles only these files (mobile 02 §5.2); `lucide.test.ts` keeps it in step with the registry.
import LHome from 'lucide-react-native/icons/house';
import LChats from 'lucide-react-native/icons/message-square';
import LProjects from 'lucide-react-native/icons/folder';
import LAgents from 'lucide-react-native/icons/bot';
import LWorkflows from 'lucide-react-native/icons/workflow';
import LAutomations from 'lucide-react-native/icons/calendar-clock';
import LScripts from 'lucide-react-native/icons/file-code-corner';
import LSettings from 'lucide-react-native/icons/settings';
import LSearch from 'lucide-react-native/icons/search';
import LPlus from 'lucide-react-native/icons/plus';
import LMore from 'lucide-react-native/icons/ellipsis';
import LX from 'lucide-react-native/icons/x';
import LCheck from 'lucide-react-native/icons/check';
import LEdit from 'lucide-react-native/icons/pencil';
import LTrash from 'lucide-react-native/icons/trash';
import LCopy from 'lucide-react-native/icons/copy';
import LChanges from 'lucide-react-native/icons/git-compare';
import LFiles from 'lucide-react-native/icons/files';
import LTerminal from 'lucide-react-native/icons/square-terminal';
import LBrowser from 'lucide-react-native/icons/globe';
import LTasks from 'lucide-react-native/icons/list-tree';
import LComputer from 'lucide-react-native/icons/monitor';
import LPlan from 'lucide-react-native/icons/list-checks';
import LWidgets from 'lucide-react-native/icons/layout-grid';
import LBranch from 'lucide-react-native/icons/git-branch';
import LCommit from 'lucide-react-native/icons/git-commit-horizontal';
import LPr from 'lucide-react-native/icons/git-pull-request';
import LDiff from 'lucide-react-native/icons/file-diff';
import LHistory from 'lucide-react-native/icons/rotate-ccw-clock';
import LPlay from 'lucide-react-native/icons/play';
import LStop from 'lucide-react-native/icons/square';
import LRetry from 'lucide-react-native/icons/rotate-ccw';
import LSend from 'lucide-react-native/icons/arrow-up';
import LAttach from 'lucide-react-native/icons/paperclip';
import LMic from 'lucide-react-native/icons/mic';
import LSkills from 'lucide-react-native/icons/book-open';
import LMcp from 'lucide-react-native/icons/plug';
import LHook from 'lucide-react-native/icons/anchor';
import LVariable from 'lucide-react-native/icons/variable';
import LWebhook from 'lucide-react-native/icons/webhook';
import LClock from 'lucide-react-native/icons/clock';
import LServer from 'lucide-react-native/icons/server';
import LLock from 'lucide-react-native/icons/lock';
import LKey from 'lucide-react-native/icons/key-round';
import LBell from 'lucide-react-native/icons/bell';
import LInfo from 'lucide-react-native/icons/info';
import LWarning from 'lucide-react-native/icons/triangle-alert';
import LHand from 'lucide-react-native/icons/hand';
import LStatusQueued from 'lucide-react-native/icons/circle-dashed';
import LStatusRunning from 'lucide-react-native/icons/loader-circle';
import LStatusWaiting from 'lucide-react-native/icons/clock';
import LStatusNeedsYou from 'lucide-react-native/icons/hand';
import LStatusPaused from 'lucide-react-native/icons/circle-pause';
import LStatusSucceeded from 'lucide-react-native/icons/circle-check';
import LStatusFailed from 'lucide-react-native/icons/circle-x';
import LStatusSkipped from 'lucide-react-native/icons/circle-minus';
import LChevronDown from 'lucide-react-native/icons/chevron-down';
import LChevronRight from 'lucide-react-native/icons/chevron-right';
import LChevronUp from 'lucide-react-native/icons/chevron-up';
import LChevronLeft from 'lucide-react-native/icons/chevron-left';
import LSidebar from 'lucide-react-native/icons/panel-left';
import LDock from 'lucide-react-native/icons/panel-right';
import LMaximize from 'lucide-react-native/icons/maximize-2';
import LShield from 'lucide-react-native/icons/shield-check';
import LFile from 'lucide-react-native/icons/file';
import LFolderOpen from 'lucide-react-native/icons/folder-open';
import LFileText from 'lucide-react-native/icons/file-text';
import LRefresh from 'lucide-react-native/icons/refresh-cw';
import LForward from 'lucide-react-native/icons/arrow-right';
import LBack from 'lucide-react-native/icons/arrow-left';
import LUndo from 'lucide-react-native/icons/undo-2';
import LRedo from 'lucide-react-native/icons/redo-2';
import LRestart from 'lucide-react-native/icons/rotate-cw';
import LView from 'lucide-react-native/icons/eye';
import LUpload from 'lucide-react-native/icons/upload';
import LDownload from 'lucide-react-native/icons/download';
import LSave from 'lucide-react-native/icons/save';
import LTool from 'lucide-react-native/icons/wrench';
import LScan from 'lucide-react-native/icons/scan';
import LExternalLink from 'lucide-react-native/icons/external-link';
import LModel from 'lucide-react-native/icons/cpu';
import LMessage from 'lucide-react-native/icons/message-square-text';
import LPointer from 'lucide-react-native/icons/mouse-pointer-2';
import LZoomIn from 'lucide-react-native/icons/zoom-in';
import LZoomOut from 'lucide-react-native/icons/zoom-out';
import LLayers from 'lucide-react-native/icons/layers';
import LArchive from 'lucide-react-native/icons/archive';
import LUsers from 'lucide-react-native/icons/users';
import LCalendar from 'lucide-react-native/icons/calendar';
import LSort from 'lucide-react-native/icons/arrow-up-down';
import LLink from 'lucide-react-native/icons/link';
import LCamera from 'lucide-react-native/icons/camera';
import LList from 'lucide-react-native/icons/list';
import LDatabase from 'lucide-react-native/icons/database';
import LActivity from 'lucide-react-native/icons/activity';
import LZap from 'lucide-react-native/icons/zap';
import LPause from 'lucide-react-native/icons/pause';
import LTag from 'lucide-react-native/icons/tag';
import LUser from 'lucide-react-native/icons/user';
import LDevice from 'lucide-react-native/icons/smartphone';
import LModeLight from 'lucide-react-native/icons/sun';
import LModeDark from 'lucide-react-native/icons/moon';
import LModeSystem from 'lucide-react-native/icons/monitor';
import LPower from 'lucide-react-native/icons/power';
import LMoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import LMinus from 'lucide-react-native/icons/minus';
import LMention from 'lucide-react-native/icons/at-sign';
import LPin from 'lucide-react-native/icons/pin';
import LKeyboard from 'lucide-react-native/icons/keyboard';
import LLoader from 'lucide-react-native/icons/loader-circle';
import LThink from 'lucide-react-native/icons/brain';
import LImage from 'lucide-react-native/icons/image';
import LExpandAll from 'lucide-react-native/icons/chevrons-up-down';
import LCollapseAll from 'lucide-react-native/icons/chevrons-down-up';
import LRepeat from 'lucide-react-native/icons/repeat';
import LHourglass from 'lucide-react-native/icons/hourglass';
import LLayout from 'lucide-react-native/icons/layout-grid';
import LGroup from 'lucide-react-native/icons/group';
import LUngroup from 'lucide-react-native/icons/ungroup';
import LBraces from 'lucide-react-native/icons/braces';
import LWand from 'lucide-react-native/icons/wand-sparkles';
import LWrap from 'lucide-react-native/icons/text-wrap';

export const LUCIDE_ALL = {
  'home': LHome,
  'chats': LChats,
  'projects': LProjects,
  'agents': LAgents,
  'workflows': LWorkflows,
  'automations': LAutomations,
  'scripts': LScripts,
  'settings': LSettings,
  'search': LSearch,
  'plus': LPlus,
  'more': LMore,
  'x': LX,
  'check': LCheck,
  'edit': LEdit,
  'trash': LTrash,
  'copy': LCopy,
  'changes': LChanges,
  'files': LFiles,
  'terminal': LTerminal,
  'browser': LBrowser,
  'tasks': LTasks,
  'computer': LComputer,
  'plan': LPlan,
  'widgets': LWidgets,
  'branch': LBranch,
  'commit': LCommit,
  'pr': LPr,
  'diff': LDiff,
  'history': LHistory,
  'play': LPlay,
  'stop': LStop,
  'retry': LRetry,
  'send': LSend,
  'attach': LAttach,
  'mic': LMic,
  'skills': LSkills,
  'mcp': LMcp,
  'hook': LHook,
  'variable': LVariable,
  'webhook': LWebhook,
  'clock': LClock,
  'server': LServer,
  'lock': LLock,
  'key': LKey,
  'bell': LBell,
  'info': LInfo,
  'warning': LWarning,
  'hand': LHand,
  'status-queued': LStatusQueued,
  'status-running': LStatusRunning,
  'status-waiting': LStatusWaiting,
  'status-needs-you': LStatusNeedsYou,
  'status-paused': LStatusPaused,
  'status-succeeded': LStatusSucceeded,
  'status-failed': LStatusFailed,
  'status-skipped': LStatusSkipped,
  'chevron-down': LChevronDown,
  'chevron-right': LChevronRight,
  'chevron-up': LChevronUp,
  'chevron-left': LChevronLeft,
  'sidebar': LSidebar,
  'dock': LDock,
  'maximize': LMaximize,
  'shield': LShield,
  'file': LFile,
  'folder-open': LFolderOpen,
  'file-text': LFileText,
  'refresh': LRefresh,
  'forward': LForward,
  'back': LBack,
  'undo': LUndo,
  'redo': LRedo,
  'restart': LRestart,
  'view': LView,
  'upload': LUpload,
  'download': LDownload,
  'save': LSave,
  'tool': LTool,
  'scan': LScan,
  'external-link': LExternalLink,
  'model': LModel,
  'message': LMessage,
  'pointer': LPointer,
  'zoom-in': LZoomIn,
  'zoom-out': LZoomOut,
  'layers': LLayers,
  'archive': LArchive,
  'users': LUsers,
  'calendar': LCalendar,
  'sort': LSort,
  'link': LLink,
  'camera': LCamera,
  'list': LList,
  'database': LDatabase,
  'activity': LActivity,
  'zap': LZap,
  'pause': LPause,
  'tag': LTag,
  'user': LUser,
  'device': LDevice,
  'mode-light': LModeLight,
  'mode-dark': LModeDark,
  'mode-system': LModeSystem,
  'power': LPower,
  'more-vertical': LMoreVertical,
  'minus': LMinus,
  'mention': LMention,
  'pin': LPin,
  'keyboard': LKeyboard,
  'loader': LLoader,
  'think': LThink,
  'image': LImage,
  'expand-all': LExpandAll,
  'collapse-all': LCollapseAll,
  'repeat': LRepeat,
  'hourglass': LHourglass,
  'layout': LLayout,
  'group': LGroup,
  'ungroup': LUngroup,
  'braces': LBraces,
  'wand': LWand,
  'wrap': LWrap,
} as const;
