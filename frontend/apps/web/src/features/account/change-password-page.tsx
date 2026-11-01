'use client';

import {
  CheckCircle2Icon,
  CircleIcon,
  KeyRoundIcon,
  Loader2Icon,
  ShieldAlertIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/data/page-header';
import { ActionGroup } from '@/components/ui/action-group';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth/auth-context';
import { safeReturnTo } from '@/lib/auth/oidc';
import { defaultLanding } from '@/lib/nav';
import { checkNewPassword, passwordIsAcceptable } from './password-rules';

export function ChangePasswordPage() {
  const { config, principal, passwordChangeRequired, changePassword } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeReturnTo(params.get('next'), defaultLanding(principal));
  const initial = params.get('initial') === '1' || passwordChangeRequired;
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentId = useId();
  const freshId = useId();
  const confirmId = useId();

  if (config?.mode !== 'local') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title="Change password" />
        <Alert variant="info">
          <KeyRoundIcon />
          <AlertDescription>
            Passwords are managed by your sign-in provider on this deployment.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const checks = checkNewPassword(current, fresh, confirm);
  const touched = fresh.length > 0 || confirm.length > 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!current) return setError('Enter your current password.');
    if (!passwordIsAcceptable(current, fresh, confirm)) {
      return setError('The new password does not meet every rule below.');
    }
    setBusy(true);
    try {
      await changePassword(current, fresh);
      setCurrent('');
      setFresh('');
      setConfirm('');
      toast.success('Password changed', {
        description: 'Use the new password the next time you sign in.',
      });
      router.replace(next);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'The current password is incorrect.'
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl" data-testid="change-password">
      <PageHeader
        title="Change password"
        description={`Signed in as ${principal?.sub ?? ''}. Other sessions stay signed in until they expire.`}
      />
      {initial && (
        <Alert variant="warning" className="mb-4" data-testid="initial-password-prompt">
          <ShieldAlertIcon />
          <AlertTitle>Replace your initial password</AlertTitle>
          <AlertDescription>
            Choose one only you know before working with study data.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New password</CardTitle>
          <CardDescription>A long passphrase works best.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {/* Hidden username field so password managers file the new password under this account. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={principal?.sub ?? ''}
              readOnly
              hidden
            />
            <div className="grid gap-2">
              <Label htmlFor={currentId}>Current password</Label>
              <Input
                id={currentId}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={freshId}>New password</Label>
              <Input
                id={freshId}
                type="password"
                autoComplete="new-password"
                value={fresh}
                onChange={(e) => setFresh(e.target.value)}
                disabled={busy}
                aria-describedby={`${freshId}-rules`}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={confirmId}>Confirm new password</Label>
              <Input
                id={confirmId}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <ul id={`${freshId}-rules`} className="space-y-1 text-sm" aria-label="Password rules">
              {checks.map((c) => (
                <li
                  key={c.id}
                  className={
                    c.ok
                      ? 'flex items-center gap-2 text-success'
                      : 'flex items-center gap-2 text-muted-foreground'
                  }
                >
                  {c.ok ? (
                    <CheckCircle2Icon className="size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <CircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {c.label}
                    <span className="sr-only">{c.ok ? ' (met)' : touched ? ' (not met)' : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
            {error && (
              <Alert variant="destructive" data-testid="change-password-error">
                <ShieldAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <ActionGroup align="end">
              <Button type="button" variant="outline" onClick={() => router.replace(next)}>
                {initial ? 'Remind me later' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRoundIcon aria-hidden="true" />
                )}
                Change password
              </Button>
            </ActionGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
