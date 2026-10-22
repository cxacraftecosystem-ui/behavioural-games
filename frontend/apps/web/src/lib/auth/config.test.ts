import { describe, expect, it } from 'vitest';
import { checkNewPassword, passwordIsAcceptable } from '@/features/account/password-rules';
import { AuthConfigError, parseAuthConfig } from './config';

const GOOGLE_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';

describe('local auth mode', () => {
  it('is password-only unless a Google client id is configured', () => {
    expect(parseAuthConfig({ NEXT_PUBLIC_AUTH_MODE: 'local' })).toEqual({
      mode: 'local',
      googleClientId: null,
    });
    expect(
      parseAuthConfig({ NEXT_PUBLIC_AUTH_MODE: 'LOCAL', NEXT_PUBLIC_GOOGLE_CLIENT_ID: '  ' }),
    ).toEqual({ mode: 'local', googleClientId: null });
  });

  it('shows Google only with a well-formed web client id', () => {
    expect(
      parseAuthConfig({ NEXT_PUBLIC_AUTH_MODE: 'local', NEXT_PUBLIC_GOOGLE_CLIENT_ID: GOOGLE_ID }),
    ).toEqual({ mode: 'local', googleClientId: GOOGLE_ID });
    expect(() =>
      parseAuthConfig({
        NEXT_PUBLIC_AUTH_MODE: 'local',
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'GOCSPX-secret',
      }),
    ).toThrow(AuthConfigError);
  });
});

describe('password rules', () => {
  it('mirrors the API rules', () => {
    const ok = 'a long and memorable passphrase';
    expect(passwordIsAcceptable('old password value', ok, ok)).toBe(true);
    const failing = (cur: string, next: string, confirm: string) =>
      checkNewPassword(cur, next, confirm)
        .filter((c) => !c.ok)
        .map((c) => c.id);
    expect(failing('x', 'short', 'short')).toEqual(['length']);
    expect(failing('x', ` ${ok}`, ` ${ok}`)).toEqual(['whitespace']);
    expect(failing(ok, ok, ok)).toEqual(['different']);
    expect(failing('x', ok, `${ok}!`)).toEqual(['match']);
  });
});
