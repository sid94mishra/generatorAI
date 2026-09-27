// ────────────────────────────────────────────────────────────────
// B-04 SourcePicker — "what should this chat work on?" (03-domain B-04).
//
// One editor, several hosts: the NewChat dialog, ChatCreatePage
// (`features/chats/create`), and "Edit sources…" on a live chat
// (`features/chat/sources/EditSourcesDialog.tsx`). All produce the same
// `ChatSourceSpec[]` + primary alias via `model.ts`'s `draftsToSources`.
// ────────────────────────────────────────────────────────────────

export { SourcePicker, type SourcePickerProps } from './SourcePicker.js';
export * from './model.js';
