// ────────────────────────────────────────────────────────────────
// F-settings-01 SettingsModal (D-26): the 960×640 S-11 frame with the
// searchable nav beside the active section. Routing is the caller's
// (app/routes/settings.routes.tsx): it passes the section from the URL and
// what "select" and "close" mean (a replace inside the modal; back to the
// background page). Section content comes from the registry
// (settingsSections.ts).
// ────────────────────────────────────────────────────────────────

import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { settingsSectionLabel, type SettingsSectionId } from '@generatorai/shared/ui-contract';
import { SettingsModalFrame } from '@/ui/shell/SettingsModalFrame/SettingsModalFrame.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { SETTINGS_SEARCH_ID, SettingsNav } from './SettingsNav.js';
import { useSettingsSection } from './settingsSections.js';

export interface SettingsModalProps {
  section: SettingsSectionId;
  onSelectSection: (section: SettingsSectionId) => void;
  onClose: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.getAttribute('role') === 'combobox';
}

export function SettingsModal({ section, onSelectSection, onClose }: SettingsModalProps) {
  const definition = useSettingsSection(section);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new section starts at the top of the frame's scroll body.
  useEffect(() => {
    bodyRef.current?.parentElement?.scrollTo?.({ top: 0 });
  }, [section]);

  // "/" focuses the nav search. The SearchInput's own shortcut stands down
  // while a dialog is open (it belongs to the page), so the modal owns it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isEditable(event.target)) return;
      const search = document.getElementById(SETTINGS_SEARCH_ID);
      if (!search) return;
      event.preventDefault();
      search.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SettingsModalFrame
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      nav={<SettingsNav active={section} onSelect={onSelectSection} />}
      footer={definition?.footer}
    >
      <div ref={bodyRef} className="pb-6" data-testid={`settings-section-${section}`}>
        <SectionBoundary key={section} label={settingsSectionLabel(section)}>
          {definition ? (
            definition.render()
          ) : (
            <SettingsSection title={settingsSectionLabel(section)} description="This section is not available in this build." />
          )}
        </SectionBoundary>
      </div>
    </SettingsModalFrame>
  );
}

interface SectionBoundaryProps {
  label: string;
  children: ReactNode;
}

/** One failing section shows its error in place; the nav and the page behind stay usable. */
class SectionBoundary extends Component<SectionBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Settings section "${this.props.label}" failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SettingsSection title={this.props.label}>
        <Callout tone="err" title="This section failed to load">
          {this.state.error.message || this.state.error.name}
        </Callout>
      </SettingsSection>
    );
  }
}
