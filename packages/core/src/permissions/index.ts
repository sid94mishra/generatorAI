// packages/core/src/permissions — TOL-02 / TOL-04 barrel.
export type { Permission, PermissionKind } from './Permission.js';
export type {
  PermissionMode,
  PermissionAction,
  PermissionRule,
  PermissionPolicy,
  PermissionRequest as ToolPermissionRequest,
  PermissionDecision,
} from './PermissionPolicy.js';
export {
  evaluatePermission,
  evaluateToolPermissions,
  toolMatches,
} from './PermissionPolicy.js';
export {
  makePolicyHookBridge,
  mergeHookBridges,
} from './policyHookBridge.js';
export type { PolicyHookBridgeOptions } from './policyHookBridge.js';
