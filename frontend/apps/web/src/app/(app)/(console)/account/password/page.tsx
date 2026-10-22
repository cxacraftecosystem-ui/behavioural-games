import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChangePasswordPage } from '@/features/account/change-password-page';

export const metadata: Metadata = { title: 'Change password' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordPage />
    </Suspense>
  );
}
