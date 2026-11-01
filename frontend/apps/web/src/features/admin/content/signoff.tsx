'use client';

import { PenLineIcon } from 'lucide-react';
import { useId, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { useApi } from '@/lib/auth/auth-context';
import { useAdminMutation } from '../shared/components';
import { adminKeys } from '../shared/query-keys';

/**
 * Record one ITC sign-off for a line and language (VOX-07). The server checks the transition, the
 * signing role and the independent-signer rule against workflow.yaml and keeps an append-only trail.
 */
export function SignoffButton({
  lineId,
  language,
  toStatus,
  toLabel,
  signoffRole,
  roles,
  commentRequired,
  disabled,
}: {
  readonly lineId: string;
  readonly language: string;
  readonly toStatus: string;
  readonly toLabel: string;
  /** The role that must sign, or '*' for any reviewer role. */
  readonly signoffRole: string;
  readonly roles: readonly string[];
  readonly commentRequired: boolean;
  readonly disabled?: boolean;
}) {
  const api = useApi();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(signoffRole === '*' ? (roles[0] ?? '') : signoffRole);
  const [signer, setSigner] = useState('');
  const [comment, setComment] = useState('');
  const record = useAdminMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/admin/content/lines/{line_id}/languages/{language}/transitions', {
          params: { path: { line_id: lineId, language } },
          body: { to_status: toStatus, role, signer: signer.trim(), comment: comment.trim() },
        }),
      ),
    invalidate: [adminKeys.contentLines()],
    success: `Signed off: ${toLabel}.`,
  });
  const ready = signer.trim().length >= 3 && role !== '' && (!commentRequired || comment.trim());

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          record.reset();
          setOpen(true);
        }}
        data-testid={`signoff-${toStatus}`}
      >
        <PenLineIcon aria-hidden="true" />
        Sign off
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) record.mutate(undefined, { onSuccess: () => setOpen(false) });
            }}
          >
            <DialogHeader>
              <DialogTitle>{toLabel}</DialogTitle>
              <DialogDescription>
                <code className="font-mono">{lineId}</code> · {language}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-role`}>Signing role</Label>
              {signoffRole === '*' ? (
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id={`${id}-role`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replaceAll('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id={`${id}-role`} value={role.replaceAll('_', ' ')} readOnly />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-signer`}>Signer (full name)</Label>
              <Input
                id={`${id}-signer`}
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-comment`}>Comment{commentRequired ? '' : ' (optional)'}</Label>
              <Textarea
                id={`${id}-comment`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                required={commentRequired}
              />
            </div>
            {record.error ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage(record.error)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!ready || record.isPending}>
                {record.isPending ? 'Recording…' : 'Record sign-off'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
