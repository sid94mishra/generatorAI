import { describe, expect, it } from 'vitest';
import { auditSnapshot, auditLogs, validateAllowList } from './a11y-check.mjs';

const button = (extra = {}) => ({ index: 1, parentIndex: 0, type: 'Button', label: 'Send', identifier: 'composer-send', rect: { x: 0, y: 0, width: 44, height: 44 }, ...extra });
const snapshot = nodes => ({ success: true, data: { nodes, appBundleId: 'dev.generatorai.app' } });

describe('native accessibility snapshot audit', () => {
  it('uses iOS points and measures the control frame, never hitSlop', () => {
    expect(auditSnapshot(snapshot([button()]), { platform: 'ios' })).toEqual([]);
    const issues = auditSnapshot(snapshot([button({ rect: { width: 32, height: 44 }, hitSlop: 20 })]), { platform: 'ios' });
    expect(issues.map(issue => issue.rule)).toEqual(['target']);
  });
  it('recognizes raw XCTest controls whose role is a native implementation class', () => {
    const node = button({ role: 'RCTViewComponentView', rect: { width: 32, height: 44 } });
    expect(auditSnapshot(snapshot([node]), { platform: 'ios' })).toMatchObject([{ rule: 'target', level: 'error' }]);
  });
  it('converts Android physical pixels to dp and accepts content descriptions on editable inputs', () => {
    const field = { index: 0, type: 'android.widget.EditText', editable: true, label: 'gai-phone', contentDescription: 'Name', rect: { width: 126, height: 126 } };
    expect(auditSnapshot(snapshot([field]), { platform: 'android', density: 2.625 })).toEqual([]);
    expect(auditSnapshot(snapshot([{ ...field, rect: { width: 125, height: 126 } }]), { platform: 'android', density: 2.625 })).toMatchObject([{ rule: 'target', level: 'error' }]);
  });
  it('honors Android semantic role descriptions while checking their native frames', () => {
    const tab = { index: 0, type: 'android.view.View', label: 'Today', roleDescription: 'Tab', hittable: true, rect: { width: 48, height: 48 } };
    expect(auditSnapshot(snapshot([tab]), { platform: 'android' })).toEqual([]);
    expect(auditSnapshot(snapshot([{ ...tab, rect: { width: 48, height: 40 } }]), { platform: 'android' })).toMatchObject([{ rule: 'target' }]);
  });
  it('requires labels and roles without treating scroll views or hidden images as buttons', () => {
    const nodes = [{ index: 0, type: 'android.widget.ScrollView', hittable: true },
      { index: 1, type: 'android.widget.ImageView', hidden: true },
      { index: 2, type: 'android.view.ViewGroup', hittable: true, rect: { width: 48, height: 48 } }];
    expect(auditSnapshot(snapshot(nodes), { platform: 'android' }).map(issue => issue.rule)).toEqual(['label', 'role']);
  });
  it('detects duplicate interactive siblings and unlabeled images, excluding system UI', () => {
    const nodes = [button(), button({ index: 2 }), { index: 3, type: 'Image' },
      button({ index: 4, label: '', rect: {}, bundleId: 'com.apple.springboard' })];
    expect(auditSnapshot(snapshot(nodes), { platform: 'ios' }).map(issue => issue.rule)).toEqual(['duplicate', 'image-label']);
  });
  it('excludes the iOS system keyboard window without dropping app controls', () => {
    const nodes = [{ index: 0, type: 'Application' }, { index: 1, parentIndex: 0, type: 'Window' },
      button({ index: 2, parentIndex: 1, label: '' }),
      { index: 3, parentIndex: 0, type: 'Window' }, { index: 4, parentIndex: 3, type: 'Keyboard' },
      button({ index: 5, parentIndex: 3, label: '', rect: {} })];
    expect(auditSnapshot(snapshot(nodes), { platform: 'ios' })).toMatchObject([{ rule: 'label' }]);
  });
  it('allows only the exact documented exception and keeps unrelated errors failing', () => {
    const allow = [{ rule: 'target', selector: 'id="composer-send"', reason: 'Fixture for an explicit MD-91 exception', decision: 'MD-91' }];
    const issues = auditSnapshot(snapshot([button({ rect: { width: 30, height: 30 } }), button({ index: 2, identifier: 'other', label: '' })]), { platform: 'ios', allow });
    expect(issues.find(issue => issue.rule === 'target').level).toBe('allowed');
    expect(issues.find(issue => issue.rule === 'label').level).toBe('error');
    expect(() => validateAllowList([{ ...allow[0], selector: '*' }])).toThrow();
    expect(() => validateAllowList([{ ...allow[0], reason: '' }])).toThrow();
    expect(() => validateAllowList([{ ...allow[0], rule: 'native-audit' }])).toThrow();
    expect(() => validateAllowList([{ ...allow[0], rule: 'native-audit', auditType: 'contrast' }])).not.toThrow();
  });
  it('checks modal descendants while allowing structural ancestors', () => {
    const nodes = [{ index: 0, type: 'Application', label: 'GeneratorAI' },
      { index: 1, parentIndex: 0, type: 'Other', identifier: 'drawer' },
      button({ index: 2, parentIndex: 1 }), button({ index: 3, parentIndex: 0, label: 'Background' })];
    const issues = auditSnapshot(snapshot(nodes), { platform: 'ios', modalOpen: true, modalSelector: 'id="drawer"' });
    expect(issues).toMatchObject([{ rule: 'focus-trap', selector: 'id="composer-send"' }]);
    expect(auditSnapshot(snapshot(nodes.slice(0, 3)), { platform: 'ios', modalOpen: true, modalSelector: 'id="drawer"' })).toEqual([]);
    expect(auditSnapshot(snapshot(nodes), { platform: 'ios', modalOpen: true })).toMatchObject([{ rule: 'focus-trap', selector: 'modal' }]);
  });
  it('uses shared status words and glyph identifiers for advisory pairing checks', () => {
    const word = { index: 1, parentIndex: 0, type: 'StaticText', label: 'Running' };
    expect(auditSnapshot(snapshot([word]), { platform: 'ios' })).toMatchObject([{ rule: 'status', level: 'warning' }]);
    expect(auditSnapshot(snapshot([word, { index: 2, parentIndex: 0, type: 'Image', label: 'Running indicator', identifier: 'status-running' }]), { platform: 'ios' })).toEqual([]);
  });
  it('rejects failed, empty and truncated captures instead of reporting a false pass', () => {
    for (const input of [{ success: false }, snapshot([]), { nodes: [button()], truncated: true }, { nodes: [button()], snapshotQuality: { state: 'sparse' } }]) {
      expect(() => auditSnapshot(input, { platform: 'ios' })).toThrow();
    }
    expect(() => auditSnapshot(snapshot([button()]), { platform: 'android', density: 0 })).toThrow();
    expect(() => auditSnapshot(snapshot([button({ bundleId: 'com.android.launcher' })]), { platform: 'android' })).toThrow();
  });
  it('audits only runtime messages after the most recent agent-device marker', () => {
    const issues = auditLogs('ERROR old\n[agent-device][mark][2026-09-27T00:00:00Z] first\nWarning: old\n[agent-device][mark][2026-09-27T00:00:01Z] task M1\nINFO Ready\nError: failed\nUnhandled promise rejection\n');
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ rule: 'runtime-log', level: 'error', selector: 'log:6' });
  });
});
