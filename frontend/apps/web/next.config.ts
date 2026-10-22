import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/** Monorepo root: Turbopack must see frontend/packages/*, contracts/ and content/* (kiosk-game imports content JSON). */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * FastAPI origin; the browser talks to it through same-origin rewrites (no CORS, no token in URLs). On
 * Vercel production this is the EC2 API (API_PROXY_TARGET=https://52-66-109-32.sslip.io), so the browser
 * only ever talks to the Vercel origin and Vercel forwards `/api/v1/*` server side.
 */
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000').replace(
  /\/+$/,
  '',
);

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Public demo deployment (Vercel): no FastAPI backend. `/api/v1/*`, `/healthz` and `/readyz` go to
 * the in-app demo API (src/app/demo-api, synthetic fixtures, read-only) instead of the proxy.
 */
const demoMode = ['1', 'true', 'yes'].includes(
  (process.env.NEXT_PUBLIC_DEMO_MODE ?? '').trim().toLowerCase(),
);

// A Vercel build without demo mode must know where the API is; the localhost default would silently break
// every /api/v1 call in production.
if (process.env.VERCEL && !demoMode && !process.env.API_PROXY_TARGET) {
  throw new Error('API_PROXY_TARGET must be set for a Vercel build with NEXT_PUBLIC_DEMO_MODE=0');
}
if (!demoMode && process.env.VERCEL && !apiProxyTarget.startsWith('https://')) {
  throw new Error('API_PROXY_TARGET must be an https:// origin on Vercel');
}
const authMode = (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'dev').trim().toLowerCase() || 'dev';
if (process.env.VERCEL && !demoMode && authMode === 'dev') {
  throw new Error(
    'Set NEXT_PUBLIC_AUTH_MODE to "local" or "oidc" for a Vercel build without demo mode',
  );
}

/**
 * Google Identity Services (the "Sign in with Google" button on /login) opens a popup and checks the page
 * origin, which `Cross-Origin-Opener-Policy: same-origin` and `Referrer-Policy: no-referrer` break. Only
 * /login relaxes them, and only when Google sign-in is configured.
 */
const googleSignIn = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').trim() !== '';

/**
 * `output: 'standalone'` is only for the Docker image (infra/docker/web.Dockerfile sets
 * NEXT_OUTPUT=standalone). Vercel builds use its own output format and must not set it.
 */
const standalone = process.env.NEXT_OUTPUT === 'standalone';

/**
 * `@shriii/kiosk-game` is authored for Vite and reads `import.meta.env.*`. Next.js has no
 * `import.meta.env`, so the handful of keys it reads are statically replaced here. The dev voice
 * placeholder (Web Speech, "DEV VOICE" banner) is forced off in production builds (BUILD_DECISIONS:
 * no runtime TTS in production).
 */
const kioskEnvShims: Record<string, string> = {
  'import.meta.env.DEV': JSON.stringify(!isProduction),
  'import.meta.env.PROD': JSON.stringify(isProduction),
  'import.meta.env.MODE': JSON.stringify(isProduction ? 'production' : 'development'),
  'import.meta.env.VITE_DEV_VOICE_PLACEHOLDER': JSON.stringify(
    !isProduction && process.env.NEXT_PUBLIC_DEV_VOICE_PLACEHOLDER === 'true' ? 'true' : 'false',
  ),
};

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Camera is never used (no facial signals). The microphone is only for opt-in closed-vocabulary
  // kiosk ASR, so it is allowed for this origin only.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@shriii/kiosk-game', '@shriii/contracts'],
  turbopack: { root: repoRoot },
  // infra/docker/web.Dockerfile ships the self-contained server from .next/standalone; tracing from the repo
  // root puts it at .next/standalone/frontend/apps/web/server.js with the workspace packages it needs.
  ...(standalone ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: repoRoot,
  // The demo API reads the fixture inputs from the repository at runtime (paths relative to this app).
  outputFileTracingIncludes: {
    '/demo-api/**': [
      '../../../pnpm-workspace.yaml',
      '../../../content/games/**/*.json',
      '../../../content/instruments/*.yaml',
      '../../../stats/measurement-model/*.yaml',
      '../../../stats/measurement-model/dictionary/*.yaml',
      './src/features/research/e2e/fixtures/engine-results.json',
      './src/features/research/e2e/fixtures/snapshot.parquet',
    ],
  },
  compiler: { define: kioskEnvShims },
  async rewrites() {
    if (demoMode) {
      return [
        { source: '/api/v1/:path*', destination: '/demo-api/v1/:path*' },
        { source: '/healthz', destination: '/demo-api/healthz' },
        { source: '/readyz', destination: '/demo-api/readyz' },
      ];
    }
    return [
      { source: '/api/v1/:path*', destination: `${apiProxyTarget}/api/v1/:path*` },
      { source: '/healthz', destination: `${apiProxyTarget}/healthz` },
      { source: '/readyz', destination: `${apiProxyTarget}/readyz` },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      ...(googleSignIn
        ? [
            {
              source: '/login',
              headers: [
                { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
              ],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
