import type { model } from '@coderline/alphatab';
import { assignFrets } from './importers/frets';

/** Afinación en MIDI, de la cuerda más aguda a la más grave (el orden de alphaTab y alphaTex). */
export type TuningValues = number[];

export interface TuningPreset {
  name: string;
  values: TuningValues;
}

export const GUITAR_TUNINGS: TuningPreset[] = [
  { name: 'Estándar', values: [64, 59, 55, 50, 45, 40] },
  { name: 'Drop D', values: [64, 59, 55, 50, 45, 38] },
  { name: 'Medio tono abajo (Eb)', values: [63, 58, 54, 49, 44, 39] },
  { name: 'Drop C#', values: [63, 58, 54, 49, 44, 37] },
  { name: 'Un tono abajo (D)', values: [62, 57, 53, 48, 43, 38] },
  { name: 'Drop C', values: [62, 57, 53, 48, 43, 36] },
  { name: 'Drop B', values: [61, 56, 52, 47, 42, 35] },
  { name: 'DADGAD', values: [62, 57, 55, 50, 45, 38] },
  { name: 'Open G', values: [62, 59, 55, 50, 43, 38] },
  { name: 'Open D', values: [62, 57, 54, 50, 45, 38] },
  { name: 'Open E', values: [64, 59, 56, 52, 47, 40] },
  { name: 'Siete cuerdas (B)', values: [64, 59, 55, 50, 45, 40, 35] },
];

export const BASS_TUNINGS: TuningPreset[] = [
  { name: 'Estándar', values: [43, 38, 33, 28] },
  { name: 'Drop D', values: [43, 38, 33, 26] },
  { name: 'Medio tono abajo (Eb)', values: [42, 37, 32, 27] },
  { name: 'Un tono abajo (D)', values: [41, 36, 31, 26] },
  { name: 'Drop C', values: [41, 36, 31, 24] },
  { name: 'Cinco cuerdas (B)', values: [43, 38, 33, 28, 23] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

function same(a: TuningValues, b: TuningValues) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Notas de grave a agudo, como se suele escribir una afinación: "D A D G B E". */
export function tuningNotes(values: TuningValues): string {
  return [...values]
    .reverse()
    .map((v) => NOTE_NAMES[((v % 12) + 12) % 12])
    .join(' ');
}

export function tuningLabel(values: TuningValues): string {
  const preset = [...GUITAR_TUNINGS, ...BASS_TUNINGS].find((p) => same(p.values, values));
  return preset ? preset.name : tuningNotes(values);
}

export function findPreset(presets: TuningPreset[], values: TuningValues): TuningPreset | undefined {
  return presets.find((p) => same(p.values, values));
}

/**
 * Lee una afinación escrita de grave a agudo ("D A D G B E", "Eb Ab Db Gb Bb Eb"). Las octavas se
 * deducen tomando como referencia la afinación actual: cada cuerda queda lo más cerca posible de
 * la que tenía. Devuelve null si el texto no se entiende.
 */
export function parseTuning(text: string, reference: TuningValues): TuningValues | null {
  const names = text
    .trim()
    .split(/[\s,-]+/)
    .filter(Boolean)
    .map((n) => n[0].toUpperCase() + n.slice(1));
  if (names.length < 4 || names.length > 8) return null;
  const classes = names.map((n) => NOTE_NAMES.indexOf(FLATS[n] ?? n));
  if (classes.some((c) => c < 0)) return null;
  const refLowToHigh = [...reference].reverse();
  const fallback = refLowToHigh[0] ?? 40;
  const out: number[] = [];
  classes.forEach((pc, i) => {
    const target = refLowToHigh[i] ?? (out[i - 1] ?? fallback) + 5;
    let midi = target - ((((target - pc) % 12) + 12) % 12);
    if (target - midi > 6) midi += 12;
    out.push(midi);
  });
  return out.reverse();
}

/**
 * Propone una afinación según la nota más grave que suena: si baja de Mi, Drop D, Eb, etc.
 * Se ignoran las notas sueltas más graves (el 2 %), que suelen ser errores de la transcripción.
 */
export function suggestTuning(pitches: number[], kind: 'guitar' | 'bass'): TuningValues {
  const presets = kind === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS;
  const standard = presets[0].values;
  if (pitches.length === 0) return standard;
  const sorted = [...pitches].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.02)];
  const lowest = standard[standard.length - 1];
  if (low >= lowest) return standard;
  // De las afinaciones de cuatro o seis cuerdas, la que llega justo a esa nota con menos cambios.
  const candidates = presets.filter(
    (p) => p.values.length === standard.length && p.values[p.values.length - 1] <= low,
  );
  candidates.sort(
    (a, b) => b.values[b.values.length - 1] - a.values[a.values.length - 1] || b.values[0] - a.values[0],
  );
  return candidates[0]?.values ?? standard;
}

/**
 * Cambia la afinación de un pentagrama sin cambiar lo que suena: cada nota se recoloca en la
 * cuerda y el traste que le corresponden con la afinación nueva. Las notas que no caben (más
 * graves que la cuerda más grave) suben una octava. Devuelve cuántas se han subido.
 */
export function retuneStaff(staff: model.Staff, values: TuningValues): number {
  const old = staff.tuning;
  const pitchOf = (note: model.Note) => old[old.length - note.string] + note.fret;
  const lowest = Math.min(...values);
  let raised = 0;
  const moves: { note: model.Note; string: number; fret: number }[] = [];
  const placed = new Map<model.Note, { string: number; fret: number }>();

  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      const beats = voice.beats.filter((b) => b.notes.length > 0);
      const chords = beats.map((beat) =>
        beat.notes.map((n) => {
          let pitch = pitchOf(n);
          while (pitch < lowest) pitch += 12;
          return pitch;
        }),
      );
      const frets = assignFrets(chords, values);
      beats.forEach((beat, i) => {
        const free = [...frets[i]];
        for (const note of beat.notes) {
          let pitch = pitchOf(note);
          if (pitch < lowest) raised++;
          while (pitch < lowest) pitch += 12;
          // Una nota ligada va en la misma cuerda que la nota de la que viene.
          const origin = note.isTieDestination && note.tieOrigin ? placed.get(note.tieOrigin) : undefined;
          let pos: { string: number; fret: number } | undefined = origin;
          if (!pos) {
            const idx = free.findIndex((f) => values[f.string - 1] + f.fret === pitch);
            if (idx >= 0) {
              const f = free.splice(idx, 1)[0];
              pos = { string: values.length - f.string + 1, fret: f.fret };
            }
          }
          if (!pos) {
            // assignFrets descarta lo que no cabe en un acorde; se busca cualquier cuerda libre.
            const string = values.findIndex((v) => pitch - v >= 0 && pitch - v <= 24);
            pos = { string: string >= 0 ? values.length - string : 1, fret: Math.max(0, pitch - values[Math.max(0, string)]) };
          }
          placed.set(note, pos);
          moves.push({ note, ...pos });
        }
      });
    }
  }

  staff.stringTuning.tunings = [...values];
  staff.stringTuning.finish();
  for (const m of moves) {
    m.note.string = m.string;
    m.note.fret = m.fret;
  }
  return raised;
}
