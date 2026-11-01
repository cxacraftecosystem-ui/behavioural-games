'use client';

import { LockIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/data/states';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';

/** Signed in, but no console section is open to this principal (e.g. no recognised permissions). */
export default function NoAccessPage() {
  const { principal, signOut } = useAuth();
  const router = useRouter();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={LockIcon}
        className="max-w-lg"
        title="No console access"
        description={
          principal
            ? `Signed in as ${principal.sub}. Ask an administrator for a role.`
            : 'Sign in with a research or admin account.'
        }
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut('user').then(() => router.replace('/login'))}
          >
            Sign in as someone else
          </Button>
        }
      />
    </div>
  );
}
