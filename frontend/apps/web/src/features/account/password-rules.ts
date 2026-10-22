/**
 * Client-side mirror of the API's staff password rules (`services/staff.py`): at least 16 characters, no
 * leading or trailing whitespace, different from the current password. The API enforces the same rules.
 */
export const MIN_PASSWORD_LENGTH = 16;

export interface PasswordCheck {
  readonly id: 'length' | 'whitespace' | 'different' | 'match';
  readonly label: string;
  readonly ok: boolean;
}

export function checkNewPassword(current: string, next: string, confirm: string): PasswordCheck[] {
  return [
    {
      id: 'length',
      label: `At least ${MIN_PASSWORD_LENGTH} characters (a passphrase of several words works well)`,
      ok: next.length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: 'whitespace',
      label: 'No space at the start or end',
      ok: next.length > 0 && next.trim() === next,
    },
    {
      id: 'different',
      label: 'Different from the current password',
      ok: next.length > 0 && next !== current,
    },
    {
      id: 'match',
      label: 'Both new password fields match',
      ok: next.length > 0 && next === confirm,
    },
  ];
}

export function passwordIsAcceptable(current: string, next: string, confirm: string): boolean {
  return checkNewPassword(current, next, confirm).every((c) => c.ok);
}
