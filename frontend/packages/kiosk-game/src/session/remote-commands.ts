/**
 * Remote commands (KSK-10): lock, unlock, restart, sync, pull scrubbed logs, wipe.
 *
 * Safety rules, each enforced here and pinned by `__tests__/remote-commands.test.ts`:
 * - Authenticated: the device token goes on every request; nothing runs without one.
 * - Authorised per kiosk: every envelope carries an Ed25519 signature (the backend's release-pack key)
 *   over the canonical JSON of `{command_id, kiosk_id, command, issued_at, expires_at, nonce}`. A bad
 *   signature, another kiosk's id or an expired command is refused and acked `failed`.
 * - Idempotent and replay-safe: executed command ids and nonces persist across restarts; a command
 *   seen again is re-acked with its recorded outcome, never run twice; a reused nonce is refused.
 * - Never during play: the client polls only while the kiosk is idle (`isIdle`: the uploader is not
 *   paused by a session and the session machine is in `attract`), the same signal that keeps the
 *   uploader quiet while a person is playing. A lock received now applies at the next boot too.
 * - Quiet: network failures back off (60 s .. 15 min); nothing is ever shown to a participant except
 *   the lock screen.
 * - `wipe` refuses while anything is unsent (`unsynced_data`): local data is cleared only once the
 *   server holds every consented event (retention and legal holds are applied server side).
 */
import { trimTrailingSlashes } from '../core/url.ts';
import { canonicalJson } from '../logging/hash.ts';
import type { OutboxStats } from '../logging/outbox/types.ts';

export type RemoteCommand = 'lock' | 'unlock' | 'restart' | 'sync' | 'pull_logs' | 'wipe';

export const REMOTE_COMMANDS: readonly RemoteCommand[] = [
  'lock',
  'unlock',
  'restart',
  'sync',
  'pull_logs',
  'wipe',
];

/** `KioskCommandEnvelope` from `GET /api/v1/admin/kiosk-device/commands`. */
export interface CommandEnvelope {
  readonly command_id: string;
  readonly kiosk_id: string;
  readonly command: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly nonce: string;
  readonly signature: string;
  readonly key_id: string;
}

export type AckStatus = 'acknowledged' | 'failed';

export interface CommandAck {
  readonly command_id: string;
  readonly status: AckStatus;
  readonly result: Record<string, unknown>;
  readonly error: string | null;
}

/** Persistent client state (survives a reload, so a restart never re-runs a command). */
export interface CommandState {
  locked: boolean;
  /** command_id -> nonce and the outcome that was (or will be) acked. */
  executed: Record<
    string,
    { readonly nonce: string; readonly at: number; readonly ack: Omit<CommandAck, 'command_id'> }
  >;
  /** Acks not yet confirmed by the server (sent again on the next poll). */
  pendingAcks: CommandAck[];
}

export interface CommandStore {
  load(): CommandState;
  save(state: CommandState): void;
}

const STORAGE_KEY = 'shriii.remote_commands.v1';
/** Executed ids kept for replay protection (commands expire after 7 days server side). */
const EXECUTED_CAP = 500;

function emptyState(): CommandState {
  return { locked: false, executed: {}, pendingAcks: [] };
}

/** localStorage-backed store with an in-memory fallback (private mode, blocked storage). */
export class LocalCommandStore implements CommandStore {
  private memory: CommandState | null = null;

  load(): CommandState {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CommandState>;
        return {
          locked: parsed.locked === true,
          executed: parsed.executed ?? {},
          pendingAcks: Array.isArray(parsed.pendingAcks) ? parsed.pendingAcks : [],
        };
      }
    } catch {
      // Fall through to memory.
    }
    return this.memory ?? emptyState();
  }

  save(state: CommandState): void {
    this.memory = state;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Memory copy keeps this run consistent.
    }
  }
}

export class MemoryCommandStore implements CommandStore {
  private state: CommandState = emptyState();
  load(): CommandState {
    return structuredClone(this.state);
  }
  save(state: CommandState): void {
    this.state = structuredClone(state);
  }
}

/** What the commands do on this kiosk (the runtime supplies them; tests fake them). */
export interface CommandEffects {
  /** Upload now (the batch uploader's immediate attempt). */
  sync(): Promise<void>;
  /** Reload the kiosk app. */
  reload(): void;
  outboxStats(): Promise<OutboxStats>;
  /** Delete local outbox stores and caches (never the command store). */
  wipeLocal(): Promise<void>;
  readonly appVersion: string;
  /** Recent error counts by kind (no messages, no ids). */
  errorCounts(): Record<string, number>;
}

