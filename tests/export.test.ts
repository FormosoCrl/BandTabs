import { describe, expect, it } from 'vitest';
import { importer } from '@coderline/alphatab';
import { concatFloat32, encodeWav, exportGuitarPro, exportMidi } from '../src/lib/export';
import { DEMO_ALPHATEX } from '../src/lib/demo';

const score = () => importer.ScoreLoader.loadAlphaTex(DEMO_ALPHATEX);
const text = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.slice(start, end));

describe('exportación', () => {
  it('genera un Guitar Pro que se puede volver a abrir', () => {
    const reopened = importer.ScoreLoader.loadScoreFromBytes(exportGuitarPro(score()));
    expect(reopened.title).toBe('Riff de ejemplo');
    expect(reopened.tracks.map((t) => t.name)).toEqual(['Guitarra', 'Bajo']);
  });

  it('genera un MIDI estándar con una pista por instrumento', () => {
    const bytes = exportMidi(score());
    expect(text(bytes, 0, 4)).toBe('MThd');
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(8)).toBe(1); // formato 1
    expect(view.getUint16(10)).toBeGreaterThanOrEqual(2);
  });

  it('codifica WAV de 16 bits con la cabecera correcta', () => {
    const samples = concatFloat32([new Float32Array([0, 1, -1]), new Float32Array([0.5])]);
    const wav = encodeWav(samples, 44100);
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 12)).toBe('WAVE');
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });
});
