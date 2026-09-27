#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { ADB } from '../../../scripts/mobile/lib/sandbox-devices.mjs';

const coreRequire = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const { tsImport } = coreRequire('tsx/esm/api');
const { STATUS_STATE_DEFS } = await tsImport('../../../packages/shared/src/status/states.ts', import.meta.url);
const statuses = Object.values(STATUS_STATE_DEFS);
const rules = new Set(['label', 'role', 'target', 'duplicate', 'image-label', 'status', 'focus-trap', 'native-audit']);
const nativeAuditTypes = new Set(['contrast', 'elementDetection', 'hitRegion', 'sufficientElementDescription', 'dynamicType', 'textClipped', 'trait']);
const interactiveRoles = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'textfield', 'slider', 'adjustable']);
const typeRoles = { button: 'button', imagebutton: 'button', switch: 'switch', checkbox: 'checkbox',
  radiobutton: 'radio', textfield: 'textfield', securetextfield: 'textfield', edittext: 'textfield',
  seekbar: 'slider', slider: 'slider', link: 'link', tab: 'tab', menuitem: 'menuitem' };

function role(node) {
  if (node.editable) return 'textfield';
  const names = [node.role, node.accessibilityRole, node.roleDescription].map(value => {
    const named = String(value ?? '').toLowerCase().replace(/[ _-]/g, '');
    return ({ textfield: 'textfield', textinput: 'textfield', search: 'textfield' })[named] ?? named;
  });
  // Raw XCTest may put RCTViewComponentView in role; its Button/TextField
  // type remains authoritative. Android exposes RN tabs via roleDescription.
  return names.find(name => interactiveRoles.has(name))
    || typeRoles[String(node.type ?? '').split('.').at(-1).toLowerCase()] || names.find(Boolean) || '';
}
function hidden(node) { return node.hidden === true || node.accessibilityHidden === true || node.visibleToUser === false; }
function interactive(node, platform) {
  return interactiveRoles.has(role(node)) || node.clickable === true || node.longClickable === true
    || (platform === 'android' && node.hittable === true && ['View', 'ViewGroup', 'FrameLayout'].includes(String(node.type ?? '').split('.').at(-1)));
}
function image(node) { return /(?:Image|ImageView|Icon)$/.test(node.type ?? '') || node.role === 'image'; }
function selector(node) { return node.identifier ? `id=${JSON.stringify(node.identifier)}` : node.label ? `label=${JSON.stringify(node.label)}` : `@${node.ref ?? node.index}`; }
function select(node, expression) {
  if (expression === `@${node.ref}`) return true;
  const match = expression.match(/^(id|label)=("(?:[^"\\]|\\.)*")$/);
  return Boolean(match && (match[1] === 'id' ? node.identifier : node.label) === JSON.parse(match[2]));
}
export function validateAllowList(allow) {
  if (!Array.isArray(allow)) throw new Error('Accessibility allowlist must be an array');
  for (const entry of allow) {
    if (!rules.has(entry.rule) || typeof entry.selector !== 'string' || !/^(?:id|label)=".+"$/.test(entry.selector)
      || !entry.reason?.trim() || !/^MD-\d+(?:\b.*)?$/.test(entry.decision ?? '')) {
      throw new Error('Every exception requires a known rule, exact id/label selector, reason and MD decision');
    }
    if (entry.rule === 'native-audit' && !nativeAuditTypes.has(entry.auditType)) throw new Error('Native audit exceptions require one explicit auditType');
  }
}
export function snapshotData(document) {
  if (document?.success === false) throw new Error('The native snapshot command failed');
  const snapshot = document?.data?.snapshot ?? document?.data ?? document?.snapshot ?? document;
  if (!Array.isArray(snapshot?.nodes) || !snapshot.nodes.length) throw new Error('Snapshot has no native nodes; capture the app again');
  if (snapshot.truncated || ['unavailable', 'sparse'].includes(snapshot.snapshotQuality?.state)) throw new Error('Snapshot is incomplete; capture the full native tree');
  return snapshot;
}
export function auditLogs(text) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const marker = lines.findLastIndex(line => line.startsWith('[agent-device][mark]['));
  return lines.slice(marker + 1).flatMap((line, index) => /\bERROR\b|\bError:|Warning: |Unhandled promise rejection|RedBox/.test(line)
    ? [{ rule: 'runtime-log', level: 'error', selector: `log:${marker + index + 2}`, message: line.trim() }] : []);
}
export function auditSnapshot(document, { platform, density = 1, allow = [], modalOpen = false, modalSelector, logs } = {}) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Platform must be ios or android');
  if (!(density > 0) || !Number.isFinite(density)) throw new Error('Android density must be a positive finite number');
  validateAllowList(allow);
  const snapshot = snapshotData(document);
  const all = snapshot.nodes.map((node, index) => ({ ...node, index: node.index ?? index }));
  const byIndex = new Map(all.map(node => [node.index, node]));
  const isDescendant = (node, ancestor) => {
    const visited = new Set();
    for (let parent = node.parentIndex; parent != null && !visited.has(parent); parent = byIndex.get(parent)?.parentIndex) {
      if (parent === ancestor.index) return true;
      visited.add(parent);
    }
    return false;
  };
  const keyboards = all.filter(node => node.type === 'Keyboard');
  // Raw XCTest includes the system keyboard's separate window, including
  // prediction buttons outside the Keyboard subtree. Never exempt a window
  // containing an app text field: an embedded/custom keyboard is app-owned.
  const keyboardWindows = platform === 'ios' ? all.filter(node => node.type === 'Window'
    && keyboards.some(keyboard => isDescendant(keyboard, node))
    && !all.some(child => role(child) === 'textfield' && isDescendant(child, node))) : [];
  const systemKeyboard = [...keyboards, ...keyboardWindows];
  const nodes = all.filter(node => !hidden(node)
    && (!snapshot.appBundleId || !node.bundleId || node.bundleId === snapshot.appBundleId)
    && !systemKeyboard.some(root => node.index === root.index || isDescendant(node, root)));
  if (!nodes.length) throw new Error('Snapshot contains no accessible app nodes; foreground the app and capture again');
  const label = node => {
    const own = String(node.contentDescription ?? node.label ?? '').trim();
    if (own || platform === 'ios' || node.editable) return own;
    // Android collects descendant text for a clickable container by default.
    return nodes.filter(child => isDescendant(child, node) && !interactive(child, platform)).map(child => child.label ?? '').join(' ').trim();
  };
  const issues = [];
  function add(rule, level, node, message) {
    const exception = allow.find(entry => entry.rule === rule && select(node, entry.selector));
    issues.push({ rule, level: exception ? 'allowed' : level, selector: selector(node), message,
      ...(exception ? { reason: exception.reason, decision: exception.decision } : {}) });
  }
  const siblings = new Map();
  for (const node of nodes) {
    if (interactive(node, platform)) {
      const accessibleLabel = label(node);
      if (!accessibleLabel) add('label', 'error', node, 'Interactive control has no accessible label');
      if (!interactiveRoles.has(role(node))) add('role', 'error', node, 'Interactive control has no meaningful role');
      const rect = node.rect ?? node.frame;
      const divisor = platform === 'android' ? density : 1;
      const width = Number(rect?.width) / divisor, height = Number(rect?.height) / divisor;
      const minimum = platform === 'ios' ? 44 : 48;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width + 0.01 < minimum || height + 0.01 < minimum) {
        add('target', 'error', node, `Control frame ${Number.isFinite(width) ? width.toFixed(1) : '?'}×${Number.isFinite(height) ? height.toFixed(1) : '?'} is below ${minimum}×${minimum} ${platform === 'ios' ? 'pt' : 'dp'}`);
      }
      if (accessibleLabel) {
        const key = JSON.stringify([node.parentIndex ?? null, role(node), accessibleLabel]);
        if (siblings.has(key)) add('duplicate', 'warning', node, 'Interactive siblings share the same role and label');
        siblings.set(key, node);
      }
    }
    if (image(node) && !label(node)) add('image-label', 'warning', node, 'Accessible image has no label');
    const status = statuses.find(status => status.label === node.label);
    const peers = nodes.filter(peer => peer.index !== node.index && peer.parentIndex === node.parentIndex);
    if (status && !peers.some(peer => image(peer) || peer.identifier?.includes(status.glyph))) {
      add('status', 'warning', node, 'Status word has no detectable glyph sibling; verify glyph + word visually');
    }
    const glyph = statuses.find(status => node.identifier?.includes(status.glyph));
    if (glyph && !peers.some(peer => peer.label === glyph.label)) add('status', 'warning', node, 'Status glyph has no word sibling');
  }
  if (modalOpen) {
    if (snapshot.visibility?.partial) throw new Error('Focus audit requires an unfiltered, complete snapshot');
    const modal = nodes.find(node => modalSelector ? select(node, modalSelector)
      : node.modal === true || node.accessibilityViewIsModal === true || /^(Dialog|Alert|Sheet)$/.test(node.type ?? '') || node.role === 'dialog');
    if (!modal) issues.push({ rule: 'focus-trap', level: 'error', selector: 'modal', message: 'No modal boundary found; pass --modal-selector with its exact id' });
    else for (const node of nodes) {
      if (node.index !== modal.index && !isDescendant(node, modal) && !isDescendant(modal, node)
        && (interactive(node, platform) || label(node))) add('focus-trap', 'error', node, 'Accessible content remains outside the open modal');
    }
  }
  if (logs !== undefined) issues.push(...auditLogs(logs));
  return issues;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    platform: { type: 'string' }, density: { type: 'string' }, serial: { type: 'string' }, logs: { type: 'string' },
    allow: { type: 'string' }, 'modal-open': { type: 'boolean' }, 'modal-selector': { type: 'string' }, json: { type: 'boolean' },
  } });
  if (positionals.length !== 1) throw new Error('Usage: node apps/mobile/e2e/a11y-check.mjs snapshot.json --platform ios|android [--density N] [--logs file] [--modal-open --modal-selector \'id="drawer"\']');
  const document = JSON.parse(await fs.readFile(positionals[0], 'utf8'));
  let density = values.density === undefined ? 1 : Number(values.density);
  if (values.platform === 'android' && values.density === undefined) {
    const args = [...(values.serial ? ['-s', values.serial] : []), 'shell', 'wm', 'density'];
    const output = execFileSync(ADB, args, { encoding: 'utf8', timeout: 15000 });
    const matches = [...output.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
    if (!matches.length) throw new Error('Cannot read Android display density; pass --density explicitly');
    density = Number(matches.at(-1)[1]) / 160;
  }
  const allow = JSON.parse(await fs.readFile(values.allow ?? new URL('./a11y-allow.json', import.meta.url), 'utf8'));
  const issues = auditSnapshot(document, { platform: values.platform, density, allow,
    modalOpen: values['modal-open'], modalSelector: values['modal-selector'],
    ...(values.logs ? { logs: await fs.readFile(values.logs, 'utf8') } : {}) });
  if (values.json) console.log(JSON.stringify(issues, null, 2));
  else if (issues.length) console.table(issues);
  else console.log('Accessibility snapshot: no findings');
  process.exitCode = issues.some(issue => issue.level === 'error') ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`a11y-check: ${error.message}`); process.exitCode = 1; });
}