export interface RemoteCommandClientOptions {
  readonly apiBase: string | null | undefined;
  readonly deviceToken: string | null | undefined;
  readonly kioskId: string;
  readonly isIdle: () => boolean;
  readonly effects: CommandEffects;
  readonly store?: CommandStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly subtle?: SubtleCrypto;
  readonly nowMs?: () => number;
  readonly setTimer?: (cb: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Poll interval while idle (default 60 s). */
  readonly pollMs?: number;
  /** Ceiling for the failure backoff (default 15 min). */
  readonly maxBackoffMs?: number;
  readonly timeoutMs?: number;
  /**
   * Release-pack verification keys pinned into this build (key_id -> base64 raw Ed25519 public key),
   * from CI config. Only a command signed with a pinned key runs; with none pinned, every command is
   * refused (fail closed). The server's advertised key is still fetched, only to notice a rotation.
   */
  readonly pinnedKeys?: Readonly<Record<string, string>>;
}

/** What the lock needs from the audio side: the master volume and a way to stop speech. */
export interface LockableAudio {
  readonly masterVolume: number;
  setMasterVolume(volume: number): void;
}

/**
 * Silence the kiosk while a remote lock is in force: the attract loop keeps scheduling its greeting,
 * but nothing reaches the speakers until unlock, when the volume the kiosk had comes back. Returns the
 * unsubscribe function.
 */
export function muteWhileLocked(
  lock: { subscribeLock(listener: (locked: boolean) => void): () => void },
  audio: LockableAudio,
  voice: { stop(): void },
): () => void {
  let restore: number | null = null;
  return lock.subscribeLock((locked) => {
    if (locked && restore === null) {
      restore = audio.masterVolume;
      voice.stop();
      audio.setMasterVolume(0);
    } else if (!locked && restore !== null) {
      audio.setMasterVolume(restore);
      restore = null;
    }
  });
}

/** Parse the build-time `{"key_id": "base64 key"}` JSON; anything malformed pins nothing. */
export function parsePinnedKeys(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [id, key] of Object.entries(value as Record<string, unknown>)) {
      if (typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key)) out[id] = key;
    }
    return out;
  } catch {
    return {};
  }
}

export type PollOutcome =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'skipped'; readonly reason: 'busy' | 'not_idle' }
  | { readonly kind: 'failed'; readonly error: string }
  | { readonly kind: 'done'; readonly handled: readonly CommandAck[] };

