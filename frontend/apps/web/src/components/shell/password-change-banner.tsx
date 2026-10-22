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
      className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:px-5 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <ShieldAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Your account still uses its initial password. Replace it with one only you know.
      </span>
      <Link
        href={`/account/password?next=${encodeURIComponent(pathname)}`}
        className="font-medium underline underline-offset-4"
      >
        Change password
      </Link>
    </div>
  );
}
