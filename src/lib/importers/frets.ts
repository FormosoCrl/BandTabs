/** Una posición en el mástil: cuerda 1 es la más aguda, como en alphaTex. */
export interface FretPosition {
  string: number;
  fret: number;
}

export const STANDARD_GUITAR = [64, 59, 55, 50, 45, 40];
export const STANDARD_BASS = [43, 38, 33, 28];
const MAX_FRET = 24;

function candidates(pitch: number, tuning: number[]): FretPosition[] {
  const out: FretPosition[] = [];
  tuning.forEach((open, i) => {
    const fret = pitch - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: i + 1, fret });
  });
  return out;
}

/**
 * Elige cuerda y traste para cada acorde (o nota suelta) intentando que la mano se mueva poco:
 * minimiza la apertura del acorde y la distancia a la posición anterior. Las notas que no caben
 * en el instrumento se descartan.
 */
export function assignFrets(chords: number[][], tuning: number[]): FretPosition[][] {
  let hand = 0;
  return chords.map((pitches) => {
    const notes = [...new Set(pitches)].sort((a, b) => b - a).slice(0, tuning.length);
    const options = notes.map((p) => candidates(p, tuning)).filter((c) => c.length > 0);
    let best: FretPosition[] = [];
    let bestCost = Infinity;
    const search = (i: number, used: Set<number>, chosen: FretPosition[]) => {
      if (i === options.length) {
        const fretted = chosen.filter((c) => c.fret > 0).map((c) => c.fret);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        const center = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : hand;
        // Cuerdas saltadas dentro de un acorde: se pueden tocar, pero es raro en una tab real.
        const strings = chosen.map((c) => c.string);
        const skipped = strings.length
          ? Math.max(...strings) - Math.min(...strings) + 1 - strings.length
          : 0;
        const cost =
          (span > 4 ? 100 : span * 2) +
          Math.abs(center - hand) +
          skipped * 1.5 +
          chosen.reduce((n, c) => n + c.fret * 0.1, 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = [...chosen];
        }
        return;
      }
      for (const pos of options[i]) {
        if (used.has(pos.string)) continue;
        used.add(pos.string);
        chosen.push(pos);
        search(i + 1, used, chosen);
        chosen.pop();
        used.delete(pos.string);
      }
    };
    search(0, new Set(), []);
    const fretted = best.filter((c) => c.fret > 0);
    if (fretted.length) hand = fretted.reduce((n, c) => n + c.fret, 0) / fretted.length;
    return best;
  });
}
