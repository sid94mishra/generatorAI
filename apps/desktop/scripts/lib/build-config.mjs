// ────────────────────────────────────────────────────────────────
// Builds the electron-builder configuration.
//
// This used to be a `build` block in package.json. It moved here because three
// things about a release are decided at build time, not commit time — the
// update channel, whether signing keys are available, and which architecture
// the server's native modules were staged for — and JSON cannot express any of
// them. The previous arrangement expressed the last one by simply not
// modelling it, which is how we ended up shipping an arm64 installer with an
// x64 `better_sqlite3.node` inside it.
//
// Everything here is a pure function of its inputs so it can be tested without
// running a build. `electron-builder.mjs` is the only caller.
// ────────────────────────────────────────────────────────────────

/** Update channels. electron-updater matches a client to the manifest of the same name. */
export const CHANNELS = ['alpha', 'beta', 'latest'];

/**
 * Maps a release tag to its update channel.
 *
 * `alpha` and `beta` are not free-form: electron-updater's GitHub provider
 * hardcodes those two names when deciding whether a pre-release is a valid
 * upgrade, so a channel called anything else strands testers with no route
 * back to stable.
 */
export function resolveChannel(tag) {
  const version = String(tag).replace(/^v/, '');
  if (version.includes('-alpha')) return 'alpha';
  if (version.includes('-beta')) return 'beta';
  return 'latest';
}

// ── Signing ──────────────────────────────────────────────────────

/**
 * Credentials are all-or-nothing per group. A half-configured group is always
 * a mistake — a typo'd secret name, or a secret that exists in one environment
 * and not another — and the failure it produces without this check is an
 * unsigned build that looks successful.
 */
const SIGNING_GROUPS = {
  mac: {
    certificate: ['CSC_LINK', 'CSC_KEY_PASSWORD'],
    // A signed but un-notarized macOS build is still refused by Gatekeeper on
    // first launch, so the two are only useful together.
    notarization: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  },
  win: {
    certificate: ['CSC_LINK', 'CSC_KEY_PASSWORD'],
  },
  linux: {},
};

export class PartialSigningConfigError extends Error {
  constructor(platform, group, present, missing) {
    super(
      `${platform} ${group} signing is partially configured: ` +
        `${present.join(', ')} set, ${missing.join(', ')} missing.\n` +
        `Set all of them to sign, or none of them to build unsigned.`,
    );
    this.name = 'PartialSigningConfigError';
    this.platform = platform;
    this.group = group;
    this.missing = missing;
  }
}

/**
 * Decides whether this build signs, and refuses to guess.
 *
 * @returns {{ signed: boolean, reason: string }}
 * @throws {PartialSigningConfigError} when a credential group is half-set.
 */
export function resolveSigning({ platform, env = {} }) {
  const groups = SIGNING_GROUPS[platform] ?? {};
  const isSet = (name) => typeof env[name] === 'string' && env[name].trim() !== '';

  const states = Object.entries(groups).map(([group, vars]) => {
    const present = vars.filter(isSet);
    const missing = vars.filter((name) => !isSet(name));
    if (present.length > 0 && missing.length > 0) {
      throw new PartialSigningConfigError(platform, group, present, missing);
    }
    return { group, complete: present.length > 0 };
  });

  if (states.length === 0) {
    return { signed: false, reason: `${platform} builds are not signed.` };
  }

  const complete = states.filter((s) => s.complete).map((s) => s.group);
  const absent = states.filter((s) => !s.complete).map((s) => s.group);

  if (complete.length === 0) {
    return { signed: false, reason: `no ${platform} signing credentials provided` };
  }

  // On macOS the two groups are a single unit; having one without the other
  // produces a build that fails on the user's machine rather than ours.
  if (absent.length > 0) {
    throw new PartialSigningConfigError(platform, absent[0], complete, groups[absent[0]]);
  }

  return { signed: true, reason: `${platform} signing enabled (${complete.join(' + ')})` };
}

