import { model } from '@coderline/alphatab';

export type InstrumentKind =
  | 'guitarra'
  | 'bajo'
  | 'bateria'
  | 'teclado'
  | 'voz'
  | 'cuerdas'
  | 'viento'
  | 'otro';

export const INSTRUMENT_LABELS: Record<InstrumentKind, string> = {
  guitarra: 'Guitarra',
  bajo: 'Bajo',
  bateria: 'Batería',
  teclado: 'Teclado',
  voz: 'Voz',
  cuerdas: 'Cuerdas',
  viento: 'Viento',
  otro: 'Otro',
};

/** Clasifica una pista por su programa MIDI y, si es de cuerda, por su número de cuerdas. */
export function classifyTrack(track: model.Track): InstrumentKind {
  if (track.isPercussion) return 'bateria';
  const program = track.playbackInfo.program;
  const staff = track.staves[0];
  if (program >= 32 && program <= 39) return 'bajo';
  if (program >= 24 && program <= 31) return 'guitarra';
  if (staff?.isStringed && program === 0) {
    // Muchos archivos dejan el programa en 0 (piano); el número de cuerdas lo desempata.
    return staff.tuning.length <= 5 && Math.min(...staff.tuning) < 40 ? 'bajo' : 'guitarra';
  }
  if (program <= 23) return 'teclado';
  if (program >= 52 && program <= 54) return 'voz';
  if (program >= 40 && program <= 51) return 'cuerdas';
  if (program >= 56 && program <= 79) return 'viento';
  return 'otro';
}

/** Nombre legible de la afinación, p. ej. "Estándar" o "D A D G B E". */
export function describeTuning(staff: model.Staff): string | null {
  if (!staff.isStringed || staff.tuning.length === 0) return null;
  if (staff.stringTuning.isStandard) return 'Estándar';
  const notes = [...staff.tuning]
    .reverse()
    .map((midi) => model.Tuning.getTextForTuning(midi, false));
  return notes.join(' ');
}
