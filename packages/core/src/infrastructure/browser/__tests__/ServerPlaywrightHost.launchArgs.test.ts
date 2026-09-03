import { describe, expect, it } from 'vitest';
import { buildChromiumLaunchArgs } from '../ServerPlaywrightHost.js';

// Regression for the §1.Q concurrent-load test finding: launching a
// persistent Chromium context without `--disable-crash-reporter` leaves a
// `crashpad_handler[.exe]` process behind after `context.close()` resolves,
// because the crashpad handler is a detached watchdog by design — it does
// not die with the browser it watches. `killOwnDescendants()` at server
// shutdown was catching these as orphans even though `BrowserService.stop()`
// had correctly awaited every session's teardown.
describe('buildChromiumLaunchArgs', () => {
  it('disables the crash reporter so no crashpad_handler process is spawned', () => {
    const args = buildChromiumLaunchArgs(9333, true);
    expect(args).toContain('--disable-crash-reporter');
  });

  it('wires the requested CDP port and headless-only flag', () => {
    const headless = buildChromiumLaunchArgs(9444, true);
    expect(headless).toContain('--remote-debugging-port=9444');
    expect(headless).toContain('--disable-dev-shm-usage');

    const headed = buildChromiumLaunchArgs(9444, false);
    expect(headed).not.toContain('--disable-dev-shm-usage');
    expect(headed).toContain('--disable-crash-reporter');
  });
});
