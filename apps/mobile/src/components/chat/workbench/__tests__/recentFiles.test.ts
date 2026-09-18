import { describe, expect, it } from 'vitest';

import {
  RECENT_FILES_MAX,
  parseRecentFiles,
  pushRecentFile,
  readRecentFiles,
  recentFilesKey,
  recordRecentFile,
  visibleRecentFiles,
} from '../recentFiles';

describe('recentFiles', () => {
  it('moves a reopened file to the front without duplicating it', () => {
    let list = pushRecentFile([], { path: 'a.ts', alias: '.', at: 1 });
    list = pushRecentFile(list, { path: 'b.ts', alias: '.', at: 2 });
    list = pushRecentFile(list, { path: 'a.ts', alias: '.', at: 3 });
    expect(list.map((r) => `${r.path}@${r.at}`)).toEqual(['a.ts@3', 'b.ts@2']);
    // Same path in another mount is a different file.
    list = pushRecentFile(list, { path: 'a.ts', alias: 'api', at: 4 });
    expect(list).toHaveLength(3);
  });

  it('caps the list', () => {
    let list: ReturnType<typeof pushRecentFile> = [];
    for (let i = 0; i < 20; i += 1) list = pushRecentFile(list, { path: `f${i}`, alias: '.', at: i });
    expect(list).toHaveLength(RECENT_FILES_MAX);
    expect(list[0]!.path).toBe('f19');
  });

  it('parses tolerantly', () => {
    expect(parseRecentFiles(undefined)).toEqual([]);
    expect(parseRecentFiles('nope')).toEqual([]);
    expect(parseRecentFiles('{"path":"x"}')).toEqual([]);
    expect(parseRecentFiles('[{"path":"x","alias":"."},{"path":1},null,{"path":"y","alias":"a","at":5}]')).toEqual([
      { path: 'x', alias: '.', at: 0 },
      { path: 'y', alias: 'a', at: 5 },
    ]);
  });

  it('offers only files still present in the selected repo', () => {
    const list = [
      { path: 'gone.ts', alias: '.', at: 3 },
      { path: 'src/a.ts', alias: '.', at: 2 },
      { path: 'src/a.ts', alias: 'api', at: 1 },
    ];
    expect(visibleRecentFiles(list, '.', ['src/a.ts', 'b.ts'])).toEqual([{ path: 'src/a.ts', alias: '.', at: 2 }]);
    expect(visibleRecentFiles(list, undefined, ['src/a.ts'])).toEqual([]);
  });

  it('round-trips through storage per workspace', () => {
    const map = new Map<string, string>();
    const storage = { getString: (k: string) => map.get(k), setString: (k: string, v: string) => void map.set(k, v) };
    recordRecentFile(storage, 'ws1', { path: 'a', alias: '.', at: 1 });
    recordRecentFile(storage, 'ws2', { path: 'b', alias: '.', at: 2 });
    expect(readRecentFiles(storage, 'ws1').map((r) => r.path)).toEqual(['a']);
    expect(map.has(recentFilesKey('ws2'))).toBe(true);
  });
});