/**
 * Update manifests that must not be published.
 *
 * Squirrel.Mac refuses an update whose signature it cannot validate, so an
 * unsigned macOS build cannot self-update no matter what the manifest says.
 * Publishing one anyway advertises an update path that fails silently on every
 * client; shipping no manifest at least leaves them on a working version.
 */
export function unpublishableManifests({ platform, signed, channel }) {
  if (platform !== 'mac' || signed) return [];
  return [`${channel}-mac.yml`];
}

// ── Publish target ───────────────────────────────────────────────

/**
 * Resolves where updates are published from, rather than hardcoding it.
 *
 * GitHub Actions sets `GITHUB_REPOSITORY` to the repository actually running
 * the workflow, so deriving it cannot drift the way a checked-in `owner/repo`
 * does — that survives neither a rename, a transfer, nor a fork, and nothing
 * fails loudly when it is wrong: the build succeeds and publishes to whatever
 * was written down. `GENERATORAI_UPDATE_REPOSITORY` overrides it for the case
 * where releases live somewhere other than the source repository.
 *
 * Returns undefined outside CI, which leaves a local build with no update feed
 * — correct, since there is nothing for it to poll.
 *
 * @returns {{provider:'github',owner:string,repo:string,releaseType:string}|undefined}
 */
export function resolveGitHubPublish({ env = {}, channel }) {
  const raw = (env.GENERATORAI_UPDATE_REPOSITORY || env.GITHUB_REPOSITORY || '').trim();
  if (!raw) return undefined;

  const [owner, repo, ...rest] = raw.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid update repository '${raw}' (expected 'owner/repo').`);
  }

  return {
    provider: 'github',
    owner,
    repo,
    releaseType: channel === 'latest' ? 'release' : 'prerelease',
    // Names the manifest electron-updater reads (alpha.yml, latest.yml, ...).
    // It has to live in the publish object: passing it as a `-c.publish.channel`
    // override instead makes electron-builder synthesise `publish` as a bare
    // object, which fails schema validation when no other publish config exists.
    channel,
  };
}

/**
 * Metadata the Linux `deb`/`rpm` targets refuse to build without.
 *
 * fpm requires a homepage and an RFC-822 maintainer for the package headers;
 * Windows and macOS ask for neither, which is why this only ever surfaces on a
 * Linux build. Both are derived from the publish target so they follow a fork
 * or a rename, and both can be overridden when the published contact differs
 * from the repository owner.
 */
export function resolveLinuxMetadata({ env = {}, publishTarget }) {
  const owner = publishTarget?.provider === 'github' ? publishTarget.owner : undefined;
  const repo = publishTarget?.provider === 'github' ? publishTarget.repo : undefined;

  const homepage =
    env.GENERATORAI_HOMEPAGE?.trim() ||
    (owner && repo ? `https://github.com/${owner}/${repo}` : undefined);

  // GitHub's documented no-reply form, so nothing here is a fabricated address.
  const maintainer =
    env.GENERATORAI_MAINTAINER?.trim() ||
    (owner ? `${owner} <${owner}@users.noreply.github.com>` : undefined);

  return { homepage, maintainer };
}

// ── Configuration ────────────────────────────────────────────────

const PRODUCT_NAME = 'GeneratorAI';

/** Linux binary name. Must be path-safe: the package name `@generatorai/desktop` is not. */
const LINUX_EXECUTABLE = 'generatorai';

/**
 * Files excluded from every platform.
 *
 * Source maps are the notable entry. They are generated deliberately — an
 * unminified bundle plus its map is what makes a production stack trace
 * readable — but they are a build artifact, not something a user needs, and
 * they cost ~21 MB across the server and web bundles.
 */
const SHARED_RESOURCE_EXCLUSIONS = ['!**/*.map', '!**/stats.html'];

/**
 * @param {object} input
 * @param {'mac'|'win'|'linux'} input.platform
 * @param {'x64'|'arm64'|'universal'} input.arch  architecture the server runtime was staged for
 * @param {'alpha'|'beta'|'latest'} input.channel
 * @param {boolean} input.signed
 * @param {{provider:string,[k:string]:unknown}} [input.publish]  overrides the derived target
 * @param {Record<string,string|undefined>} [input.env]
 */
