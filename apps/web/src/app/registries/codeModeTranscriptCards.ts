// The `run_code` tool card (code mode, D-182): drawn under the step row by
// blocks/transcript StepList through its tool-card registry (D-35). Loaded
// with the chat route and the workflow routes (a stage transcript shows the
// same card), like workflowTranscriptCards.

import { registerToolCard, RUN_CODE_TOOL_CARD } from '@/blocks/transcript/index.js';

registerToolCard(RUN_CODE_TOOL_CARD);
