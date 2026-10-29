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
 */
export function makeTimeGrid(beats: number[], downbeat: number, tempo: number) {
  const usable = beats.slice(Math.max(0, downbeat));
  const fallback = 60 / (tempo || 120);
  const avg =
    usable.length > 1 ? (usable[usable.length - 1] - usable[0]) / (usable.length - 1) : fallback;
  const first = usable[0] ?? 0;
  return (time: number): number => {
    if (usable.length < 2 || time < first) return Math.round(((time - first) / avg) * 4);
    let lo = 0;
    let hi = usable.length - 1;
    if (time >= usable[hi]) return Math.round((hi + (time - usable[hi]) / avg) * 4);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (usable[mid] <= time) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + (time - usable[lo]) / (usable[lo + 1] - usable[lo])) * 4);
  };
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
  const toStep = makeTimeGrid(result.beats, result.downbeat, result.tempo);
  const barSteps = (result.beatsPerBar || 4) * 4;
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
    const onsets = groupOnsets(track.notes, toStep);
    if (onsets.length === 0) continue;
    const header = [`\\track ${quote(track.name)} \\instrument ${track.program}`];
    let bodies: string[];
    if (track.kind === 'guitar' || track.kind === 'bass') {
      const chosen = track.kind === 'bass' ? options.bass : options.guitar;
      const tuning =
        chosen ?? suggestTuning(track.notes.map((n) => n.pitch), track.kind) ??
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
      const step = toStep(hit.time);
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
        return { step, end: step + 1, body: parts.length === 1 ? parts[0] : `(${parts.join(' ')})` };
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
