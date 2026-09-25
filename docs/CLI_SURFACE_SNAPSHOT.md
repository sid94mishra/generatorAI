# CLI / TUI surface snapshot

Generated from the live registry and keymap — do not edit by hand. Run
`pnpm --filter @generatorai/cli surface` and commit the result.

Phase 0 of the parity audit asks for a snapshot whose exit gate is "no
feature is called full based only on registry presence". The columns are
chosen to make that claim checkable: a command that reaches no server, is
hidden from the palette, or needs input the caller must supply is not the
same promise as one that does not.

## Totals

| Measure | Count |
|---|---:|
| Commands | 211 |
| Groups | 24 |
| Server-backed commands | 184 |
| Destructive commands | 33 |
| Commands hidden from the palette | 2 |
| Key bindings | 165 |
| Bindings executed by a component | 21 |
| Bindings nothing executes | 0 |
| Administration views | 20 |

## Commands

| ID | Path | Server | Destructive | Palette | RPC | Required args | Required flags |
|---|---|:-:|:-:|:-:|:-:|---|---|
| `agent.delete` | `agent delete` | yes | yes | yes | yes | agent | — |
| `agent.export` | `agent export` | yes | no | yes | yes | agent | — |
| `agent.import` | `agent import` | yes | no | yes | yes | file | — |
| `agent.list` | `agent list` | yes | no | yes | yes | — | — |
| `agent.resolve` | `agent resolve` | yes | no | yes | yes | — | — |
| `agent.show` | `agent show` | yes | no | yes | yes | agent | — |
| `agent.usage` | `agent usage` | yes | no | yes | yes | agent | — |
| `automation.create` | `automation create` | yes | no | yes | yes | — | --name, --workflow |
| `automation.delete` | `automation delete` | yes | yes | yes | yes | automation | — |
| `automation.disable` | `automation disable` | yes | no | yes | yes | automation | — |
| `automation.enable` | `automation enable` | yes | no | yes | yes | automation | — |
| `automation.execution.cancel` | `automation execution cancel` | yes | yes | yes | yes | automation, execution | — |
| `automation.execution.list` | `automation execution list` | yes | no | yes | yes | automation | — |
| `automation.execution.show` | `automation execution show` | yes | no | yes | yes | automation, execution | — |
| `automation.list` | `automation list` | yes | no | yes | yes | — | — |
| `automation.rotateWebhookToken` | `automation rotate-webhook-token` | yes | yes | yes | yes | automation | — |
| `automation.show` | `automation show` | yes | no | yes | yes | automation | — |
| `automation.trigger` | `automation trigger` | yes | no | yes | yes | automation | — |
| `automation.update` | `automation update` | yes | no | yes | yes | automation | — |
| `browser.back` | `browser back` | yes | no | yes | yes | workspace | — |
| `browser.dom` | `browser dom` | yes | no | yes | yes | workspace | — |
| `browser.forward` | `browser forward` | yes | no | yes | yes | workspace | — |
| `browser.navigate` | `browser navigate` | yes | no | yes | yes | workspace, url | — |
| `browser.read` | `browser read` | yes | no | yes | yes | workspace | — |
| `browser.reload` | `browser reload` | yes | no | yes | yes | workspace | — |
| `browser.screenshot` | `browser screenshot` | yes | no | yes | yes | workspace | — |
| `browser.snapshots` | `browser snapshots` | yes | no | yes | yes | workspace | — |
| `browser.start` | `browser start` | yes | no | yes | yes | workspace | — |
| `browser.status` | `browser status` | yes | no | yes | yes | workspace | — |
| `browser.stop` | `browser stop` | yes | no | yes | yes | workspace | — |
| `chat.archive` | `chat archive` | yes | no | yes | yes | chat | — |
| `chat.cancel` | `chat cancel` | yes | no | yes | yes | chat | — |
| `chat.create` | `chat create` | yes | no | yes | yes | name | — |
| `chat.delete` | `chat delete` | yes | yes | yes | yes | chat | — |
| `chat.list` | `chat list` | yes | no | yes | yes | — | — |
| `chat.messages` | `chat messages` | yes | no | yes | yes | chat | — |
| `chat.permissionMode` | `chat permission-mode` | yes | no | yes | yes | chat | — |
| `chat.plan` | `chat plan` | yes | no | yes | yes | chat, planId | — |
| `chat.plans` | `chat plans` | yes | no | yes | yes | chat | — |
| `chat.send` | `chat send` | yes | no | yes | yes | chat, prompt | — |
| `chat.show` | `chat show` | yes | no | yes | yes | chat | — |
| `chat.tasks` | `chat tasks` | yes | no | yes | yes | chat | — |
| `chat.update` | `chat update` | yes | no | yes | yes | chat | — |
| `chat.watch` | `chat watch` | yes | no | yes | yes | chat | — |
| `computer.activity` | `computer activity` | yes | no | yes | yes | workspace | — |
| `computer.answer` | `computer answer` | yes | no | yes | yes | workspace, request, decision | --app |
| `computer.frames` | `computer frames` | yes | no | yes | yes | workspace | — |
| `computer.grants` | `computer grants` | yes | no | yes | yes | workspace | — |
| `computer.pending` | `computer pending` | yes | no | yes | yes | workspace | — |
| `computer.revoke` | `computer revoke` | yes | yes | yes | yes | workspace, app | — |
| `computer.runtime` | `computer runtime` | yes | yes | yes | yes | workspace, action | — |
| `computer.status` | `computer status` | yes | no | yes | yes | workspace | — |
| `config.get` | `config get` | no | no | yes | yes | key | — |
| `config.keymap.list` | `config keymap list` | no | no | yes | yes | — | — |
| `config.keymap.set` | `config keymap set` | no | no | yes | yes | action, keys | — |
| `config.path` | `config path` | no | no | yes | yes | — | — |
| `config.profile.create` | `config profile create` | no | no | yes | yes | name | — |
| `config.profile.delete` | `config profile delete` | no | yes | yes | yes | name | — |
| `config.profile.list` | `config profile list` | no | no | yes | yes | — | — |
| `config.profile.use` | `config profile use` | no | no | yes | yes | name | — |
| `config.reset` | `config reset` | no | yes | yes | yes | — | — |
| `config.set` | `config set` | no | no | yes | yes | key, value | — |
| `config.show` | `config show` | no | no | yes | yes | — | — |
| `config.unset` | `config unset` | no | no | yes | yes | key | — |
| `connect.add` | `connect add` | no | no | yes | yes | url | — |
| `connect.endpoint.add` | `connect endpoint add` | no | no | yes | yes | connection, url | — |
| `connect.endpoint.remove` | `connect endpoint remove` | no | no | yes | yes | connection, url | — |
| `connect.list` | `connect list` | no | no | yes | yes | — | — |
| `connect.remove` | `connect remove` | no | yes | yes | yes | connection | — |
| `connect.rename` | `connect rename` | no | no | yes | yes | connection, label | — |
| `connect.resolve` | `connect resolve` | no | no | no | no | — | — |
| `connect.test` | `connect test` | no | no | yes | yes | — | — |
| `connect.use` | `connect use` | no | no | yes | yes | connection | — |
| `device.audit` | `device audit` | yes | no | yes | yes | — | — |
| `device.forget` | `device forget` | no | yes | yes | yes | — | — |
| `device.invite` | `device invite` | yes | no | yes | yes | — | — |
| `device.invites` | `device invites` | yes | no | yes | yes | — | — |
| `device.list` | `device list` | yes | no | yes | yes | — | — |
| `device.pair` | `device pair` | no | no | yes | yes | code | — |
| `device.revoke` | `device revoke` | yes | yes | yes | yes | device | — |
| `device.scopes` | `device scopes` | yes | no | yes | yes | device | — |
| `device.status` | `device status` | no | no | yes | yes | — | — |
| `extension.disable` | `extension disable` | yes | no | yes | yes | extension | — |
| `extension.enable` | `extension enable` | yes | no | yes | yes | extension | — |
| `extension.list` | `extension list` | yes | no | yes | yes | — | — |
| `extension.reload` | `extension reload` | yes | no | yes | yes | — | — |
| `extension.show` | `extension show` | yes | no | yes | yes | extension | — |
| `extension.uninstall` | `extension uninstall` | yes | yes | yes | yes | extension | — |
| `harness.show` | `harness show` | yes | no | yes | yes | — | — |
| `harness.switch` | `harness switch` | yes | no | yes | yes | provider | — |
| `hook.phases` | `hook phases` | yes | no | yes | yes | — | — |
| `hook.test` | `hook test` | yes | no | yes | yes | session, phase | --type, --config |
| `orchestrator.cancel` | `orchestrator cancel` | yes | yes | yes | yes | run | — |
| `project.codebase.branches` | `project codebase branches` | yes | no | yes | yes | project, codebase | — |
| `project.codebase.browse` | `project codebase browse` | yes | no | yes | yes | project, codebase | — |
| `project.codebase.fetch` | `project codebase fetch` | yes | no | yes | yes | project, codebase | — |
| `project.codebase.file` | `project codebase file` | yes | no | yes | yes | project, codebase, path | — |
| `project.codebase.link` | `project codebase link` | yes | no | yes | yes | project | --alias, --type |
| `project.codebase.list` | `project codebase list` | yes | no | yes | yes | project | — |
| `project.codebase.unlink` | `project codebase unlink` | yes | yes | yes | yes | project, codebase | — |
| `project.config.delete` | `project config delete` | yes | yes | yes | yes | project, config | — |
| `project.config.list` | `project config list` | yes | no | yes | yes | project | — |
| `project.config.upload` | `project config upload` | yes | no | yes | yes | project, type, file | — |
| `project.create` | `project create` | yes | no | yes | yes | name | — |
| `project.delete` | `project delete` | yes | yes | yes | yes | project | — |
| `project.list` | `project list` | yes | no | yes | yes | — | — |
| `project.mcp.add` | `project mcp add` | yes | no | yes | yes | project | --name |
| `project.mcp.list` | `project mcp list` | yes | no | yes | yes | project | — |
| `project.mcp.remove` | `project mcp remove` | yes | yes | yes | yes | project, server | — |
| `project.show` | `project show` | yes | no | yes | yes | project | — |
| `project.update` | `project update` | yes | no | yes | yes | project | — |
| `project.worktree.cleanup` | `project worktree cleanup` | yes | yes | yes | yes | project | — |
| `project.worktree.list` | `project worktree list` | yes | no | yes | yes | project | — |
| `project.worktree.remove` | `project worktree remove` | yes | yes | yes | yes | project, worktree | — |
| `review.create` | `review create` | yes | no | yes | yes | workspace, path, body | --startLine |
| `review.list` | `review list` | yes | no | yes | yes | workspace | — |
| `review.reply` | `review reply` | yes | no | yes | yes | workspace, thread, body | — |
| `review.resolve` | `review resolve` | yes | no | yes | yes | workspace, thread | — |
| `review.submit` | `review submit` | yes | no | yes | yes | workspace | — |
| `review.unresolve` | `review unresolve` | yes | no | yes | yes | workspace, thread | — |
| `run.cancel` | `run cancel` | yes | yes | yes | yes | run | — |
| `run.delete` | `run delete` | yes | yes | yes | yes | run | — |
| `run.diff` | `run diff` | yes | no | yes | yes | run | — |
| `run.hitl.approve` | `run hitl approve` | yes | no | yes | yes | run, stage | — |
| `run.hitl.changes-request` | `run hitl changes-request` | yes | no | yes | yes | run, stage | — |
| `run.hitl.mode` | `run hitl mode` | yes | no | yes | yes | run | — |
| `run.hitl.pending` | `run hitl pending` | yes | no | yes | yes | run | — |
| `run.hitl.reject` | `run hitl reject` | yes | yes | yes | yes | run, stage | — |
| `run.list` | `run list` | yes | no | yes | yes | — | — |
| `run.messages` | `run messages` | yes | no | yes | yes | run | — |
| `run.pause` | `run pause` | yes | no | yes | yes | run | — |
| `run.profile.generate` | `run profile generate` | yes | no | yes | yes | workflow | — |
| `run.profile.list` | `run profile list` | no | no | yes | yes | — | — |
| `run.profile.validate` | `run profile validate` | yes | no | yes | yes | workflow, profile | — |
| `run.resume` | `run resume` | yes | no | yes | yes | run | — |
| `run.retry` | `run retry` | yes | no | yes | yes | run | — |
| `run.show` | `run show` | yes | no | yes | yes | run | — |
| `run.stage.cancel` | `run stage cancel` | yes | yes | yes | yes | run, stage | — |
| `run.stage.list` | `run stage list` | yes | no | yes | yes | run | — |
| `run.stage.pause` | `run stage pause` | yes | no | yes | yes | run, stage | — |
| `run.stage.resume` | `run stage resume` | yes | no | yes | yes | run, stage | — |
| `run.stage.retry` | `run stage retry` | yes | no | yes | yes | run, stage | — |
| `run.start` | `run start` | yes | no | yes | yes | workflow | — |
| `run.watch` | `run watch` | yes | no | yes | yes | run | — |
| `run.workspace` | `run workspace` | yes | no | yes | yes | run | — |
| `script.list` | `script list` | yes | no | yes | yes | — | — |
| `script.materialize` | `script materialize` | yes | no | yes | yes | script | — |
| `script.profiles` | `script profiles` | yes | no | yes | yes | script | — |
| `script.reload` | `script reload` | yes | no | yes | yes | — | — |
| `script.run` | `script run` | yes | no | yes | yes | script | — |
| `script.show` | `script show` | yes | no | yes | yes | script | — |
| `script.validate` | `script validate` | yes | no | yes | yes | file | — |
| `security.audit` | `security audit` | yes | no | yes | yes | — | — |
| `security.networkAccess` | `security network-access` | yes | no | yes | yes | — | — |
| `security.posture` | `security posture` | yes | no | yes | yes | — | — |
| `sourceControl.config` | `source-control config` | yes | no | yes | yes | — | — |
| `sourceControl.status` | `source-control status` | yes | no | yes | yes | — | — |
| `system.artifact` | `system artifact` | yes | no | yes | yes | id | — |
| `system.artifacts` | `system artifacts` | yes | no | yes | yes | — | — |
| `system.config` | `system config` | yes | no | yes | yes | — | — |
| `system.doctor` | `system doctor` | no | no | yes | yes | — | — |
| `system.health` | `system health` | yes | no | yes | yes | — | — |
| `system.mcpServers` | `system mcp-servers` | yes | no | yes | yes | — | — |
| `system.models` | `system models` | yes | no | yes | yes | — | — |
| `system.version` | `system version` | no | no | yes | yes | — | — |
| `template.list` | `template list` | yes | no | yes | yes | — | — |
| `template.show` | `template show` | yes | no | yes | yes | template | — |
| `terminal.attach` | `terminal attach` | yes | no | no | no | workspace | — |
| `terminal.create` | `terminal create` | yes | no | yes | yes | workspace | — |
| `terminal.kill` | `terminal kill` | yes | yes | yes | yes | workspace, terminal | — |
| `terminal.list` | `terminal list` | yes | no | yes | yes | workspace | — |
| `terminal.scrollback` | `terminal scrollback` | yes | no | yes | yes | workspace, terminal | — |
| `terminal.signal` | `terminal signal` | yes | no | yes | yes | workspace, terminal | — |
| `widget.close` | `widget close` | yes | yes | yes | yes | widget | — |
| `widget.list` | `widget list` | yes | no | yes | yes | — | — |
| `widget.read` | `widget read` | yes | no | yes | yes | widget | — |
| `widget.setState` | `widget set-state` | yes | no | yes | yes | widget, state | — |
| `workflow.clone` | `workflow clone` | yes | no | yes | yes | workflow | — |
| `workflow.create` | `workflow create` | yes | no | yes | yes | name | — |
| `workflow.delete` | `workflow delete` | yes | yes | yes | yes | workflow | — |
| `workflow.edge.add` | `workflow edge add` | yes | no | yes | yes | workflow | --from, --to |
| `workflow.edge.delete` | `workflow edge delete` | yes | yes | yes | yes | workflow, edge | — |
| `workflow.edge.list` | `workflow edge list` | yes | no | yes | yes | workflow | — |
| `workflow.export` | `workflow export` | yes | no | yes | yes | workflow | — |
| `workflow.fromTemplate` | `workflow from-template` | yes | no | yes | yes | template | — |
| `workflow.importJson` | `workflow import-json` | yes | no | yes | yes | file | — |
| `workflow.list` | `workflow list` | yes | no | yes | yes | — | — |
| `workflow.show` | `workflow show` | yes | no | yes | yes | workflow | — |
| `workflow.stage.add` | `workflow stage add` | yes | no | yes | yes | workflow | --name |
| `workflow.stage.delete` | `workflow stage delete` | yes | yes | yes | yes | workflow, stage | — |
| `workflow.stage.hook.add` | `workflow stage hook add` | yes | no | yes | yes | workflow, stage | --name, --phase, --type, --config |
| `workflow.stage.hook.list` | `workflow stage hook list` | yes | no | yes | yes | workflow, stage | — |
| `workflow.stage.hook.remove` | `workflow stage hook remove` | yes | yes | yes | yes | workflow, stage, hook | — |
| `workflow.stage.list` | `workflow stage list` | yes | no | yes | yes | workflow | — |
| `workflow.stage.update` | `workflow stage update` | yes | no | yes | yes | workflow, stage | — |
| `workflow.update` | `workflow update` | yes | no | yes | yes | workflow | — |
| `workflow.validate` | `workflow validate` | yes | no | yes | yes | workflow | — |
| `workspace.archive` | `workspace archive` | yes | no | yes | yes | workspace | — |
| `workspace.changes` | `workspace changes` | yes | no | yes | yes | workspace | — |
| `workspace.checkpoints` | `workspace checkpoints` | yes | no | yes | yes | workspace | — |
| `workspace.cleanup` | `workspace cleanup` | yes | yes | yes | yes | — | — |
| `workspace.commit` | `workspace commit` | yes | no | yes | yes | workspace | — |
| `workspace.delete` | `workspace delete` | yes | yes | yes | yes | workspace | — |
| `workspace.get` | `workspace cat` | yes | no | yes | yes | workspace, path | — |
| `workspace.list` | `workspace list` | yes | no | yes | yes | — | — |
| `workspace.pr` | `workspace pr` | yes | no | yes | yes | workspace | — |
| `workspace.put` | `workspace put` | yes | no | yes | yes | workspace, path | — |
| `workspace.restore` | `workspace restore` | yes | yes | yes | yes | workspace, checkpoint | — |
| `workspace.show` | `workspace show` | yes | no | yes | yes | workspace | — |
| `workspace.tree` | `workspace tree` | yes | no | yes | yes | workspace | — |
| `workspace.worktrees` | `workspace worktree list` | yes | no | yes | yes | workspace | — |

