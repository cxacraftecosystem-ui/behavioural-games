'use client';

import { CheckIcon, EyeIcon, MinusIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Section } from '@/components/data/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth/auth-context';
import { ALL_STUDIES, isUserRole, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/auth/permissions';
import { isAdmin } from '@/lib/auth/principal';
import { cn } from '@/lib/utils';
import { KeyValues } from '../shared/components';
import {
  MATRIX_ROLES,
  type MatrixRole,
  permissionGroups,
  ROLE_PERMISSIONS,
  SENSITIVE,
} from './rbac-matrix';

const ROLE_HEAD: Record<MatrixRole, string> = {
  admin: 'Admin',
  researcher: 'Researcher',
  administrator: 'Field admin',
  analyst: 'Analyst',
  kiosk_device: 'Kiosk device',
};

/** Users and roles: the signed-in principal, study scoping rules and the read-only permission matrix. */
export function RolesPanel() {
  const { principal } = useAuth();
  const groups = permissionGroups();
  const unscoped = principal
    ? isAdmin(principal) || principal.studies.includes(ALL_STUDIES)
    : false;
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Signed in as</CardTitle>
            <CardDescription>
              Roles and study scope are assigned in your sign-in provider.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KeyValues
              items={[
                [
                  'Subject',
                  <code key="s" className="font-mono text-xs">
                    {principal?.sub}
                  </code>,
                ],
                [
                  'Roles',
                  <span key="r" className="flex flex-wrap gap-1">
                    {principal?.roles.map((r) => (
                      <Badge key={r} variant="secondary">
                        {ROLE_LABELS[r]}
                      </Badge>
                    ))}
                  </span>,
                ],
                ['Study scope', unscoped ? 'All studies' : (principal?.studies.join(', ') ?? '—')],
                ['Permissions', String(principal?.permissions.size ?? 0)],
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Study-scoped access</CardTitle>
            <CardDescription>
              Roles grant permissions; study scope limits where they apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="grid gap-1 sm:grid-cols-2">
              {MATRIX_ROLES.filter(isUserRole).map((r) => (
                <li key={r} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{ROLE_LABELS[r]}:</span>{' '}
                  {ROLE_DESCRIPTIONS[r]}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Section
        title="Permission matrix"
        description="The eye marks identifiable or score-bearing data."
      >
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Permission</TableHead>
                {MATRIX_ROLES.map((r) => (
                  <TableHead
                    key={r}
                    className={cn(
                      'text-center',
                      principal?.roles.some((x) => x === r) && 'text-foreground',
                    )}
                  >
                    {ROLE_HEAD[r]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.group}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell
                      colSpan={MATRIX_ROLES.length + 1}
                      className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      {g.group.replaceAll('_', ' ')}
                    </TableCell>
                  </TableRow>
                  {g.permissions.map((p) => (
                    <TableRow key={p}>
                      <TableCell className="py-1">
                        <span className="flex items-center gap-1.5">
                          <code className="font-mono text-xs">{p}</code>
                          {SENSITIVE.has(p) && (
                            <EyeIcon
                              className="size-3 text-muted-foreground"
                              aria-label="Sensitive data"
                            />
                          )}
                        </span>
                      </TableCell>
                      {MATRIX_ROLES.map((r) => (
                        <TableCell key={r} className="py-1 text-center">
                          {ROLE_PERMISSIONS[r].has(p) ? (
                            <CheckIcon
                              className="mx-auto size-3.5"
                              aria-label={`${ROLE_HEAD[r]} has ${p}`}
                            />
                          ) : (
                            <MinusIcon
                              className="mx-auto size-3.5 text-muted-foreground/40"
                              aria-label={`${ROLE_HEAD[r]} lacks ${p}`}
                            />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}
