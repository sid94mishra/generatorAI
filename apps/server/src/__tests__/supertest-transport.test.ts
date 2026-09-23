import { describe, expect, it } from 'vitest';
import supertest from 'supertest';

describe('test fixture transport', () => {
  it.each([
    ['IPv6', '::', 'http://[::1]:12345/probe'],
    ['IPv4', '127.0.0.1', 'http://127.0.0.1:12345/probe'],
  ])('connects to the fixture address family %s', (family, address, expected) => {
    const app = { address: () => ({ family, address, port: 12345 }) };
    const request = new supertest.Test(app as never, 'GET', '/probe');
    expect(request.url).toBe(expected);
  });
});
