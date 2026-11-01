/**
 * The one helper for every generated data file name in the web console (skill `naming`):
 *
 *   BehaviouralGames_Entity_Date[_Time]_Subject_What[_Sequence].ext
 *
 * `_` separates fields, `-` joins words inside a field, ASCII only, Title-Case words (codes, acronyms
 * and anything with a digit keep their case), dates and times in IST, at most 150 characters. A field
 * that is unknown is left out, never written as `Unknown`. Never format a data file name inline.
 */

export const PORTAL = 'BehaviouralGames';
const MAX_LENGTH = 150;
const SUBJECT_MAX = 40;

/** One field: ASCII words joined by `-`, Title-Cased unless the word is a code. '' when nothing is left. */
export function nameField(text: string | null | undefined): string {
  const ascii = (text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return ascii
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) =>
      /\d/.test(w) || w === w.toUpperCase()
        ? w
        : `${w[0]?.toUpperCase() ?? ''}${w.slice(1).toLowerCase()}`,
    )
    .join('-');
}

/** `YYYY-MM-DD` and `HHMM` in India Standard Time. */
export function istStamp(at: Date): { readonly date: string; readonly time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}${get('minute')}`,
  };
}

export interface DataFileNameInput {
  /** `Dataset`, `Study`, `Snapshot`, … (see the skill's entity list). */
  readonly entity: string;
  /** Generation time for exports and reports. Default: now. */
  readonly at?: Date;
  /** Add `HHMM` (IST) for a name that can repeat within a day, e.g. an export. */
  readonly time?: boolean;
  /** The record's name or code (study code, dataset name, device id). Truncated to 40. */
  readonly subject?: string | null | undefined;
  /** `Export`, `Validation-Report`, `Figure`, `Table`, `Snapshot`, … */
  readonly what: string;
  /** A figure number (zero-padded to two digits) or a table id. */
  readonly sequence?: string | number | null | undefined;
  readonly ext: string;
}

export function dataFileName(input: DataFileNameInput): string {
  const stamp = istStamp(input.at ?? new Date());
  const subject = nameField(input.subject).slice(0, SUBJECT_MAX).replace(/-+$/, '');
  const sequence =
    input.sequence === null || input.sequence === undefined || input.sequence === ''
      ? ''
      : typeof input.sequence === 'number'
        ? String(input.sequence).padStart(2, '0')
        : nameField(input.sequence);
  const fields = [
    PORTAL,
    nameField(input.entity),
    stamp.date,
    input.time ? stamp.time : '',
    subject,
    nameField(input.what),
    sequence,
  ].filter(Boolean);
  const ext = input.ext.replace(/^\.+/, '');
  return `${fields.join('_').slice(0, MAX_LENGTH - ext.length - 1)}.${ext}`;
}
