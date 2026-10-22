// Live end-to-end check against https://behavioural-games.vercel.app (headless Chromium). Not part of CI.
// Run from frontend/apps/web:
//   SMOKE_PASSWORD="$(aws ssm get-parameter --name /shriii/prod/smoke_test_password --with-decryption \
//     --query Parameter.Value --output text)" OUT_DIR=../../../docs/screenshots/deploy node e2e/live-prod.mjs
// The password is never printed. See docs/deploy/aws-ec2.md (Smoke-test staff account).
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://behavioural-games.vercel.app';
const USER = 'smoke-test@shriii.local';
/** The EC2 API host; the browser must never contact it directly (Vercel proxies /api/v1). */
const EC2_HOSTS = new Set(['52-66-109-32.sslip.io', '52.66.109.32']);
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = process.env.OUT_DIR;
if (!PASSWORD || !OUT) throw new Error('SMOKE_PASSWORD and OUT_DIR are required');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
try {
  // ---------- console ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const apiCalls = [];
  const foreignHosts = new Set();
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/v1')) apiCalls.push({ method: req.method(), url: req.url() });
    if (EC2_HOSTS.has(u.hostname)) foreignHosts.add(u.hostname);
  });
  const apiResponses = [];
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/v1')) return;
    const h = res.headers();
    apiResponses.push({
      path: u.pathname,
      status: res.status(),
      caddy: (h['content-security-policy'] ?? '').includes("default-src 'none'"),
      requestId: Boolean(h['x-request-id']),
      vercel: Boolean(h['x-vercel-id']),
    });
  });

  // Backend identity through the Vercel origin (the in-app demo API has no migration/identity DB).
  const ready = await (await ctx.request.get(`${BASE}/readyz`)).json();
  check(
    'readyz via Vercel is the EC2 API',
    ready.checks?.database === 'ok' &&
      ready.checks?.identity_database === 'ok' &&
      ready.checks?.migration === '0007',
    JSON.stringify(ready),
  );
  const providers = await ctx.request.get(`${BASE}/api/v1/auth/providers`);
  check(
    'auth providers endpoint (new API) reachable',
    providers.status() === 200,
    JSON.stringify(await providers.json()),
  );

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  check('login page shows password form', await page.getByTestId('password-sign-in').isVisible());
  check('no demo sign-in on production', (await page.getByTestId('demo-sign-in').count()) === 0);
  check(
    'no Google button while unconfigured',
    (await page.getByTestId('google-sign-in').count()) === 0,
  );
  await page.getByLabel('Email or username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL((u) => u.pathname.startsWith('/research'), { timeout: 30_000 });
  check('sign-in lands on /research', new URL(page.url()).pathname === '/research', page.url());
  check('no demo banner', (await page.getByTestId('demo-banner').count()) === 0);
  check(
    'no password-change prompt for the service account',
    (await page.getByTestId('password-change-banner').count()) === 0,
  );
  await page.waitForLoadState('networkidle');
  await page
    .getByText(/SYNTHETIC DEMO/i)
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => undefined);
  const researchText = await page.locator('main').innerText();
  check('/research shows the backend SYNTHETIC DEMO study', /SYNTHETIC DEMO/i.test(researchText));
  const studies = await page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('shriii.auth.session') ?? 'null');
    const r = await fetch('/api/v1/studies', {
      headers: { Authorization: `Bearer ${s?.accessToken}` },
    });
    return { status: r.status, body: await r.json() };
  });
  const items = Array.isArray(studies.body) ? studies.body : (studies.body.items ?? []);
  check(
    '/api/v1/studies returns only synthetic studies',
    studies.status === 200 &&
      items.length > 0 &&
      items.every((x) => String(x.study_id ?? x.id).startsWith('synthetic-')),
    items.map((x) => `${x.study_id ?? x.id}: ${x.name}`).join('; '),
  );
  await page.getByTestId('user-menu').click();
  const roles = await page.getByTestId('user-roles').innerText();
  check(
    'user menu shows researcher role and session expiry',
    /Researcher/i.test(roles) && (await page.getByTestId('session-expiry').count()) === 1,
    roles,
  );
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/live-research.jpg`, type: 'jpeg', quality: 85 });

  await page.goto(`${BASE}/research/validation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const valText = await page.locator('main').innerText();
  check(
    '/research/validation renders',
    (await page.getByTestId('forbidden').count()) === 0 && /validation/i.test(valText),
    valText.slice(0, 120).replace(/\s+/g, ' '),
  );
  await page.screenshot({ path: `${OUT}/live-validation.jpg`, type: 'jpeg', quality: 85 });

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page
    .getByTestId('forbidden')
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  check('/admin refused for researcher', (await page.getByTestId('forbidden').count()) === 1);
  const adminApi = await page.evaluate(async () => {
    const s = JSON.parse(sessionStorage.getItem('shriii.auth.session') ?? 'null');
    const r = await fetch('/api/v1/admin/kiosks', {
      headers: { Authorization: `Bearer ${s?.accessToken}` },
    });
    return r.status;
  });
  check('API refuses admin endpoint for researcher', adminApi === 403, String(adminApi));
  await page.screenshot({ path: `${OUT}/live-admin-refused.jpg`, type: 'jpeg', quality: 85 });

  await page.getByTestId('user-menu').click();
  await page.getByTestId('sign-out').click();
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 });
  const tokenAfter = await page.evaluate(() => sessionStorage.getItem('shriii.auth.session'));
  check('sign-out returns to /login and clears the token', tokenAfter === null);
  await page.goto(`${BASE}/research`);
  await page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 }).catch(() => undefined);
  check(
    'console requires sign-in again after sign-out',
    new URL(page.url()).pathname === '/login',
    page.url(),
  );

  const sameOrigin = apiCalls.every((c) => c.url.startsWith(`${BASE}/api/v1/`));
  check(
    'every browser /api/v1 request goes to the Vercel origin',
    sameOrigin && apiCalls.length > 0,
    `${apiCalls.length} requests`,
  );
  check(
    'browser never contacts the EC2 host directly',
    foreignHosts.size === 0,
    [...foreignHosts].join(','),
  );
  const served = apiResponses.filter((r) => r.caddy && r.requestId);
  check(
    'API responses carry the EC2 edge (Caddy) headers via Vercel',
    served.length === apiResponses.length && apiResponses.length > 0,
    `${served.length}/${apiResponses.length}`,
  );
  await ctx.close();

  // ---------- public kiosk ----------
  const kctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const kpage = await kctx.newPage();
  const kioskApi = [];
  const errors = [];
  kpage.on('request', (req) => {
    const u = new URL(req.url());
    if (
      u.pathname.includes('/api/') ||
      u.pathname.includes('events/batch') ||
      EC2_HOSTS.has(u.hostname)
    ) {
      kioskApi.push(`${req.method()} ${req.url()}`);
    }
  });
  kpage.on('pageerror', (e) => errors.push(e.message));
  await kpage.goto(`${BASE}/kiosk`, { waitUntil: 'networkidle' });
  const canvas = kpage.getByTestId('kiosk-stage-host').locator('canvas');
  await canvas.first().waitFor({ state: 'attached', timeout: 45_000 });
  await kpage.waitForTimeout(4000);
  await kpage.mouse.click(960, 540);
  await kpage.waitForTimeout(5000);
  await kpage.screenshot({ path: `${OUT}/live-kiosk-language.jpg`, type: 'jpeg', quality: 85 });
  await kpage.waitForTimeout(35_000); // longer than the uploader's 30 s idle poll
  check('kiosk canvas mounted, no page errors', errors.length === 0, errors.join(' | '));
  check('kiosk made no upload or API request', kioskApi.length === 0, kioskApi.join(', '));
  await kctx.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
