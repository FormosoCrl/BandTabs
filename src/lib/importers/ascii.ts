import { quote, tuningToTex } from './alphatex';
import { buildBars, type GridEvent } from './grid';

const PITCH_CLASSES: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6,
  g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

// "e|--0--|", "E |-3-", "D:--", también líneas sin nombre que empiezan por "|-".
const TAB_LINE = /^\s*([A-Ga-g][#b]?)?\s*([|:])(.*)$/;

interface Block {
  labels: (string | null)[];
  lines: string[];
}

function isTabLine(line: string): boolean {
  const m = TAB_LINE.exec(line);
  if (!m) return false;
  const body = m[3];
  return (body.match(/-/g)?.length ?? 0) >= 3 && /^[-0-9|hpbrsx/\\~()<>.^v*= ]+$/i.test(body.trim());
}

function findBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of text.replace(/\t/g, '    ').split(/\r?\n/)) {
    if (isTabLine(raw)) {
      const m = TAB_LINE.exec(raw)!;
      current ??= { labels: [], lines: [] };
      current.labels.push(m[1]?.toLowerCase() ?? null);
      current.lines.push(m[3]);
    } else if (current) {
      if (current.lines.length >= 4) blocks.push(current);
      current = null;
    }
  }
  if (current && current.lines.length >= 4) blocks.push(current);
  return blocks;
}

const DEFAULT_TUNINGS: Record<number, number[]> = {
  4: [43, 38, 33, 28],
  5: [43, 38, 33, 28, 23],
  6: [64, 59, 55, 50, 45, 40],
  7: [64, 59, 55, 50, 45, 40, 35],
};

/** Convierte los nombres de cuerda (de aguda a grave) en notas MIDI con octavas razonables. */
export function tuningFromLabels(labels: (string | null)[]): number[] {
  const count = labels.length;
  const classes = labels.map((l) => (l ? PITCH_CLASSES[l] : undefined));
  if (classes.some((c) => c === undefined)) return DEFAULT_TUNINGS[count] ?? DEFAULT_TUNINGS[6];
  const lowToHigh = [...(classes as number[])].reverse();
  // Bajo: cuerda grave entre La0 y Sol#1. Guitarra: entre La1 y Sol#2.
  const [min, max] = count <= 5 ? [21, 33] : [33, 45];
  let previous = lowToHigh[0];
  while (previous < min) previous += 12;
  while (previous >= max) previous -= 12;
  const midi = [previous];
  for (const pc of lowToHigh.slice(1)) {
    let next = previous + 1;
    while (next % 12 !== pc) next++;
    midi.push(next);
    previous = next;
  }
  return midi.reverse();
}

interface Event {
  column: number;
  notes: { string: number; fret: string }[];
}

interface Bar {
  /** Primera columna del compás y la de la barra que lo cierra. */
  start: number;
  end: number;
  events: Event[];
}

function parseBlock(block: Block): Bar[] {
  const width = Math.max(...block.lines.map((l) => l.length));
  const lines = block.lines.map((l) => l.padEnd(width, '-'));
  const bars: Bar[] = [{ start: 0, end: width, events: [] }];
  for (let col = 0; col < width; col++) {
    if (lines.every((l) => l[col] === '|')) {
      bars[bars.length - 1].end = col;
      bars.push({ start: col + 1, end: width, events: [] });
      continue;
    }
    const notes: Event['notes'] = [];
    lines.forEach((line, s) => {
      const ch = line[col];
      const prev = line[col - 1];
      if (/[0-9]/.test(ch) && !/[0-9]/.test(prev ?? '')) {
        const fret = /[0-9]/.test(line[col + 1] ?? '') ? ch + line[col + 1] : ch;
        notes.push({ string: s + 1, fret });
      } else if (/x/i.test(ch)) {
        notes.push({ string: s + 1, fret: 'x' });
      }
    });
    if (notes.length) bars[bars.length - 1].events.push({ column: col, notes });
  }
  // Los compases vacíos anchos son silencios de verdad; los estrechos, barras dobles o de repetición.
  return bars.filter((b) => b.events.length || b.end - b.start >= 8).flatMap(splitLongBar);
}

const BAR_STEPS = 16;

/** Una línea sin barras de compás (o con más notas de las que caben) se reparte en varios compases. */
function splitLongBar(bar: Bar): Bar[] {
  const parts = Math.ceil(bar.events.length / BAR_STEPS);
  if (parts <= 1) return [bar];
  const width = (bar.end - bar.start) / parts;
  return Array.from({ length: parts }, (_, i) => {
    const start = Math.round(bar.start + i * width);
    const end = Math.round(bar.start + (i + 1) * width);
    return { start, end, events: bar.events.filter((e) => e.column >= start && e.column < end) };
  });
}

/**
 * Coloca las notas de un compás en la rejilla de semicorcheas según su posición horizontal: una
 * nota a mitad del compás cae en el tercer tiempo. Así cada compás dura exactamente un 4/4.
 */
function barEvents(bar: Bar, index: number): GridEvent[] {
  // Casi todas las tabs dejan uno o dos guiones de margen antes de la primera nota: si la primera
  // está cerca del principio, es el primer tiempo.
  const first = bar.events[0]?.column ?? bar.start;
  const margin = Math.max(2, (bar.end - bar.start) / 8);
  const origin = first - bar.start <= margin ? first : bar.start + 1;
  const span = Math.max(1, bar.end - origin);
  // Con pocas notas se cuadra a corcheas, que da figuras más limpias; con muchas, a semicorcheas.
  const unit = bar.events.length <= BAR_STEPS / 2 ? 2 : 1;
  const out: GridEvent[] = [];
  let previous = -unit;
  for (const ev of bar.events) {
    const raw = Math.round(((ev.column - origin) / span) * (BAR_STEPS / unit)) * unit;
    // Dos notas muy juntas no pueden caer en el mismo sitio: la segunda pasa al siguiente.
    const step = Math.max(raw, previous + unit);
    if (step >= BAR_STEPS) break;
    previous = step;
    const notes = ev.notes.map((n) => `${n.fret}.${n.string}`);
    out.push({
      step: index * BAR_STEPS + step,
      end: (index + 1) * BAR_STEPS,
      body: notes.length === 1 ? notes[0] : `(${notes.join(' ')})`,
    });
  }
  return out;
}

export class NoTabFoundError extends Error {
  constructor() {
    super('No se encontraron tablaturas en el texto');
    this.name = 'NoTabFoundError';
  }
}

/**
 * Convierte una tablatura en texto (el formato típico de las webs de tabs) a alphaTex.
 * El ritmo no está escrito en estas tabs, así que se estima por la posición de cada nota dentro de
 * su compás, suponiendo compases de 4/4.
 */
export function asciiTabToAlphaTex(text: string, title: string): string {
  const blocks = findBlocks(text);
  if (blocks.length === 0) throw new NoTabFoundError();
  const stringCount = blocks[0].lines.length;
  const tuning = tuningFromLabels(blocks[0].labels);
  const sameShape = blocks.filter((b) => b.lines.length === stringCount);

  const parsed = sameShape.flatMap(parseBlock);
  const events = parsed.flatMap(barEvents);
  const bars = buildBars(events, parsed.length, BAR_STEPS);

  const instrument = stringCount <= 5 ? 33 : 25;
  return [
    `\\title ${quote(title)}`,
    '.',
    `\\track ${quote(stringCount <= 5 ? 'Bajo' : 'Guitarra')} \\instrument ${instrument}`,
    `\\staff {tabs} \\tuning ${tuningToTex(tuning)}`,
    bars.join(' |\n') + ' |',
  ].join('\n');
}
