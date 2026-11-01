/**
 * Network mock of the admin API endpoints for the admin screenshot/smoke suite. Game configs and the
 * session plan come from the real content/games files; fleet, audit and settings rows are labelled
 * test fixtures (the suite runs without a database, per the local-dev rule).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { findRepoRoot } from '../../research/load-science.server';
import { planDefaults, propose } from '../settings/policy';

// From the working directory, not import.meta.url: the demo API route (src/app/demo-api) bundles this.
const ROOT = `${findRepoRoot()}/`;
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

interface GameDoc {
  config: Record<string, unknown>;
  path: string;
  sha256: string;
}

function gameDocs(): GameDoc[] {
  const out: GameDoc[] = [];
  for (const dir of ['pathway-a', 'pathway-b', 'shared']) {
    for (const f of readdirSync(`${ROOT}content/games/${dir}`)) {
      if (!f.endsWith('.json')) continue;
      const bytes = readFileSync(`${ROOT}content/games/${dir}/${f}`);
      const config = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      if (!('module_id' in config)) continue;
      out.push({
        config,
        path: `content/games/${dir}/${f}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return out;
}

/** Fixture approval state: two games have an approved 0.0.9 plus a 0.1.0 draft; one is fully approved. */
function buildGames() {
  const docs = gameDocs();
  let id = 1;
  const versions = new Map<string, Record<string, unknown>[]>();
  for (const d of docs) {
    const gameId = String(d.config.module_id);
    const list: Record<string, unknown>[] = [];
    const base = {
      game_id: gameId,
      config_id: String(d.config.config_id),
      source_path: d.path,
    };
    if (gameId === 'stall' || gameId === 'dont_tap') {
      const older = structuredClone(d.config);
      older.version = '0.0.9';
      const blocks = older.blocks as Record<string, unknown>[];
      const main = blocks.find((b) => b.phase === 'main');
      if (main && typeof main.budget_trial_ms === 'number') main.budget_trial_ms += 200;
      list.push({
        ...base,
        id: id++,
        version: '0.0.9',
        sha256: createHash('sha256').update(JSON.stringify(older)).digest('hex'),
        status: 'approved',
        approved_by: ['Dr A. Rao (PI)', 'S. Iyer (Ethics)'],
        approved_at: ago(60 * 24 * 9),
        config: older,
      });
    }
    const approvedNow = gameId === 'card_sort';
    list.push({
      ...base,
      id: id++,
      version: String(d.config.version),
      sha256: d.sha256,
      status: approvedNow ? 'approved' : 'draft',
      approved_by: approvedNow ? ['Dr A. Rao (PI)', 'M. Kulkarni (Content lead)'] : [],
      approved_at: approvedNow ? ago(60 * 24 * 2) : null,
      config: d.config,
    });
    versions.set(gameId, list);
  }
  const strip = (v: Record<string, unknown>) => {
    const { config: _c, ...rest } = v;
    return rest;
  };
  const games = docs.map((d) => {
    const gameId = String(d.config.module_id);
    const list = versions.get(gameId) ?? [];
    const approved = [...list].reverse().find((v) => v.status === 'approved');
    return {
      game_id: gameId,
      kind: d.config.kind,
      pathways: d.config.pathways,
      constructs: d.config.constructs,
      slot: d.config.slot,
      latest_version: list.length ? strip(list[list.length - 1] as Record<string, unknown>) : null,
      approved_version: approved ? strip(approved) : null,
    };
  });
  return { games, versions, strip };
}

