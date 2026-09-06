import { describe, it, expect } from 'vitest';

import {
  CHANNELS,
  createBuildConfig,
  resolveChannel,
  resolveGitHubPublish,
  resolveSigning,
  unpublishableManifests,
  PartialSigningConfigError,
  assertPublishAllowed,
  requestsPublish,
  UnsignedPublishError,
} from './build-config.mjs';

const base = { platform: 'win', arch: 'x64', channel: 'alpha', signed: false, env: {} };

describe('resolveChannel', () => {
  it.each([
    ['v0.0.1-alpha.1', 'alpha'],
    ['0.0.1-alpha.1', 'alpha'],
    ['v0.1.0-beta.3', 'beta'],
    ['v1.0.0', 'latest'],
    ['v1.2.3-rc.1', 'latest'],
  ])('%s → %s', (tag, expected) => {
    expect(resolveChannel(tag)).toBe(expected);
  });

  it('only ever produces a channel electron-updater understands', () => {
    // The GitHub provider hardcodes "alpha" and "beta" when deciding whether a
    // pre-release is a valid upgrade; anything else strands testers.
    for (const tag of ['v1.0.0', 'v1.0.0-alpha.1', 'v1.0.0-beta.1', 'v9.9.9-nightly.2']) {
      expect(CHANNELS).toContain(resolveChannel(tag));
    }
  });
});

