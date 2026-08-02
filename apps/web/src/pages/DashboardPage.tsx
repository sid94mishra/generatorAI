// ────────────────────────────────────────────────────────────────
// DashboardPage — "Mission Control".
// An operational landing view focused on what's happening right now:
//   • header heartbeat pill + quick-create actions
//   • count stats (Chats / Workflows / Automations / System Health)
//   • full-width Activity feed (Today / Running / Needs attention) with
//     inline cancel / restart / stop
// Deliberately does NOT list workflow definitions — this page is for
// live activity, not browsing. Full server health lives in
// Settings → Diagnostics.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHealth, useChats } from '@/hooks/queries.js';
import { useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { useAutomations } from '@/hooks/automationQueries.js';
import { useLiveOperations } from '@/hooks/useLiveOperations.js';
import { CreateChatDialog } from '@/components/chat/CreateChatDialog.js';
import { StatCard, Button, PageHeader } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { ActivityPanel } from '@/components/dashboard/ActivityPanel.js';
import { HealthStatCard } from '@/components/dashboard/HealthStatCard.js';
import { SystemStatusPill } from '@/components/dashboard/SystemStatusPill.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { MessageSquare, GitBranch, Zap, Radar } from 'lucide-react';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [createChatOpen, setCreateChatOpen] = useState(false);
  const openSettings = useSettingsUiStore((s) => s.openSettings);

  const { today, running, attention, isLoading } = useLiveOperations();
  const { data: health, isError } = useHealth();
  const { data: chats, isLoading: chatsLoading } = useChats();
  const { data: definitions, isLoading: defsLoading } = useWorkflowDefinitions();
  const { data: automations, isLoading: autosLoading } = useAutomations();

  const connected = !isError && !!health;

  const activeChats = chats?.filter((c) => c.status === 'active').length ?? health?.activeChats ?? 0;

  return (
    <PageContainer className="animate-fade-in">
      {/* ── Command header ── */}
      <PageHeader
        className="mb-6"
        leading={
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Radar className="h-5 w-5 text-primary-foreground" />
          </div>
        }
        title="Mission Control"
        subtitle={`${greeting()} — here's what's running across your agents`}
        actions={
          <div className="flex items-center gap-2">
            <SystemStatusPill
              connected={connected}
              runningCount={running.length}
              className="hidden sm:inline-flex"
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
              onClick={() => setCreateChatOpen(true)}
            >
              New Chat
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<GitBranch className="h-3.5 w-3.5" />}
              onClick={() => navigate('/workflows/new')}
            >
              New Workflow
            </Button>
          </div>
        }
      />

      {/* ── Counts + health — clickable, open the list / diagnostics ── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<MessageSquare className="h-5 w-5" />}
          iconTone="info"
          label="Chats"
          value={chatsLoading ? '—' : activeChats}
          onClick={() => navigate('/chats')}
        />
        <StatCard
          icon={<GitBranch className="h-5 w-5" />}
          iconTone="primary"
          label="Workflows"
          value={defsLoading ? '—' : definitions?.length ?? 0}
          onClick={() => navigate('/workflows')}
        />
        <StatCard
          icon={<Zap className="h-5 w-5" />}
          iconTone="warning"
          label="Automations"
          value={autosLoading ? '—' : automations?.length ?? 0}
          onClick={() => navigate('/automations')}
        />
        <HealthStatCard
          health={health}
          isError={isError}
          onClick={() => openSettings('diagnostics')}
        />
      </div>

      {/* ── Activity (full width) ── */}
      <ActivityPanel today={today} running={running} attention={attention} isLoading={isLoading} />

      <CreateChatDialog open={createChatOpen} onOpenChange={setCreateChatOpen} />
    </PageContainer>
  );
}

export default DashboardPage;
