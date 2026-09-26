// ────────────────────────────────────────────────────────────────
// F-home-02 QuickComposer — Home's quick start (board Home; composer variant
// `quick`, 03 §3.2 F-composer-01).
//
// One box: the task textarea, then a toolbar of chips — Project, Agent
// (B-02 data, "No agent"), Model (B-01 ModelPicker), and "Worktree / In place"
// once the project has codebases — with the Mod+Enter hint, "More options"
// and Start. Built from kit parts here: Home never imports `features/chat`,
// and shares only blocks (ModelPicker).
//
// Start creates the chat (`useCreateChat`), sends the task as its first
// message and opens it. "More options" hands the draft to the full New chat
// surface (`/chats?new=1` with `{ draft }` in the navigation state until
// P5-09's `/chats/new`, 04 R-1).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { chatNameFromPrompt, type CreateChatDraft } from '@generatorai/shared/ui-contract';
import type { ChatSourceSpec, CreateChatParams } from '@generatorai/shared';
import { useCreateChat, useSendChatPromptTo } from '@/hooks/queries.js';
import { useProjectCodebases, useProjects } from '@/hooks/projectQueries.js';
import { useSelectableAgents } from '@/hooks/agentQueries.js';
import { useModels } from '@/hooks/harnessQueries.js';
import { getDefaultChatModel } from '@/lib/appPreferences.js';
import { isMacOS } from '@/lib/desktop.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';

type SourceMode = NonNullable<CreateChatDraft['sourceMode']>;

const SOURCE_MODE_LABEL: Record<SourceMode, string> = { worktree: 'Worktree', 'in-place': 'In place' };
const SEND_KEYS = [isMacOS ? '⌘' : 'Ctrl', '↵'] as const;

/** The saved default model when a ready provider still offers it, else the first ready model. */
function useDefaultModel(): string {
  const { data: models } = useModels();
  return useMemo(() => {
    const saved = getDefaultChatModel();
    if (!models) return saved;
    return models.some((m) => m.id === saved) ? saved : (models[0]?.id ?? '');
  }, [models]);
}

export function QuickComposer() {
  const navigate = useNavigate();
  const createChat = useCreateChat();
  const sendPrompt = useSendChatPromptTo();

  const [prompt, setPrompt] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [agentRef, setAgentRef] = useState<string | undefined>(undefined);
  const [model, setModel] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('worktree');

  const defaultModel = useDefaultModel();
  useEffect(() => {
    if (!model && defaultModel) setModel(defaultModel);
  }, [model, defaultModel]);

  const projects = useProjects();
  const agents = useSelectableAgents(projectId);
  const codebases = useProjectCodebases(projectId);
  const project = projects.data?.find((p) => p.id === projectId);
  const agent = agents.data?.find((a) => a.ref === agentRef);
  const projectCodebases = projectId ? (codebases.data ?? []) : [];

  const busy = createChat.isPending || sendPrompt.isPending;
  const canStart = prompt.trim().length > 0 && !busy;

  const draft = (): CreateChatDraft => ({
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    ...(projectId ? { projectId } : {}),
    ...(agentRef ? { agentRef } : {}),
    ...(model ? { model } : {}),
    ...(projectCodebases.length > 0 ? { sourceMode } : {}),
  });

  const start = async () => {
    const task = prompt.trim();
    if (!task || busy) return;
    const sources: ChatSourceSpec[] = projectCodebases.map((cb) => ({ kind: 'codebase', codebaseId: cb.id, mode: sourceMode }));
    const params: CreateChatParams = {
      name: chatNameFromPrompt(task),
      ...(model ? { model } : {}),
      ...(projectId ? { projectId } : {}),
      ...(agentRef ? { agentRef } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    };
    try {
      const chat = await createChat.mutateAsync(params);
      await sendPrompt.mutateAsync({ chatId: chat.id, prompt: task });
      setPrompt('');
      navigate(`/chats/${chat.id}`);
    } catch {
      // Each mutation's own toast already said what failed; the task stays in the box.
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void start();
    }
  };

  return (
    <div
      className="rounded-dialog border border-line bg-raised transition-control focus-within:border-line-strong"
      data-testid="home-quick-composer"
    >
      <Textarea
        variant="inline"
        autosize={{ minRows: 2, maxRows: 8 }}
        aria-label="New chat task"
        placeholder="Start a chat — describe a task for an agent"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        className="px-3.5 pt-3"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2">
        <Menu.Root>
          <Menu.Trigger
            render={
              <Chip dropdown icon="projects" aria-label={`Project: ${project?.name ?? 'No project'}`}>
                {project?.name ?? 'No project'}
              </Chip>
            }
          />
          <Menu.Popup aria-label="Project" className="max-h-80 overflow-y-auto">
            <Menu.RadioGroup value={projectId ?? ''} onValueChange={(v) => setProjectId(typeof v === 'string' && v ? v : undefined)}>
              <Menu.RadioItem value="" closeOnClick>
                No project
              </Menu.RadioItem>
              {(projects.data ?? []).map((p) => (
                <Menu.RadioItem key={p.id} value={p.id} closeOnClick>
                  {p.name}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Root>

        <Menu.Root>
          <Menu.Trigger
            render={
              <Chip dropdown icon="agents" aria-label={`Agent: ${agent?.name ?? 'No agent'}`}>
                {agent?.name ?? 'No agent'}
              </Chip>
            }
          />
          <Menu.Popup aria-label="Agent" className="max-h-80 overflow-y-auto">
            <Menu.RadioGroup value={agentRef ?? ''} onValueChange={(v) => setAgentRef(typeof v === 'string' && v ? v : undefined)}>
              <Menu.RadioItem value="" closeOnClick description="Just a model">
                No agent
              </Menu.RadioItem>
              {(agents.data ?? [])
                .filter((a) => a.enabled)
                .map((a) => (
                  <Menu.RadioItem key={a.ref} value={a.ref} closeOnClick description={a.description || undefined}>
                    {a.name}
                  </Menu.RadioItem>
                ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Root>

        <ModelPicker value={model} onChange={setModel} side="bottom" ariaLabel="Model" />

        {projectCodebases.length > 0 ? (
          <Menu.Root>
            <Menu.Trigger
              render={
                <Chip dropdown icon="branch" aria-label={`Source mode: ${SOURCE_MODE_LABEL[sourceMode]}`}>
                  {SOURCE_MODE_LABEL[sourceMode]}
                </Chip>
              }
            />
            <Menu.Popup aria-label="Source mode">
              <Menu.RadioGroup value={sourceMode} onValueChange={(v) => setSourceMode(v === 'in-place' ? 'in-place' : 'worktree')}>
                <Menu.RadioItem value="worktree" closeOnClick description="Changes go to a new branch in a separate checkout">
                  Worktree
                </Menu.RadioItem>
                <Menu.RadioItem value="in-place" closeOnClick description="Edits the project's checkout directly">
                  In place
                </Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Root>
        ) : null}

        <div className="flex-1" />
        <Kbd keys={SEND_KEYS} aria-hidden />
        <Button variant="ghost" size="sm" onClick={() => navigate('/chats?new=1', { state: { draft: draft() } })}>
          More options
        </Button>
        <IconButton
          icon="send"
          label="Start chat"
          variant="primary"
          shortcut={SEND_KEYS}
          disabled={!canStart}
          loading={busy}
          onClick={() => void start()}
        />
      </div>
    </div>
  );
}
