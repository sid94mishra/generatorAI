// ────────────────────────────────────────────────────────────────
// The command registry.
//
// A registry is an ordered, immutable-after-freeze collection of
// CommandSpecs with lookup by id, by invocation path and by alias. It is the
// only thing the five generators in this directory read.
// ────────────────────────────────────────────────────────────────

import { CliError } from '../errors/CliError.js';
import { commandPath, type CommandSpec } from './CommandSpec.js';

export interface GroupInfo {
  name: string;
  aliases: string[];
  summary: string;
  commands: CommandSpec[];
}

/** Declared separately from the commands so a group can carry its own alias. */
export interface GroupDeclaration {
  name: string;
  aliases?: string[];
  summary: string;
  /** Groups sort by this, then alphabetically. Lower comes first. */
  order?: number;
}

export class CommandRegistry {
  private readonly byId = new Map<string, CommandSpec>();
  private readonly byPath = new Map<string, CommandSpec>();
  private readonly groups = new Map<string, GroupDeclaration>();
  private frozen = false;

  declareGroup(group: GroupDeclaration): this {
    this.assertMutable();
    if (this.groups.has(group.name)) {
      throw CliError.internal(`Duplicate group declaration: ${group.name}`);
    }
    this.groups.set(group.name, group);
    return this;
  }

  register(...specs: CommandSpec[]): this {
    this.assertMutable();
    for (const spec of specs) {
      if (this.byId.has(spec.id)) {
        throw CliError.internal(`Duplicate command id: ${spec.id}`);
      }
      this.byId.set(spec.id, spec);

      for (const path of this.invocationPaths(spec)) {
        const existing = this.byPath.get(path);
        if (existing && existing.id !== spec.id) {
          throw CliError.internal(
            `Command path "${path}" is claimed by both ${existing.id} and ${spec.id}.`,
          );
        }
        this.byPath.set(path, spec);
      }
    }
    return this;
  }

  /** Every string that resolves to this spec: canonical path, aliases, deprecated spellings. */
  private invocationPaths(spec: CommandSpec): string[] {
    const groupNames = [spec.group, ...(this.groups.get(spec.group)?.aliases ?? [])];
    const verbs = spec.verb ? [spec.verb, ...(spec.aliases ?? [])] : [''];
    const paths: string[] = [];
    for (const g of groupNames) {
      for (const v of verbs) paths.push(v ? `${g} ${v}` : g);
    }
    paths.push(...(spec.deprecates ?? []));
    return paths;
  }

  freeze(): this {
    this.frozen = true;
    return this;
  }

  private assertMutable(): void {
    if (this.frozen) throw CliError.internal('The command registry is frozen.');
  }

  get(id: string): CommandSpec | undefined {
    return this.byId.get(id);
  }

  /** Resolve argv tokens to a command, longest-path-first. Returns leftover argv. */
  resolve(tokens: string[]): { spec: CommandSpec; rest: string[] } | undefined {
    for (let take = Math.min(tokens.length, 4); take >= 1; take--) {
      const path = tokens.slice(0, take).join(' ');
      const spec = this.byPath.get(path);
      if (spec) return { spec, rest: tokens.slice(take) };
    }
    return undefined;
  }

  all(): CommandSpec[] {
    return [...this.byId.values()];
  }

  visible(): CommandSpec[] {
    return this.all().filter((s) => !s.hidden);
  }

  groupList(): GroupInfo[] {
    const infos = new Map<string, GroupInfo>();
    for (const spec of this.visible()) {
      const decl = this.groups.get(spec.group);
      let info = infos.get(spec.group);
      if (!info) {
        info = {
          name: spec.group,
          aliases: decl?.aliases ?? [],
          summary: decl?.summary ?? '',
          commands: [],
        };
        infos.set(spec.group, info);
      }
      info.commands.push(spec);
    }
    for (const info of infos.values()) {
      info.commands.sort((a, b) => commandPath(a).localeCompare(commandPath(b)));
    }
    return [...infos.values()].sort((a, b) => {
      const oa = this.groups.get(a.name)?.order ?? 100;
      const ob = this.groups.get(b.name)?.order ?? 100;
      return oa === ob ? a.name.localeCompare(b.name) : oa - ob;
    });
  }

  groupDeclaration(name: string): GroupDeclaration | undefined {
    return this.groups.get(name);
  }

  /**
   * Ranked fuzzy search over path + summary. Powers the TUI palette and the
   * "did you mean" line on an unknown command.
   */
  search(query: string, limit = 20): CommandSpec[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.visible().slice(0, limit);

    const scored: Array<{ spec: CommandSpec; score: number }> = [];
    for (const spec of this.visible()) {
      const path = commandPath(spec).toLowerCase();
      const summary = spec.summary.toLowerCase();
      let score = 0;
      if (path === q) score = 1000;
      else if (path.startsWith(q)) score = 500 - path.length;
      else if (path.includes(q)) score = 300 - path.length;
      else if (summary.includes(q)) score = 100;
      else {
        const sub = subsequenceScore(q, path);
        if (sub > 0) score = sub;
      }
      if (score > 0) scored.push({ spec, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || commandPath(a.spec).localeCompare(commandPath(b.spec)))
      .slice(0, limit)
      .map((s) => s.spec);
  }

  /** Suggestions for an unrecognised invocation. */
  didYouMean(tokens: string[]): string[] {
    const query = tokens.join(' ');
    return this.search(query, 3).map(commandPath);
  }
}

/** Cheap subsequence match: "rst" matches "run start". Contiguity scores higher. */
function subsequenceScore(needle: string, haystack: string): number {
  let hi = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return 0;
    streak = found === hi ? streak + 1 : 0;
    score += 1 + streak;
    hi = found + 1;
  }
  return score;
}
