/** Duraciones de alphaTex en semicorcheas: redonda = 16, negra = 4… */
const DURATIONS: [number, number][] = [
  [16, 1],
  [8, 2],
  [4, 4],
  [2, 8],
  [1, 16],
];

/** Divide un hueco (en semicorcheas) en duraciones de alphaTex, de mayor a menor. */
export function splitDuration(sixteenths: number): number[] {
  const out: number[] = [];
  let left = Math.max(1, Math.round(sixteenths));
  for (const [size, value] of DURATIONS) {
    while (left >= size) {
      out.push(value);
      left -= size;
    }
  }
  return out;
}

export function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '')}"`;
}

const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

export function pitchName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function tuningToTex(tuning: number[]): string {
  return tuning.map(pitchName).join(' ');
}
