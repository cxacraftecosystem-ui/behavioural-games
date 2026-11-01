'use client';

import { useQuery } from '@tanstack/react-query';
import { PencilIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { usePermission } from '@/components/auth/can';
import { TimeStamp } from '@/components/data/audit-stamp';
import { Section } from '@/components/data/page-header';
import { EmptyState, QueryState } from '@/components/data/states';
import { StatusBadge } from '@/components/data/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import type { Schema } from '@/lib/api/types';
import { useApi } from '@/lib/auth/auth-context';
import { ALL_STUDIES, ROLE_LABELS, USER_ROLES, type UserRole } from '@/lib/auth/permissions';
import { useAdminMutation } from '../shared/components';
import { adminKeys } from '../shared/query-keys';

type UserOut = Schema<'UserOut'>;

/** Parse "*" or a comma-separated list of study ids. */
export function parseStudyScope(text: string): string[] {
  const ids = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length === 0 || ids.includes(ALL_STUDIES) ? [ALL_STUDIES] : [...new Set(ids)];
}

function GrantsDialog({ user, onClose }: { readonly user: UserOut; readonly onClose: () => void }) {
  const api = useApi();
  const id = useId();
  const [roles, setRoles] = useState<UserRole[]>(
    user.roles.filter((r): r is UserRole => (USER_ROLES as readonly string[]).includes(r)),
  );
  const [studies, setStudies] = useState(user.studies.join(', ') || ALL_STUDIES);
  const [disabled, setDisabled] = useState(user.disabled);
  const save = useAdminMutation({
    mutationFn: (body: Schema<'UserGrantsIn'>) =>
      unwrap(
        api.PUT('/api/v1/admin/users/{sub}/grants', {
          params: { path: { sub: user.username } },
          body,
        }),
      ),
    invalidate: [adminKeys.users()],
    success: 'Access updated. It applies at their next sign-in.',
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { roles, studies: parseStudyScope(studies), disabled },
              { onSuccess: onClose },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Access for {user.username}</DialogTitle>
            <DialogDescription>Applies at their next sign-in.</DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Roles</legend>
            {USER_ROLES.map((r) => (
              <div key={r} className="flex items-center gap-2.5">
                <Checkbox
                  id={`${id}-${r}`}
                  checked={roles.includes(r)}
                  onCheckedChange={(v) =>
                    setRoles((prev) => (v === true ? [...prev, r] : prev.filter((x) => x !== r)))
                  }
                />
                <Label htmlFor={`${id}-${r}`} className="font-normal">
                  {ROLE_LABELS[r]}
                </Label>
              </div>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-studies`}>Study scope</Label>
            <Input
              id={`${id}-studies`}
              value={studies}
              onChange={(e) => setStudies(e.target.value)}
              placeholder="* for all, or study ids separated by commas"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id={`${id}-disabled`}
              checked={disabled}
              onCheckedChange={(v) => setDisabled(v === true)}
            />
            <Label htmlFor={`${id}-disabled`} className="font-normal">
              Account disabled
            </Label>
          </div>
          {save.error ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={roles.length === 0 || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save access'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Staff accounts with their roles and study scope (PRV-08); every change is audited. */
export function UsersPanel() {
  const api = useApi();
  const canEdit = usePermission({ all: ['admin.settings'] });
  const [editing, setEditing] = useState<UserOut | null>(null);
  const users = useQuery({
    queryKey: adminKeys.users(),
    queryFn: () => unwrap(api.GET('/api/v1/admin/users')),
  });
  return (
    <Section title="Users and grants" description="Roles and study scope per staff account.">
      <QueryState
        query={users}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="No staff accounts" />}
      >
        {(rows) => (
          <div className="overflow-x-auto rounded-md border" data-testid="users-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Study scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.username}>
                    <TableCell className="font-mono text-xs">{u.username}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} variant="secondary">
                            {ROLE_LABELS[r as UserRole] ?? r}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell>
                      {u.studies.includes(ALL_STUDIES) ? 'All studies' : u.studies.join(', ')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={u.disabled ? 'disabled' : 'active'}
                        tone={u.disabled ? 'locked' : 'good'}
                      />
                    </TableCell>
                    <TableCell>
                      <TimeStamp value={u.last_login_at ?? null} />
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(u)}
                          aria-label={`Edit access for ${u.username}`}
                        >
                          <PencilIcon aria-hidden="true" /> Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
      {editing && <GrantsDialog user={editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}
