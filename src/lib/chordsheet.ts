import type { model } from '@coderline/alphatab';

export interface SheetSegment {
  chord: string | null;
  text: string;
}

export interface SheetBar {
  index: number;
  segments: SheetSegment[];
}

export interface ChordSheet {
  bars: SheetBar[];
  chords: string[];
  hasLyrics: boolean;
}

function lyricsTrack(score: model.Score): model.Track | undefined {
  return score.tracks.find((t) =>
    t.staves.some((s) => s.bars.some((b) => b.voices.some((v) => v.beats.some((x) => x.lyrics?.length)))),
  );
}

/**
 * Junta los acordes de todas las pistas y la letra de la primera pista que la tenga, ordenados
 * por tiempo dentro de cada compás, para la vista de acordes y letra.
 */
export function buildChordSheet(score: model.Score): ChordSheet {
  const lyricSource = lyricsTrack(score);
  const chords = new Set<string>();
  const bars: SheetBar[] = score.masterBars.map((mb) => {
    const events = new Map<number, { chord: string | null; text: string }>();
    const at = (tick: number) => {
      if (!events.has(tick)) events.set(tick, { chord: null, text: '' });
      return events.get(tick)!;
    };
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        for (const voice of staff.bars[mb.index]?.voices ?? []) {
          for (const beat of voice.beats) {
            const tick = beat.absolutePlaybackStart;
            const name = beat.chord?.name?.trim();
            if (name && !at(tick).chord) {
              at(tick).chord = name;
              chords.add(name);
            }
            const syllable = track === lyricSource ? beat.lyrics?.[0]?.trim() : undefined;
            if (syllable) {
              const ev = at(tick);
              ev.text = ev.text ? `${ev.text} ${syllable}` : syllable;
            }
          }
        }
      }
    }
    const segments = [...events.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, ev]) => ev)
      .filter((ev) => ev.chord || ev.text);
    return { index: mb.index, segments };
  });
  return { bars, chords: [...chords], hasLyrics: lyricSource !== undefined };
}

/** Une sílabas: "Ho-" + "la" se muestra como "Hola". */
export function joinSyllables(segments: SheetSegment[]): SheetSegment[] {
  return segments.map((seg, i) => {
    const next = segments[i + 1];
    if (seg.text.endsWith('-') && next?.text) return { ...seg, text: seg.text.slice(0, -1) };
    return { ...seg, text: seg.text ? `${seg.text} ` : '' };
  });
}
