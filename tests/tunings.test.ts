import { describe, expect, it } from 'vitest';
import { importer, type model } from '@coderline/alphatab';
import { parseTuning, retuneStaff, suggestTuning, tuningLabel, tuningNotes } from '../src/lib/tunings';
import { DROP_D_TEX } from './helpers';

const sounding = (staff: model.Staff) =>
  staff.bars.flatMap((bar) =>
    bar.voices.flatMap((v) =>
      v.beats.flatMap((b) => b.notes.map((n) => staff.tuning[staff.tuning.length - n.string] + n.fret)),
    ),
  );

describe('afinaciones', () => {
  it('nombra afinaciones conocidas y desconocidas', () => {
    expect(tuningLabel([64, 59, 55, 50, 45, 38])).toBe('Drop D');
    expect(tuningNotes([64, 59, 55, 50, 45, 38])).toBe('D A D G B E');
    expect(tuningLabel([64, 59, 55, 50, 43, 38])).toBe('D G D G B E');
  });

  it('lee una afinación escrita de grave a agudo', () => {
    const standard = [64, 59, 55, 50, 45, 40];
    expect(parseTuning('D A D G B E', standard)).toEqual([64, 59, 55, 50, 45, 38]);
    expect(parseTuning('Eb Ab Db Gb Bb Eb', standard)).toEqual([63, 58, 54, 49, 44, 39]);
    expect(parseTuning('C G C F A D', standard)).toEqual([62, 57, 53, 48, 43, 36]);
    expect(parseTuning('hola', standard)).toBeNull();
  });

  it('sugiere según la nota más grave', () => {
    expect(suggestTuning([40, 45, 52], 'guitar')).toEqual([64, 59, 55, 50, 45, 40]);
    expect(suggestTuning([38, 45, 50, 38], 'guitar')).toEqual([64, 59, 55, 50, 45, 38]);
    expect(suggestTuning([39, 44], 'guitar')).toEqual([63, 58, 54, 49, 44, 39]);
    expect(suggestTuning([26, 33], 'bass')).toEqual([43, 38, 33, 26]);
  });

  it('cambia de Drop D a estándar sin cambiar lo que suena', () => {
    const tex = DROP_D_TEX.replace(':4 0.6 0.6 0.6 0.6', ':4 0.6 (0.6 0.5 0.4) 5.5 3.6');
    const staff = importer.ScoreLoader.loadAlphaTex(tex).tracks[0].staves[0];
    const before = sounding(staff);
    const raised = retuneStaff(staff, [64, 59, 55, 50, 45, 40]);
    expect(staff.tuning).toEqual([64, 59, 55, 50, 45, 40]);
    // El Re grave no existe en estándar: sube una octava. Lo demás suena igual.
    expect(raised).toBe(2);
    const after = sounding(staff);
    expect(after.map((p, i) => (before[i] === 38 ? p - 12 : p))).toEqual(before);
    // Y vuelta a Drop D: todo cabe.
    expect(retuneStaff(staff, [64, 59, 55, 50, 45, 38])).toBe(0);
  });
});
