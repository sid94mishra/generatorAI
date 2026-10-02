export { DiffView, fontPinch, type DiffFile, type DiffViewProps } from './DiffView';
export { useFilePatch, useReviewThreads, type NewThreadInput, type ReviewScope, type ReviewThreadsApi } from './DiffView.queries';
export { diffItems, fileNeighbours, openThreadCounts, type DiffItem, type LineAnchor } from './model/diffItems';
export * from './model/diffModel';
export { getDiffPrefs, setDiffFontSize, setDiffLayout, setDiffWrap, useDiffPrefs, type DiffPrefs } from './model/diffPrefs';
export * from './model/reviewBatch';
