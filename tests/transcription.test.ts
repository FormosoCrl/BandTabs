import { describe, expect, it } from 'vitest';
import { importer } from '@coderline/alphatab';
import {
  makeTimeGrid,
  transcriptionToAlphaTex,
  type EngineResult,
} from '../src/lib/importers/transcription';
import { buildChordSheet } from '../src/lib/chordsheet';

// 120 BPM: un tiempo cada 0,5 s. El primer tiempo fuerte es el segundo tiempo detectado (0,5 s).
const beats = Array.from({ length: 17 }, (_, i) => i * 0.5);

const RESULT: EngineResult = {
  version: 1,
  title: 'Canción de prueba',
  artist: 'Grupo',
  sourceUrl: 'https://youtu.be/x',
  duration: 8.4,
  tempo: 120,
  beats,
  downbeat: 1,
  beatsPerBar: 4,
  tracks: [
    {
      stem: 'guitar',
      kind: 'guitar',
      name: 'Guitarra',
      program: 29,
      notes: [
        { start: 0.5, end: 1.0, pitch: 40, velocity: 0.8 },
        { start: 0.5, end: 1.0, pitch: 47, velocity: 0.8 },
        { start: 1.5, end: 2.5, pitch: 45, velocity: 0.8 },
      ],
    },
    {
      stem: 'vocals',
      kind: 'vocals',
      name: 'Voz',
      program: 54,
      notes: [
        { start: 0.52, end: 0.9, pitch: 64, velocity: 0.7 },
        { start: 1.0, end: 1.4, pitch: 67, velocity: 0.7 },
      ],
    },
  ],
  drums: [
    { time: 0.5, piece: 'kick' },
    { time: 0.5, piece: 'hihat' },
    { time: 1.0, piece: 'snare' },
  ],
  chords: [
    { time: 0.5, name: 'Em' },
    { time: 2.5, name: 'A' },
  ],
  lyrics: {
    language: 'es',
    words: [
      { start: 0.55, end: 0.9, text: 'Ho-' },
      { start: 1.02, end: 1.4, text: 'la' },
      { start: 3.0, end: 3.2, text: 'mundo' },
    ],
  },
};

describe('rejilla de tiempo', () => {
  it('cuenta semicorcheas desde el primer tiempo fuerte', () => {
    const toStep = makeTimeGrid(beats, 1, 120);
    expect(toStep(0.5)).toBe(0);
    expect(toStep(0.625)).toBe(1);
    expect(toStep(1.0)).toBe(4);
    expect(toStep(0.25)).toBe(-2);
    expect(toStep(9.0)).toBe(68); // más allá del último tiempo se extrapola
  });
});

describe('transcriptionToAlphaTex', () => {
  const score = importer.ScoreLoader.loadAlphaTex(transcriptionToAlphaTex(RESULT));

  it('crea guitarra en tablatura, voz, batería y metadatos', () => {
    expect(score.title).toBe('Canción de prueba');
    expect(score.artist).toBe('Grupo');
    expect(score.tempo).toBe(120);
    expect(score.tracks.map((t) => t.name)).toEqual(['Guitarra', 'Voz', 'Batería']);
    expect(score.tracks[0].staves[0].showTablature).toBe(true);
    expect(score.tracks[2].isPercussion).toBe(true);
    expect(score.masterBars.length).toBe(4); // 8,4 s a 120 BPM desde 0,5 s
  });

  it('respeta duraciones y silencios', () => {
    const beats0 = score.tracks[0].staves[0].bars[0].voices[0].beats;
    const summary = beats0.map((b) => (b.isRest ? `r${b.duration}` : `${b.notes.map((n) => n.realValue).sort().join('+')}/${b.duration}`));
    expect(summary).toEqual(['40+47/4', 'r4', '45/2']);
  });

  it('coloca acordes y letra para la vista de acordes', () => {
    const sheet = buildChordSheet(score);
    expect(sheet.chords).toEqual(['Em', 'A']);
    expect(sheet.bars[0].segments).toEqual([
      { chord: 'Em', text: 'Ho-' },
      { chord: null, text: 'la' },
    ]);
    expect(sheet.bars[1].segments[0]).toEqual({ chord: 'A', text: '' });
    expect(sheet.bars[1].segments.some((s) => s.text === 'mundo')).toBe(true);
  });
});

describe('afinación en la transcripción', () => {
  const lowD: EngineResult = {
    ...RESULT,
    tracks: [
      {
        stem: 'guitar',
        kind: 'guitar',
        name: 'Guitarra',
        program: 29,
        notes: Array.from({ length: 8 }, (_, i) => ({
          start: 0.5 + i * 0.5,
          end: 0.9 + i * 0.5,
          pitch: i % 2 ? 45 : 38,
          velocity: 0.8,
        })),
      },
    ],
    chords: [],
    lyrics: { language: null, words: [] },
  };

  it('propone Drop D si la guitarra baja hasta Re', () => {
    const score = importer.ScoreLoader.loadAlphaTex(transcriptionToAlphaTex(lowD));
    const staff = score.tracks[0].staves[0];
    expect(staff.tuning).toEqual([64, 59, 55, 50, 45, 38]);
    const first = staff.bars[0].voices[0].beats.find((b) => b.notes.length)!.notes[0];
    expect(first.string).toBe(1);
    expect(first.fret).toBe(0);
  });

  it('respeta la afinación elegida', () => {
    const eb = [63, 58, 54, 49, 44, 39];
    const score = importer.ScoreLoader.loadAlphaTex(transcriptionToAlphaTex(lowD, { guitar: eb }));
    expect(score.tracks[0].staves[0].tuning).toEqual(eb);
  });
});
