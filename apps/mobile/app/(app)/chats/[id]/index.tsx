// Chat (Main, MChatRunning; 04 §2.3) → features/chat/ChatScreen. M6 transition: the pane tabs whose blocks have not
// landed yet and the legacy changes tray are rendered here (legacy code stays out of features); M6-07…M6-11 remove both.
import React from 'react';

import ChatScreen from '../../../../src/features/chat/ChatScreen';
import { ChangesTray } from '../../../../src/components/chat/panes/ChangesTray';
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
          changesFocus={pane.changesFocus}
          onOpenInChanges={pane.onOpenInChanges}
          onPlanDecided={pane.onPlanDecided}
        />
      )}
      renderChangesDock={(props) => <ChangesTray {...props} />}
    />
  );
}
