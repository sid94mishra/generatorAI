Add a new page called **Connections** to the "GeneratorAI Redesign – Desktop & Web" canvas, and design its boards in
the same design language as the existing boards (Instrument theme, the current sidebar, rail, header, dock, Activity
column, cards, gate cards, steppers and settings layouts). Reuse existing components wherever one fits. Desktop boards
are 1440×900, narrow-window variants 1100×760. Draw every board in Instrument dark, and draw the catalogue, the
connection detail and the Slack setup in Instrument light as well. Use real, specific copy (no lorem ipsum, no invented
statistics). Where a brand mark is needed, use a simple neutral monogram tile with the app's name rather than an
official logo.

## What Connections is

Connections let a person connect GeneratorAI to the third-party apps they already use — Slack, Discord, Gmail and
Google Drive, Outlook and Teams, Notion, Figma, GitHub, Linear, Jira and Confluence, Sentry — or to any MCP server.
Agents then use those apps as tools in chats, workflow stages and automations. Some connections can also **start
work**: when someone @mentions GeneratorAI in Slack, a new chat (or an automation run) starts and replies in the same
Slack thread.

Everything runs on the person's own machine: tokens stay in the local vault and never reach the model. Every tool a
connection offers has a risk class:

- **Read** — allowed by default.
- **Write** — asks by default.
- **Send / post / delete** — asks and is marked Risky. On a phone it needs Face ID.

Each tool can be set to Allow, Ask or Block.

Connections authenticate in three ways, and the boards should make the difference clear without jargon:

1. **Sign in** — OAuth in the system browser (Notion, Linear, GitHub, Atlassian, Sentry).
2. **Your own app** — a guided setup where the person creates an internal app in their own Slack workspace, Google Cloud
   project or Microsoft tenant and pastes the credentials. It's needed because those vendors only let registered apps
   connect, and it keeps the data private.
3. **Token or key** — Discord bot token, Figma personal token, API keys, or none, for a custom MCP server.

## Navigation

Add **Connections** as a top-level destination in the sidebar and the rail, after Scripts, with a plug icon. It
replaces Settings › MCP servers (a custom MCP server is now just another connection).

## Boards to create

1. **Connections · catalogue.** Sidebar with Connections selected.
   - **Header:** "Connections", a search field, and tabs "All apps / Connected".
   - **Featured row:** Slack, Gmail, Notion, GitHub.
   - **Category sections:** Communication (Slack, Discord, Gmail, Outlook, Teams); Docs and knowledge (Notion, Google
     Drive, Docs, SharePoint, Confluence); Design (Figma); Development (GitHub, Linear, Jira, Sentry); Custom (Custom MCP
     server).
   - **Each tile:** monogram, name, one line on what agents can do with it ("Read and post messages, reply in threads"),
     an auth badge (Sign in / Your own app / Token), and "Connected · 2 accounts" when connected.
2. **Connections · my connections.** A list or table:
   - **Columns:** app and account (e.g. "Slack · Acme workspace", "Gmail · maya@acme.dev"), status, used by ("3 agents ·
     1 workflow · 1 automation"), events ("@mentions on" / off), last used, row actions.
   - **Status chips:** Connected / Reconnect needed / Error / Off.
   - **Two accounts of the same app:** two Slack workspaces.
   - **Empty state** too.
3. **Connect · sign in (OAuth)** — Notion as the example, in a dialog.
   - **Before:** what agents will be able to read and do, the permissions requested in plain words, which server it
     connects to, and "Continue in browser".
   - **Waiting:** "Finish signing in in your browser", with Cancel.
   - **Success:** account name and "14 tools found · 9 read, 4 write, 1 risky", with "Choose who can use it".
   - **Errors:** sign-in cancelled; "This server's sign-in page changed — reconnect to be safe" (issuer mismatch); timed
     out.
4. **Connect · Slack (your own app).** A stepper:
   1. **Create the app:** a generated app manifest with Copy, and "Open Slack app setup". Explain in one line why ("Slack
      only lets registered apps connect. Your own app stays private to your workspace.").
   2. **Install it to your workspace.**
   3. **Paste the bot token and the app-level token:** masked inputs, inline validation, where to find each.
   4. **Test:** "Connected to Acme · listening for @mentions".
   5. **Optional:** "Also connect Slack's own tools" (sign in with your Slack account for search and canvases).
5. **Connect · Google and Microsoft (your own app).** One board with two variants of the same stepper:
   - **Shared steps:** create the OAuth client, copy the redirect address, paste the client ID and secret, sign in, test.
   - **Google:** a clear note that a Google Cloud client in Testing mode needs reconnecting every 7 days, and how to
     avoid that.
   - **Microsoft:** a "Use a device code instead" option.
6. **Connection detail.** "Slack · Acme workspace" with status, Reconnect and Disconnect. Tabs:
   - **Overview:** account, permissions granted, health ("Listening · last event 2 min ago"), token renewal ("Renews
     automatically").
   - **Tools:** every tool with a read/write/risky chip and an Allow/Ask/Block segmented control; bulk actions by risk
     class.
   - **Access:** which agents, projects, workflows and automations may use this connection, and with which tools.
   - **Events:** the event sources and the triggers attached to them.
   - **Activity:** a log of every tool call — time, agent, chat or run, tool, result, who approved — with links.
   Include a "Reconnect needed" banner variant. Also draw the 1100×760 narrow variant.
7. **Trigger editor** — "When someone @mentions GeneratorAI in Slack".
   - **Filters:** channels, and which people may trigger it (allowlist, deny by default).
   - **Target, as two choices:**
     - Start a new chat: agent, project, permission mode, "Reply in the Slack thread" toggle.
     - Run an automation: pick one, map the message to its inputs.
   - **Safety note:** "Messages from Slack are untrusted. Risky actions in these chats always ask, even if the agent
     normally allows them."
   - **Test:** "Send a test event", with a preview of the chat it would start.
8. **Chat started from Slack.** A normal chat page whose header shows where it came from ("From Slack · #support ·
   @maya · thread"). Replies show "Posted to the Slack thread". The Activity column shows it too.
9. **Approvals for connector actions.**
   - **In a chat:** a gate card for "Post to #releases in Acme Slack", marked Risky, with a preview of the message and
     Deny / Allow once / Always allow this tool. Also a write-but-not-risky example: "Create a Notion page in
     Engineering".
   - **Consent card:** "This agent wants to use Gmail, which isn't connected" with Connect / Not now.
   - **Activity card:** the same gate as a Needs-you card in the Activity column.
10. **Reconnect states.** "Reconnect Notion" as:
    - a Needs-you card in the Activity column;
    - a banner on the connection;
    - a tool-error step in a chat transcript with a Reconnect button.
11. **Choosing connections where agents are set up.**
    - **Agent editor Tools section:** a "Connections" picker — pick a connection, then all tools or selected tools.
    - **Workflow stage Tools tab:** the same picker.
    - **Chat composer "+" menu:** connections available to this chat, with their status.
12. **Add a custom MCP server.**
    - **Address or command:** a URL, or a command to run on this computer, with a clear warning that a command runs
      with your permissions and shows exactly what will run.
    - **Sign-in method:** automatic sign-in / API key / none.
    - **Test:** tool discovery — "Found 8 tools".
13. **Connections · narrow window (1100×760).** The catalogue and the my-connections list at narrow width.

Also add a short annotation board, **Connection card · anatomy and states**, showing the tile, list row and status
chips in every state (Connected, Connecting, Reconnect needed, Error, Off, Listening for events), in the style of the
existing "Activity card · anatomy and states" board.
