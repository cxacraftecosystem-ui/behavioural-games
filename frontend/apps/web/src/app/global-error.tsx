'use client';

/** Last-resort boundary (replaces the root layout, so it renders its own document). */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100dvh',
          margin: 0,
          background: '#f7f6fb',
          color: '#1e1b2e',
        }}
      >
        <main role="alert" style={{ textAlign: 'center', padding: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#615d7a', fontSize: 14 }}>
            {error.digest ? `Reference ${error.digest}. ` : ''}Reload the page to try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 40,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 500,
              border: 0,
              borderRadius: 12,
              background: 'oklch(0.47 0.198 305)',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
