'use client';

import {
  AlertTriangleIcon,
  EyeIcon,
  EyeOffIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  Loader2Icon,
  LockKeyholeIcon,
  LogInIcon,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { DevLoginRole } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-context';
import { safeReturnTo } from '@/lib/auth/oidc';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES } from '@/lib/auth/permissions';
import { DEMO_BANNER_TITLE, DEMO_MODE, DEMO_ROLES } from '@/lib/demo';
import { canOpen, defaultLanding } from '@/lib/nav';

const REASON_TEXT = {
  expired: 'Your session expired. Sign in again to continue.',
  unauthorized: 'The API rejected your session. Sign in again.',
  user: null,
} as const;

export function LoginPanel() {
  const {
    status,
    principal,
    config,
    configError,
    signOutReason,
    signInDev,
    signInDemo,
    signInOidc,
    signInPassword,
    signInGoogle,
    passwordChangeRequired,
  } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const [sub, setSub] = useState('dev-researcher');
  const [roles, setRoles] = useState<DevLoginRole[]>(['researcher']);
  const [studies, setStudies] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const subId = useId();
  const studiesId = useId();
  const usernameId = useId();
  const passwordId = useId();

  // Once signed in, continue to `next` if permitted, else to the first permitted page. Accounts that
  // still use an operator-issued initial password go to the change-password screen first.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const target = safeReturnTo(next, '');
    const destination = target && canOpen(principal, target) ? target : defaultLanding(principal);
    router.replace(
      passwordChangeRequired
        ? `/account/password?initial=1&next=${encodeURIComponent(destination)}`
        : destination,
    );
  }, [status, principal, next, router, passwordChangeRequired]);

  const onPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) return setError('Enter your email or username.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      await signInPassword(username, password);
      setPassword('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 422
          ? 'Check the email or username and password format.'
          : errorMessage(err),
      );
      setBusy(false);
    }
  };

  const onGoogleCredential = async (credential: string) => {
    setError(null);
    setBusy(true);
    try {
      await signInGoogle(credential);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'This Google account is not registered for staff access. Ask an administrator to add your email, or sign in with your password.'
          : errorMessage(err),
      );
      setBusy(false);
    }
  };

  const toggleRole = (role: DevLoginRole, on: boolean) =>
    setRoles((current) =>
      on ? [...new Set([...current, role])] : current.filter((r) => r !== role),
    );

  const onDevSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!sub.trim()) return setError('Enter a subject (user id).');
    if (roles.length === 0) return setError('Choose at least one role.');
    setBusy(true);
    try {
      const scope = studies
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await signInDev({ sub: sub.trim(), roles, studies: scope.length ? scope : null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reason = signOutReason ? REASON_TEXT[signOutReason] : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            S
          </span>
          <span className="text-sm font-semibold">SHRIII Behavioural Games</span>
        </div>
        <CardTitle className="text-lg">Sign in to the research console</CardTitle>
        <CardDescription>
          Access is role-based and study-scoped. Every data access is audited.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reason && (
          <Alert variant="info">
            <AlertTriangleIcon />
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        )}
        {configError && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Sign-in is misconfigured</AlertTitle>
            <AlertDescription>{configError}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" data-testid="login-error">
            <AlertTriangleIcon />
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {DEMO_MODE && (
          <section aria-label="Demo sign-in" className="space-y-3" data-testid="demo-sign-in">
            <Alert variant="warning">
              <FlaskConicalIcon />
              <AlertTitle>DEMO — no real accounts</AlertTitle>
              <AlertDescription>
                Pick a role to explore the console. This starts a demo session in your browser only:
                there are no credentials, no backend and no participant data. {DEMO_BANNER_TITLE}.
              </AlertDescription>
            </Alert>
            {DEMO_ROLES.map((role) => (
              <Button
                key={role}
                variant={role === 'researcher' ? 'default' : 'outline'}
                className="h-auto w-full flex-col items-start gap-0.5 py-2.5 text-left whitespace-normal"
                onClick={() => {
                  setError(null);
                  try {
                    signInDemo(role);
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                <span className="flex items-center gap-2 font-medium">
                  <LogInIcon /> Continue as {ROLE_LABELS[role]} (demo)
                </span>
                <span className="text-xs font-normal opacity-80">{ROLE_DESCRIPTIONS[role]}</span>
              </Button>
            ))}
          </section>
        )}

        {!DEMO_MODE && config?.mode === 'local' && (
          <section aria-label="Staff sign-in" className="space-y-4" data-testid="password-sign-in">
            <form onSubmit={onPasswordSubmit} className="space-y-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor={usernameId}>Email or username</Label>
                <Input
                  id={usernameId}
                  name="username"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="name@example.org"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={passwordId}>Password</Label>
                <div className="relative">
                  <Input
                    id={passwordId}
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                    disabled={busy}
                    className="pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
                {capsLock && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
                    Caps Lock is on.
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={busy} data-testid="sign-in-submit">
                {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
                Sign in
              </Button>
            </form>
            {config.googleClientId && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
                <GoogleSignInButton
                  clientId={config.googleClientId}
                  disabled={busy}
                  onCredential={(c) => void onGoogleCredential(c)}
                  onError={setError}
                />
              </>
            )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <LockKeyholeIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Staff accounts are issued by a system administrator. Five failed attempts lock an
                account for 15 minutes. Sessions last 8 hours.
              </span>
            </p>
          </section>
        )}

        {!DEMO_MODE && config?.mode === 'oidc' && (
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              signInOidc(safeReturnTo(next)).catch((err: unknown) => {
                setError(errorMessage(err));
                setBusy(false);
              });
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
            Sign in with your organisation
          </Button>
        )}

        {!DEMO_MODE && config?.mode === 'dev' && (
          <form onSubmit={onDevSubmit} className="space-y-4" aria-label="Development sign-in">
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertTitle>Development sign-in</AlertTitle>
              <AlertDescription>
                Issues a local signed JWT from the API (ENV=dev only). Production uses OIDC.
              </AlertDescription>
            </Alert>
            <div className="grid gap-2">
              <Label htmlFor={subId}>Subject</Label>
              <Input
                id={subId}
                name="sub"
                autoComplete="username"
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                required
              />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Roles</legend>
              {USER_ROLES.map((role) => {
                const id = `${subId}-role-${role}`;
                return (
                  <div key={role} className="flex items-start gap-2.5 rounded-md border p-2.5">
                    <Checkbox
                      id={id}
                      checked={roles.includes(role)}
                      onCheckedChange={(v) => toggleRole(role, v === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={id} className="flex-col items-start gap-0.5 font-normal">
                      <span className="font-medium">{ROLE_LABELS[role]}</span>
                      <span className="text-xs text-muted-foreground">
                        {ROLE_DESCRIPTIONS[role]}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </fieldset>
            <div className="grid gap-2">
              <Label htmlFor={studiesId}>Study scope (optional)</Label>
              <Input
                id={studiesId}
                name="studies"
                placeholder="All studies, or comma-separated study ids"
                value={studies}
                onChange={(e) => setStudies(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
              Sign in
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
