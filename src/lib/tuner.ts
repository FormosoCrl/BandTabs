const NOTE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export interface DetectedNote {
  name: string;
  octave: number;
  midi: number;
  /** Desviación respecto a la nota más cercana, de -50 a +50. */
  cents: number;
  frequency: number;
}

export function noteFromFrequency(frequency: number, a4 = 440): DetectedNote {
  const exact = 69 + 12 * Math.log2(frequency / a4);
  const midi = Math.round(exact);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: Math.round((exact - midi) * 100),
    frequency,
  };
}

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export const TUNER_PRESETS: { name: string; strings: number[] }[] = [
  { name: 'Guitarra estándar', strings: [40, 45, 50, 55, 59, 64] },
  { name: 'Guitarra Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { name: 'Guitarra medio tono abajo', strings: [39, 44, 49, 54, 58, 63] },
  { name: 'Bajo estándar', strings: [28, 33, 38, 43] },
  { name: 'Bajo 5 cuerdas', strings: [23, 28, 33, 38, 43] },
  { name: 'Ukelele', strings: [67, 60, 64, 69] },
];
