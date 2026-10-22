'use client';

/**
 * "Sign in with Google" (Google Identity Services, ID-token flow). Rendered only when
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID is set. GIS hands back a Google-signed ID token, which the API verifies
 * (`POST /api/v1/auth/google`): signature against Google's keys, issuer, audience = this client id,
 * expiry and a verified email. Only an existing, active staff account whose username is that email can
 * sign in; Google never grants roles. The flow needs only the client id, no client secret.
 */
import { useEffect, useRef, useState } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GisCredentialResponse {
  readonly credential?: string;
}

interface GisApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GisCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        context?: 'signin' | 'signup' | 'use';
        ux_mode?: 'popup' | 'redirect';
        itp_support?: boolean;
        use_fedcm_for_button?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GisApi;
  }
}

let loader: Promise<GisApi> | null = null;

function loadGis(): Promise<GisApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (loader) return loader;
  loader = new Promise<GisApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () =>
      window.google?.accounts?.id
        ? resolve(window.google)
        : reject(new Error('Google sign-in did not load.'));
    script.onerror = () => {
      loader = null;
      reject(new Error('Google sign-in could not be loaded. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export function GoogleSignInButton({
  clientId,
  onCredential,
  onError,
  disabled,
}: {
  readonly clientId: string;
  readonly onCredential: (credential: string) => void;
  readonly onError: (message: string) => void;
  readonly disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Keep the latest callbacks without re-initialising GIS on every render.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let alive = true;
    loadGis()
      .then((google) => {
        if (!alive || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) handlers.current.onCredential(response.credential);
            else handlers.current.onError('Google did not return a sign-in credential.');
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          ux_mode: 'popup',
          itp_support: true,
          use_fedcm_for_button: true,
        });
        const width = Math.min(400, Math.max(200, Math.round(ref.current.clientWidth)));
        google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width,
        });
        setReady(true);
      })
      .catch((err: unknown) => {
        if (alive) handlers.current.onError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  return (
    <div
      className="relative flex min-h-10 w-full justify-center"
      data-testid="google-sign-in"
      aria-busy={!ready}
    >
      <div
        ref={ref}
        className={disabled ? 'pointer-events-none w-full opacity-60' : 'w-full'}
        style={{ colorScheme: 'light' }}
      />
      {!ready && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-md border bg-muted/50"
        />
      )}
    </div>
  );
}
