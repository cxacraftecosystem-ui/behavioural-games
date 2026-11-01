'use client';

import { ShieldAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';

/** Reminder on every console page while the account still uses an operator-issued initial password. */
export function PasswordChangeBanner() {
  const { passwordChangeRequired, config } = useAuth();
  const pathname = usePathname();
  if (!passwordChangeRequired || config?.mode !== 'local' || pathname.startsWith('/account')) {
    return null;
  }
  return (
    <div
      role="note"
      aria-label="Password change required"
      data-testid="password-change-banner"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
    >
      <ShieldAlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1">You’re still on your initial password.</span>
      <Link
        href={`/account/password?next=${encodeURIComponent(pathname)}`}
        className="font-medium text-accent-foreground underline underline-offset-4"
      >
        Change password
      </Link>
    </div>
  );
}