export function createBuildConfig({ platform, arch, channel, signed, publish, env = {} }) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`Unknown channel '${channel}' (expected one of ${CHANNELS.join(', ')}).`);
  }

  const publishTarget = publish ?? resolveGitHubPublish({ env, channel });

  const config = {
    appId: 'ai.generatorai.desktop',
    productName: PRODUCT_NAME,
    npmRebuild: false,
    // The staged tree is built against Electron's ABI by
    // stage-server-runtime.mjs; letting electron-builder rebuild would
    // overwrite it with a system-Node build.
    ...(publishTarget ? { publish: [publishTarget] } : {}),
    directories: { output: 'release', buildResources: 'resources' },
    // Chromium ships 55 locale packs (~47 MB). We render one language.
    electronLanguages: ['en-US'],
    files: [
      'dist/**/*',
      'resources/**/*',
      // Shipped beside the server bundle instead, where Node can resolve them.
      '!node_modules/better-sqlite3/**',
      '!node_modules/node-pty/**',
      '!node_modules/playwright/**',
      '!node_modules/playwright-core/**',
    ],
    extraResources: [
      {
        from: '../../apps/server/dist-bundle',
        to: 'server',
        filter: ['**/*', '!node_modules', ...SHARED_RESOURCE_EXCLUSIONS],
      },
      {
        // electron-builder 26 unconditionally refuses to copy a directory
        // whose relative path is exactly `node_modules`, so it is named as the
        // source root here rather than reached through the entry above.
        from: '../../apps/server/dist-bundle/node_modules',
        to: 'server/node_modules',
        filter: [
          '**/*',
          '!.modules.yaml',
          '!.pnpm-workspace-state*',
          // node-pty vendors a prebuild for every platform it supports (~58 MB,
          // most of it the two Windows ConPTY payloads). Only the one matching
          // this installer can ever load.
          ...foreignPrebuildExclusions({ platform, arch }),
          ...SHARED_RESOURCE_EXCLUSIONS,
        ],
      },
      { from: '../../apps/web/dist', to: 'web/dist', filter: ['**/*', ...SHARED_RESOURCE_EXCLUSIONS] },
      { from: '../../templates', to: 'templates' },
      // One target's payload only. The driver spawns `cua-driver-uia` and
      // `cua-cursor-theme` as siblings, so the whole directory ships or the
      // driver starts and then cannot read a window.
      {
        from: `resources/cua-driver/${platform === 'win' ? 'win32' : platform === 'mac' ? 'darwin' : 'linux'}-${arch}`,
        to: 'cua-driver',
        filter: ['**/*', '!.version', ...SHARED_RESOURCE_EXCLUSIONS],
      },
      // Platform-independent: the agent cursor theme is a Lottie bundle the
      // server installs into the driver's theme store on boot.
      { from: 'resources/cursor-themes', to: 'cursor-themes', filter: ['**/*', ...SHARED_RESOURCE_EXCLUSIONS] },
    ],
    asarUnpack: ['**/*.node'],
    protocols: [{ name: PRODUCT_NAME, schemes: ['generatorai'] }],
  };

  if (platform === 'win') config.win = winConfig(arch);
  if (platform === 'mac') Object.assign(config, macConfig(arch, signed));
  if (platform === 'linux') {
    const { homepage, maintainer } = resolveLinuxMetadata({ env, publishTarget });
    // `homepage` is package.json metadata, not a config key — fpm reads it from
    // there for the deb/rpm headers, and extraMetadata is how it gets injected
    // without committing a repository URL that a fork would silently inherit.
    if (homepage) config.extraMetadata = { ...config.extraMetadata, homepage };
    Object.assign(config, linuxConfig(arch, maintainer));
  }

  if (platform === 'win') {
    config.nsis = {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      allowElevation: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: PRODUCT_NAME,
      deleteAppDataOnUninstall: false,
    };
    config.portable = { artifactName: '${productName}-${version}-${arch}-portable.${ext}' };
  }

  return config;
}

