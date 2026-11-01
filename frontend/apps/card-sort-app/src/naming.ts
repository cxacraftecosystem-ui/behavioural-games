/**
 * Generated file names on the card-sort tablet (skill `naming`), the same grammar as the web
 * console's `src/lib/naming.ts`: BehaviouralGames_Entity_Date_Time_Subject_What.ext, ASCII, IST.
 */

function field(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) =>
      /\d/.test(w) || w === w.toUpperCase()
        ? w
        : `${w[0]?.toUpperCase() ?? ''}${w.slice(1).toLowerCase()}`,
    )
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** `BehaviouralGames_Card-Sort_<date>_<HHMM>_<device>_Export.json`, IST. */
export function exportFileName(deviceId: string | null | undefined, at = new Date()): string {
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
  const device = field(deviceId ?? '');
  return [
    'BehaviouralGames',
    'Card-Sort',
    `${get('year')}-${get('month')}-${get('day')}`,
    `${get('hour')}${get('minute')}`,
    device,
    'Export',
  ]
    .filter(Boolean)
    .join('_')
    .concat('.json');
}
