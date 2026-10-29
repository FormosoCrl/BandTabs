import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/lib/formats';
import { parseSong, UnsupportedFormatError } from '../src/lib/importer';
import { DEMO_ALPHATEX } from '../src/lib/demo';
import { encode, makeGuitarPro } from './helpers';

describe('detectFormat', () => {
  it('reconoce las extensiones compatibles sin importar mayúsculas', () => {
    expect(detectFormat('cancion.GP5')).toBe('guitarpro');
    expect(detectFormat('cancion.gp')).toBe('guitarpro');
    expect(detectFormat('cancion.musicxml')).toBe('musicxml');
    expect(detectFormat('cancion.atex')).toBe('alphatex');
    expect(detectFormat('cancion.mp3')).toBeNull();
  });
});

describe('parseSong', () => {
  it('extrae título, artista, tempo y pistas de alphaTex', () => {
    const song = parseSong('demo.atex', encode(DEMO_ALPHATEX));
    expect(song.title).toBe('Riff de ejemplo');
    expect(song.artist).toBe('BandTabs');
    expect(song.tempo).toBe(100);
    expect(song.tracks).toEqual([
      { name: 'Guitarra', instrument: 'guitarra', tuning: 'Estándar' },
      { name: 'Bajo', instrument: 'bajo', tuning: 'Estándar' },
    ]);
  });

  it('lee archivos Guitar Pro', () => {
    const song = parseSong('demo.gp', makeGuitarPro());
    expect(song.format).toBe('guitarpro');
    expect(song.title).toBe('Riff de ejemplo');
    expect(song.tracks.map((t) => t.instrument)).toEqual(['guitarra', 'bajo']);
  });

  it('usa el nombre del archivo si no hay título', () => {
    const song = parseSong('mi-riff.atex', encode('. :4 0.6 0.6 0.6 0.6 |'));
    expect(song.title).toBe('mi-riff');
  });

  it('rechaza formatos no compatibles', () => {
    expect(() => parseSong('audio.mp3', new Uint8Array())).toThrow(UnsupportedFormatError);
  });
});
