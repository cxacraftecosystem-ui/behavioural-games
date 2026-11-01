import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { OutboxStats } from '../../logging/outbox/types.ts';
import {
  type CommandEffects,
  type CommandEnvelope,
  MemoryCommandStore,
  RemoteCommandClient,
  signedPayload,
} from '../remote-commands.ts';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const API = 'https://api.example.test';
const KIOSK = 'kiosk-01';
const NOW = Date.parse('2026-11-01T10:00:00Z');

const keyPair = (await subtle.generateKey({ name: 'Ed25519' }, true, [
  'sign',
  'verify',
])) as CryptoKeyPair;
const publicKeyB64 = Buffer.from(await subtle.exportKey('raw', keyPair.publicKey)).toString(
  'base64',
);

let counter = 0;
async function envelope(
  command: string,
  over: Partial<Omit<CommandEnvelope, 'signature'>> = {},
): Promise<CommandEnvelope> {
  counter += 1;
  const unsigned = {
    command_id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    kiosk_id: KIOSK,
    command,
    issued_at: '2026-11-01T09:00:00Z',
    expires_at: '2026-11-08T09:00:00Z',
    nonce: `nonce${counter}`,
    key_id: 'k1',
    ...over,
  };
  const sig = await subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(signedPayload({ ...unsigned, signature: '' })),
  );
  return { ...unsigned, signature: Buffer.from(sig).toString('base64') };
}

const CLEAN: OutboxStats = {
  pendingEvents: 0,
  inflightEvents: 0,
  acknowledgedEvents: 12,
  sessions: 3,
  sessionsAwaitingConsent: 0,
  openBatches: 0,
  declinedCount: 1,
  lastAckAt: null,
};

function harness(opts: { store?: MemoryCommandStore; token?: string | null } = {}) {
  const acks: { id: string; body: Record<string, unknown> }[] = [];
  const fetchCalls: string[] = [];
  const state = {
    queue: [] as CommandEnvelope[],
    stats: CLEAN,
    idle: true,
    ackFails: false,
  };
  const effects = {
    sync: vi.fn(async () => undefined),
    reload: vi.fn(() => undefined),
    wipeLocal: vi.fn(async () => undefined),
    outboxStats: async () => state.stats,
    appVersion: '0.1.0',
    errorCounts: () => ({ session_errors: 2, upload_failures: 0 }),
  } satisfies CommandEffects;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(`${init?.method ?? 'GET'} ${url.slice(API.length)}`);
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer dev_tok',
    );
    if (url.endsWith('/release-pack/public-key')) {
      return Response.json({ algorithm: 'ed25519', key_id: 'k1', public_key: publicKeyB64 });
    }
    if (url.endsWith('/kiosk-device/commands')) return Response.json(state.queue);
    const ack = /\/kiosk-device\/commands\/([^/]+)\/ack$/.exec(url);
    if (ack) {
      if (state.ackFails) throw new TypeError('network down');
      acks.push({ id: ack[1] as string, body: JSON.parse(String(init?.body)) });
      return Response.json({});
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const client = new RemoteCommandClient({
    apiBase: API,
    deviceToken: opts.token === undefined ? 'dev_tok' : opts.token,
    kioskId: KIOSK,
    isIdle: () => state.idle,
    effects,
    store: opts.store ?? new MemoryCommandStore(),
    fetch: fetchImpl,
    subtle,
    nowMs: () => NOW,
  });
  return { client, effects, acks, fetchCalls, state };
}

