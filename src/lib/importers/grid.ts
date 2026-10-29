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

function effects(ev: GridEvent): string {
  const props: string[] = [];
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
      const [first, ...remaining] = splitDuration(soundEnd - ev.step);
      beats.push(`${ev.body ?? 'r'}.${first}${effects(ev)}`);
      remaining.forEach((d) => beats.push(`r.${d}`));
      pos = ev.step + splitDuration(soundEnd - ev.step).reduce((n, d) => n + 16 / d, 0);
    }
    if (pos < barEnd) rest(barEnd - pos);
    bars.push(beats.join(' '));
  }
  return bars;
}
