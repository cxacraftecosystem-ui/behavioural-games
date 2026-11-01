import { describe, expect, it } from 'vitest';
import { dataFileName, istStamp, nameField } from './naming';

describe('naming (skill naming)', () => {
  it('builds Portal_Entity_Date_Time_Subject_What with IST stamps', () => {
    expect(
      dataFileName({
        entity: 'Dataset',
        at: new Date('2026-10-21T09:05:00Z'),
        time: true,
        subject: 'Validation runs',
        what: 'Export',
        ext: 'parquet',
      }),
    ).toBe('BehaviouralGames_Dataset_2026-10-21_1435_Validation-Runs_Export.parquet');
  });

  it('keeps codes, pads figure numbers and drops unknown fields', () => {
    const at = new Date('2026-11-01T20:00:00Z'); // 01:30 IST on 2 November
    expect(
      dataFileName({
        entity: 'Study',
        at,
        subject: 'PILOT-1',
        what: 'Figure',
        sequence: 3,
        ext: 'svg',
      }),
    ).toBe('BehaviouralGames_Study_2026-11-02_PILOT-1_Figure_03.svg');
    expect(
      dataFileName({ entity: 'Dataset', at, subject: '  ### ', what: 'Export', ext: '.csv' }),
    ).toBe('BehaviouralGames_Dataset_2026-11-02_Export.csv');
  });

  it('is ASCII with Title-Case words and caps the subject at 40', () => {
    expect(nameField('Hand block   printing!')).toBe('Hand-Block-Printing');
    expect(nameField('Ādhār café')).toBe('Adhar-Cafe');
    expect(nameField('snap_8F3a2')).toBe('Snap-8F3a2');
    const long = dataFileName({
      entity: 'Study',
      at: new Date('2026-01-01T00:00:00Z'),
      subject: 'a very long study name that keeps going and going and going',
      what: 'Validation report',
      ext: 'html',
    });
    expect(long).toBe(
      'BehaviouralGames_Study_2026-01-01_A-Very-Long-Study-Name-That-Keeps-Going_Validation-Report.html',
    );
    expect(long).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('formats IST across the date line', () => {
    expect(istStamp(new Date('2026-03-31T18:29:00Z'))).toEqual({
      date: '2026-03-31',
      time: '2359',
    });
    expect(istStamp(new Date('2026-03-31T18:30:00Z'))).toEqual({
      date: '2026-04-01',
      time: '0000',
    });
  });
});