describe('resolveSigning', () => {
  it('builds unsigned when no credentials are present', () => {
    expect(resolveSigning({ platform: 'win', env: {} }).signed).toBe(false);
  });

  it('signs Windows when the certificate pair is complete', () => {
    const result = resolveSigning({
      platform: 'win',
      env: { CSC_LINK: 'base64', CSC_KEY_PASSWORD: 'pw' },
    });
    expect(result.signed).toBe(true);
  });

  it('refuses a half-configured certificate rather than silently not signing', () => {
    expect(() => resolveSigning({ platform: 'win', env: { CSC_LINK: 'base64' } })).toThrow(
      PartialSigningConfigError,
    );
  });

  it('treats an empty string as absent, because that is what an unset Actions secret expands to', () => {
    expect(
      resolveSigning({ platform: 'win', env: { CSC_LINK: '', CSC_KEY_PASSWORD: '' } }).signed,
    ).toBe(false);
  });

  it('names the missing variable so the failure is actionable', () => {
    expect(() =>
      resolveSigning({ platform: 'win', env: { CSC_KEY_PASSWORD: 'pw' } }),
    ).toThrow(/CSC_LINK/);
  });

  it('rejects a macOS certificate without notarization credentials', () => {
    // Signed-but-unnotarized still fails Gatekeeper on first launch, so the
    // two are only useful together.
    expect(() =>
      resolveSigning({ platform: 'mac', env: { CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw' } }),
    ).toThrow(PartialSigningConfigError);
  });

  it('signs macOS when certificate and notarization are both complete', () => {
    const result = resolveSigning({
      platform: 'mac',
      env: {
        CSC_LINK: 'b64',
        CSC_KEY_PASSWORD: 'pw',
        APPLE_API_KEY: 'key',
        APPLE_API_KEY_ID: 'id',
        APPLE_API_ISSUER: 'issuer',
      },
    });
    expect(result.signed).toBe(true);
  });

  it('never signs Linux', () => {
    expect(resolveSigning({ platform: 'linux', env: { CSC_LINK: 'b64' } }).signed).toBe(false);
  });
});

describe('unpublishableManifests', () => {
  it('withdraws the macOS manifest when the build is unsigned', () => {
    // Squirrel.Mac rejects an update it cannot verify, so publishing the
    // manifest advertises a path that fails on every client.
    expect(unpublishableManifests({ platform: 'mac', signed: false, channel: 'alpha' })).toEqual([
      'alpha-mac.yml',
    ]);
  });

  it('keeps the manifest once the build is signed', () => {
    expect(unpublishableManifests({ platform: 'mac', signed: true, channel: 'latest' })).toEqual([]);
  });

  it('does not touch Windows or Linux, which update without a signature', () => {
    expect(unpublishableManifests({ platform: 'win', signed: false, channel: 'alpha' })).toEqual([]);
    expect(unpublishableManifests({ platform: 'linux', signed: false, channel: 'alpha' })).toEqual(
      [],
    );
  });
});

describe('resolveGitHubPublish', () => {
  it('derives the target from the repository running the workflow', () => {
    expect(resolveGitHubPublish({ env: { GITHUB_REPOSITORY: 'acme/widget' }, channel: 'latest' }))
      .toEqual({
        provider: 'github',
        owner: 'acme',
        repo: 'widget',
        releaseType: 'release',
        channel: 'latest',
      });
  });

  it('carries the channel, which names the manifest electron-updater reads', () => {
    // Supplying it as a `-c.publish.channel` override instead made
    // electron-builder synthesise `publish` as a bare object and fail schema
    // validation once the publish block became conditional.
    for (const channel of CHANNELS) {
      expect(
        resolveGitHubPublish({ env: { GITHUB_REPOSITORY: 'a/b' }, channel }).channel,
      ).toBe(channel);
    }
  });

  it('marks pre-release channels as prereleases', () => {
    for (const channel of ['alpha', 'beta']) {
      expect(
        resolveGitHubPublish({ env: { GITHUB_REPOSITORY: 'acme/widget' }, channel }).releaseType,
      ).toBe('prerelease');
    }
  });

  it('lets an explicit override win, for releases hosted outside the source repo', () => {
    const target = resolveGitHubPublish({
      env: { GITHUB_REPOSITORY: 'acme/source', GENERATORAI_UPDATE_REPOSITORY: 'acme/releases' },
      channel: 'latest',
    });
    expect(target.repo).toBe('releases');
  });

  it('produces no feed outside CI, because a local build has nothing to poll', () => {
    expect(resolveGitHubPublish({ env: {}, channel: 'alpha' })).toBeUndefined();
  });

  it('refuses a malformed repository instead of publishing somewhere unintended', () => {
    for (const raw of ['owner', 'a/b/c', '/repo', 'owner/']) {
      expect(() => resolveGitHubPublish({ env: { GITHUB_REPOSITORY: raw }, channel: 'alpha' })).toThrow(
        /owner\/repo/,
      );
    }
  });
});

describe('createBuildConfig', () => {
  it('rejects an unknown channel before a build is spent on it', () => {
    expect(() => createBuildConfig({ ...base, channel: 'nightly' })).toThrow(/nightly/);
  });

  it('omits the publish block entirely when no feed is configured', () => {
    // electron-builder writes no <channel>.yml without one, and
    // verify-release-manifest.mjs then fails the release rather than
    // shipping a build whose updater has nothing to read.
    expect(createBuildConfig({ ...base, env: {} }).publish).toBeUndefined();
  });

  it('carries the derived GitHub target into the config', () => {
    const config = createBuildConfig({ ...base, env: { GITHUB_REPOSITORY: 'acme/widget' } });
    expect(config.publish).toEqual([
      {
        provider: 'github',
        owner: 'acme',
        repo: 'widget',
        releaseType: 'prerelease',
        channel: 'alpha',
      },
    ]);
  });

  it('lets the mock update server displace the GitHub target', () => {
    const config = createBuildConfig({
      ...base,
      env: { GITHUB_REPOSITORY: 'acme/widget' },
      publish: { provider: 'generic', url: 'http://localhost:8770' },
    });
    expect(config.publish).toEqual([{ provider: 'generic', url: 'http://localhost:8770' }]);
  });

  it('targets only the architecture the server runtime was staged for', () => {
    // Building every arch from one staged tree is what shipped an arm64
    // installer containing an x64 better_sqlite3.node.
    const config = createBuildConfig({ ...base, arch: 'x64' });
    const arches = config.win.target.flatMap((t) => t.arch);
    expect([...new Set(arches)]).toEqual(['x64']);
  });

  it('carries the staged architecture through to arm64 builds', () => {
    const config = createBuildConfig({ ...base, arch: 'arm64' });
    expect([...new Set(config.win.target.flatMap((t) => t.arch))]).toEqual(['arm64']);
  });

  it('builds macOS for the staged architecture, not universal', () => {
    // A universal app carries both slices of every native module, but the
    // server runtime is staged one architecture at a time — so a universal
    // target would ship better_sqlite3 for the wrong CPU on one of the two.
    const config = createBuildConfig({ ...base, platform: 'mac', arch: 'arm64' });
    expect(config.mac.target.every((t) => t.arch.includes('arm64'))).toBe(true);
    expect(config.mac.target.some((t) => t.arch.includes('universal'))).toBe(false);
  });

  it('builds Linux for the staged architecture', () => {
    const config = createBuildConfig({ ...base, platform: 'linux', arch: 'x64' });
    expect(config.linux.target.every((t) => t.arch.includes('x64'))).toBe(true);
  });

  it('gives Linux a path-safe executable name', () => {
    // Left to electron-builder this is derived from the package name, and
    // `@generatorai/desktop` becomes `@generatoraidesktop`, which it rejects —
    // the AppImage target fails outright.
    const config = createBuildConfig({ ...base, platform: 'linux', arch: 'x64' });
    expect(config.linux.executableName).toBe('generatorai');
    expect(config.linux.executableName).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('names Linux artifacts without the package scope', () => {
    // The deb/rpm default is `${name}`, and `@generatorai/desktop` makes fpm
    // try to write into a release/@generatorai/ directory that does not exist.
    const config = createBuildConfig({ ...base, platform: 'linux', arch: 'x64' });
    expect(config.linux.artifactName).not.toMatch(/\$\{name\}/);
    expect(config.linux.artifactName).toContain('${productName}');
  });

  it('supplies the homepage and maintainer that deb/rpm refuse to build without', () => {
    const config = createBuildConfig({
      ...base,
      platform: 'linux',
      arch: 'x64',
      env: { GITHUB_REPOSITORY: 'acme/widget' },
    });
    expect(config.extraMetadata.homepage).toBe('https://github.com/acme/widget');
    expect(config.linux.maintainer).toBe('acme <acme@users.noreply.github.com>');
  });

  it('lets the published contact differ from the repository owner', () => {
    const config = createBuildConfig({
      ...base,
      platform: 'linux',
      arch: 'x64',
      env: {
        GITHUB_REPOSITORY: 'acme/widget',
        GENERATORAI_MAINTAINER: 'Release Team <release@example.com>',
        GENERATORAI_HOMEPAGE: 'https://example.com',
      },
    });
    expect(config.linux.maintainer).toBe('Release Team <release@example.com>');
    expect(config.extraMetadata.homepage).toBe('https://example.com');
  });

  it('matches StartupWMClass to the executable so windows bind to the launcher', () => {
    const config = createBuildConfig({ ...base, platform: 'linux', arch: 'x64' });
    expect(config.linux.desktop.entry.StartupWMClass).toBe(config.linux.executableName);
  });

  it('ships one Chromium locale instead of 55', () => {
    expect(createBuildConfig(base).electronLanguages).toEqual(['en-US']);
  });

  it('excludes source maps and the bundle analyser report from every resource', () => {
    const config = createBuildConfig(base);
    for (const entry of config.extraResources.filter((e) => e.filter)) {
      expect(entry.filter).toContain('!**/*.map');
    }
  });

  it('drops node-pty prebuilds that this installer could never load', () => {
    const config = createBuildConfig({ ...base, arch: 'x64' });
    const nodeModules = config.extraResources.find((e) => e.to === 'server/node_modules');
    expect(nodeModules.filter).toContain('!**/prebuilds/!(win32-x64)/**');
  });

  it('keeps both slices for a universal macOS build', () => {
    const config = createBuildConfig({ ...base, platform: 'mac', arch: 'universal' });
    const nodeModules = config.extraResources.find((e) => e.to === 'server/node_modules');
    expect(nodeModules.filter).toContain('!**/prebuilds/!(darwin-arm64|darwin-x64)/**');
  });

  it('pins the macOS identity to null when unsigned', () => {
    // Otherwise electron-builder adopts any identity in the runner keychain
    // and produces a build signed by something nobody can verify.
    expect(createBuildConfig({ ...base, platform: 'mac', signed: false }).mac.identity).toBeNull();
  });

  it('leaves identity discovery alone when signing is configured', () => {
    expect(
      createBuildConfig({ ...base, platform: 'mac', signed: true }).mac.identity,
    ).toBeUndefined();
  });

  it('never lets electron-builder rebuild the staged native modules', () => {
    // They are compiled against Electron's ABI; a rebuild would target system Node.
    expect(createBuildConfig(base).npmRebuild).toBe(false);
  });

  it('reaches node_modules through its own entry, which electron-builder 26 requires', () => {
    // app-builder-lib's createFilter returns false for a relative path of
    // exactly "node_modules", so it has to be named as the source root.
    const config = createBuildConfig(base);
    const server = config.extraResources.find((e) => e.to === 'server');
    expect(server.filter).toContain('!node_modules');
    expect(config.extraResources.some((e) => e.from.endsWith('/node_modules'))).toBe(true);
  });

  it('produces a config for every platform without throwing', () => {
    expect(() => createBuildConfig({ ...base, platform: 'linux', arch: 'x64' })).not.toThrow();
    expect(() => createBuildConfig({ ...base, platform: 'mac', arch: 'universal' })).not.toThrow();
  });
});

describe('requestsPublish / assertPublishAllowed', () => {
  it('recognises every way electron-builder can be asked to upload', () => {
    expect(requestsPublish(['--publish', 'always'])).toBe(true);
    expect(requestsPublish(['--publish=onTag'])).toBe(true);
    expect(requestsPublish(['-p', 'onTagOrDraft'])).toBe(true);
    expect(requestsPublish(['--win', '--publish'])).toBe(true); // bare flag defaults to onTagOrDraft
  });

  it('does not treat `--publish never` or a plain build as publishing', () => {
    expect(requestsPublish(['--publish', 'never'])).toBe(false);
    expect(requestsPublish(['--publish=never'])).toBe(false);
    expect(requestsPublish(['--win', '--dir'])).toBe(false);
  });

  it('refuses to publish an unsigned build by default', () => {
    expect(() =>
      assertPublishAllowed({ argv: ['--publish', 'always'], signed: false, platform: 'mac', env: {} }),
    ).toThrow(UnsignedPublishError);
  });

  it('names the override in the refusal so the operator knows the escape hatch', () => {
    expect(() =>
      assertPublishAllowed({ argv: ['--publish', 'always'], signed: false, platform: 'win', env: {} }),
    ).toThrow(/ALLOW_UNSIGNED_RELEASE=1/);
  });

  it('lets a signed build publish, and an unsigned one only with the explicit override', () => {
    expect(() =>
      assertPublishAllowed({ argv: ['--publish', 'always'], signed: true, platform: 'mac', env: {} }),
    ).not.toThrow();
    expect(() =>
      assertPublishAllowed({
        argv: ['--publish', 'always'],
        signed: false,
        platform: 'linux',
        env: { ALLOW_UNSIGNED_RELEASE: '1' },
      }),
    ).not.toThrow();
    expect(() =>
      assertPublishAllowed({ argv: ['--publish', 'always'], signed: false, platform: 'linux', env: { ALLOW_UNSIGNED_RELEASE: 'yes' } }),
    ).toThrow(UnsignedPublishError);
  });

  it('never blocks a build that does not publish', () => {
    expect(() => assertPublishAllowed({ argv: ['--publish', 'never'], signed: false, platform: 'mac', env: {} })).not.toThrow();
    expect(() => assertPublishAllowed({ argv: [], signed: false, platform: 'mac', env: {} })).not.toThrow();
  });
});
