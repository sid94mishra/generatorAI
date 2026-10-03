import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { categoryRegistrations, intentFromResponse } from '../../services/notifications/notificationCategories';
import { normalizePushData } from '../../services/notifications/pushData';
import { apnsPayload, PLACEHOLDER_IDS, PUSH_CASES, pushFixture } from './pushFixtures';

const dir = path.resolve(__dirname, '../../../e2e/push');
const file = (kind: string) => path.join(dir, `${kind}.json`);
const ids = { server: 'srvA', chat: 'c1', interaction: 'i1', workflow: 'w1', run: 'r1', stage: 's1' };

describe('push fixtures (08 §6 notification smoke)', () => {
  it.each(PUSH_CASES)('e2e/push/%s.json is the APNs form of the fixture (WRITE_PUSH_FIXTURES=1 rewrites it)', (kind) => {
    const expected = `${JSON.stringify(apnsPayload(pushFixture(kind, PLACEHOLDER_IDS)), null, 2)}\n`;
    if (process.env['WRITE_PUSH_FIXTURES'] === '1') writeFileSync(file(kind), expected);
    expect(readFileSync(file(kind), 'utf8')).toBe(expected);
  });

  it.each(PUSH_CASES)('%s passes the v2 schema and names a registered category', (kind) => {
    const f = pushFixture(kind, ids);
    expect(normalizePushData(f.data)).not.toBeNull();
    expect(categoryRegistrations().map((c) => c.identifier)).toContain(f.categoryId);
    expect(intentFromResponse('tap', f.data, 'tap')).toMatchObject({ type: 'open' });
  });
});