const KIOSKS = [
  {
    kiosk_id: 'pune-market-01',
    site_id: 'pune-hadapsar',
    label: 'Hadapsar weekly market, stall row B',
    status: 'active',
    hardware_sku: 'kiosk-21in-v2',
    app_version: '0.4.2',
    last_heartbeat_at: ago(1),
    last_heartbeat: {
      outbox_depth: 14,
      last_upload_age_s: 95,
      frame_time_p99_ms: 16.4,
      disk_free_mb: 41210,
      clock_offset_estimate_ms: -38,
      audio_underruns: 0,
      dropped_frames: 3,
      content_pack_version: 'content-0.1.0+3fa2c1',
      policy_version: '1.0.0',
      temperature: { cpu_c: 54 },
      printer: 'ok',
      touch_self_test: 'pass',
    },
    health_status: 'healthy',
    created_at: ago(60 * 24 * 30),
    revoked_at: null,
  },
  {
    kiosk_id: 'pune-market-02',
    site_id: 'pune-hadapsar',
    label: 'Hadapsar weekly market, entrance',
    status: 'active',
    hardware_sku: 'kiosk-21in-v2',
    app_version: '0.4.2',
    last_heartbeat_at: ago(47),
    last_heartbeat: {
      outbox_depth: 362,
      last_upload_age_s: 5400,
      frame_time_p99_ms: 21.9,
      disk_free_mb: 39880,
      clock_offset_estimate_ms: 912,
    },
    health_status: 'stale',
    created_at: ago(60 * 24 * 30),
    revoked_at: null,
  },
  {
    kiosk_id: 'nashik-phc-01',
    site_id: 'nashik-phc',
    label: 'Primary health centre waiting hall (supervised)',
    status: 'active',
    hardware_sku: 'kiosk-15in-v1',
    app_version: '0.4.1',
    last_heartbeat_at: ago(2),
    last_heartbeat: {
      outbox_depth: 0,
      last_upload_age_s: 40,
      frame_time_p99_ms: 18.1,
      disk_free_mb: 12004,
      clock_offset_estimate_ms: 12,
      // Still on the previous pack: the fleet table flags the drift from the assigned games 0.1.0.
      content_pack_version: 'content-0.0.9+77de01',
    },
    health_status: 'healthy',
    created_at: ago(60 * 24 * 12),
    revoked_at: null,
  },
  {
    kiosk_id: 'madurai-lab-01',
    site_id: 'madurai-lab',
    label: 'Field lab bench unit',
    status: 'active',
    hardware_sku: null,
    app_version: null,
    last_heartbeat_at: null,
    last_heartbeat: {},
    health_status: 'unknown',
    created_at: ago(60 * 3),
    revoked_at: null,
  },
  {
    kiosk_id: 'pune-market-03',
    site_id: 'pune-hadapsar',
    label: 'Reported stolen 14 Oct',
    status: 'revoked',
    hardware_sku: 'kiosk-21in-v2',
    app_version: '0.4.0',
    last_heartbeat_at: ago(60 * 24 * 8),
    last_heartbeat: { outbox_depth: 51 },
    health_status: 'stale',
    created_at: ago(60 * 24 * 40),
    revoked_at: ago(60 * 24 * 8),
  },
];

const CONTENT_VERSIONS = [
  {
    id: '7b1e2a9c-0000-4000-8000-000000000001',
    kind: 'games',
    version: '0.1.0',
    sha256: 'c0ffee5a7d0c0d1e2f3a4b5c6d7e8f9012345678901234567890abcdef123456',
    status: 'approved',
    approved_by: ['Dr A. Rao (PI)', 'M. Kulkarni (Content lead)'],
    created_at: ago(60 * 24 * 3),
  },
  {
    id: '7b1e2a9c-0000-4000-8000-000000000002',
    kind: 'dictionary',
    version: '0.1.0',
    sha256: '9a8b7c6d5e4f30211203f4e5d6c7b8a99a8b7c6d5e4f30211203f4e5d6c7b8a9',
    status: 'approved',
    approved_by: ['Dr A. Rao (PI)', 'R. Menon (Methods)'],
    created_at: ago(60 * 24 * 3),
  },
  {
    id: '7b1e2a9c-0000-4000-8000-000000000003',
    kind: 'instruments',
    version: '0.2.0',
    sha256: '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988',
    status: 'draft',
    approved_by: [],
    created_at: ago(60 * 5),
  },
  {
    id: '7b1e2a9c-0000-4000-8000-000000000004',
    kind: 'gates',
    version: '0.1.0',
    sha256: 'aa11bb22cc33dd44ee55ff6600aa11bb22cc33dd44ee55ff6600aa11bb22cc33',
    status: 'draft',
    approved_by: [],
    created_at: ago(60 * 5),
  },
];

