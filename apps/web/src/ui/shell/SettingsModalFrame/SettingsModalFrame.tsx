// ────────────────────────────────────────────────────────────────
// S-11 SettingsModalFrame (03 §4 S-11). P-31 Dialog `lg` (960×640) built on
// T-05 MasterDetail with `listWidth={220}` and `bareDetail` (the content
// column owns its own close button and footer, not the template's default
// padded/scrolling slot): left nav 220 (`bg-raised`, border-r `line-soft`,
// pad 12 8, gap 1 — the caller fills it with a SearchInput `sm` + grouped
// dense NavItems from `SETTINGS_NAV`) beside the active section's content
// (close ib absolute top 14 right 14; scroll body pad 20 28 0; a C-13
// SettingsSection recipe; an optional 40h footer status bar).
//
// Frame only (D-26): `open`/`onOpenChange` and the section content are the
// caller's (P6-02 wires the route, background location and
// `open-settings`/`generatorai://settings/<section>` commands). Replaces
// `pages/SettingsPage.tsx`'s layout and `settingsUiStore`'s page navigation.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { Dialog, DialogClose } from '../../primitives/Dialog/Dialog.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { MasterDetail } from '../../templates/MasterDetail/MasterDetail.js';

export interface SettingsModalFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The left nav content: a SearchInput `sm` + grouped dense NavItems from `SETTINGS_NAV`. */
  nav: ReactNode;
  /** The active section's content (a SettingsSection tree). */
  children: ReactNode;
  /** The 40h status bar (`SettingsStatusFooter`), when the active section wants one. */
  footer?: ReactNode;
  'data-testid'?: string;
}

/** The Settings modal's 960×640 frame: searchable left nav beside the active section. */
export function SettingsModalFrame({
  open,
  onOpenChange,
  nav,
  children,
  footer,
  'data-testid': testId = 'settings-modal',
}: SettingsModalFrameProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" header={false} title="Settings" data-testid={testId}>
      <MasterDetail
        listWidth={220}
        bareDetail
        list={<div className="flex h-full flex-col gap-1 border-r border-line-soft bg-raised px-2 py-3">{nav}</div>}
        detail={
          <>
            <DialogClose
              render={
                <IconButton
                  icon="x"
                  label="Close"
                  tooltip={false}
                  size="sm"
                  className="absolute top-3.5 right-3.5"
                  data-testid={`${testId}-close`}
                />
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-5 pb-0">{children}</div>
            {footer}
          </>
        }
      />
    </Dialog>
  );
}
