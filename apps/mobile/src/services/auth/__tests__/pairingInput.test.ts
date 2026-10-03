import { describe, expect, it } from 'vitest';
import { normalizeAddress, prefillFrom } from '../pairingInput';

describe('pairing input (MD-34, MD-35)', () => {
  it('pre-fills a typed or linked short code and nothing else', () => {
    expect(prefillFrom('4h7k-2m9p-xq3t')).toEqual({ code: '4H7K2M9PXQ3T', address: null, consent: null });
    expect(prefillFrom('generatorai://pair?code=4H7K-2M9P-XQ3T')).toEqual({ code: '4H7K2M9PXQ3T', address: null, consent: null });
    expect(prefillFrom('')).toBeNull();
    expect(prefillFrom('hello')).toBeNull();
  });
  it('normalizes addresses to an origin', () => {
    expect(normalizeAddress('192.168.1.24:3100')).toBe('http://192.168.1.24:3100');
    expect(normalizeAddress('https://ghe.example.com/')).toBe('https://ghe.example.com');
    expect(normalizeAddress('http://h:3100/path')).toBe('http://h:3100');
    expect(normalizeAddress('   ')).toBeNull();
    expect(normalizeAddress('http://')).toBeNull();
  });
});
