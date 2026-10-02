// Chat (Main, MChatRunning; 04 §2.3) → features/chat/ChatScreen. M6 transition: the pane tabs whose blocks have not
// landed yet render here (legacy code stays out of features); M6-08…M6-11 remove them.
import React from 'react';

import ChatScreen from '../../../../src/features/chat/ChatScreen';
import { WorkbenchTab } from '../../../../src/components/workbench/WorkbenchTab';

export default function ChatRoute(): React.ReactElement {
  return (
    <ChatScreen
      renderLegacyTab={(type, ctx, pane) => (
        <WorkbenchTab
          type={type}
          active={ctx.active}
          workspaceId={pane.workspaceId}
          scopes={pane.scopes}
          chatId={pane.chatId}
          planId={pane.planId}
          agentBusy={pane.agentBusy}
          onOpenInChanges={pane.onOpenInChanges}
          onPlanDecided={pane.onPlanDecided}
        />
      )}
    />
  );
}