describe('RemoteCommandClient', () => {
  it('is disabled without a device token', async () => {
    const h = harness({ token: null });
    expect(h.client.enabled).toBe(false);
    expect(await h.client.pollOnce()).toEqual({ kind: 'disabled' });
    expect(h.fetchCalls).toEqual([]);
  });

  it('verifies the signature, locks (persisted) and acks', async () => {
    const store = new MemoryCommandStore();
    const h = harness({ store });
    const seen: boolean[] = [];
    h.client.subscribeLock((l) => seen.push(l));
    const lock = await envelope('lock');
    h.state.queue = [lock];
    const out = await h.client.pollOnce();
    expect(out.kind).toBe('done');
    expect(h.client.locked).toBe(true);
    expect(seen).toEqual([false, true]);
    expect(h.acks).toEqual([
      {
        id: lock.command_id,
        body: { status: 'acknowledged', result: { locked: true }, error: null },
      },
    ]);
    // The lock applies at the next boot: a new client on the same store starts locked.
    expect(harness({ store }).client.locked).toBe(true);

    h.state.queue = [await envelope('unlock')];
    await h.client.pollOnce();
    expect(h.client.locked).toBe(false);
  });

  it('refuses a tampered command', async () => {
    const h = harness();
    const forged = { ...(await envelope('sync')), command: 'wipe' };
    h.state.queue = [forged];
    await h.client.pollOnce();
    expect(h.effects.wipeLocal).not.toHaveBeenCalled();
    expect(h.acks[0]?.body).toEqual({ status: 'failed', result: {}, error: 'bad_signature' });
  });

  it('refuses another kiosk’s and expired commands', async () => {
    const h = harness();
    const other = await envelope('lock', { kiosk_id: 'kiosk-99' });
    const old = await envelope('lock', { expires_at: '2026-10-31T00:00:00Z' });
    h.state.queue = [other, old];
    await h.client.pollOnce();
    expect(h.client.locked).toBe(false);
    expect(h.acks.map((a) => a.body.error)).toEqual(['wrong_kiosk', 'expired']);
  });

  it('never runs a command twice and refuses a reused nonce', async () => {
    const h = harness();
    const sync = await envelope('sync');
    h.state.queue = [sync];
    await h.client.pollOnce();
    await h.client.pollOnce();
    expect(h.effects.sync).toHaveBeenCalledTimes(1);
    expect(h.acks).toHaveLength(2);
    expect(h.acks[1]?.body.status).toBe('acknowledged');

    h.state.queue = [await envelope('sync', { nonce: sync.nonce })];
    await h.client.pollOnce();
    expect(h.effects.sync).toHaveBeenCalledTimes(1);
    expect(h.acks.at(-1)?.body).toEqual({ status: 'failed', result: {}, error: 'replay' });
  });

  it('restarts once: the ack survives the reload and the command is not re-run', async () => {
    const store = new MemoryCommandStore();
    const first = harness({ store });
    const restart = await envelope('restart');
    first.state.queue = [restart];
    first.state.ackFails = true;
    await first.client.pollOnce();
    expect(first.effects.reload).toHaveBeenCalledTimes(1);
    expect(first.acks).toEqual([]);

    // After the reload: the pending ack goes out first, and the redelivered command is not run.
    const second = harness({ store });
    second.state.queue = [restart];
    await second.client.pollOnce();
    expect(second.effects.reload).not.toHaveBeenCalled();
    expect(second.acks[0]).toMatchObject({
      id: restart.command_id,
      body: { status: 'acknowledged' },
    });
  });

  it('does not fetch commands while a session is running', async () => {
    const h = harness();
    h.state.idle = false;
    h.state.queue = [await envelope('lock')];
    expect(await h.client.pollOnce()).toEqual({ kind: 'skipped', reason: 'not_idle' });
    expect(h.fetchCalls.some((c) => c.endsWith('/kiosk-device/commands'))).toBe(false);
    expect(h.client.locked).toBe(false);
  });

  it('refuses to wipe with unsynced data, wipes and reloads when clean', async () => {
    const h = harness();
    h.state.stats = { ...CLEAN, pendingEvents: 4 };
    h.state.queue = [await envelope('wipe')];
    await h.client.pollOnce();
    expect(h.effects.wipeLocal).not.toHaveBeenCalled();
    expect(h.acks[0]?.body).toEqual({ status: 'failed', result: {}, error: 'unsynced_data' });

    h.state.stats = CLEAN;
    h.state.queue = [await envelope('wipe')];
    await h.client.pollOnce();
    expect(h.effects.wipeLocal).toHaveBeenCalledTimes(1);
    expect(h.effects.reload).toHaveBeenCalledTimes(1);
    expect(h.acks.at(-1)?.body.status).toBe('acknowledged');
  });

  it('pulls scrubbed counters only', async () => {
    const h = harness();
    h.state.queue = [await envelope('pull_logs')];
    await h.client.pollOnce();
    const result = h.acks[0]?.body.result as Record<string, unknown>;
    expect(result).toEqual({
      app_version: '0.1.0',
      outbox: {
        pending_events: 0,
        inflight_events: 0,
        acknowledged_events: 12,
        open_batches: 0,
        sessions: 3,
        sessions_awaiting_consent: 0,
      },
      errors: { session_errors: 2, upload_failures: 0 },
    });
  });

  it('syncs on request', async () => {
    const h = harness();
    h.state.queue = [await envelope('sync')];
    await h.client.pollOnce();
    expect(h.effects.sync).toHaveBeenCalledTimes(1);
    expect(h.acks[0]?.body.status).toBe('acknowledged');
  });
});
