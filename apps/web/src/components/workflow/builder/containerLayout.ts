// ────────────────────────────────────────────────────────────────
// containerLayout — geometry of container stages (loops, P05 §2.1)
// on the builder canvas.
//
// A container renders as a React Flow group node and its body stages
// are child nodes (`parentId`), so a body node's `position` is relative
// to its container. The document stores ABSOLUTE canvas positions for
// every stage (a reader without groups still sees a sensible picture),
// so the conversion happens exactly twice: `canvasNodesFromStages` on
// load and `absolutePosition` in `toGraph`.
//
// A container has no stored size: it is auto-sized around its body
// (`fitContainers`) after every structural change and at the end of a
// drag; while a child is dragged, React Flow's `expandParent` grows it.
// ────────────────────────────────────────────────────────────────

import type { Edge, Node } from '@xyflow/react';
import { CONTAINER_STAGE_KINDS, type StageSpec } from '@generatorai/workflow-spec';
import { getLayoutedElements } from '@/utils/dagLayout.js';
import type { StageNodeData } from '@/stores/workflowBuilderStore.js';

type StageFlowNode = Node<StageNodeData>;

/** Horizontal and bottom padding inside a container. */
export const GROUP_PAD = 28;
/** Height of a container's header band (its body starts below it). */
export const GROUP_HEADER = 64;
export const GROUP_MIN_WIDTH = 340;
export const GROUP_MIN_HEIGHT = 170;
/** Size of a stage node before React Flow has measured it. */
export const STAGE_WIDTH = 280;
export const STAGE_HEIGHT = 104;

export function isContainerStage(stage: StageSpec): boolean {
  return CONTAINER_STAGE_KINDS.includes(stage.kind);
}

/** The node's size: a container's fitted size, else the measured (or default) size. */
export function nodeSize(node: StageFlowNode): { width: number; height: number } {
  if (isContainerStage(node.data.stage)) {
    return {
      width: node.width ?? node.measured?.width ?? GROUP_MIN_WIDTH,
      height: node.height ?? node.measured?.height ?? GROUP_MIN_HEIGHT,
    };
  }
  return { width: node.measured?.width ?? STAGE_WIDTH, height: node.measured?.height ?? STAGE_HEIGHT };
}

/** Number of enclosing containers of a node (its `parentId` chain). */
export function nodeDepth(id: string, byId: ReadonlyMap<string, StageFlowNode>): number {
  let depth = 0;
  let p = byId.get(id)?.parentId;
  while (p && depth < 16) {
    depth++;
    p = byId.get(p)?.parentId;
  }
  return depth;
}

/** Canvas position of a node: its own position plus every enclosing container's. */
export function absolutePosition(id: string, byId: ReadonlyMap<string, StageFlowNode>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node = byId.get(id);
  let guard = 0;
  while (node && guard++ < 16) {
    x += node.position.x;
    y += node.position.y;
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return { x, y };
}

/** Keys of every stage inside `key` (its body, their bodies, …), by `parentId`. */
export function descendantIds(key: string, nodes: readonly StageFlowNode[]): string[] {
  const out: string[] = [];
  const frontier = [key];
  while (frontier.length > 0) {
    const parent = frontier.shift()!;
    for (const n of nodes) {
      if (n.parentId === parent && !out.includes(n.id)) {
        out.push(n.id);
        frontier.push(n.id);
      }
    }
  }
  return out;
}

/** The attributes a body node carries: its container, clamped to it, growing it when dragged to the edge. */
export function parentAttrs(parentId: string | undefined): Pick<StageFlowNode, 'parentId' | 'extent' | 'expandParent'> {
  return parentId ? { parentId, extent: 'parent', expandParent: true } : {};
}

/** A copy of `node` in another container (or at the top level), without stale parent attributes. */
export function withParent(node: StageFlowNode, parentId: string | undefined): StageFlowNode {
  const { parentId: _p, extent: _e, expandParent: _x, ...rest } = node;
  return { ...rest, ...parentAttrs(parentId) };
}

/**
 * React Flow needs a parent before its children in the node array. Keeps
 * the given order otherwise (so a document that already lists containers
 * first round-trips in the same order); a child waiting for its parent is
 * emitted right after it.
 */
export function orderParentsFirst(nodes: readonly StageFlowNode[]): StageFlowNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const out: StageFlowNode[] = [];
  const done = new Set<string>();
  const waiting = new Map<string, StageFlowNode[]>();
  const emit = (n: StageFlowNode) => {
    out.push(n);
    done.add(n.id);
    const children = waiting.get(n.id);
    if (children) {
      waiting.delete(n.id);
      children.forEach(emit);
    }
  };
  for (const n of nodes) {
    if (!n.parentId || done.has(n.parentId) || !ids.has(n.parentId)) emit(n);
    else waiting.set(n.parentId, [...(waiting.get(n.parentId) ?? []), n]);
  }
  // A parentId chain that loops never reaches `done`: show those at the top level.
  for (const children of waiting.values()) for (const n of children) if (!done.has(n.id)) emit(withParent(n, undefined));
  return out;
}

