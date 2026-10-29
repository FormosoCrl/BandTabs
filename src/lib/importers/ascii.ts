import { quote, tuningToTex } from './alphatex';

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

function parseBlock(block: Block): { bars: Event[][]; width: number } {
  const width = Math.max(...block.lines.map((l) => l.length));
  const lines = block.lines.map((l) => l.padEnd(width, '-'));
  const bars: Event[][] = [[]];
  for (let col = 0; col < width; col++) {
    if (lines.every((l) => l[col] === '|')) {
      if (bars[bars.length - 1].length) bars.push([]);
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
    if (notes.length) bars[bars.length - 1].push({ column: col, notes });
  }
  return { bars: bars.filter((b) => b.length), width };
}

function durationFor(gap: number, unit: number): number {
  const ratio = gap / unit;
  if (ratio < 1.5) return 8;
  if (ratio < 3) return 4;
  if (ratio < 6) return 2;
  return 1;
}

export class NoTabFoundError extends Error {
  constructor() {
    super('No se encontraron tablaturas en el texto');
    this.name = 'NoTabFoundError';
  }
}

/**
 * Convierte una tablatura en texto (el formato típico de las webs de tabs) a alphaTex.
 * El ritmo no está escrito en estas tabs, así que se estima por la separación entre notas.
 */
export function asciiTabToAlphaTex(text: string, title: string): string {
  const blocks = findBlocks(text);
  if (blocks.length === 0) throw new NoTabFoundError();
  const stringCount = blocks[0].lines.length;
  const tuning = tuningFromLabels(blocks[0].labels);
  const sameShape = blocks.filter((b) => b.lines.length === stringCount);

  const bars: string[] = [];
  for (const block of sameShape) {
    const parsed = parseBlock(block);
    const allGaps: number[] = [];
    for (const bar of parsed.bars) {
      for (let i = 1; i < bar.length; i++) allGaps.push(bar[i].column - bar[i - 1].column);
    }
    const unit = allGaps.length ? Math.max(1, Math.min(...allGaps)) : 2;
    for (const bar of parsed.bars) {
      const beats = bar.map((ev, i) => {
        const gap = (bar[i + 1]?.column ?? ev.column + unit) - ev.column;
        const notes = ev.notes.map((n) => `${n.fret}.${n.string}`);
        const body = notes.length === 1 ? notes[0] : `(${notes.join(' ')})`;
        return `${body}.${durationFor(gap, unit)}`;
      });
      bars.push(beats.join(' '));
    }
  }

  const instrument = stringCount <= 5 ? 33 : 25;
  return [
    `\\title ${quote(title)}`,
    '.',
    `\\track ${quote(stringCount <= 5 ? 'Bajo' : 'Guitarra')} \\instrument ${instrument}`,
    `\\staff {tabs} \\tuning ${tuningToTex(tuning)}`,
    bars.join(' |\n') + ' |',
  ].join('\n');
}
