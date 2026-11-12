import { pitchName, quote, tuningToTex } from './alphatex';
import { assignFrets, STANDARD_BASS, STANDARD_GUITAR } from './frets';
import { buildBars, type GridEvent } from './grid';
import { suggestTuning, type TuningValues } from '../tunings';

/** Lo que devuelve el motor de transcripción (bandtabs_engine.py). */
export interface EngineResult {
  version: 1;
  title: string;
  artist: string;
  sourceUrl: string | null;
  duration: number;
  tempo: number;
  beats: number[];
  downbeat: number;
  beatsPerBar: number;
  tracks: {
    stem: string;
    kind: 'guitar' | 'bass' | 'piano' | 'vocals';
    name: string;
    program: number;
    notes: { start: number; end: number; pitch: number; velocity: number }[];
  }[];
  drums: { time: number; piece: 'kick' | 'snare' | 'hihat' }[];
  chords: { time: number; name: string }[];
  lyrics: { language: string | null; words: { start: number; end: number; text: string }[] };
}

const DRUM_MIDI: Record<EngineResult['drums'][number]['piece'], number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
};

/**
 * Convierte segundos en semicorcheas contando desde el primer tiempo fuerte detectado. Entre dos
 * tiempos interpola; antes y después extrapola con la duración media de un tiempo.
 *
 * Si la música empieza antes de ese primer tiempo fuerte (`startTime`), la cuenta empieza los
 * compases enteros que hagan falta antes, para que esas notas no se pierdan.
 */
export function makeTimeGrid(
  beats: number[],
  downbeat: number,
  tempo: number,
  startTime?: number,
  beatsPerBar = 4,
) {
  const fallback = 60 / (tempo || 120);
  const avg = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : fallback;
  const first = beats[0] ?? 0;
  /** Posición en tiempos (con decimales) respecto al primer tiempo detectado. */
  const position = (time: number): number => {
    const last = beats.length - 1;
    if (beats.length < 2 || time < first) return (time - first) / avg;
    if (time >= beats[last]) return last + (time - beats[last]) / avg;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - beats[lo]) / (beats[lo + 1] - beats[lo]);
  };
  const origin = Math.max(0, Math.min(downbeat, beats.length - 1));
  // Un cuarto de tiempo de margen: una nota un pelo antes del primer tiempo fuerte es ese tiempo.
  const early = startTime === undefined ? 0 : origin - (position(startTime) + 0.25);
  const extraBars = early > 0 ? Math.ceil(early / beatsPerBar) : 0;
  const exact = (time: number) => (position(time) - origin + extraBars * beatsPerBar) * 4;
  // El "+ 0" convierte -0 en 0.
  const grid = ((time: number) => Math.round(exact(time) - grid.bias) + 0) as TimeGrid;
  grid.exact = exact;
  grid.bias = 0;
  return grid;
}

/** Función que da la semicorchea de un instante; `exact` la da sin redondear. */
export interface TimeGrid {
  (time: number): number;
  exact(time: number): number;
  /** Desfase que se resta antes de redondear (ver `gridBias`). */
  bias: number;
}

/**
 * Desfase medio (en semicorcheas, entre -0,5 y 0,5) entre los ataques y la rejilla. Los tiempos y
 * las notas se detectan con métodos distintos y suelen ir unas milésimas adelantados o atrasados
 * entre sí; sin corregirlo, en canciones rápidas muchas notas caen en la semicorchea de al lado.
 */
