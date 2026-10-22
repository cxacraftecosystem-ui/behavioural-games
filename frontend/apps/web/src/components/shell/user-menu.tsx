'use client';

import { ClockIcon, KeyRoundIcon, LogOutIcon, ShieldCheckIcon, UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/auth-context';
import { ALL_STUDIES, ROLE_LABELS } from '@/lib/auth/permissions';
import { isAdmin } from '@/lib/auth/principal';

export function UserMenu() {
  const { principal, signOut, config, expiresAt, passwordChangeRequired } = useAuth();
  const router = useRouter();
  if (!principal) return null;
  const unscoped = isAdmin(principal) || principal.studies.includes(ALL_STUDIES);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" data-testid="user-menu">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserIcon className="size-3.5" />
          </span>
          <span className="hidden max-w-40 truncate sm:inline">{principal.sub}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="space-y-1.5">
          <div className="truncate font-medium">{principal.sub}</div>
          <div className="flex flex-wrap gap-1" data-testid="user-roles">
            {principal.roles.map((r) => (
              <Badge key={r} variant="secondary">
                <ShieldCheckIcon />
                {ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
          <div className="text-xs font-normal text-muted-foreground">
            Study scope:{' '}
            {unscoped
              ? 'all studies'
              : principal.studies.length
                ? principal.studies.join(', ')
                : 'none'}
          </div>
          {expiresAt !== null && config?.mode === 'local' && (
            <div
              className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
              data-testid="session-expiry"
            >
              <ClockIcon className="size-3" aria-hidden="true" />
              Session ends at{' '}
              {new Date(expiresAt * 1000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
          {config?.mode === 'dev' && (
            <Badge variant="warning" className="font-normal">
              Development sign-in
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {config?.mode === 'local' && (
          <DropdownMenuItem
            data-testid="change-password-link"
            onSelect={() => router.push('/account/password')}
          >
            <KeyRoundIcon />
            Change password
            {passwordChangeRequired && (
              <Badge variant="warning" className="ml-auto font-normal">
                Required
              </Badge>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          data-testid="sign-out"
          onSelect={() => {
            void signOut('user').then(() => router.replace('/login'));
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