const DEPLOYMENTS = [
  {
    id: 'd-1',
    kiosk_id: 'pune-market-01',
    site_id: 'pune-hadapsar',
    site_mode: 'open_public',
    study_id: null,
    policy_version: '1.0.0',
    app_version: '0.4.2',
    content_version_id: CONTENT_VERSIONS[0]?.id,
    ring: 'pilot',
    status: 'active',
    effective_from: ago(60 * 24 * 6),
    created_by: 'dev-admin',
  },
  {
    id: 'd-2',
    kiosk_id: 'pune-market-02',
    site_id: 'pune-hadapsar',
    site_mode: 'open_public',
    study_id: null,
    policy_version: '1.0.0',
    app_version: '0.4.2',
    content_version_id: CONTENT_VERSIONS[0]?.id,
    ring: 'pilot',
    status: 'active',
    effective_from: ago(60 * 24 * 6),
    created_by: 'dev-admin',
  },
  {
    id: 'd-3',
    kiosk_id: 'nashik-phc-01',
    site_id: 'nashik-phc',
    site_mode: 'supervised',
    study_id: 'S-PILOT',
    policy_version: '1.0.0',
    app_version: '0.4.1',
    content_version_id: CONTENT_VERSIONS[0]?.id,
    ring: 'lab',
    status: 'active',
    effective_from: ago(60 * 24 * 10),
    created_by: 'dev-admin',
  },
  {
    id: 'd-0',
    kiosk_id: 'nashik-phc-01',
    site_id: 'nashik-phc',
    site_mode: 'supervised',
    study_id: 'S-PILOT',
    policy_version: '0.9.0',
    app_version: '0.4.0',
    content_version_id: null,
    ring: 'lab',
    status: 'superseded',
    effective_from: ago(60 * 24 * 12),
    created_by: 'dev-admin',
  },
];

const EVENTS = [
  {
    id: 41,
    occurred_at: ago(30),
    kind: 'kiosk_stale',
    severity: 'warn',
    kiosk_id: 'pune-market-02',
    details: { last_heartbeat_at: ago(47) },
  },
  {
    id: 40,
    occurred_at: ago(60 * 24 * 8),
    kind: 'kiosk_revoked',
    severity: 'warn',
    kiosk_id: 'pune-market-03',
    details: { by: 'dev-admin' },
  },
  {
    id: 39,
    occurred_at: ago(60 * 26),
    kind: 'batch_rejected',
    severity: 'error',
    kiosk_id: 'pune-market-02',
    details: { reason: 'schema_invalid', count: 3 },
  },
];