export function gridBias(times: number[], grid: TimeGrid): number {
  if (times.length < 8) return 0;
  // Media circular: -0,49 y +0,49 están al lado, no en extremos opuestos.
  let x = 0;
  let y = 0;
  for (const time of times) {
    const angle = grid.exact(time) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return Math.atan2(y, x) / (2 * Math.PI);
}

interface Onset {
  step: number;
  end: number;
  pitches: number[];
}

function groupOnsets(notes: EngineResult['tracks'][number]['notes'], toStep: (t: number) => number) {
  const map = new Map<number, Onset>();
  for (const n of notes) {
    const step = toStep(n.start);
    if (step < 0) continue;
    const onset = map.get(step) ?? { step, end: step + 1, pitches: [] };
    onset.pitches.push(n.pitch);
    onset.end = Math.max(onset.end, toStep(n.end));
    map.set(step, onset);
  }
  const onsets = [...map.values()].sort((a, b) => a.step - b.step);
  // Los huecos cortos entre notas suelen ser imprecisión al detectar dónde acaba cada una: se
  // alarga la nota hasta la siguiente para no llenar la tab de silencios de semicorchea.
  onsets.forEach((o, i) => {
    const next = onsets[i + 1];
    if (next && next.step - o.end <= 2) o.end = next.step;
  });
  return onsets;
}

/** Pone un acorde o una sílaba en el evento que empieza en `step` o, si suena una nota, en esa nota. */
function attach(events: GridEvent[], step: number, field: 'chord' | 'lyric', value: string) {
  const exact = events.find((e) => e.step === step);
  if (exact) {
    if (field === 'lyric' && exact.lyric) exact.lyric += ` ${value}`;
    else if (!exact[field]) exact[field] = value;
    return;
  }
  const sounding = events.find((e) => e.body && e.step < step && e.end > step);
  if (sounding && !sounding[field]) {
    sounding[field] = value;
    return;
  }
  if (sounding && field === 'lyric') {
    sounding.lyric += ` ${value}`;
    return;
  }
  events.push({ step, end: step + 1, body: null, [field]: value });
}

/** Afinación elegida para guitarra y bajo; sin valor, se deduce de las notas. */
export interface TranscriptionOptions {
  guitar?: TuningValues | null;
  bass?: TuningValues | null;
}

export function transcriptionToAlphaTex(
  result: EngineResult,
  options: TranscriptionOptions = {},
): string {
  const beatsPerBar = result.beatsPerBar || 4;
  const starts = [
    ...result.tracks.flatMap((t) => t.notes.map((n) => n.start)),
    ...result.drums.map((d) => d.time),
  ];
  const startTime = starts.length ? Math.max(0, starts.reduce((a, b) => Math.min(a, b))) : undefined;
  const toStep = makeTimeGrid(result.beats, result.downbeat, result.tempo, startTime, beatsPerBar);
  toStep.bias = gridBias(starts, toStep);
  // Cada instrumento se detecta con un método distinto y lleva su propio retraso (el bajo llega
  // a ir un tercio de semicorchea por detrás de la guitarra): cada uno se cuadra con su desfase.
  // El desfase solo se conoce salvo semicorcheas enteras: se toma el más cercano al de la
  // batería, que es lo que se detecta con más precisión, para que dos pistas no acaben a una
  // semicorchea de distancia.
  const drumTimes = result.drums.map((d) => d.time);
  const reference = drumTimes.length >= 8 ? gridBias(drumTimes, toStep) : toStep.bias;
  const stepper = (times: number[]) => {
    if (times.length < 8) return toStep;
    const own = gridBias(times, toStep);
    const bias = own + Math.round(reference - own);
    return (time: number) => Math.round(toStep.exact(time) - bias) + 0;
  };
  const steppers = new Map<string, (time: number) => number>();
  for (const kind of new Set(result.tracks.map((t) => t.kind))) {
    // Las guitarras van juntas: suelen tocar a la vez y se detectan igual.
    const times = result.tracks.filter((t) => t.kind === kind).flatMap((t) => t.notes.map((n) => n.start));
    steppers.set(kind, stepper(times));
  }
  const drumStep = stepper(drumTimes);
  const barSteps = beatsPerBar * 4;
  const lastStep = Math.max(1, toStep(result.duration));
  const barCount = Math.max(1, Math.ceil(lastStep / barSteps));

  const out = [
    `\\title ${quote(result.title)}`,
    result.artist ? `\\artist ${quote(result.artist)}` : '',
    `\\tempo ${Math.round(result.tempo) || 120}`,
    '.',
  ].filter(Boolean);

  const built: { header: string[]; events: GridEvent[]; kind: string }[] = [];
  for (const track of result.tracks) {
    const onsets = groupOnsets(track.notes, steppers.get(track.kind) ?? toStep);
    if (onsets.length === 0) continue;
    const header = [`\\track ${quote(track.name)} \\instrument ${track.program}`];
    let bodies: string[];
    if (track.kind === 'guitar' || track.kind === 'bass') {
      const chosen = track.kind === 'bass' ? options.bass : options.guitar;
      // Todas las guitarras de una canción comparten afinación: se deduce de las notas de todas.
      const pitches = result.tracks
        .filter((t) => t.kind === track.kind)
        .flatMap((t) => t.notes.map((n) => n.pitch));
      const tuning =
        chosen ?? suggestTuning(pitches, track.kind) ??
        (track.kind === 'bass' ? STANDARD_BASS : STANDARD_GUITAR);
      header.push(`\\staff {tabs} \\tuning ${tuningToTex(tuning)}`);
      bodies = assignFrets(
        onsets.map((o) => o.pitches),
        tuning,
      ).map((frets) => {
        const parts = frets.map((p) => `${p.fret}.${p.string}`);
        return parts.length === 1 ? parts[0] : `(${parts.join(' ')})`;
      });
    } else {
      header.push('\\staff {score}');
      bodies = onsets.map((o) => {
        const parts = [...new Set(o.pitches)].sort((a, b) => a - b).map(pitchName);
        return parts.length === 1 ? parts[0] : `(${parts.join(' ')})`;
      });
    }
    const events: GridEvent[] = onsets.map((o, i) => ({
      step: o.step,
      end: o.end,
      body: bodies[i] === '()' ? null : bodies[i],
    }));
    built.push({ header, events, kind: track.kind });
  }

  if (result.drums.length) {
    const hits = new Map<number, Set<number>>();
    for (const hit of result.drums) {
      const step = drumStep(hit.time);
      if (step < 0) continue;
      if (!hits.has(step)) hits.set(step, new Set());
      hits.get(step)!.add(DRUM_MIDI[hit.piece]);
    }
    const keys = [...new Set([...hits.values()].flatMap((s) => [...s]))];
    built.push({
      header: [
        '\\track "Batería" \\instrument percussion',
        `\\staff {score} ${keys.map((k) => `\\articulation p${k} ${k}`).join(' ')}`,
      ],
      events: [...hits.entries()].map(([step, set]) => {
        const parts = [...set].map((k) => `p${k}`);
        // Un golpe de batería no dura nada, pero escrito como semicorchea llena el compás de
        // silencios: se alarga hasta el siguiente golpe o, como mucho, un tiempo.
        return { step, end: step + 4, body: parts.length === 1 ? parts[0] : `(${parts.join(' ')})` };
      }),
      kind: 'drums',
    });
  }

  if (built.length === 0) {
    built.push({ header: ['\\track "Acordes"', '\\staff {score}'], events: [], kind: 'empty' });
  }

  // La letra va en la voz; los acordes, en la voz o en el primer instrumento armónico.
  const byKind = (k: string) => built.find((b) => b.kind === k);
  const lyricHost = byKind('vocals') ?? built[0];
  const chordHost = byKind('vocals') ?? byKind('guitar') ?? byKind('piano') ?? built[0];
  for (const word of result.lyrics.words) {
    const step = toStep(word.start);
    if (step < 0) continue;
    // La sílaba se pega a la nota de voz más cercana (hasta un tiempo de distancia).
    const near = lyricHost.events
      .filter((e) => e.body && Math.abs(e.step - step) <= 4 && !e.lyric)
      .sort((a, b) => Math.abs(a.step - step) - Math.abs(b.step - step))[0];
    if (near) near.lyric = word.text;
    else attach(lyricHost.events, step, 'lyric', word.text);
  }
  for (const chord of result.chords) {
    const step = toStep(chord.time);
    if (step >= 0) attach(chordHost.events, step, 'chord', chord.name);
  }

  for (const track of built) {
    out.push(...track.header);
    out.push(buildBars(track.events, barCount, barSteps).join(' |\n') + ' |');
  }
  return out.join('\n');
}
