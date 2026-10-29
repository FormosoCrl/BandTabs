import { describe, expect, it } from 'vitest';
import { midiToName, noteFromFrequency } from '../src/lib/tuner';

describe('noteFromFrequency', () => {
  it('reconoce La 440 y la sexta cuerda de la guitarra', () => {
    expect(noteFromFrequency(440)).toMatchObject({ name: 'La', octave: 4, midi: 69, cents: 0 });
    expect(noteFromFrequency(82.41)).toMatchObject({ name: 'Mi', octave: 2, midi: 40, cents: 0 });
  });

  it('calcula la desviación en cents', () => {
    expect(noteFromFrequency(445).cents).toBe(20);
    expect(noteFromFrequency(435).cents).toBe(-20);
  });

  it('nombra notas MIDI', () => {
    expect(midiToName(40)).toBe('Mi2');
    expect(midiToName(64)).toBe('Mi4');
  });
});
