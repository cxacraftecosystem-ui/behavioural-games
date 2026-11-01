'use client';

import { useQuery } from '@tanstack/react-query';
import { PlayIcon, ShieldAlertIcon, ShieldOffIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Can, usePermission } from '@/components/auth/can';
import { TimeStamp } from '@/components/data/audit-stamp';
import { Section } from '@/components/data/page-header';
import { EmptyState, QueryState } from '@/components/data/states';
import { StatusBadge } from '@/components/data/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { unwrap } from '@/lib/api/client';
import type { Schema } from '@/lib/api/types';
import { useApi } from '@/lib/auth/auth-context';
import { formatInteger } from '@/lib/format';
import { Hash, useAdminMutation } from '../shared/components';
import { adminKeys } from '../shared/query-keys';
import type { SettingsInputs } from './load-settings.server';

interface RunReport {
  readonly retention_run_id: string;
  readonly dry_run: boolean;
  readonly policy_sha256: string;
  readonly report: {
    readonly policy_version?: string;
    readonly rules?: Record<string, { cutoff?: string; affected?: number; skipped?: string }>;
  };
}

type ErasureRow = {
  request_id: string;
  scope: string;
  status: string;
  channel: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
};

/** Retention schedule (PRV-05): rules, dry-run or live run, legal holds and the erasure queue. */
export function RetentionPanel({ retention }: { readonly retention: SettingsInputs['retention'] }) {
  const api = useApi();
  const canErasure = usePermission({ all: ['erasure.execute'] });
  const [live, setLive] = useState(false);
  const [report, setReport] = useState<RunReport | null>(null);
  const run = useAdminMutation({
    mutationFn: async (dryRun: boolean) =>
      (await unwrap(
        api.POST('/api/v1/admin/retention/run', { body: { dry_run: dryRun } }),
      )) as unknown as RunReport,
    invalidate: [adminKeys.auditAll(), adminKeys.retentionRuns()],
    success: (r: RunReport) =>
      r.dry_run ? 'Dry run finished: nothing was deleted' : 'Retention run finished',
  });
  const erasure = useQuery({
    queryKey: adminKeys.erasure(),
    enabled: canErasure,
    queryFn: async () =>
      (await unwrap(
        api.GET('/api/v1/admin/erasure-requests', { params: { query: { limit: 100 } } }),
      )) as ErasureRow[],
  });

  const holdId = useId();
  const [hold, setHold] = useState<Schema<'LegalHoldIn'>>({
    scope_kind: 'study',
    scope_value: '',
    reason: '',
  });
  const placeHold = useAdminMutation({
    mutationFn: (body: Schema<'LegalHoldIn'>) =>
      unwrap(api.POST('/api/v1/admin/legal-holds', { body })),
    invalidate: [adminKeys.auditAll(), adminKeys.legalHolds()],
    success: (r: Record<string, unknown>) => `Legal hold #${String(r.id)} placed`,
  });
  const releaseHold = useAdminMutation({
    mutationFn: (id: number) =>
      unwrap(
        api.POST('/api/v1/admin/legal-holds/{hold_id}/release', {
          params: { path: { hold_id: id } },
        }),
      ),
    invalidate: [adminKeys.auditAll(), adminKeys.legalHolds()],
    success: (r: Record<string, unknown>) => `Legal hold #${String(r.id)} released`,
  });

  const canRetention = usePermission({ all: ['retention.run'] });
  const policy = useQuery({
    queryKey: adminKeys.retentionPolicy(),
    enabled: canRetention,
    queryFn: () => unwrap(api.GET('/api/v1/admin/retention/policy')),
  });
  const runs = useQuery({
    queryKey: adminKeys.retentionRuns(),
    enabled: canRetention,
    queryFn: () =>
      unwrap(api.GET('/api/v1/admin/retention/runs', { params: { query: { limit: 20 } } })),
  });
  const holds = useQuery({
    queryKey: adminKeys.legalHolds(),
    enabled: canRetention,
    queryFn: () => unwrap(api.GET('/api/v1/admin/legal-holds')),
  });

  // The rules the server runs; the repository copy read at build time until the server answers.
  const rules = policy.data
    ? policy.data.rules.map((r) => ({
        id: r.id,
        dataClass: r.data_class ?? 'unclassified',
        ttlDays: r.ttl_days ?? null,
        enabled: r.enabled,
        description: r.description ?? '',
      }))
    : retention.rules;
  const version = policy.data?.version ?? retention.version;
  const sha256 = policy.data?.sha256 ?? retention.sha256;
  const lastRules = report?.report.rules ?? {};

  return (
    <div className="space-y-8">
      <Section
        title="Retention schedule"
        description={
          <>
            Applied nightly · v{version} · sha256 <Hash value={sha256} />. Legal holds block purges.
          </>
        }
        actions={
          <Can all={['retention.run']}>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id={`${holdId}-live`}
                  checked={live}
                  onCheckedChange={(v) => setLive(v === true)}
                />
                <Label htmlFor={`${holdId}-live`} className="text-xs font-normal">
                  Live run (deletes data)
                </Label>
              </div>
              <Button
                size="sm"
                variant={live ? 'destructive' : 'outline'}
                disabled={run.isPending}
                onClick={() => run.mutate(!live, { onSuccess: (r) => setReport(r) })}
              >
                <PlayIcon aria-hidden="true" />
                {live ? 'Run retention now' : 'Dry run'}
              </Button>
            </div>
          </Can>
        }
      >
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Data class</TableHead>
                <TableHead className="text-right">Keep for</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Description</TableHead>
                {report && (
                  <TableHead className="text-right">
                    {report.dry_run ? 'Would affect' : 'Affected'}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const res = lastRules[r.id];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell>{r.dataClass.replaceAll('_', ' ')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.ttlDays === null ? 'rule-defined' : `${r.ttlDays} days`}
                    </TableCell>
                    <TableCell>
                      {r.enabled ? (
                        <StatusBadge status="active" label="on" />
                      ) : (
                        <StatusBadge status="off" label="off" />
                      )}
                    </TableCell>
                    <TableCell className="min-w-72 max-w-md whitespace-normal text-xs text-muted-foreground">
                      {r.description}
                    </TableCell>
                    {report && (
                      <TableCell className="text-right tabular-nums">
                        {res?.skipped ? (
                          <span className="text-xs text-muted-foreground">
                            {res.skipped.replaceAll('_', ' ')}
                          </span>
                        ) : (
                          formatInteger(res?.affected ?? null)
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {report && (
          <p className="text-xs text-muted-foreground">
            Run <code className="font-mono">{report.retention_run_id}</code> (
            {report.dry_run ? 'dry run' : 'live'}) against policy{' '}
            {report.report.policy_version ?? '—'} · sha256 <Hash value={report.policy_sha256} />
          </p>
        )}
        {canRetention && (runs.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-md border" data-testid="retention-runs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Affected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((r) => {
                  const counts = Object.values(
                    (r.report as RunReport['report']).rules ?? {},
                  ).reduce((n, x) => n + (x.affected ?? 0), 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <TimeStamp value={r.started_at} />
                      </TableCell>
                      <TableCell>{r.dry_run ? 'Dry run' : 'Live'}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.triggered_by}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInteger(counts)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Legal holds" description="Blocks purges and erasure until released.">
        <Can
          all={['retention.run']}
          fallback={
            <p className="text-sm text-muted-foreground">You don’t have access to legal holds.</p>
          }
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              className="space-y-3 rounded-lg border bg-card p-4"
              aria-label="Place legal hold"
              onSubmit={(e) => {
                e.preventDefault();
                placeHold.mutate(
                  { ...hold, scope_value: hold.scope_value.trim(), reason: hold.reason.trim() },
                  {
                    onSuccess: () =>
                      setHold({ scope_kind: hold.scope_kind, scope_value: '', reason: '' }),
                  },
                );
              }}
            >
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldAlertIcon className="size-4" aria-hidden="true" />
                Place a hold
              </p>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor={`${holdId}-kind`}>Scope</Label>
                  <Select
                    value={hold.scope_kind}
                    onValueChange={(v) =>
                      setHold({ ...hold, scope_kind: v as Schema<'LegalHoldIn'>['scope_kind'] })
                    }
                  >
                    <SelectTrigger id={`${holdId}-kind`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="study">Study</SelectItem>
                      <SelectItem value="session">Session</SelectItem>
                      <SelectItem value="participant">Participant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${holdId}-value`}>Identifier</Label>
                  <Input
                    id={`${holdId}-value`}
                    value={hold.scope_value}
                    onChange={(e) => setHold({ ...hold, scope_value: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${holdId}-reason`}>Reason</Label>
                <Input
                  id={`${holdId}-reason`}
                  value={hold.reason}
                  onChange={(e) => setHold({ ...hold, reason: e.target.value })}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={
                  placeHold.isPending || !hold.scope_value.trim() || hold.reason.trim().length < 3
                }
              >
                Place hold
              </Button>
            </form>
            <div className="space-y-3 rounded-lg border bg-card p-4" data-testid="legal-holds">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldOffIcon className="size-4" aria-hidden="true" />
                Active holds
              </p>
              {(holds.data ?? []).filter((h) => !h.released_at).length === 0 ? (
                <p className="text-sm text-muted-foreground">No active holds.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(holds.data ?? [])
                    .filter((h) => !h.released_at)
                    .map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">#{h.id}</span>
                        <span>
                          {h.scope_kind} <code className="font-mono text-xs">{h.scope_value}</code>
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {h.reason}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={releaseHold.isPending}
                          onClick={() => releaseHold.mutate(h.id)}
                        >
                          Release
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </Can>
      </Section>

      <Section title="Erasure requests" description="Receipts are signed.">
        {!canErasure ? (
          <p className="text-sm text-muted-foreground">
            You don’t have access to erasure requests.
          </p>
        ) : (
          <QueryState
            query={erasure}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState title="No erasure requests" />}
          >
            {(rows) => (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.request_id}>
                        <TableCell>
                          <Hash value={r.request_id} length={8} />
                        </TableCell>
                        <TableCell>{r.scope}</TableCell>
                        <TableCell>{r.channel}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                          {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                        </TableCell>
                        <TableCell>
                          <TimeStamp value={r.created_at} />
                        </TableCell>
                        <TableCell>
                          <TimeStamp value={r.completed_at} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </QueryState>
        )}
      </Section>
    </div>
  );
}
