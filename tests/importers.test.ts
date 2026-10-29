import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { importer } from '@coderline/alphatab';
import { asciiTabToAlphaTex, tuningFromLabels } from '../src/lib/importers/ascii';
import { midiToAlphaTex } from '../src/lib/importers/midi';
import { assignFrets, STANDARD_GUITAR } from '../src/lib/importers/frets';
import { splitDuration } from '../src/lib/importers/alphatex';
import { parseSong, prepareFile } from '../src/lib/importer';

// En el modelo de alphaTab la cuerda 1 es la más grave; en alphaTex, la más aguda.
const beatsOf = (tex: string, track = 0) => {
  const staff = importer.ScoreLoader.loadAlphaTex(tex).tracks[track].staves[0];
  const texString = (s: number) => staff.tuning.length - s + 1;
  return staff.bars.map((bar) =>
    bar.voices[0].beats.map((b) =>
      b.isRest
        ? 'r'
        : b.notes.map((n) => (n.isDead ? 'x' : `${n.fret}.${texString(n.string)}`)).join('+'),
    ),
  );
};

const ASCII = `Riff
e|-------------------|-----------------|
B|-------------------|-----------------|
G|-------------------|---------2-------|
D|-------0---2---3---|-----2-------0---|
A|---0-----------3---|-0-----x---------|
E|-0-----------------|-----------------|

Letra que no es tab
`;

describe('tabs en texto (ASCII)', () => {
  it('deduce afinación con octavas', () => {
    expect(tuningFromLabels(['e', 'b', 'g', 'd', 'a', 'e'])).toEqual([64, 59, 55, 50, 45, 40]);
    expect(tuningFromLabels(['e', 'b', 'g', 'd', 'a', 'd'])).toEqual([64, 59, 55, 50, 45, 38]);
    expect(tuningFromLabels(['g', 'd', 'a', 'e'])).toEqual([43, 38, 33, 28]);
    expect(tuningFromLabels(['g', 'd', 'a', 'e', 'b'])).toEqual([43, 38, 33, 28, 23]);
  });

  it('convierte notas, acordes, compases y notas muertas', () => {
    const tex = asciiTabToAlphaTex(ASCII, 'Riff');
    expect(beatsOf(tex)).toEqual([
      ['0.6', '0.5', '0.4', '2.4', '3.4+3.5'],
      ['0.5', '2.4', 'x', '2.3', '0.4'],
    ]);
  });

  it('lee trastes de dos cifras', () => {
    const tex = asciiTabToAlphaTex('e|--12--15--|\nB|--------|\nG|------|\nD|-----|\nA|-----|\nE|----|', 'x');
    expect(beatsOf(tex)[0]).toEqual(['12.1', '15.1']);
  });

  it('importa un .txt a la biblioteca como guitarra', () => {
    const file = prepareFile('mi riff.txt', new TextEncoder().encode(ASCII));
    const song = parseSong('mi riff.txt', file);
    expect(song.title).toBe('mi riff');
    expect(song.tracks).toEqual([{ name: 'Guitarra', instrument: 'guitarra', tuning: 'Estándar' }]);
  });
});

describe('cuerdas y trastes', () => {
  it('pone las notas al aire cuando se puede y evita estiramientos', () => {
    const [eChord, highA] = assignFrets([[40, 47, 52, 56, 59, 64], [69]], STANDARD_GUITAR);
    expect(eChord.map((p) => p.fret).sort()).toEqual([0, 0, 0, 1, 2, 2]);
    expect(highA).toEqual([{ string: 1, fret: 5 }]);
  });

  it('divide duraciones en valores de alphaTex', () => {
    expect(splitDuration(16)).toEqual([1]);
    expect(splitDuration(6)).toEqual([4, 8]);
    expect(splitDuration(3)).toEqual([8, 16]);
  });
});

function makeMidi(): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(100);
  midi.header.name = 'Canción MIDI';
  const ppq = midi.header.ppq;
  const guitar = midi.addTrack();
  guitar.name = 'Guitarra';
  guitar.instrument.number = 29;
  [40, 45, 50, 55].forEach((note, i) =>
    guitar.addNote({ midi: note, ticks: i * ppq, durationTicks: ppq }),
  );
  const drums = midi.addTrack();
  drums.channel = 9;
  drums.name = 'Batería';
  [36, 38, 36, 38].forEach((note, i) => drums.addNote({ midi: note, ticks: i * ppq, durationTicks: ppq / 2 }));
  drums.addNote({ midi: 42, ticks: 0, durationTicks: ppq / 2 });
  const piano = midi.addTrack();
  piano.name = 'Piano';
  piano.addNote({ midi: 60, ticks: 0, durationTicks: ppq * 2 });
  piano.addNote({ midi: 64, ticks: 0, durationTicks: ppq * 2 });
  piano.addNote({ midi: 67, ticks: ppq * 6, durationTicks: ppq });
  return midi.toArray();
}

describe('MIDI', () => {
  it('convierte pistas de guitarra, batería y piano', () => {
    const tex = midiToAlphaTex(makeMidi(), 'archivo');
    const score = importer.ScoreLoader.loadAlphaTex(tex);
    expect(score.title).toBe('Canción MIDI');
    expect(score.tempo).toBe(100);
    expect(score.tracks.map((t) => t.name)).toEqual(['Guitarra', 'Batería', 'Piano']);
    expect(score.tracks[1].isPercussion).toBe(true);
    expect(beatsOf(tex, 0)[0]).toEqual(['0.6', '0.5', '0.4', '0.3']);

    const pianoBeats = score.tracks[2].staves[0].bars.flatMap((b) => b.voices[0].beats);
    expect(pianoBeats[0].notes.map((n) => n.realValue).sort()).toEqual([60, 64]);
    expect(pianoBeats.filter((b) => !b.isRest).flatMap((b) => b.notes.map((n) => n.realValue))).toEqual([
      60, 64, 67,
    ]);
    const drumBeat = score.tracks[1].staves[0].bars[0].voices[0].beats[0];
    const outputs = drumBeat.notes.map(
      (n) => score.tracks[1].percussionArticulations[n.percussionArticulation].outputMidiNumber,
    );
    expect(outputs.sort()).toEqual([36, 42]);
  });

  it('importa un .mid a la biblioteca', () => {
    const song = parseSong('x.mid', prepareFile('x.mid', makeMidi()));
    expect(song.tracks.map((t) => t.instrument)).toEqual(['guitarra', 'bateria', 'teclado']);
  });
});