/** node-pty prebuild directories that cannot be loaded by this installer. */
function foreignPrebuildExclusions({ platform, arch }) {
  const ebPlatform = { win: 'win32', mac: 'darwin', linux: 'linux' }[platform];
  // A universal macOS app genuinely contains both slices.
  const architectures = arch === 'universal' ? ['arm64', 'x64'] : [arch];
  const keep = new Set(architectures.map((a) => `${ebPlatform}-${a}`));
  return [`!**/prebuilds/!(${[...keep].join('|')})/**`];
}

function winConfig(arch) {
  return {
    // Exactly the architecture the server runtime was staged for. Listing more
    // produces installers whose native modules are for a different CPU.
    target: [
      { target: 'nsis', arch: [arch] },
      { target: 'portable', arch: [arch] },
    ],
    icon: 'resources/icon.png',
    artifactName: '${productName}-${version}-${arch}-setup.${ext}',
  };
}

function macConfig(arch, signed) {
  return {
    mac: {
      // Follows the staged architecture rather than always building
      // `universal`. A universal app has to carry both slices of every native
      // module, and the server runtime is staged for one architecture at a
      // time — so a universal target here would produce an app that loads
      // `better_sqlite3.node` for the wrong CPU on one of the two, failing at
      // the first database access rather than at build time. Restoring
      // universal means staging arm64 and x64 and merging them first.
      target: [
        { target: 'dmg', arch: [arch] },
        { target: 'zip', arch: [arch] },
      ],
      icon: 'resources/icon.png',
      category: 'public.app-category.developer-tools',
      darkModeSupport: true,
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      // Without credentials electron-builder will happily sign with any
      // identity it finds in the runner's keychain, producing a build signed
      // by something nobody can verify.
      identity: signed ? undefined : null,
      extendInfo: {
        NSMicrophoneUsageDescription: 'GeneratorAI needs microphone access for voice input in chats.',
        NSCameraUsageDescription:
          'GeneratorAI needs camera access when an agent captures video in the integrated browser.',
        NSAppleEventsUsageDescription:
          'GeneratorAI needs automation access to drive local developer tooling on your behalf.',
        LSMinimumSystemVersion: '11.0',
      },
    },
    dmg: {
      contents: [
        { x: 140, y: 180, type: 'file' },
        { x: 400, y: 180, type: 'link', path: '/Applications' },
      ],
    },
  };
}

function linuxConfig(arch, maintainer) {
  return {
    linux: {
      target: [
        { target: 'AppImage', arch: [arch] },
        { target: 'deb', arch: [arch] },
        { target: 'rpm', arch: [arch] },
      ],
      // Without this deb/rpm fall back to `${name}`, which is the package name
      // `@generatorai/desktop` — fpm then treats the slash as a directory and
      // fails writing to release/@generatorai/. AppImage defaults to
      // productName, which is why it alone survived.
      artifactName: '${productName}-${version}-${arch}.${ext}',
      ...(maintainer ? { maintainer } : {}),
      // Without this electron-builder derives the binary name from the package
      // name, and `@generatorai/desktop` becomes `@generatoraidesktop` — which
      // it then rejects, because `@` is not safe in a Linux executable path.
      executableName: LINUX_EXECUTABLE,
      icon: 'resources/icon.png',
      category: 'Development',
      synopsis: 'Agentic developer workspace',
      description: 'GeneratorAI Desktop — native shell with full parity to the web UI and CLI.',
      desktop: {
        entry: {
          Name: PRODUCT_NAME,
          // Has to match the executable, or desktop environments cannot tie a
          // running window back to this launcher (wrong icon in the dock).
          StartupWMClass: LINUX_EXECUTABLE,
          MimeType: 'x-scheme-handler/generatorai;',
          Keywords: 'ai;agent;developer;automation;',
        },
      },
    },
    deb: {
      depends: [
        'libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libxss1',
        'libxtst6',
        'xdg-utils',
        'libatspi2.0-0',
        'libsecret-1-0',
      ],
    },
    rpm: { fpm: ['--rpm-rpmbuild-define=_build_id_links none'] },
  };
}
