---
description: Start development conversations, supply context, choose runtime controls, and manage conversation history.
---
# Chats and the composer

A chat is a persisted development conversation attached to an execution workspace. It can investigate existing code, generate a new application, operate integrated tools, or delegate work through an orchestrator agent. Its transcript includes user and assistant messages, tools, plans, questions, permissions, and interactive outputs.

## Start a useful conversation

1. Open **Chats** and create a chat.
2. Select the project or sources appropriate to the task. A source is a host-side directory or registered codebase, not an uploaded copy of the entire project.
3. Choose a ready provider/model and, where available, an agent, reasoning effort, and context tier.
4. State the desired outcome, constraints, acceptance criteria, and how success should be verified.
5. Wait for source preparation to finish, then send the first message.

The source-preparation bar reports pending, ready, or failed mounts. The composer can preserve a draft while preparation is pending, but it does not silently queue a send for later. Resolve a source error before expecting the agent to inspect that repository.

## Compose with context

| Control | Behavior |
| --- | --- |
| Message editor | Web/desktop plain Enter sends; Shift+Enter or Ctrl/Cmd+Enter inserts a newline. Up/Down at the first/last line recalls prompt history while preserving multi-line editing. |
| Model picker | Search available models by provider; readiness and model metadata drive the choices. |
| Reasoning effort | Only valid levels for the selected model are offered. |
| Context tier/gauge | Shows supported context options and estimated usage; a larger tier must be supported by the model. |
| Attach file | Add documents, images, or other supported files; attachment chips allow removal before sending. |
| Slash commands | Built-in `/browser` and `/terminal`, plus discovered skill and prompt commands. |
| Mentions | Add supported source/context references from the composer menu. |
| Dictation | Insert speech at the text cursor using the configured audio engine. |
| Captures | Browser and terminal captures enter the attachment area and remain visible before the next send. |

The built-in browser and terminal commands construct instructions for the agent to use integrated tools. They do not bypass permissions or make the tool available when the host or device lacks the capability. Prompt commands load their template body when sent; skill commands invoke the selected skill by name.

## Choose behavior

**Auto** works autonomously and can apply changes directly. **Plan** asks the agent to research and propose an implementation plan, then waits for review before implementation. Mode and tool permission policy are related but not identical: the server's deployment posture, agent policy, selected mode, and provider support all contribute to effective behavior. See [Plans, questions, and permissions](./interactions.md).

An orchestrator chat can spawn workers that appear in **Background Tasks**. The agent's team and capability settings control delegation; adding the panel alone does not turn a normal chat into an orchestrator.

## Follow and control a turn

The transcript streams assistant content and structured tool activity. Expand tool rows for inputs and outputs; inspect edited files through **Changes**. The activity strip and usage indicators supplement the final answer but do not replace checking the generated result.

Use **Stop generation** to request cancellation. If graceful stopping fails, the composer exposes a reset action. Reset is a recovery action for a stuck turn, not a guarantee that files already written or external commands already executed have been undone. Use [checkpoints and change review](./source-control.md) to inspect the workspace afterward.

## History and organization

Chats can be renamed, archived, revisited, forked through supported message/history actions, and deleted. A fork provides a new conversational branch through the selected response and links back to its origin. It **shares the parent's workspace**: it does not create an isolated copy of the files. Rewind exposes separately scoped conversation/file restoration choices. Archiving preserves viewing but disables new messages.

The Chats list searches names and tags, filters active or archived records, and supports bulk deletion with confirmation. **Copy transcript** copies the whole chat as Markdown; **Fork from here** branches through the chosen response. Long histories load incrementally and large lists are virtualized.

## Source evidence

`apps/web/src/pages/ChatPage.tsx`, `apps/web/src/pages/ChatsListPage.tsx`, `apps/web/src/components/chat/CreateChatDialog.tsx`, `apps/web/src/components/chat/ChatInput.tsx`, `apps/web/src/components/chat/MessageActions.tsx`, `apps/web/src/components/chat/composer`, `apps/web/src/components/chat/sources`, and `apps/web/src/hooks/useTwoPhaseStop.ts`.

## Configuration and worked examples

[Chats](../configuration/chats.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
