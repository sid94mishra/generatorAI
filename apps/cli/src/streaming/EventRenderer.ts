// EventRenderer — Renders streamed PersistedEvent data to the terminal.
// Handles token streaming, tool call display, usage stats, thinking indicators.
// Filters out internal turns (hook context injection, validation feedback).

import chalk from 'chalk';
import type { PersistedEvent } from '@generatorai/shared';
import { formatDuration } from '../utils/formatDuration.js';

export type StreamVerbosity = 'minimal' | 'normal' | 'verbose';

export interface EventRendererOptions {
  verbosity: StreamVerbosity;
  showThinking?: boolean;
  showToolCalls?: boolean;
  showUsage?: boolean;
  onComplete?: () => void;
}

interface RenderState {
  isStreaming: boolean;
  currentContent: string;
  tokenCount: number;
  activeTools: Map<string, { tool: string; startTime: number }>;
  turnId?: string;
  hasOutput: boolean;
  /** True when the current turn is internal (hook context, validation feedback) */
  isInternalTurn: boolean;
  /** Track current stage for labeling */
  currentStageName?: string;
}

export class EventRenderer {
  private state: RenderState;
  private readonly opts: Required<EventRendererOptions>;

  constructor(options: EventRendererOptions) {
    this.opts = {
      verbosity: options.verbosity,
      showThinking: options.showThinking ?? (options.verbosity !== 'minimal'),
      showToolCalls: options.showToolCalls ?? true,
      showUsage: options.showUsage ?? (options.verbosity !== 'minimal'),
      onComplete: options.onComplete ?? (() => {}),
    };

    this.state = {
      isStreaming: false,
      currentContent: '',
      tokenCount: 0,
      activeTools: new Map(),
      hasOutput: false,
      isInternalTurn: false,
    };
  }

  /** Process a single event and render to terminal */
  handleEvent(event: PersistedEvent): void {
    const kind = event.kind;
    const data = event.data as Record<string, unknown>;
    const isInternal = !!data['__isInternalTurn'];

    switch (kind) {
      case 'harness.turn_start':
        this.state.turnId = data['turnId'] as string | undefined;
        this.state.isInternalTurn = isInternal;
        break;

      case 'harness.user_message':
        // User message already shown by CLI; skip internal turns
        break;

      case 'harness.token':
        if (this.state.isInternalTurn || isInternal) break;
        this.handleToken(data['text'] as string);
        break;

      case 'harness.reasoning_delta':
        if (this.state.isInternalTurn || isInternal) break;
        if (this.opts.showThinking) {
          this.handleThinking(data['text'] as string);
        }
        break;

      case 'harness.tool_start':
        if (this.state.isInternalTurn || isInternal) break;
        if (this.opts.showToolCalls) {
          this.handleToolStart(data);
        }
        break;

      case 'harness.tool_complete':
        if (this.state.isInternalTurn || isInternal) break;
        if (this.opts.showToolCalls) {
          this.handleToolComplete(data);
        }
        break;

      case 'harness.message_complete':
        if (this.state.isInternalTurn || isInternal) break;
        this.handleMessageComplete(data['content'] as string);
        break;

      case 'harness.usage':
        if (this.state.isInternalTurn || isInternal) break;
        if (this.opts.showUsage) {
          this.handleUsage(data);
        }
        break;

      case 'harness.error':
        this.handleError(data['message'] as string);
        break;

      case 'harness.idle':
        if (this.state.isInternalTurn || isInternal) break;
        this.handleIdle();
        break;

      case 'harness.turn_end':
        this.state.isInternalTurn = false;
        this.handleTurnEnd();
        break;

      case 'stage_run.awaiting_input':
        this.handleHITLPrompt(data);
        break;

      default: {
        // Stage/workflow lifecycle events (not in PersistedEvent union — use string match)
        const kindStr = kind as string;
        if (kindStr === 'stage_run.running') {
          this.handleStageStarted(data);
        } else if (kindStr === 'stage_run.step_started') {
          this.handleStepStarted(data);
        } else if (kindStr === 'stage_run.completed') {
          this.handleStageCompleted(data);
        } else if (kindStr === 'stage_run.failed') {
          this.handleStageFailed(data);
        } else if (kindStr === 'stage_run.cancelled') {
          this.handleStageCancelled(data);
        } else if (kindStr === 'stage_run.paused') {
          this.handleStagePaused(data);
        } else if (kindStr === 'stage_run.step_completed') {
          this.handleStepCompleted(data);
        } else if (kindStr === 'workflow_run.completed') {
          this.handleWorkflowCompleted(data);
        } else if (kindStr === 'workflow_run.failed') {
          this.handleWorkflowFailed(data);
        } else if (kindStr === 'workflow_run.paused') {
          this.handleWorkflowPaused(data);
        } else if (kindStr === 'workflow_run.cancelled') {
          this.handleWorkflowCancelled(data);
        } else if (this.opts.verbosity === 'verbose') {
          process.stderr.write(chalk.dim(`  [${kind}] ${JSON.stringify(data).slice(0, 100)}\n`));
        }
        break;
      }
    }
  }

