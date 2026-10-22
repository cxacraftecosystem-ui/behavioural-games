import { describe, expect, it } from 'vitest';
import { globToRegExp, handleDemoRequest } from '@/features/demo/demo-api.server';
import { createDemoToken, demoReadOnlyBody, isDemoValue, parseDemoToken } from './demo';

describe('demo mode', () => {
  it('reads the demo flag', () => {
    expect(isDemoValue('1')).toBe(true);
    expect(isDemoValue(' TRUE ')).toBe(true);
    expect(isDemoValue('0')).toBe(false);
    expect(isDemoValue(undefined)).toBe(false);
  });

  it('round-trips a demo token and rejects expired or foreign tokens', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    const { token, exp } = createDemoToken('admin', now, 1);
    expect(parseDemoToken(`Bearer ${token}`, now)).toEqual({
      sub: 'demo-admin',
      roles: ['admin'],
      exp,
    });
    expect(parseDemoToken(token, (exp + 1) * 1000)).toBeNull();
    expect(parseDemoToken('eyJhbGciOiJub25lIn0.e30.sig', now)).toBeNull();
    expect(parseDemoToken(null, now)).toBeNull();
  });

  it('uses the API error envelope for read-only refusals', () => {
    expect(demoReadOnlyBody().detail.code).toBe('demo_read_only');
  });

  it('matches Playwright-style URL globs', () => {
    const all = globToRegExp('**/api/v1/**');
    expect(all.test('http://demo.local/api/v1/studies?x=1')).toBe(true);
    const games = globToRegExp('**/api/v1/games**');
    expect(games.test('http://demo.local/api/v1/games/stall/versions')).toBe(true);
    expect(games.test('http://demo.local/api/v1/admin/kiosks')).toBe(false);
    expect(globToRegExp('**/a/*/b').test('http://h/a/x/y/b')).toBe(false);
  });

  it('the demo API is off outside demo builds', async () => {
    const res = await handleDemoRequest(new Request('http://localhost/demo-api/v1/studies'), [
      'v1',
      'studies',
    ]);
    expect(res.status).toBe(404);
  });
});
