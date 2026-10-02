// ML-08 PaneTabStrip contract (03 ML-08; MD-23, MD-02).
import type { MobileIconConcept } from '@generatorai/design-tokens';
import type { DockTabType } from '@generatorai/shared/ui-contract';

export interface PaneTab {
  id: string;
  type: DockTabType;
  label: string;
  icon: MobileIconConcept;
  /** Inline mono count (changed files, running tasks). */
  count?: number;
  /** Needs you: a warn dot (Plan to approve, Computer consent). */
  attention?: boolean;
  /** instanceChips: the chip shows ✕ "Close <label>". */
  closable?: boolean;
}

export interface PaneTabStripProps {
  tabs: ReadonlyArray<PaneTab>;
  active: string;
  onSelect: (id: string) => void;
  /** 'tabs' (the pane's tab row) or 'instanceChips' (Terminal instances, Browser pages inside their tab). */
  variant?: 'tabs' | 'instanceChips';
  onClose?: (id: string) => void;
  /** instanceChips: the trailing "+"; hidden at the cap. */
  onAdd?: () => void;
  addLabel?: string;
  /** "Workspace tabs" / "Terminals". */
  accessibilityLabel: string;
  /** Tabs get `pane-tab-<type>`, chips `pane-instance-<id>` (MD-95). */
  testID?: string;
}