/**
 * Size every container around its body and move the body so it starts
 * just inside the padding. The container moves the other way, so every
 * body stage keeps its canvas position. Innermost containers first, since
 * a container's size is part of its parent's body.
 */
export function fitContainers(nodes: readonly StageFlowNode[]): StageFlowNode[] {
  const result = [...nodes];
  const index = new Map(result.map((n, i) => [n.id, i]));
  const byId = new Map(result.map((n) => [n.id, n]));
  const containers = result
    .filter((n) => isContainerStage(n.data.stage))
    .map((n) => ({ id: n.id, depth: nodeDepth(n.id, byId) }))
    .sort((a, b) => b.depth - a.depth);

  for (const { id } of containers) {
    const i = index.get(id)!;
    const container = result[i]!;
    const children = result.filter((n) => n.parentId === id);
    if (children.length === 0) {
      if (container.width !== GROUP_MIN_WIDTH || container.height !== GROUP_MIN_HEIGHT) {
        result[i] = { ...container, width: GROUP_MIN_WIDTH, height: GROUP_MIN_HEIGHT };
      }
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of children) {
      const { width, height } = nodeSize(c);
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + width);
      maxY = Math.max(maxY, c.position.y + height);
    }
    const dx = Math.round(GROUP_PAD - minX);
    const dy = Math.round(GROUP_HEADER - minY);
    const width = Math.max(GROUP_MIN_WIDTH, Math.round(maxX - minX + GROUP_PAD * 2));
    const height = Math.max(GROUP_MIN_HEIGHT, Math.round(maxY - minY + GROUP_HEADER + GROUP_PAD));
    if (dx !== 0 || dy !== 0) {
      for (const c of children) {
        const j = index.get(c.id)!;
        result[j] = { ...result[j]!, position: { x: result[j]!.position.x + dx, y: result[j]!.position.y + dy } };
      }
    }
    if (dx !== 0 || dy !== 0 || container.width !== width || container.height !== height) {
      result[i] = {
        ...container,
        position: { x: container.position.x - dx, y: container.position.y - dy },
        width,
        height,
      };
    }
  }
  return result;
}

/**
 * Dagre layout, one scope at a time: each container's body is laid out
 * inside it (innermost first), then its parent's scope treats the fitted
 * container as one node. Edges never cross a scope, so every edge belongs
 * to exactly one of these layouts.
 */
export function layoutScoped<E extends Edge>(nodes: readonly StageFlowNode[], edges: readonly E[]): StageFlowNode[] {
  let result = [...nodes];
  const byId = new Map(result.map((n) => [n.id, n]));
  const scopeOf = (n: StageFlowNode) => n.parentId ?? '';
  const scopes = [...new Set(result.map(scopeOf))]
    .map((scope) => ({ scope, depth: scope ? nodeDepth(scope, byId) + 1 : 0 }))
    .sort((a, b) => b.depth - a.depth);

  for (const { scope } of scopes) {
    const members = result.filter((n) => scopeOf(n) === scope);
    const ids = new Set(members.map((n) => n.id));
    // dagre sizes a node from `measured`; a container's size is its fitted size.
    const sized = members.map((n) => ({ ...n, measured: nodeSize(n) }));
    const scopeEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const laid = getLayoutedElements(sized, [...scopeEdges], 'LR').nodes;
    const positions = new Map(laid.map((n) => [n.id, n.position]));
    result = result.map((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
    if (scope) result = fitContainers(result);
  }
  return fitContainers(result);
}

/**
 * Nodes for the stages of a document. `parentId` is set only for a valid
 * parent (an existing container, no loop in the chain): anything else is
 * drawn at the top level and the validator reports it.
 */
export function canvasNodesFromStages(
  stages: readonly StageSpec[],
  toNode: (stage: StageSpec, position: { x: number; y: number }, parentId: string | undefined) => StageFlowNode,
  edges: readonly Edge[],
): StageFlowNode[] {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const validParent = (stage: StageSpec): string | undefined => {
    const seen = new Set([stage.key]);
    let p = stage.parentKey;
    const direct = p;
    while (p !== undefined) {
      const parent = byKey.get(p);
      if (!parent || !isContainerStage(parent) || seen.has(p)) return undefined;
      seen.add(p);
      p = parent.parentKey;
    }
    return direct;
  };

  const allPositioned = stages.every((s) => s.position !== undefined);
  const nodes = stages.map((stage, i) => {
    const parentId = validParent(stage);
    const abs = stage.position ?? { x: i * 320, y: 100 };
    // Stored positions are absolute; a body node's is relative to its container.
    const parentAbs = parentId ? byKey.get(parentId)?.position : undefined;
    const position = allPositioned && parentAbs ? { x: abs.x - parentAbs.x, y: abs.y - parentAbs.y } : abs;
    return toNode(stage, position, parentId);
  });
  const ordered = orderParentsFirst(nodes);
  if (stages.length === 0) return ordered;
  return allPositioned ? fitContainers(ordered) : layoutScoped(ordered, edges);
}
