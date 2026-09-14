// ────────────────────────────────────────────────────────────────
// SettingsPage — Settings as a routed page (`/settings/:section?`).
//
// The same nav rail + section content the modal used to host, but
// addressable: `/settings/source-control` is the target every "Connect
// GitHub" call-to-action links to, the browser Back button works, and
// the section survives a reload.
//
// Back goes to wherever the user came from when this page was pushed
// onto the history stack (`history.state.idx > 0`), and home otherwise —
// a deep link opened in a fresh tab must not leave the user on a dead
// Back button.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import {
  useSettingsUiStore,
  toSettingsSection,
  settingsPath,
  type SettingsSectionId,
} from '@/stores/settingsUiStore.js';
import { SETTINGS_NAV, SETTINGS_SECTIONS } from '@/components/settings/sectionRegistry.js';

/** True when this page was pushed onto an existing history stack. */
export function canGoBack(): boolean {
  if (typeof window === 'undefined') return false;
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

export function SettingsPage() {
  const navigate = useNavigate();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const section = toSettingsSection(sectionParam);
  const rememberSection = useSettingsUiStore((s) => s.setSection);

  // Keep the store's "where the user was" in sync so a later bare
  // `openSettings()` returns to this section. Deliberately NOT the store's
  // `setSection` navigation path — the URL is already the truth here.
  useEffect(() => {
    useSettingsUiStore.setState({ section });
  }, [section]);

  const goBack = useCallback(() => {
    if (canGoBack()) navigate(-1);
    else navigate('/');
  }, [navigate]);

  // Escape leaves Settings the same way the modal's Escape used to.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      goBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack]);

  const selectSection = useCallback(
    (next: SettingsSectionId) => {
      if (next === section) return;
      // `replace` so paging through sections does not bury the page the user
      // arrived from under fifteen history entries.
      navigate(settingsPath(next), { replace: true });
      rememberSection(next);
    },
    [navigate, rememberSection, section],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="settings-page">
      {/* Page header — Back + title, spanning the full width above the rail */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 sm:px-5">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={goBack}
          aria-label="Back"
          data-testid="settings-back"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          className="h-8 rounded-md px-2 text-muted-foreground hover:bg-subtle hover:text-foreground"
        >
          Back
        </Button>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Settings2 className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Settings</h2>
      </header>

      {/* Narrow viewports get a select instead of the rail. */}
      <div className="shrink-0 border-b border-border bg-subtle/40 px-4 py-2.5 sm:hidden">
        <label htmlFor="settings-section" className="sr-only">Settings section</label>
        <select
          id="settings-section"
          value={section}
          onChange={(event) => selectSection(event.target.value as SettingsSectionId)}
          className="h-10 w-full rounded-md border border-border bg-card px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {SETTINGS_NAV.map((group) => (
            <optgroup key={group.heading} label={group.heading}>
              {group.items.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left nav */}
        <nav
          aria-label="Settings sections"
          className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-subtle/40 px-3 py-4 sm:flex"
        >
          {SETTINGS_NAV.map((group) => (
            <div key={group.heading} className="space-y-1">
              <div className="px-2 pb-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {group.heading}
                </span>
              </div>
              <div className="space-y-0.5">
                {group.items.map(({ id, label, icon: Icon }) => {
                  const active = id === section;
                  return (
                    <Button
                      key={id}
                      variant="ghost"
                      onClick={() => selectSection(id)}
                      className={cn(
                        'h-auto flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-subtle hover:text-foreground',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="truncate">{label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Content — full-width scroller so the scrollbar sits at the page
            edge; an inner column keeps the reading measure comfortable. */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-8 sm:py-6">
            {SETTINGS_SECTIONS[section]}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
