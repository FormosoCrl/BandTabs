import { quote, splitDuration } from './alphatex';

/**
 * Un golpe en la rejilla de semicorcheas. `body` es el texto alphaTex de las notas (p. ej.
 * "(0.6 2.5)"); null deja un silencio, útil para colgar un acorde o una sílaba donde no suena nada.
 */
export interface GridEvent {
  step: number;
  end: number;
  body: string | null;
  chord?: string;
  lyric?: string;
}

// Duraciones de una sola figura, en semicorcheas, con su valor alphaTex y si lleva puntillo.
const FIGURES: [steps: number, value: number, dotted: boolean][] = [
  [16, 1, false],
  [12, 2, true],
  [8, 2, false],
  [6, 4, true],
  [4, 4, false],
  [3, 8, true],
  [2, 8, false],
  [1, 16, false],
];

function effects(ev: GridEvent, dotted = false): string {
  const props: string[] = dotted ? ['d'] : [];
  if (ev.chord) props.push(`ch ${quote(ev.chord)}`);
  if (ev.lyric) props.push(`lyrics ${quote(ev.lyric)}`);
  return props.length ? `{${props.join(' ')}}` : '';
}

/**
 * Reparte los eventos en compases de `barSteps` semicorcheas. Cada nota dura hasta que termina o
 * hasta el siguiente evento; lo que no cabe en el compás se corta (no se ligan notas).
 */
export function buildBars(events: GridEvent[], barCount: number, barSteps: number): string[] {
  const ordered = [...events].sort((a, b) => a.step - b.step);
  const bars: string[] = [];
  let cursor = 0;
  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * barSteps;
    const barEnd = barStart + barSteps;
    const beats: string[] = [];
    const rest = (steps: number) => splitDuration(steps).forEach((d) => beats.push(`r.${d}`));
    let pos = barStart;
    while (cursor < ordered.length && ordered[cursor].step < barEnd) {
      const ev = ordered[cursor];
      cursor++;
      if (ev.step < pos) continue; // dos eventos en la misma semicorchea: gana el primero
      if (ev.step > pos) rest(ev.step - pos);
      const next = Math.min(ordered[cursor]?.step ?? barEnd, barEnd);
      const soundEnd = ev.body ? Math.min(Math.max(ev.end, ev.step + 1), next) : next;
      // La nota ocupa la figura más larga que cabe (con puntillo si hace falta) y lo que sobra
      // hasta el siguiente evento queda en silencio, así se leen negras con puntillo y no
      // corcheas seguidas de silencios.
      const [steps, value, dotted] = FIGURES.find(([n]) => n <= soundEnd - ev.step)!;
      beats.push(`${ev.body ?? 'r'}.${value}${effects(ev, dotted)}`);
      pos = ev.step + steps;
      if (!ev.body && next > pos) {
        rest(next - pos);
        pos = next;
      }
    }
    if (pos < barEnd) rest(barEnd - pos);
    bars.push(beats.join(' '));
  }
  return bars;
}
