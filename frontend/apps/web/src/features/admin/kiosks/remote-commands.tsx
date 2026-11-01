'use client';

import { useQuery } from '@tanstack/react-query';
import {
  DownloadCloudIcon,
  LockIcon,
  LockOpenIcon,
  PowerIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { type ComponentType, useId, useState } from 'react';
import { usePermission } from '@/components/auth/can';
import { TimeStamp } from '@/components/data/audit-stamp';
import { Section } from '@/components/data/page-header';
import { StatusBadge } from '@/components/data/status-badge';
import { ActionGroup } from '@/components/ui/action-group';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import type { Schema } from '@/lib/api/types';
import { useApi } from '@/lib/auth/auth-context';
import { useAdminMutation } from '../shared/components';
import { adminKeys } from '../shared/query-keys';

type Command = Schema<'KioskCommandIn'>['command'];
type CommandOut = Schema<'KioskCommandOut'>;

interface CommandSpec {
  readonly id: Command;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** What happens, in one line (the confirm dialog's body). */
  readonly effect: string;
}

const SPECS: Readonly<Record<Command, CommandSpec>> = {
  lock: {
    id: 'lock',
    label: 'Lock',
    icon: LockIcon,
    effect: 'The kiosk shows out-of-service until you unlock it. Applies at the next idle moment.',
  },
  unlock: {
    id: 'unlock',
    label: 'Unlock',
    icon: LockOpenIcon,
    effect: 'The kiosk returns to play.',
  },
  restart: {
    id: 'restart',
    label: 'Restart',
    icon: PowerIcon,
    effect: 'Restarts when nobody is playing.',
  },
  sync: {
    id: 'sync',
    label: 'Sync now',
    icon: RefreshCwIcon,
    effect: 'Uploads queued sessions now.',
  },
  pull_logs: {
    id: 'pull_logs',
    label: 'Pull logs',
    icon: DownloadCloudIcon,
    effect: 'Collects scrubbed counters. No participant data.',
  },
  wipe: {
    id: 'wipe',
    label: 'Wipe',
    icon: Trash2Icon,
    effect:
      'Clears the kiosk’s local data once everything is uploaded. Refused under a legal hold.',
  },
};

const PENDING = new Set(['queued', 'delivered']);

/** The kiosk's lock state from its newest acknowledged lock/unlock (a pending one is shown as such). */
function lockState(history: readonly CommandOut[]): 'locked' | 'unlocked' {
  const last = history.find(
    (c) => (c.command === 'lock' || c.command === 'unlock') && c.status === 'acknowledged',
  );
  return last?.command === 'lock' ? 'locked' : 'unlocked';
}

/** Remote commands for one kiosk (KSK-10): signed per kiosk, idempotent, applied only when idle. */
export function RemoteCommands({
  kioskId,
  revoked,
}: {
  readonly kioskId: string;
  readonly revoked: boolean;
}) {
  const api = useApi();
  const canSend = usePermission({ all: ['admin.kiosks'] });
  const [confirm, setConfirm] = useState<CommandSpec | null>(null);
  const [intent, setIntent] = useState<string>('');
  const [reason, setReason] = useState('');
  const [typedId, setTypedId] = useState('');
  const baseId = useId();

  const history = useQuery({
    queryKey: adminKeys.kioskCommands(kioskId),
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/admin/kiosks/{kiosk_id}/commands', {
          params: { path: { kiosk_id: kioskId } },
        }),
      ),
    refetchInterval: 15_000,
  });

  const send = useAdminMutation({
    mutationFn: (body: Schema<'KioskCommandIn'>) =>
      unwrap(
        api.POST('/api/v1/admin/kiosks/{kiosk_id}/commands', {
          params: { path: { kiosk_id: kioskId } },
          body,
        }),
      ),
    invalidate: [adminKeys.kioskCommands(kioskId)],
    success: (c: CommandOut) => `${SPECS[c.command as Command]?.label ?? c.command} queued.`,
  });

  const cancel = useAdminMutation({
    mutationFn: (commandId: string) =>
      unwrap(
        api.POST('/api/v1/admin/kiosks/{kiosk_id}/commands/{command_id}/cancel', {
          params: { path: { kiosk_id: kioskId, command_id: commandId } },
        }),
      ),
    invalidate: [adminKeys.kioskCommands(kioskId)],
    success: 'Command cancelled.',
  });

  const rows = history.data ?? [];
  const locked = lockState(rows) === 'locked';
  const visible: readonly Command[] = [
    locked ? 'unlock' : 'lock',
    'sync',
    'pull_logs',
    'restart',
    'wipe',
  ];

  const open = (spec: CommandSpec) => {
    // One idempotency key per confirmed intent: a double click or a retry never queues it twice.
    setIntent(crypto.randomUUID().replaceAll('-', ''));
    setReason('');
    setTypedId('');
    send.reset();
    setConfirm(spec);
  };
  const isWipe = confirm?.id === 'wipe';
  const ready = !isWipe || (reason.trim().length >= 3 && typedId === kioskId);

  return (
    <Section
      title="Remote commands"
      description="Signed for this kiosk and applied when nobody is playing."
    >
      {canSend && !revoked && (
        <ActionGroup align="start">
          {visible.map((id) => {
            const spec = SPECS[id];
            return (
              <Button
                key={id}
                size="sm"
                variant={id === 'wipe' ? 'destructive' : 'outline'}
                onClick={() => open(spec)}
                data-testid={`kiosk-command-${id}`}
              >
                <spec.icon aria-hidden="true" />
                {spec.label}
              </Button>
            );
          })}
        </ActionGroup>
      )}
      {revoked && <p className="text-sm text-muted-foreground">Revoked kiosks take no commands.</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No commands yet.</p>
      ) : (
        <ul className="space-y-2 text-sm" data-testid="kiosk-command-history">
          {rows.slice(0, 10).map((c) => (
            <li key={c.command_id} className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              <span className="font-medium">{SPECS[c.command as Command]?.label ?? c.command}</span>
              <span className="text-muted-foreground">by {c.issued_by}</span>
              <TimeStamp value={c.created_at} className="text-xs text-muted-foreground" />
              {c.error && <span className="text-destructive">{c.error.replaceAll('_', ' ')}</span>}
              {c.command === 'pull_logs' && c.status === 'acknowledged' && (
                <code className="w-full truncate rounded-sm bg-muted px-2 py-1 font-mono text-xs">
                  {JSON.stringify(c.result)}
                </code>
              )}
              {canSend && PENDING.has(c.status) && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Cancel ${SPECS[c.command as Command]?.label ?? c.command}`}
                  onClick={() => cancel.mutate(c.command_id)}
                >
                  <XIcon />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!ready) return;
                send.mutate(
                  {
                    command: confirm.id,
                    idempotency_key: intent,
                    reason: reason.trim() || null,
                    confirm_kiosk_id: isWipe ? typedId : null,
                  },
                  { onSuccess: () => setConfirm(null) },
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {confirm.label} {kioskId}?
                </DialogTitle>
                <DialogDescription>{confirm.effect}</DialogDescription>
              </DialogHeader>
              {isWipe && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor={`${baseId}-reason`}>Reason</Label>
                    <Textarea
                      id={`${baseId}-reason`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`${baseId}-confirm`}>Type the kiosk id to confirm</Label>
                    <Input
                      id={`${baseId}-confirm`}
                      autoComplete="off"
                      value={typedId}
                      onChange={(e) => setTypedId(e.target.value.trim())}
                      placeholder={kioskId}
                    />
                  </div>
                </>
              )}
              {send.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage(send.error)}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={isWipe ? 'destructive' : 'default'}
                  disabled={!ready || send.isPending}
                  data-testid="kiosk-command-confirm"
                >
                  {send.isPending ? 'Sending…' : confirm.label}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