function auditRows(policyDocs: { previous: unknown; next: unknown; actor: string; at: string }[]) {
  const rows: Record<string, unknown>[] = [];
  let id = 9120;
  const push = (
    r: Partial<Record<string, unknown>> & { action: string; actor_sub: string; at: string },
  ) =>
    rows.push({
      id: id--,
      occurred_at: r.at,
      actor_sub: r.actor_sub,
      actor_roles: r.actor_roles ?? ['admin'],
      actor_kind: 'user',
      action: r.action,
      method: r.method ?? 'POST',
      path: r.path ?? null,
      status_code: r.status_code ?? 200,
      outcome: r.outcome ?? 'success',
      resource_type: r.resource_type ?? null,
      resource_id: r.resource_id ?? null,
      study_id: r.study_id ?? null,
      request_id: `req${id.toString(16)}a7f3`,
      details: r.details ?? {},
    });
  for (const p of policyDocs) {
    push({
      action: 'settings.put',
      actor_sub: p.actor,
      at: p.at,
      method: 'PUT',
      path: '/api/v1/admin/settings/deployment_policy',
      resource_type: 'setting',
      resource_id: 'deployment_policy',
      details: { previous: p.previous, new: p.next },
    });
  }
  push({
    action: 'kiosks.revoke',
    actor_sub: 'dev-admin',
    at: ago(60 * 24 * 8),
    path: '/api/v1/admin/kiosks/pune-market-03/revoke',
    resource_type: 'kiosk',
    resource_id: 'pune-market-03',
  });
  push({
    action: 'games.approve',
    actor_sub: 'dev-admin',
    at: ago(60 * 24 * 2),
    path: '/api/v1/games/card_sort/versions/0.1.0/approve',
    resource_type: 'game_version',
    resource_id: 'card_sort@0.1.0',
  });
  push({
    action: 'sessions.events.read',
    actor_sub: 'r.menon',
    actor_roles: ['researcher'],
    at: ago(60 * 5),
    method: 'GET',
    path: '/api/v1/sessions/…/events',
    resource_type: 'session',
    study_id: 'S-PILOT',
  });
  push({
    action: 'participants.read',
    actor_sub: 'k.patil',
    actor_roles: ['analyst'],
    at: ago(60 * 4),
    method: 'GET',
    path: '/api/v1/participants',
    status_code: 403,
    outcome: 'denied',
  });
  push({
    action: 'auth.dev_login',
    actor_sub: 'dev-admin',
    at: ago(3),
    path: '/api/v1/auth/dev-login',
  });
  return rows.sort((a, b) => Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)));
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

