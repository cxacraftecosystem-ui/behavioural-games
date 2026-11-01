'use client';

import { useEffect } from 'react';

export default function RootError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] unhandled error', error);
  }, [error]);
  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center"
    >
      <h1 className="display-title text-3xl">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Try again.{error.digest ? ` Reference ${error.digest}.` : ''}
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        Try again
      </button>
    </main>
  );
}
