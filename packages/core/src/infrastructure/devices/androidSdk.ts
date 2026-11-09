// ────────────────────────────────────────────────────────────────
// Where the user's Android SDK tools are (DV-13): an explicit Settings path,
// then ANDROID_HOME / ANDROID_SDK_ROOT, then each OS's default SDK folder,
// then `adb` / `emulator` on PATH. Nothing is installed by us.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AndroidTools {
  sdkRoot: string | null;
  adb: string | null;
  emulator: string | null;
}

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export function defaultSdkRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const home = os.homedir();
  const roots = [env['ANDROID_HOME'], env['ANDROID_SDK_ROOT']].filter((p): p is string => !!p);
  if (platform === 'darwin') roots.push(path.join(home, 'Library', 'Android', 'sdk'));
  else if (platform === 'win32') {
    const local = env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    roots.push(path.join(local, 'Android', 'Sdk'));
  } else roots.push(path.join(home, 'Android', 'Sdk'), path.join(home, 'Android', 'sdk'));
  return roots;
}

async function existing(file: string): Promise<string | null> {
  try {
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function onPath(name: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const found = await existing(path.join(dir, exe(name)));
    if (found) return found;
  }
  return null;
}

/** Resolves the tools; `override` is the Settings SDK path. */
export async function findAndroidTools(override?: string | null, env: NodeJS.ProcessEnv = process.env): Promise<AndroidTools> {
  const roots = [...(override ? [override] : []), ...defaultSdkRoots(env)];
  for (const root of roots) {
    const adb = await existing(path.join(root, 'platform-tools', exe('adb')));
    if (adb) {
      return { sdkRoot: root, adb, emulator: await existing(path.join(root, 'emulator', exe('emulator'))) };
    }
  }
  return { sdkRoot: null, adb: await onPath('adb', env), emulator: await onPath('emulator', env) };
}

/** AVDs from `~/.android/avd/*.ini` (or ANDROID_AVD_HOME), with their display names. */
export async function listAvds(env: NodeJS.ProcessEnv = process.env): Promise<{ name: string; displayName: string; target?: string }[]> {
  const home = env['ANDROID_AVD_HOME'] ?? path.join(env['ANDROID_USER_HOME'] ?? path.join(os.homedir(), '.android'), 'avd');
  let entries: string[];
  try {
    entries = await fs.readdir(home);
  } catch {
    return [];
  }
  const avds: { name: string; displayName: string; target?: string }[] = [];
  for (const file of entries) {
    if (!file.endsWith('.ini')) continue;
    const name = file.slice(0, -4);
    let displayName = name;
    let target: string | undefined;
    try {
      const ini = await fs.readFile(path.join(home, file), 'utf8');
      target = ini.match(/^target=(.+)$/m)?.[1]?.trim();
      const avdPath = ini.match(/^path=(.+)$/m)?.[1]?.trim();
      const config = avdPath ? await fs.readFile(path.join(avdPath, 'config.ini'), 'utf8') : '';
      displayName = config.match(/^avd\.ini\.displayname\s*=\s*(.+)$/m)?.[1]?.trim() || name;
    } catch {
      // keep the file name
    }
    avds.push({ name, displayName, ...(target ? { target } : {}) });
  }
  return avds.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** `android-36` → `Android 16` (API level → release, where known). */
export function androidVersionForTarget(target: string | undefined): string | undefined {
  const api = Number(target?.match(/android-(\d+)/)?.[1]);
  if (!Number.isFinite(api) || api <= 0) return undefined;
  const release: Record<number, string> = { 37: '17', 36: '16', 35: '15', 34: '14', 33: '13', 32: '12L', 31: '12', 30: '11', 29: '10', 28: '9' };
  return `Android ${release[api] ?? `API ${api}`}`;
}
