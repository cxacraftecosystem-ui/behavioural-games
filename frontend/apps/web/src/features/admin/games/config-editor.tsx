'use client';

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  LockIcon,
  RotateCcwIcon,
  SaveIcon,
  WandSparklesIcon,
  XCircleIcon,
} from 'lucide-react';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { Section } from '@/components/data/page-header';
import { ActionGroup } from '@/components/ui/action-group';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useApi } from '@/lib/auth/auth-context';
import { canonicalJson, downloadText, parseJson, sha256Hex } from '../shared/canonical-json';
import { Hash, useAdminMutation } from '../shared/components';
import { adminKeys } from '../shared/query-keys';
import { checkGameConfig, LOCKED_FIELDS, MEASUREMENT_FIELDS } from './config-checks';
import { DiffList } from './diff-list';

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Next patch version (0.1.3 → 0.1.4); a draft is always a new version, never an edit in place. */
export function nextDraftVersion(latest: string | null): string {
  if (!latest) return '0.1.0';
  const [major = 0, minor = 1, patch = 0] = latest
    .split('.')
    .map((p) => Number.parseInt(p, 10) || 0);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * JSON editor for a draft game configuration with live schema, invariant and change-control checks.
 * A valid edit is saved as a new draft version (`POST /api/v1/games/{game_id}/versions`; the server
 * re-validates the contract and refuses locked-field changes), or downloaded to commit under
 * content/games.
 */
export function ConfigEditor({
  base,
  sourcePath,
  readOnly,
  gameId,
  latestVersion,
  onSaved,
}: {
  readonly base: Record<string, unknown>;
  readonly sourcePath: string | null;
  readonly readOnly: boolean;
  /** Game and newest version, for saving a draft (no save control without them). */
  readonly gameId?: string;
  readonly latestVersion?: string | null;
  readonly onSaved?: (version: string) => void;
}) {
  const api = useApi();
  const versionId = useId();
  const [draftVersion, setDraftVersion] = useState(() => nextDraftVersion(latestVersion ?? null));
  useEffect(() => setDraftVersion(nextDraftVersion(latestVersion ?? null)), [latestVersion]);
  const saveDraft = useAdminMutation({
    mutationFn: (config: Record<string, unknown>) =>
      unwrap(
        api.POST('/api/v1/games/{game_id}/versions', {
          params: { path: { game_id: gameId ?? '' } },
          body: { version: draftVersion, config },
        }),
      ),
    invalidate: gameId ? [adminKeys.gameVersions(gameId), adminKeys.games()] : [],
    success: (v: { version: string }) => `Draft ${v.version} saved.`,
  });
  const initial = useMemo(() => pretty(base), [base]);
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => parseJson(deferred), [deferred]);
  const check = useMemo(
    () => (parsed.ok ? checkGameConfig(parsed.value, base) : null),
    [parsed, base],
  );
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!parsed.ok) {
      setHash(null);
      return;
    }
    try {
      void sha256Hex(canonicalJson(parsed.value)).then((h) => live && setHash(h));
    } catch {
      setHash(null);
    }
    return () => {
      live = false;
    };
  }, [parsed]);

  const errors = check?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = check?.issues.filter((i) => i.severity === 'warning') ?? [];
  const dirty = text !== initial;
  const lines = text.split('\n').length;
  const fileName = sourcePath?.split('/').pop() ?? `${String(base.module_id ?? 'game')}.json`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {readOnly && (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertTitle>Read-only: this version is approved</AlertTitle>
            <AlertDescription>Edit the latest draft, or start a new version.</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {lines} lines · canonical sha256 <Hash value={hash} />
            {sourcePath && (
              <>
                {' '}
                · source <code className="font-mono">{sourcePath}</code>
              </>
            )}
          </p>
          {!readOnly && (
            <ActionGroup align="end">
              <Button
                variant="outline"
                size="sm"
                disabled={!parsed.ok}
                onClick={() => parsed.ok && setText(pretty(parsed.value))}
              >
                <WandSparklesIcon aria-hidden="true" />
                Format
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty}
                onClick={() => setText(initial)}
              >
                <RotateCcwIcon aria-hidden="true" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty || !check?.valid}
                onClick={() => parsed.ok && downloadText(fileName, pretty(parsed.value))}
              >
                <DownloadIcon aria-hidden="true" />
                Download
              </Button>
            </ActionGroup>
          )}
        </div>
        <Textarea
          aria-label="Game configuration JSON"
          spellCheck={false}
          readOnly={readOnly}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-[34rem] resize-y font-mono text-xs leading-5"
        />
        {!readOnly && gameId && (
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
            aria-label="Save draft"
            onSubmit={(e) => {
              e.preventDefault();
              if (!parsed.ok || !check?.valid || !dirty) return;
              saveDraft.mutate(parsed.value as Record<string, unknown>, {
                onSuccess: (v) => onSaved?.(v.version),
              });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={versionId}>New version</Label>
              <Input
                id={versionId}
                className="w-32 font-mono"
                value={draftVersion}
                onChange={(e) => setDraftVersion(e.target.value.trim())}
                pattern="\d+\.\d+\.\d+"
                required
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!dirty || !check?.valid || saveDraft.isPending}
              data-testid="save-draft"
            >
              <SaveIcon aria-hidden="true" />
              {saveDraft.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            {saveDraft.error ? (
              <p className="w-full text-sm text-destructive" role="alert">
                {errorMessage(saveDraft.error)}
              </p>
            ) : null}
          </form>
        )}
      </div>

      <div className="space-y-5">
        <Section title="Validation" description="Schema, invariants and change control">
          {!parsed.ok ? (
            <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
              <XCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Not valid JSON: {parsed.message}
            </p>
          ) : errors.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-success" data-testid="config-valid">
              <CheckCircle2Icon className="size-4" aria-hidden="true" />
              {dirty ? 'Valid draft' : 'Valid'}
              {warnings.length > 0 &&
                ` with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`}
            </p>
          ) : (
            <p
              className="flex items-center gap-2 text-sm text-destructive"
              data-testid="config-invalid"
            >
              <XCircleIcon className="size-4" aria-hidden="true" />
              {errors.length} problem{errors.length > 1 ? 's' : ''} block this draft
            </p>
          )}
          {check && check.issues.length > 0 && (
            <ul
              className="max-h-72 space-y-1.5 overflow-auto text-xs"
              aria-label="Validation issues"
            >
              {check.issues.map((i) => (
                <li key={`${i.source}:${i.path}:${i.message}`} className="flex gap-2">
                  {i.severity === 'error' ? (
                    <XCircleIcon
                      className="mt-0.5 size-3.5 shrink-0 text-destructive"
                      aria-label="Error"
                    />
                  ) : (
                    <AlertTriangleIcon
                      className="mt-0.5 size-3.5 shrink-0 text-warning"
                      aria-label="Warning"
                    />
                  )}
                  <span>
                    <code className="font-mono text-muted-foreground">{i.path || '/'}</code>{' '}
                    {i.message} <span className="text-muted-foreground">({i.source})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {check && check.diff.length > 0 && (
          <Section
            title={`Changes (${check.diff.length})`}
            description="Against the version you opened"
          >
            <DiffList diff={check.diff} max={30} />
          </Section>
        )}

        <Section title="Locked fields" description="Change only through a signed amendment">
          <details className="group text-xs" data-testid="locked-fields">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
              {LOCKED_FIELDS.length} locked paths
            </summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {LOCKED_FIELDS.map((f) => (
                <li key={f.pattern} className="flex gap-2">
                  <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span>
                    <code className="font-mono text-foreground/80">{f.pattern}</code> {f.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <p className="pt-2 text-xs font-medium">Allowed with a warning</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {MEASUREMENT_FIELDS.map((f) => (
              <li key={f.pattern} className="flex gap-2">
                <AlertTriangleIcon
                  className="mt-0.5 size-3 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span>
                  <code className="font-mono text-foreground/80">{f.pattern}</code> {f.reason}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
