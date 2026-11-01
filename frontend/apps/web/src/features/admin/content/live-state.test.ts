import { describe, expect, it } from 'vitest';
import type { ContentSnapshot } from './content-types';
import { takeCount, withLiveState } from './live-state';

const snapshot = {
  translations: {
    'hi-IN': {
      language: 'hi-IN',
      script: 'Deva',
      provenance: '',
      sourceCatalogueVersion: '0.1.0',
      entries: {
        'attract.touch_to_start': {
          id: 'attract.touch_to_start',
          status: 'forward_translated',
          text: 'x',
          backTranslation: '',
          registerNote: '',
          translatorNote: '',
          record: true,
          stale: false,
          history: [
            {
              fromStatus: 'draft_machine_needs_native_review',
              toStatus: 'forward_translated',
              by: 'A',
              role: 'translator',
              date: '2026-10-01',
              comment: '',
              source: 'workbook',
            },
          ],
        },
      },
    },
  },
} as unknown as ContentSnapshot;

describe('withLiveState', () => {
  it('returns the snapshot untouched without a server answer', () => {
    expect(withLiveState(snapshot, undefined)).toBe(snapshot);
  });

  it('takes the status from the server and appends console sign-offs to the trail', () => {
    const merged = withLiveState(snapshot, {
      lines: [
        {
          line_id: 'attract.touch_to_start',
          languages: {
            'hi-IN': {
              status: 'back_translated',
              takes: 2,
              history: [
                {
                  from_status: 'forward_translated',
                  to_status: 'back_translated',
                  role: 'back_translator',
                  signer: 'B',
                  comment: 'ok',
                  created_at: '2026-11-01T10:00:00Z',
                },
              ],
            },
          },
        },
      ],
    });
    const entry = merged.translations['hi-IN']?.entries['attract.touch_to_start'];
    expect(entry?.status).toBe('back_translated');
    expect(entry?.history.map((h) => [h.toStatus, h.source])).toEqual([
      ['forward_translated', 'workbook'],
      ['back_translated', 'console'],
    ]);
    expect(
      takeCount(
        {
          lines: [
            {
              line_id: 'attract.touch_to_start',
              languages: { 'hi-IN': { status: 'x', takes: 2, history: [] } },
            },
          ],
        },
        'attract.touch_to_start',
        'hi-IN',
      ),
    ).toBe(2);
  });
});
