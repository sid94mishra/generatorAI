// ────────────────────────────────────────────────────────────────
// Expression v2 AST. Every node carries its source span so type errors
// point at the offending text.
// ────────────────────────────────────────────────────────────────

export interface Span {
  /** Offset of the first character (inclusive). */
  start: number;
  /** Offset after the last character (exclusive). */
  end: number;
}

export type LiteralValue = string | number | boolean | null;

export type ExprNode =
  | ({ type: 'literal'; value: LiteralValue } & Span)
  | ({ type: 'list'; items: ExprNode[] } & Span)
  | ({ type: 'ident'; name: string } & Span)
  | ({ type: 'member'; object: ExprNode; property: string } & Span)
  | ({ type: 'index'; object: ExprNode; index: ExprNode } & Span)
  | ({ type: 'call'; callee: string; args: ExprNode[] } & Span)
  | ({ type: 'lambda'; param: string; body: ExprNode } & Span)
  | ({ type: 'unary'; op: 'not'; operand: ExprNode } & Span)
  | ({ type: 'binary'; op: ComparisonOp; left: ExprNode; right: ExprNode } & Span)
  | ({ type: 'logical'; op: 'and' | 'or'; left: ExprNode; right: ExprNode } & Span);

export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';

/** A diagnostic located in the source text. */
export interface ExprDiagnostic extends Span {
  code: string;
  message: string;
  hint?: string;
}

/** The dotted path of a pure path expression (`a.b.c`), or null when the node is not one. */
export function pathOf(node: ExprNode): string[] | null {
  if (node.type === 'ident') return [node.name];
  if (node.type === 'member') {
    const base = pathOf(node.object);
    return base ? [...base, node.property] : null;
  }
  return null;
}

/** Visit every node, depth first, parents before children. */
export function walkExpr(node: ExprNode, visit: (n: ExprNode) => void): void {
  visit(node);
  switch (node.type) {
    case 'list':
      node.items.forEach((i) => walkExpr(i, visit));
      break;
    case 'member':
      walkExpr(node.object, visit);
      break;
    case 'index':
      walkExpr(node.object, visit);
      walkExpr(node.index, visit);
      break;
    case 'call':
      node.args.forEach((a) => walkExpr(a, visit));
      break;
    case 'lambda':
      walkExpr(node.body, visit);
      break;
    case 'unary':
      walkExpr(node.operand, visit);
      break;
    case 'binary':
    case 'logical':
      walkExpr(node.left, visit);
      walkExpr(node.right, visit);
      break;
    default:
      break;
  }
}
