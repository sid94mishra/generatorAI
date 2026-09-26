// blocks/composer — the chat composer (03 §3.2) and its extension point.
export { Composer, type ComposerProps } from './Composer.js';
export type { ComposerAttachment, CaptureSource } from './model/types.js';
export type { PromptHistoryEntry, HistoryAttachment } from './model/promptHistory.js';
export {
  registerComposerTool,
  listComposerTools,
  useComposerTools,
  type ComposerToolEntry,
  type ComposerToolChat,
  type ComposerToolState,
} from './toolToggles.js';
