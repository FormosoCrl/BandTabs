import { Midi } from '@tonejs/midi';
import { pitchName, quote, splitDuration, tuningToTex } from './alphatex';
import { assignFrets, STANDARD_BASS, STANDARD_GUITAR } from './frets';

type TrackKind = 'guitar' | 'bass' | 'drums' | 'other';

function kindOf(program: number, percussion: boolean): TrackKind {
  if (percussion) return 'drums';
  if (program >= 24 && program <= 31) return 'guitar';
  if (program >= 32 && program <= 39) return 'bass';
  return 'other';
}

interface Onset {
  step: number;
  pitches: number[];
}

/**
 * Convierte un archivo MIDI en alphaTex: cuantiza a semicorcheas, agrupa notas simultáneas en
 * acordes y, en guitarras y bajos, calcula cuerda y traste.
 */
export function midiToAlphaTex(data: Uint8Array, fallbackTitle: string): string {
  const midi = new Midi(data);
  const ppq = midi.header.ppq;
  const stepTicks = ppq / 4;
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const [num, den] = ts;
  const barSteps = Math.round((16 * num) / den);
  const tempo = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  const title = midi.header.name.trim() || fallbackTitle;

  const tracks = midi.tracks.filter((t) => t.notes.length > 0);
  const lastStep = Math.max(
    1,
    ...tracks.flatMap((t) => t.notes.map((n) => Math.round((n.ticks + n.durationTicks) / stepTicks))),
  );
  const barCount = Math.ceil(lastStep / barSteps);

  const out = [`\\title ${quote(title)}`, `\\tempo ${tempo}`, '.'];
  tracks.forEach((track, index) => {
    const percussion = track.instrument.percussion;
    const program = track.instrument.number;
    const kind = kindOf(program, percussion);
    const name = track.name.trim() || track.instrument.name || `Pista ${index + 1}`;
    out.push(`\\track ${quote(name)} \\instrument ${percussion ? 'percussion' : program}`);

    const tuning = kind === 'bass' ? STANDARD_BASS : STANDARD_GUITAR;
    const drumKeys = [...new Set(track.notes.map((n) => n.midi))];
    if (kind === 'guitar' || kind === 'bass') {
      out.push(`\\staff {tabs} \\tuning ${tuningToTex(tuning)}`);
    } else if (percussion) {
      out.push(`\\staff {score} ${drumKeys.map((k) => `\\articulation p${k} ${k}`).join(' ')}`);
    } else {
      out.push('\\staff {score}');
    }

    const onsets = new Map<number, Onset>();
    for (const note of track.notes) {
      const step = Math.round(note.ticks / stepTicks);
      const onset = onsets.get(step) ?? { step, pitches: [] };
      onset.pitches.push(note.midi);
      onsets.set(step, onset);
    }
    const ordered = [...onsets.values()].sort((a, b) => a.step - b.step);
    const frets =
      kind === 'guitar' || kind === 'bass'
        ? assignFrets(
            ordered.map((o) => o.pitches),
            tuning,
          )
        : null;

    const noteText = (onset: Onset, i: number): string | null => {
      let parts: string[];
      if (frets) parts = frets[i].map((p) => `${p.fret}.${p.string}`);
      else if (percussion) parts = [...new Set(onset.pitches)].map((p) => `p${p}`);
      else parts = [...new Set(onset.pitches)].sort((a, b) => a - b).map(pitchName);
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : `(${parts.join(' ')})`;
    };

    const bars: string[] = [];
    let cursor = 0;
    for (let bar = 0; bar < barCount; bar++) {
      const barStart = bar * barSteps;
      const barEnd = barStart + barSteps;
      const beats: string[] = [];
      const rest = (steps: number) => splitDuration(steps).forEach((d) => beats.push(`r.${d}`));
      let pos = barStart;
      while (cursor < ordered.length && ordered[cursor].step < barEnd) {
        const onset = ordered[cursor];
        if (onset.step > pos) rest(onset.step - pos);
        const next = ordered[cursor + 1]?.step ?? barEnd;
        const length = Math.max(1, Math.min(next, barEnd) - onset.step);
        const [first, ...remaining] = splitDuration(length);
        const text = noteText(onset, cursor);
        beats.push(text ? `${text}.${first}` : `r.${first}`);
        remaining.forEach((d) => beats.push(`r.${d}`));
        pos = onset.step + length;
        cursor++;
      }
      if (pos < barEnd) rest(barEnd - pos);
      bars.push((bar === 0 && (num !== 4 || den !== 4) ? `\\ts ${num} ${den} ` : '') + beats.join(' '));
    }
    out.push(bars.join(' |\n') + ' |');
  });
  return out.join('\n');
}
