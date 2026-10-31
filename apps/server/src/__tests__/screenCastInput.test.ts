// Screen video on every OS: the capture input per platform, and finding ffmpeg before the cast says "recording".
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureInput, ffmpegInstallHint, findFfmpeg } from '../computer/screenCast.js';

describe('captureInput', () => {
  it('captures the named window with gdigrab on Windows, else the bounded primary display', () => {
    expect(captureInput('win32', { windowTitle: 'Notepad', bounds: null })).toEqual({
      args: ['-f', 'gdigrab', '-framerate', '15', '-draw_mouse', '1', '-i', 'title=Notepad'],
    });
    const desk = captureInput('win32', { bounds: { width: 1920, height: 1200 } });
    expect('args' in desk && desk.args).toEqual(
      expect.arrayContaining(['-video_size', '1920x1200', '-i', 'desktop']),
    );
  });

  it('captures the first screen with avfoundation on macOS — gdigrab does not exist there', () => {
    const mac = captureInput('darwin', { windowTitle: 'Calculator', bounds: null });
    expect('args' in mac && mac.args).toEqual(['-f', 'avfoundation', '-capture_cursor', '1', '-framerate', '15', '-i', 'Capture screen 0:none']);
  });

  it('uses x11grab on $DISPLAY on Linux and refuses a Wayland-only session', () => {
    expect(captureInput('linux', { bounds: null, env: { DISPLAY: ':1' } })).toEqual({
      args: ['-f', 'x11grab', '-draw_mouse', '1', '-framerate', '15', '-i', ':1.0'],
    });
    const wayland = captureInput('linux', { bounds: null, env: { WAYLAND_DISPLAY: 'wayland-0' } });
    expect('unsupported' in wayland && wayland.unsupported).toMatch(/Wayland/);
  });
});

describe('findFfmpeg', () => {
  it('finds ffmpeg on PATH and returns null when there is none', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'));
    try {
      // win32 with LOCALAPPDATA in the temp dir: no install roots outside it (Linux would also search /usr/bin).
      expect(findFfmpeg('win32', { PATH: dir, LOCALAPPDATA: dir })).toBeNull();
      fs.writeFileSync(path.join(dir, 'ffmpeg'), '');
      expect(findFfmpeg('linux', { PATH: dir })).toBe(path.join(dir, 'ffmpeg'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says how to install it on each OS', () => {
    expect(ffmpegInstallHint('darwin')).toMatch(/brew install ffmpeg/);
    expect(ffmpegInstallHint('win32')).toMatch(/winget install ffmpeg/);
    expect(ffmpegInstallHint('linux')).toMatch(/apt install ffmpeg/);
  });
});
