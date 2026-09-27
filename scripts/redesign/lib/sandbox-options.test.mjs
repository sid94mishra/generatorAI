import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sandboxOptions } from './sandbox-options.mjs';

test('default sandbox ports stay unchanged', () => {
  assert.deepEqual(sandboxOptions([], {}), { serverPort: 3197, widgetPort: 3198, webPort: 5197 });
});

test('second sandbox gets distinct API, widget and web ports', () => {
  const first = sandboxOptions([], {});
  const second = sandboxOptions(['--port=3297'], {});
  assert.deepEqual(second, { serverPort: 3297, widgetPort: 3298, webPort: 5297 });
  assert.equal(new Set([...Object.values(first), ...Object.values(second)]).size, 6);
});

test('CLI overrides environment; environment supports both ports', () => {
  const env = { GENERATORAI_SANDBOX_PORT: '3297', GENERATORAI_SANDBOX_WEB_PORT: '5298' };
  assert.deepEqual(sandboxOptions([], env), { serverPort: 3297, widgetPort: 3298, webPort: 5298 });
  assert.deepEqual(sandboxOptions(['--port', '3397', '--web-port=5397', '--dry-run'], env), {
    serverPort: 3397, widgetPort: 3398, webPort: 5397,
  });
});

test('rejects malformed ports and API/widget/web collisions before starting a server', () => {
  for (const args of [
    ['--port=0'], ['--port=65535'], ['--port=1.2'], ['--port=NaN'], ['--port='], ['--port'],
    ['--web-port=-1'], ['--web-port=65536'], ['--web-port=3197'], ['--web-port=3198'],
  ]) assert.throws(() => sandboxOptions(args, {}), undefined, args.join(' '));
  assert.throws(() => sandboxOptions([], { GENERATORAI_SANDBOX_PORT: 'bad' }));
});