/** Register admin endpoint mocks (call after the shell's `mockApi`, so these take precedence). */
export async function mockAdminApi(page: Page): Promise<void> {
  const { games, versions, strip } = buildGames();
  const session = JSON.parse(
    readFileSync(`${ROOT}content/games/session-plan.json`, 'utf8'),
  ) as unknown;
  const v1 = await propose(
    { ...planDefaults(), report_use_statement_key: 'report.what_this_is_about' },
    {
      current: null,
      actor: 'r.menon',
      note: 'First pilot policy from the plan §1.4 defaults (ethics approval EC-2026-14).',
      now: new Date(NOW - 86_400_000 * 10),
    },
  );
  const v1approved = {
    ...v1,
    status: 'approved' as const,
    approvals: [{ by: 'dev-admin', at: ago(60 * 24 * 9) }],
  };
  const v2 = await propose(
    { ...v1.values, enabled_languages: ['hi-IN', 'mr-IN'], reminder_channel: 'sms' },
    {
      current: v1approved,
      actor: 'r.menon',
      note: 'Tamil recordings not ready: stage Tamil out of the first wave; SMS reminders for the Pune site per ethics amendment 2.',
      now: new Date(NOW - 3_600_000 * 20),
    },
  );
  const settings = [
    {
      key: 'deployment_policy',
      value: v2,
      description: 'Deployment policy 1.1.0 (proposed); PRV-01, plan §1.4',
      updated_by: 'r.menon',
      updated_at: ago(60 * 20),
    },
    {
      key: 'export.justification_rows',
      value: { threshold: 50 },
      description: 'Rows above which an export needs a written justification (PRV-08).',
      updated_by: 'dev-admin',
      updated_at: ago(60 * 24 * 20),
    },
    {
      key: 'kiosk.heartbeat',
      value: { interval_s: 60 },
      description: 'Expected kiosk heartbeat cadence (KSK-10).',
      updated_by: 'dev-admin',
      updated_at: ago(60 * 24 * 15),
    },
  ];
  const commands = new Map<string, Record<string, unknown>[]>();
  const takes = new Map<string, Record<string, unknown>[]>();
  const users = [
    {
      username: 'dev-admin',
      roles: ['admin'],
      studies: ['*'],
      disabled: false,
      locked_until: null,
      last_login_at: ago(5),
      must_change_password: false,
      created_at: ago(60 * 24 * 30),
      created_by: 'cli',
    },
    {
      username: 'r.menon',
      roles: ['researcher'],
      studies: ['S-PILOT'],
      disabled: false,
      locked_until: null,
      last_login_at: ago(60 * 20),
      must_change_password: false,
      created_at: ago(60 * 24 * 25),
      created_by: 'cli',
    },
  ];
  const audit = auditRows([
    { previous: null, next: v1, actor: 'r.menon', at: ago(60 * 24 * 10) },
    { previous: v1, next: v1approved, actor: 'dev-admin', at: ago(60 * 24 * 9) },
    { previous: v1approved, next: v2, actor: 'r.menon', at: ago(60 * 20) },
  ]);

  await page.route('**/api/v1/games**', (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname
      .replace(/^\/api\/v1\/games\/?/, '')
      .split('/')
      .filter(Boolean);
    const method = route.request().method();
    if (parts.length === 0 && method === 'GET') return json(route, games);
    if (parts[0] === 'session-plan')
      return json(route, {
        sha256: 'b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184',
        plan: session,
      });
    if (parts[0] === 'sync' && method === 'POST')
      return json(route, { games: games.length, versions_added: 0, unchanged: games.length });
    const list = versions.get(parts[0] ?? '');
    if (!list)
      return json(route, { detail: { code: 'unknown_game', message: 'game not found' } }, 404);
    if (parts[1] === 'versions' && parts.length === 2 && method === 'POST') {
      const body = route.request().postDataJSON() as { version: string; config: unknown };
      if (list.some((x) => x.version === body.version))
        return json(route, { detail: { code: 'version_exists', message: 'version exists' } }, 409);
      const row = {
        id: 9000 + list.length,
        game_id: parts[0],
        version: body.version,
        config_id: `${parts[0]}@${body.version}`,
        config: body.config,
        sha256: 'd'.repeat(64),
        status: 'draft',
        approved_by: [],
        approved_at: null,
        source_path: null,
      };
      list.push(row);
      return json(route, strip(row), 201);
    }
    if (parts[1] === 'versions' && parts.length === 2) return json(route, list.map(strip));
    if (parts[1] === 'versions' && parts[2]) {
      const v = list.find((x) => x.version === decodeURIComponent(parts[2] ?? ''));
      if (!v)
        return json(route, { detail: { code: 'unknown_game_version', message: 'not found' } }, 404);
      if (parts[3] === 'approve') return json(route, { ...strip(v), status: 'approved' });
      const blocks =
        ((v.config as Record<string, unknown>).blocks as Record<string, unknown>[]) ?? [];
      const trial_definitions =
        (v.config as Record<string, unknown>).kind === 'episode'
          ? blocks.map((b, i) => ({
              block_id: b.block_id,
              sequence: i + 1,
              phase: b.phase,
              condition_id: b.condition_id,
              planned_trials: b.trials,
              min_trials: b.min_trials,
              scorable: b.scorable,
            }))
          : [];
      return json(route, { ...v, trial_definitions });
    }
    return json(route, strip(list[list.length - 1] as Record<string, unknown>));
  });

  await page.route('**/api/v1/admin/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1/admin', '');
    const method = route.request().method();
    if (path === '/kiosks' && method === 'GET') return json(route, KIOSKS);
    if (path === '/deployments') return json(route, DEPLOYMENTS);
    if (path === '/system-events') return json(route, EVENTS);
    if (path === '/dead-letters/summary')
      return json(route, [{ reason_code: 'schema_invalid', app_version: '0.4.1', count: 3 }]);
    if (path === '/content-versions') return json(route, CONTENT_VERSIONS);
    if (path === '/settings' && method === 'GET') return json(route, settings);
    if (path === '/gates/release-pack/current')
      return json(
        route,
        { detail: { code: 'no_release_pack', message: 'no release pack issued' } },
        404,
      );
    if (path === '/erasure-requests') {
      return json(route, [
        {
          request_id: '5f1c9a3e-1111-4a2b-9c3d-000000000001',
          scope: 'session',
          status: 'completed',
          channel: 'report_page',
          pid_hmac: null,
          session_id: null,
          created_at: ago(60 * 30),
          completed_at: ago(60 * 29),
          error: null,
        },
        {
          request_id: '5f1c9a3e-1111-4a2b-9c3d-000000000002',
          scope: 'participant',
          status: 'blocked',
          channel: 'researcher',
          pid_hmac: 'x',
          session_id: null,
          created_at: ago(60 * 6),
          completed_at: null,
          error: 'legal hold #3 on study S-PILOT',
        },
      ]);
    }
    if (path === '/audit') {
      const action = url.searchParams.get('action');
      const outcome = url.searchParams.get('outcome');
      const items = audit.filter(
        (r) =>
          (!action || String(r.action).startsWith(action)) && (!outcome || r.outcome === outcome),
      );
      return json(route, { items, total: items.length, limit: 50, offset: 0 });
    }
    if (path === '/retention/run' && method === 'POST') {
      return json(route, {
        retention_run_id: '0c9d8e7f-2222-4b3c-8d4e-000000000009',
        dry_run: true,
        policy_sha256: 'f'.repeat(64),
        report: {
          policy_version: '1.0.0',
          rules: {
            consent_parking_expired: { cutoff: ago(0), affected: 0 },
            play_only_raw_events: { cutoff: ago(60 * 24 * 90), affected: 1840 },
            dead_letters: { cutoff: ago(60 * 24 * 90), affected: 0 },
            telemetry: { cutoff: ago(60 * 24 * 90), affected: 220 },
            security_logs: { cutoff: ago(60 * 24 * 365), affected: 0 },
            expired_reports: { cutoff: ago(60 * 24 * 30), affected: 12 },
            finished_jobs: { cutoff: ago(60 * 24 * 30), affected: 96 },
            vault_contacts: { cutoff: ago(0), affected: 0 },
          },
        },
      });
    }
    // Kiosk remote commands (idempotent by key).
    const cmd = /^\/kiosks\/([^/]+)\/commands(?:\/([^/]+)\/cancel)?$/.exec(path);
    if (cmd) {
      const kioskId = decodeURIComponent(cmd[1] ?? '');
      const list = commands.get(kioskId) ?? [];
      commands.set(kioskId, list);
      if (cmd[2] && method === 'POST') {
        const row = list.find((c) => c.command_id === cmd[2]);
        if (!row)
          return json(route, { detail: { code: 'unknown_command', message: 'not found' } }, 404);
        row.status = 'cancelled';
        return json(route, row);
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as {
          command: string;
          idempotency_key: string;
          reason: string | null;
          confirm_kiosk_id: string | null;
        };
        const existing = list.find((c) => c.idempotency_key === body.idempotency_key);
        if (existing) return json(route, existing);
        if (body.command === 'wipe' && body.confirm_kiosk_id !== kioskId)
          return json(
            route,
            { detail: { code: 'confirm_required', message: 'confirm the kiosk id' } },
            422,
          );
        const row = {
          command_id: `c0ffee00-0000-4000-8000-${String(list.length + 1).padStart(12, '0')}`,
          kiosk_id: kioskId,
          command: body.command,
          idempotency_key: body.idempotency_key,
          status: 'queued',
          reason: body.reason,
          issued_by: 'dev-admin',
          created_at: ago(0),
          expires_at: ago(-60 * 24 * 7),
          delivered_at: null,
          acknowledged_at: null,
          result: {},
          error: null,
        };
        list.unshift(row);
        return json(route, row, 201);
      }
      return json(route, list);
    }
    if (path === '/users' && method === 'GET') return json(route, users);
    const grants = /^\/users\/([^/]+)\/grants$/.exec(path);
    if (grants && method === 'PUT') {
      const user = users.find((u) => u.username === decodeURIComponent(grants[1] ?? ''));
      if (!user)
        return json(route, { detail: { code: 'unknown_user', message: 'not found' } }, 404);
      Object.assign(user, route.request().postDataJSON() as Record<string, unknown>);
      return json(route, user);
    }
    if (path === '/retention/policy')
      return json(route, {
        version: '1.0.0',
        sha256: 'f'.repeat(64),
        rules: [
          {
            id: 'play_only_raw_events',
            data_class: 'raw',
            description: 'Raw events of play-only sessions.',
            ttl_days: 90,
            enabled: true,
          },
          {
            id: 'telemetry',
            data_class: 'telemetry',
            description: 'System events and device health.',
            ttl_days: 90,
            enabled: true,
          },
          {
            id: 'security_logs',
            data_class: 'security_logs',
            description: 'Audit events older than a year.',
            ttl_days: 365,
            enabled: true,
          },
        ],
      });
    if (path === '/retention/runs')
      return json(route, [
        {
          id: '0c9d8e7f-2222-4b3c-8d4e-000000000008',
          started_at: ago(60 * 24),
          finished_at: ago(60 * 24 - 1),
          dry_run: false,
          policy_sha256: 'f'.repeat(64),
          report: { policy_version: '1.0.0', rules: { telemetry: { affected: 212 } } },
          status: 'completed',
          triggered_by: 'system',
        },
      ]);
    if (path === '/legal-holds' && method === 'GET')
      return json(route, [
        {
          id: 3,
          scope_kind: 'study',
          scope_value: 'S-PILOT',
          reason: 'Ethics committee review of the pilot',
          created_by: 'dev-admin',
          created_at: ago(60 * 24 * 3),
          released_at: null,
        },
      ]);
    const sign = /^\/policies\/([^/]+)\/sign$/.exec(path);
    if (sign && method === 'POST')
      return json(route, {
        policy_version: decodeURIComponent(sign[1] ?? ''),
        sha256: 'a'.repeat(64),
        signature: 'c2lnbmF0dXJl',
        key_id: 'release-2026',
        algorithm: 'ed25519',
        signed_by: 'dev-admin',
        signed_at: ago(0),
      });
    if (path === '/content/lines' && method === 'GET')
      return json(route, {
        catalogue_version: '0.1.0',
        reference_language: 'en-IN',
        languages: [],
        lines: [],
      });
    const audio = /^\/content\/audio\/([^/]+)\/([^/]+)$/.exec(path);
    if (audio) {
      const key = `${audio[1]}|${audio[2]}`;
      const list = takes.get(key) ?? [];
      takes.set(key, list);
      if (method === 'POST') {
        const row = {
          id: `a0d10000-0000-4000-8000-${String(list.length + 1).padStart(12, '0')}`,
          line_id: decodeURIComponent(audio[1] ?? ''),
          language: decodeURIComponent(audio[2] ?? ''),
          filename: 'take.wav',
          content_type: 'audio/wav',
          size_bytes: 96044,
          sha256: 'e'.repeat(64),
          duration_ms: 1000,
          peak_dbfs: -3.1,
          rms_dbfs: -18.2,
          status: 'pending_qc',
          uploaded_by: 'dev-admin',
          created_at: ago(0),
        };
        list.unshift(row);
        return json(route, row, 201);
      }
      return json(route, list);
    }
    if (
      /^\/content\/lines\/[^/]+\/languages\/[^/]+\/transitions$/.test(path) &&
      method === 'POST'
    ) {
      const body = route.request().postDataJSON() as Record<string, string>;
      return json(
        route,
        {
          id: 1,
          from_status: 'forward_translated',
          recorded_by: 'dev-admin',
          created_at: ago(0),
          ...body,
        },
        201,
      );
    }
    return json(route, { detail: 'not mocked' }, 404);
  });
}