/** The bytes the backend signs (keys sorted, no whitespace, UTF-8). */
export function signedPayload(e: CommandEnvelope): string {
  return canonicalJson({
    command_id: e.command_id,
    kiosk_id: e.kiosk_id,
    command: e.command,
    issued_at: e.issued_at,
    expires_at: e.expires_at,
    nonce: e.nonce,
  });
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function isRemoteCommand(value: string): value is RemoteCommand {
  return (REMOTE_COMMANDS as readonly string[]).includes(value);
}

export class RemoteCommandClient {
  private readonly o: RemoteCommandClientOptions;
  private readonly base: string | null;
  private readonly store: CommandStore;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly subtle: SubtleCrypto | undefined;
  private readonly nowMs: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly pollMs: number;
  private readonly maxBackoffMs: number;
  private state: CommandState;
  private readonly keys = new Map<string, CryptoKey>();
  /** A key the server advertises that this build does not pin (a rotation in progress). */
  private rotation: { readonly keyId: string; readonly seenAt: number } | null = null;
  private advertisedCheckedAt = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private busy = false;
  private running = false;
  private failures = 0;
  private readonly lockListeners = new Set<(locked: boolean) => void>();

  constructor(options: RemoteCommandClientOptions) {
    this.o = options;
    const base = options.apiBase?.trim();
    this.base = base && options.deviceToken ? trimTrailingSlashes(base) : null;
    this.store = options.store ?? new LocalCommandStore();
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.subtle = options.subtle ?? globalThis.crypto?.subtle;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.pollMs = options.pollMs ?? 60_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
    this.state = this.store.load();
  }

  /** True while a remote lock is in force (persisted: it survives a reboot). */
  get locked(): boolean {
    return this.state.locked;
  }

  get enabled(): boolean {
    return this.base !== null;
  }

  subscribeLock(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    listener(this.state.locked);
    return () => this.lockListeners.delete(listener);
  }

  /** Poll once now (so a lock applies at boot), then every `pollMs` while idle. */
  start(): void {
    if (this.running || !this.base) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.pollOnce().then((outcome) => {
        if (outcome.kind === 'failed') {
          this.failures += 1;
          this.schedule(Math.min(this.maxBackoffMs, this.pollMs * 2 ** this.failures));
        } else {
          if (outcome.kind === 'done') this.failures = 0;
          this.schedule(this.pollMs);
        }
      });
    }, ms);
  }

  private headers(json = false): Record<string, string> {
    return {
      authorization: `Bearer ${this.o.deviceToken ?? ''}`,
      accept: 'application/json',
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 20_000);
    try {
      return await this.fetchImpl(`${this.base}${path}`, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  private persist(): void {
    this.store.save(this.state);
  }

  private setLocked(locked: boolean): void {
    if (this.state.locked === locked) return;
    this.state.locked = locked;
    this.persist();
    for (const l of this.lockListeners) l(locked);
  }

  /** Send queued acks; keeps any the server did not confirm. */
  private async flushAcks(): Promise<void> {
    const remaining: CommandAck[] = [];
    for (const ack of this.state.pendingAcks) {
      try {
        const res = await this.request(
          `/api/v1/admin/kiosk-device/commands/${encodeURIComponent(ack.command_id)}/ack`,
          {
            method: 'POST',
            headers: this.headers(true),
            body: JSON.stringify({ status: ack.status, result: ack.result, error: ack.error }),
          },
        );
        // 404 = the command is gone (another kiosk's or deleted): nothing left to confirm.
        if (!res.ok && res.status !== 404) remaining.push(ack);
      } catch {
        remaining.push(ack);
      }
    }
    this.state.pendingAcks = remaining;
    this.persist();
  }

  /** The pinned key for `keyId`, imported once; null when this build does not pin that key. */
  private async pinnedKey(keyId: string): Promise<CryptoKey | null> {
    const raw = this.o.pinnedKeys?.[keyId];
    if (!raw || !this.subtle) return null;
    const cached = this.keys.get(keyId);
    if (cached) return cached;
    const key = await this.subtle.importKey('raw', base64ToBytes(raw), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    this.keys.set(keyId, key);
    return key;
  }

  /**
   * Fetch the key the server advertises (at most hourly) only to notice a rotation: a key that is not
   * pinned here, or a pinned id with different bytes, is reported in `pull_logs` and never trusted.
   */
  private async checkAdvertisedKey(): Promise<void> {
    if (this.nowMs() - this.advertisedCheckedAt < 3_600_000) return;
    this.advertisedCheckedAt = this.nowMs();
    try {
      const res = await this.request('/api/v1/admin/gates/release-pack/public-key', {
        headers: this.headers(),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { key_id?: string; public_key?: string };
      if (!body.key_id || !body.public_key) return;
      const pinned = this.o.pinnedKeys?.[body.key_id];
      this.rotation =
        pinned === body.public_key ? null : { keyId: body.key_id, seenAt: this.nowMs() };
    } catch {
      // Detection only: a failed fetch changes nothing.
    }
  }

  /** A rotation the kiosk has noticed but cannot follow until a build pins the new key. */
  get pendingRotation(): string | null {
    return this.rotation?.keyId ?? null;
  }

  private async signatureValid(e: CommandEnvelope, key: CryptoKey): Promise<boolean> {
    if (!this.subtle) return false;
    try {
      return await this.subtle.verify(
        { name: 'Ed25519' },
        key,
        base64ToBytes(e.signature),
        new TextEncoder().encode(signedPayload(e)),
      );
    } catch {
      return false;
    }
  }

  private record(e: CommandEnvelope, ack: Omit<CommandAck, 'command_id'>): CommandAck {
    this.state.executed[e.command_id] = { nonce: e.nonce, at: this.nowMs(), ack };
    const ids = Object.keys(this.state.executed);
    if (ids.length > EXECUTED_CAP) {
      const oldest = ids
        .sort((a, b) => (this.state.executed[a]?.at ?? 0) - (this.state.executed[b]?.at ?? 0))
        .slice(0, ids.length - EXECUTED_CAP);
      for (const id of oldest) delete this.state.executed[id];
    }
    const full = { command_id: e.command_id, ...ack };
    this.state.pendingAcks = [
      ...this.state.pendingAcks.filter((a) => a.command_id !== e.command_id),
      full,
    ];
    this.persist();
    return full;
  }

  private fail(e: CommandEnvelope, error: string): CommandAck {
    return this.record(e, { status: 'failed', result: {}, error });
  }

  private async execute(e: CommandEnvelope & { command: RemoteCommand }): Promise<CommandAck> {
    const fx = this.o.effects;
    const ok = (result: Record<string, unknown> = {}): CommandAck =>
      this.record(e, { status: 'acknowledged', result, error: null });
    switch (e.command) {
      case 'lock':
        this.setLocked(true);
        return ok({ locked: true });
      case 'unlock':
        this.setLocked(false);
        return ok({ locked: false });
      case 'sync':
        await fx.sync();
        return ok({ outbox: scrubStats(await fx.outboxStats()) });
      case 'pull_logs':
        return ok({
          app_version: fx.appVersion,
          outbox: scrubStats(await fx.outboxStats()),
          errors: fx.errorCounts(),
          pinned_keys: Object.keys(this.o.pinnedKeys ?? {}),
          ...(this.rotation ? { key_rotation_pending: this.rotation.keyId } : {}),
        });
      case 'restart': {
        // Recorded (and queued for ack) BEFORE the reload: the ack goes out after the restart and
        // the command can never run a second time.
        const ack = ok({ restarted_at: new Date(this.nowMs()).toISOString() });
        await this.flushAcks();
        fx.reload();
        return ack;
      }
      case 'wipe': {
        const stats = await fx.outboxStats();
        if (stats.pendingEvents + stats.inflightEvents + stats.openBatches > 0) {
          return this.fail(e, 'unsynced_data');
        }
        const ack = ok({ wiped_at: new Date(this.nowMs()).toISOString() });
        await fx.wipeLocal();
        await this.flushAcks();
        fx.reload();
        return ack;
      }
    }
  }

  /** One poll: send pending acks, then fetch, verify and run commands (only while idle). */
  async pollOnce(): Promise<PollOutcome> {
    if (!this.base) return { kind: 'disabled' };
    if (this.busy) return { kind: 'skipped', reason: 'busy' };
    this.busy = true;
    try {
      await this.flushAcks();
      if (!this.o.isIdle()) return { kind: 'skipped', reason: 'not_idle' };
      let envelopes: CommandEnvelope[];
      try {
        const res = await this.request('/api/v1/admin/kiosk-device/commands', {
          headers: this.headers(),
        });
        if (!res.ok) return { kind: 'failed', error: `HTTP ${res.status}` };
        envelopes = (await res.json()) as CommandEnvelope[];
      } catch (err) {
        return { kind: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
      const handled: CommandAck[] = [];
      for (const e of envelopes) {
        // A participant may have touched the screen since the fetch: stop and pick up later.
        if (!this.o.isIdle()) break;
        handled.push(await this.handle(e));
      }
      await this.flushAcks();
      return { kind: 'done', handled };
    } finally {
      this.busy = false;
    }
  }

  private async handle(e: CommandEnvelope): Promise<CommandAck> {
    const seen = this.state.executed[e.command_id];
    if (seen) {
      // Already run: confirm the recorded outcome again (the previous ack may have been lost).
      const again = { command_id: e.command_id, ...seen.ack };
      this.state.pendingAcks = [
        ...this.state.pendingAcks.filter((a) => a.command_id !== e.command_id),
        again,
      ];
      this.persist();
      return again;
    }
    if (Object.values(this.state.executed).some((x) => x.nonce === e.nonce)) {
      return this.fail(e, 'replay');
    }
    await this.checkAdvertisedKey();
    let key: CryptoKey | null = null;
    try {
      key = await this.pinnedKey(e.key_id);
    } catch {
      key = null;
    }
    // Only keys pinned into this build are trusted; a key fetched from the network never is.
    if (!key) return this.fail(e, 'unpinned_key');
    if (!(await this.signatureValid(e, key))) return this.fail(e, 'bad_signature');
    if (e.kiosk_id !== this.o.kioskId) return this.fail(e, 'wrong_kiosk');
    const expires = Date.parse(e.expires_at);
    if (!Number.isFinite(expires) || expires <= this.nowMs()) return this.fail(e, 'expired');
    const { command } = e;
    if (!isRemoteCommand(command)) return this.fail(e, 'unknown_command');
    try {
      return await this.execute({ ...e, command });
    } catch (err) {
      return this.fail(e, err instanceof Error ? err.name || 'error' : 'error');
    }
  }
}

/** Outbox counters only: never ids, never payloads. */
export function scrubStats(s: OutboxStats): Record<string, number> {
  return {
    pending_events: s.pendingEvents,
    inflight_events: s.inflightEvents,
    acknowledged_events: s.acknowledgedEvents,
    open_batches: s.openBatches,
    sessions: s.sessions,
    sessions_awaiting_consent: s.sessionsAwaitingConsent,
  };
}