## Key bindings

| ID | Context | Keys | Category | Handled by |
|---|---|---|---|:-:|
| `app.back` | global | `escape` | Global | shell |
| `app.focusNext` | global | `tab` | Global | shell |
| `app.focusPrev` | global | `shift+tab` | Global | shell |
| `app.help` | global | `?` | Global | shell |
| `app.palette` | global | `ctrl+k` | Global | shell |
| `app.quit` | global | `ctrl+c` | Global | shell |
| `app.refresh` | global | `ctrl+r` | Global | shell |
| `app.search` | list | `/` | Global | shell |
| `app.theme` | global | `ctrl+t` | Global | shell |
| `app.toggleRightPane` | global | `ctrl+g` | Global | shell |
| `automation.cancelExecution` | automation | `c` | Automation | shell |
| `automation.nextExecution` | automation | `ctrl+n` | Automation | shell |
| `automation.openRun` | automation | `return` | Automation | shell |
| `automation.prevExecution` | automation | `ctrl+p` | Automation | shell |
| `browser.back` | browser | `shift+h` | Browser | shell |
| `browser.computer` | browser | `c` | Browser | shell |
| `browser.forward` | browser | `shift+l` | Browser | shell |
| `browser.inspect` | browser | `a` | Browser | shell |
| `browser.navigate` | browser | `o` | Browser | shell |
| `browser.reload` | browser | `r` | Browser | shell |
| `browser.screenshot` | browser | `s` | Browser | shell |
| `browser.status` | browser | `i` | Browser | shell |
| `browser.stop` | browser | `k` | Browser | shell |
| `chat.agent` | composer | `alt+a` | Chat | shell |
| `chat.clear` | chat | `ctrl+l` | Chat | shell |
| `chat.editor` | composer | `alt+e` | Chat | shell |
| `chat.historyNext` | composer | `down` | Chat | component |
| `chat.historyPrev` | composer | `up` | Chat | component |
| `chat.mention` | composer | `@` | Chat | component |
| `chat.model` | composer | `ctrl+o` | Chat | shell |
| `chat.newline` | composer | `shift+return` | Chat | component |
| `chat.permission` | composer | `ctrl+p` | Chat | shell |
| `chat.respond` | chat | `alt+g` | Chat | shell |
| `chat.scrollDown` | chat | `pagedown` | Chat | shell |
| `chat.scrollUp` | chat | `pageup` | Chat | shell |
| `chat.search` | chat | `alt+s` | Chat | shell |
| `chat.send` | composer | `return` | Chat | component |
| `chat.slash` | composer | `/` | Chat | component |
| `chat.stop` | chat | `ctrl+x` | Chat | shell |
| `chat.toggleThinking` | chat | `alt+r` | Chat | shell |
| `command.inspect` | command | `return` | Admin | shell |
| `command.rerun` | command | `shift+r` | Admin | shell |
| `command.switch` | command | `v` | Admin | shell |
| `composer.charLeft` | composer | `ctrl+b` | Composer | component |
| `composer.charRight` | composer | `ctrl+f` | Composer | component |
| `composer.deleteForward` | composer | `ctrl+d` | Composer | component |
| `composer.killLine` | composer | `ctrl+k` | Composer | component |
| `composer.killToStart` | composer | `ctrl+u` | Composer | component |
| `composer.killWordBack` | composer | `ctrl+w` | Composer | component |
| `composer.killWordForward` | composer | `alt+d` | Composer | component |
| `composer.lineEnd` | composer | `ctrl+e` | Composer | component |
| `composer.lineStart` | composer | `ctrl+a` | Composer | component |
| `composer.newline` | composer | `ctrl+j` | Composer | component |
| `composer.undo` | composer | `ctrl+_` | Composer | component |
| `composer.wordLeft` | composer | `alt+b` | Composer | component |
| `composer.wordRight` | composer | `alt+f` | Composer | component |
| `composer.yank` | composer | `ctrl+y` | Composer | component |
| `computer.answer` | computer | `a` | Computer | shell |
| `computer.nextSection` | computer | `s` | Computer | shell |
| `computer.refresh` | computer | `r` | Computer | shell |
| `computer.revoke` | computer | `x` | Computer | shell |
| `computer.runtime` | computer | `shift+r` | Computer | shell |
| `diff.checkpoints` | diff | `p` | Diff | shell |
| `diff.comment` | diff | `c` | Diff | shell |
| `diff.commit` | diff | `shift+c` | Diff | shell |
| `diff.nextFile` | diff | `ctrl+n` | Diff | shell |
| `diff.nextHunk` | diff | `n` | Diff | shell |
| `diff.nextLine` | diff | `down` | Diff | shell |
| `diff.openBrowser` | diff | `b` | Diff | shell |
| `diff.openTerminal` | diff | `t` | Diff | shell |
| `diff.prevFile` | diff | `ctrl+p` | Diff | shell |
| `diff.prevHunk` | diff | `shift+n` | Diff | shell |
| `diff.prevLine` | diff | `up` | Diff | shell |
| `diff.pullRequest` | diff | `shift+p` | Diff | shell |
| `diff.refresh` | diff | `shift+r` | Diff | shell |
| `diff.resolve` | diff | `o` | Diff | shell |
| `diff.submitReview` | diff | `shift+s` | Diff | shell |
| `diff.threads` | diff | `shift+t` | Diff | shell |
| `diff.toggleLayout` | diff | `w` | Diff | shell |
| `goto.admin` | global | `g m` | Navigate | shell |
| `goto.agents` | global | `g e` | Navigate | shell |
| `goto.automations` | global | `g a` | Navigate | shell |
| `goto.chats` | global | `g c` | Navigate | shell |
| `goto.dashboard` | global | `g d` | Navigate | shell |
| `goto.extensions` | global | `g x` | Navigate | shell |
| `goto.projects` | global | `g p` | Navigate | shell |
| `goto.runs` | global | `g r` | Navigate | shell |
| `goto.scripts` | global | `g s` | Navigate | shell |
| `goto.settings` | global | `g ,` | Navigate | shell |
| `goto.workflows` | global | `g w` | Navigate | shell |
| `goto.workspaces` | global | `g o` | Navigate | shell |
| `list.bottom` | list | `end` | List | shell |
| `list.delete` | list | `d` | List | shell |
| `list.down` | list | `down` | List | shell |
| `list.edit` | list | `e` | List | shell |
| `list.filter` | list | `f` | List | shell |
| `list.new` | list | `n` | List | shell |
| `list.open` | list | `return` | List | shell |
| `list.pageDown` | list | `pagedown` | List | shell |
| `list.pageUp` | list | `pageup` | List | shell |
| `list.select` | list | `space` | List | shell |
| `list.sort` | list | `s` | List | shell |
| `list.top` | list | `home` | List | shell |
| `list.up` | list | `up` | List | shell |
| `list.yankId` | list | `y` | List | shell |
| `pane.close` | leader | `x` | Panes | shell |
| `pane.detach` | leader | `d` | Panes | shell |
| `pane.diagnostics` | leader | `i` | Panes | shell |
| `pane.focusDown` | leader | `down` | Panes | shell |
| `pane.focusLeft` | leader | `left` | Panes | shell |
| `pane.focusRight` | leader | `right` | Panes | shell |
| `pane.focusUp` | leader | `up` | Panes | shell |
| `pane.growSplit` | leader | `}` | Panes | shell |
| `pane.help` | leader | `?` | Panes | shell |
| `pane.lastTab` | leader | ``` | Panes | shell |
| `pane.leader` | global | `alt+l` | Panes | component |
| `pane.moveTabLeft` | leader | `<` | Panes | shell |
| `pane.moveTabRight` | leader | `>` | Panes | shell |
| `pane.newTab` | leader | `c` | Panes | shell |
| `pane.nextTab` | leader | `n` | Panes | shell |
| `pane.notifications` | leader | `b` | Panes | shell |
| `pane.prevTab` | leader | `p` | Panes | shell |
| `pane.rename` | leader | `,` | Panes | shell |
| `pane.scrollMode` | leader | `[` | Panes | shell |
| `pane.shrinkSplit` | leader | `{` | Panes | shell |
| `pane.splitHorizontal` | leader | `"` | Panes | shell |
| `pane.splitVertical` | leader | `%` | Panes | shell |
| `pane.tabNavigator` | leader | `t` | Panes | shell |
| `pane.zoom` | leader | `z` | Panes | shell |
| `run.approve` | run | `a` | Run | shell |
| `run.cancel` | run | `c` | Run | shell |
| `run.pause` | run | `p` | Run | shell |
| `run.reject` | run | `x` | Run | shell |
| `run.resume` | run | `r` | Run | shell |
| `run.retry` | run | `shift+r` | Run | shell |
| `run.stageDetail` | run | `s` | Run | shell |
| `run.verbosity` | run | `v` | Run | shell |
| `terminal.attach` | terminal | `return` | Terminal | shell |
| `terminal.follow` | terminal | `end` | Terminal | shell |
| `terminal.kill` | terminal | `d` | Terminal | shell |
| `terminal.list` | terminal | `l` | Terminal | shell |
| `terminal.new` | terminal | `n` | Terminal | shell |
| `terminal.scrollDown` | terminal | `pagedown` | Terminal | shell |
| `terminal.scrollUp` | terminal | `pageup` | Terminal | shell |
| `terminal.search` | terminal | `alt+s` | Terminal | shell |
| `terminal.yank` | terminal | `y` | Terminal | shell |
| `workflow.addEdge` | workflow | `shift+e` | Workflow | shell |
| `workflow.addStage` | workflow | `n` | Workflow | shell |
| `workflow.deleteEdge` | workflow | `shift+d` | Workflow | shell |
| `workflow.deleteStage` | workflow | `d` | Workflow | shell |
| `workflow.editStage` | workflow | `e` | Workflow | shell |
| `workflow.hooks` | workflow | `h` | Workflow | shell |
| `workflow.nextStage` | workflow | `ctrl+n` | Workflow | shell |
| `workflow.prevStage` | workflow | `ctrl+p` | Workflow | shell |
| `workflow.reload` | workflow | `shift+r` | Workflow | shell |
| `workflow.run` | workflow | `r` | Workflow | shell |
| `workflow.validate` | workflow | `shift+v` | Workflow | shell |
| `workflow.variables` | workflow | `v` | Workflow | shell |
| `workspace.collapse` | workspace | `left` | Workspace | shell |
| `workspace.download` | workspace | `d` | Workspace | shell |
| `workspace.edit` | workspace | `e` | Workspace | shell |
| `workspace.expand` | workspace | `right` | Workspace | shell |
| `workspace.refresh` | workspace | `shift+r` | Workspace | shell |
| `workspace.toggleTree` | workspace | `t` | Workspace | shell |
| `workspace.upload` | workspace | `u` | Workspace | shell |

## Administration views

| ID | Command | Shape |
|---|---|---|
| agents | `agent.list` | list |
| connections | `connect.list` | list |
| device-audit | `device.audit` | list |
| device-invites | `device.invites` | list |
| devices | `device.list` | list |
| doctor | `system.doctor` | record |
| extensions | `extension.list` | list |
| health | `system.health` | record |
| hook-phases | `hook.phases` | list |
| mcp | `system.mcpServers` | list |
| prompts | `system.artifacts` | list |
| providers | `system.models` | list |
| security-audit | `security.audit` | list |
| security-network | `security.networkAccess` | record |
| security-posture | `security.posture` | record |
| server-config | `system.config` | record |
| skills | `system.artifacts` | list |
| templates | `template.list` | list |
| version | `system.version` | record |
| widgets | `widget.list` | list |
