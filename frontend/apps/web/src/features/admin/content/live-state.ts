/**
 * Live ITC state from the server (`GET /api/v1/admin/content/lines`) laid over the repository snapshot.
 *
 * The snapshot (content/i18n read at build time) holds the scripts, the workflow and the sign-offs made
 * in the translation workbook. The server adds the sign-offs recorded in the console and decides the
 * current status of each line and language; this module merges the two so every screen shows the live
 * status and one trail.
 */
import type { ContentSnapshot, HistoryEvent, TranslationEntry } from './content-types';

export interface LiveTransition {
  readonly from_status: string;
  readonly to_status: string;
  readonly role: string;
  readonly signer: string;
  readonly comment: string;
  readonly created_at: string;
}

export interface LiveLanguageState {
  readonly status: string;
  readonly history: readonly LiveTransition[];
  readonly takes: number;
}

export interface LiveLine {
  readonly line_id: string;
  readonly languages: Readonly<Record<string, LiveLanguageState>>;
}

export interface LiveLines {
  readonly lines: readonly LiveLine[];
}

function toEvent(t: LiveTransition): HistoryEvent {
  return {
    fromStatus: t.from_status,
    toStatus: t.to_status,
    by: t.signer,
    role: t.role,
    date: t.created_at.slice(0, 10),
    comment: t.comment,
    source: 'console',
  };
}

/** The snapshot with each translation's status and trail taken from the server, when it answered. */
export function withLiveState(
  snapshot: ContentSnapshot,
  live: LiveLines | undefined,
): ContentSnapshot {
  if (!live) return snapshot;
  const byLine = new Map(live.lines.map((l) => [l.line_id, l.languages]));
  const translations: Record<string, ContentSnapshot['translations'][string]> = {};
  for (const [lang, file] of Object.entries(snapshot.translations)) {
    const entries: Record<string, TranslationEntry> = {};
    for (const [id, entry] of Object.entries(file.entries)) {
      const state = byLine.get(id)?.[lang];
      entries[id] = state
        ? {
            ...entry,
            status: state.status,
            history: [...entry.history, ...state.history.map(toEvent)],
          }
        : entry;
    }
    translations[lang] = { ...file, entries };
  }
  return { ...snapshot, translations };
}

/** Takes uploaded for one line and language (0 when the server did not answer). */
export function takeCount(live: LiveLines | undefined, lineId: string, language: string): number {
  return live?.lines.find((l) => l.line_id === lineId)?.languages[language]?.takes ?? 0;
}