  private handleToken(text: string): void {
    if (!this.state.isStreaming) {
      this.state.isStreaming = true;
      process.stderr.write('\n');
    }
    this.state.currentContent += text;
    this.state.tokenCount++;
    this.state.hasOutput = true;
    process.stdout.write(text);
  }

  private handleThinking(text: string): void {
    process.stderr.write(chalk.dim.italic(text));
  }

  private handleToolStart(data: Record<string, unknown>): void {
    const callId = (data['callId'] ?? 'unknown') as string;
    const tool = data['tool'] as string;

    this.state.activeTools.set(callId, { tool, startTime: Date.now() });

    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }

    if (this.opts.verbosity === 'minimal') {
      process.stderr.write(chalk.dim(`  ⚡ ${tool}\n`));
    } else {
      process.stderr.write(chalk.yellow(`  ⚡ ${tool}`));
      if (this.opts.verbosity === 'verbose' && data['args']) {
        const argsStr = JSON.stringify(data['args']);
        process.stderr.write(chalk.dim(` ${argsStr.length > 100 ? argsStr.slice(0, 100) + '…' : argsStr}`));
      }
      process.stderr.write('\n');
    }
  }

  private handleToolComplete(data: Record<string, unknown>): void {
    const callId = (data['callId'] ?? 'unknown') as string;
    const entry = this.state.activeTools.get(callId);

    if (entry) {
      const elapsed = Date.now() - entry.startTime;
      const success = data['success'] !== false;

      if (this.opts.verbosity !== 'minimal') {
        const icon = success ? chalk.green('✓') : chalk.red('✗');
        process.stderr.write(`  ${icon} ${entry.tool} ${chalk.dim(`(${elapsed}ms)`)}\n`);
      }

      this.state.activeTools.delete(callId);
    }
  }

  private handleMessageComplete(_content: string): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
  }

  private handleUsage(data: Record<string, unknown>): void {
    const model = data['model'] as string | undefined;
    const inputTokens = data['inputTokens'] as number | undefined;
    const outputTokens = data['outputTokens'] as number | undefined;
    const durationMs = data['durationMs'] as number | undefined;
    const cost = data['cost'] as number | undefined;

    const parts: string[] = [];
    if (model) parts.push(model);
    if (inputTokens !== undefined) parts.push(`${inputTokens} in`);
    if (outputTokens !== undefined) parts.push(`${outputTokens} out`);
    if (durationMs !== undefined) parts.push(formatDuration(new Date(Date.now() - durationMs)));
    if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);

    if (parts.length > 0) {
      process.stderr.write(chalk.dim(`\n  📊 ${parts.join(' · ')}\n`));
    }
  }

  private handleError(message: string): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    process.stderr.write(chalk.red(`\n  ✗ Error: ${message}\n`));
  }

  private handleIdle(): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    this.opts.onComplete();
  }

  private handleTurnEnd(): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
  }

  private handleHITLPrompt(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }

    const prompt = data['prompt'] as string | undefined;
    const stageRunId = data['stageRunId'] as string | undefined;

    process.stderr.write(chalk.yellow.bold(`\n  ⏸ Awaiting Input`));
    if (stageRunId) process.stderr.write(chalk.dim(` [${stageRunId.slice(0, 8)}]`));
    process.stderr.write('\n');
    if (prompt) process.stderr.write(`  ${prompt}\n`);
    process.stderr.write(chalk.dim(`  Use: generatorai run resume <runId> <stageId> --approve\n\n`));
  }

  private handleStageStarted(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const name = data['name'] as string | undefined;
    const stageRunId = data['stageRunId'] as string | undefined;
    this.state.currentStageName = name;
    process.stderr.write(chalk.cyan.bold(`\n  ▶ Stage: ${name ?? stageRunId?.slice(0, 8) ?? 'unknown'}\n`));
    process.stderr.write(chalk.dim(`  ${'─'.repeat(50)}\n`));
  }

  private handleStepStarted(data: Record<string, unknown>): void {
    const step = data['step'] as number | undefined;
    const totalSteps = data['totalSteps'] as number | undefined;
    const label = data['label'] as string | undefined;
    if (this.opts.verbosity === 'verbose' && label) {
      process.stderr.write(chalk.dim(`    Step ${(step ?? 0) + 1}/${totalSteps ?? '?'}: ${label}\n`));
    }
  }

  private handleStageCompleted(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const name = data['name'] as string | undefined;
    process.stderr.write(chalk.green(`\n  ✓ Stage completed: ${name ?? this.state.currentStageName ?? 'unknown'}\n`));
  }

  private handleStageFailed(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const name = data['name'] as string | undefined;
    const error = data['error'] as string | undefined;
    process.stderr.write(chalk.red(`\n  ✗ Stage failed: ${name ?? this.state.currentStageName ?? 'unknown'}\n`));
    if (error) process.stderr.write(chalk.red(`    ${error}\n`));
  }

  private handleStageCancelled(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const name = data['name'] as string | undefined;
    process.stderr.write(chalk.yellow(`\n  ⊘ Stage cancelled: ${name ?? this.state.currentStageName ?? 'unknown'}\n`));
  }

  private handleStagePaused(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const name = data['name'] as string | undefined;
    process.stderr.write(chalk.yellow(`\n  ⏸ Stage paused: ${name ?? this.state.currentStageName ?? 'unknown'}\n`));
  }

  private handleStepCompleted(data: Record<string, unknown>): void {
    if (this.opts.verbosity === 'verbose') {
      const step = data['step'] as number | undefined;
      const totalSteps = data['totalSteps'] as number | undefined;
      const label = data['label'] as string | undefined;
      process.stderr.write(chalk.dim(`    ✓ Step ${(step ?? 0) + 1}/${totalSteps ?? '?'} done${label ? `: ${label}` : ''}\n`));
    }
  }

  private handleWorkflowCompleted(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const totalStages = data['totalStages'] as number | undefined;
    process.stderr.write(chalk.green.bold(`\n  ✓ Workflow completed`));
    if (totalStages) process.stderr.write(chalk.dim(` (${totalStages} stages)`));
    process.stderr.write('\n\n');
    this.opts.onComplete();
  }

  private handleWorkflowFailed(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const error = data['error'] as string | undefined;
    process.stderr.write(chalk.red.bold(`\n  ✗ Workflow failed`));
    process.stderr.write('\n');
    if (error) process.stderr.write(chalk.red(`    ${error}\n`));
    process.stderr.write('\n');
    this.opts.onComplete();
  }

  private handleWorkflowPaused(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    const runId = data['runId'] as string | undefined;
    process.stderr.write(chalk.yellow.bold(`\n  ⏸ Workflow paused`));
    if (runId) process.stderr.write(chalk.dim(` [${runId.slice(0, 8)}]`));
    process.stderr.write('\n');
    process.stderr.write(chalk.dim(`  Use: generatorai run resume ${runId?.slice(0, 8) ?? '<runId>'}\n\n`));
    this.opts.onComplete();
  }

  private handleWorkflowCancelled(data: Record<string, unknown>): void {
    if (this.state.isStreaming) {
      process.stdout.write('\n');
      this.state.isStreaming = false;
    }
    process.stderr.write(chalk.yellow.bold(`\n  ⊘ Workflow cancelled\n\n`));
    this.opts.onComplete();
  }

  /** Get accumulated content from the stream */
  getContent(): string {
    return this.state.currentContent;
  }

  /** Check if any output was produced */
  hasOutput(): boolean {
    return this.state.hasOutput;
  }

  /** Reset state for a new turn */
  reset(): void {
    this.state = {
      isStreaming: false,
      currentContent: '',
      tokenCount: 0,
      activeTools: new Map(),
      hasOutput: false,
      isInternalTurn: false,
    };
  }
}
