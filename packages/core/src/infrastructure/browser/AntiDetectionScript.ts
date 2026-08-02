// ────────────────────────────────────────────────────────────────
// AntiDetectionScript — masks common automation signals (navigator.webdriver,
// empty plugins/languages, missing window.chrome, Permissions API defaults)
// that bot-detection services like Cloudflare Turnstile probe for. Injected
// via `context.addInitScript()` so it runs before any page JS, on every
// navigation.
//
// This is about not tripping "is this a real browser" heuristics on sites
// the agent needs to actually use — it is not a jailbreak or a way to evade
// any of THIS application's own safeguards.
// ────────────────────────────────────────────────────────────────

export const ANTI_DETECTION_SCRIPT = String.raw`(function() {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch (e) {}

  // Real Chrome always exposes a few default plugins (PDF viewer, etc.);
  // an empty array is itself a signal headless/automated browsers give off.
  try {
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
    }
  } catch (e) {}

  // window.chrome (with .runtime/.csi/.loadTimes) is present in every real
  // Chrome tab; some automated contexts omit it entirely.
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
    if (!window.chrome.csi) {
      window.chrome.csi = function () {
        return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 };
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function () {
        const now = Date.now() / 1000;
        return {
          commitLoadTime: now, connectionInfo: 'h2', finishDocumentLoadTime: now,
          finishLoadTime: now, firstPaintAfterLoadTime: 0, firstPaintTime: now,
          navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: now - 0.16,
          startLoadTime: now - 0.3, wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        };
      };
    }
  } catch (e) {}

  // Real Chrome returns 'prompt' for ungranted permissions; automated
  // contexts often default to 'denied', which detectors cross-reference.
  try {
    const promptPerms = new Set(['geolocation', 'camera', 'microphone', 'midi', 'idle-detection', 'storage-access']);
    const origQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (desc) {
      if (desc && promptPerms.has(desc.name)) {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      return origQuery.call(this, desc);
    };
  } catch (e) {}

  // An empty languages array is itself an automation signal.
  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    }
  } catch (e) {}
})();`;
