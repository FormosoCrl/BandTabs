import { importer, Settings, model } from '@coderline/alphatab';
import { detectFormat, type SongFormat } from './formats';
import { asciiTabToAlphaTex } from './importers/ascii';
import { midiToAlphaTex } from './importers/midi';
import { classifyTrack, describeTuning, type InstrumentKind } from './instruments';

export interface TrackSummary {
  name: string;
  instrument: InstrumentKind;
  tuning: string | null;
}

export interface ParsedSong {
  title: string;
  artist: string;
  album: string;
  tempo: number;
  format: SongFormat;
  tracks: TrackSummary[];
}

export class UnsupportedFormatError extends Error {
  constructor(fileName: string) {
    super(`Formato no compatible: ${fileName}`);
    this.name = 'UnsupportedFormatError';
  }
}

export function loadScore(data: Uint8Array, format: SongFormat): model.Score {
  const settings = new Settings();
  if (format === 'alphatex') {
    return importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(data), settings);
  }
  return importer.ScoreLoader.loadScoreFromBytes(data, settings);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export interface PreparedFile {
  format: SongFormat;
  data: Uint8Array;
}

/** Deja el archivo en un formato que alphaTab abre directamente (MIDI y texto pasan a alphaTex). */
export function prepareFile(fileName: string, data: Uint8Array): PreparedFile {
  const format = detectFormat(fileName);
  if (!format) throw new UnsupportedFormatError(fileName);
  const encode = (tex: string) => new TextEncoder().encode(tex);
  if (format === 'midi') {
    return { format: 'alphatex', data: encode(midiToAlphaTex(data, stripExtension(fileName))) };
  }
  if (format === 'asciitab') {
    const text = new TextDecoder().decode(data);
    return { format: 'alphatex', data: encode(asciiTabToAlphaTex(text, stripExtension(fileName))) };
  }
  return { format, data };
}

/** Lee un archivo ya preparado y extrae los metadatos que guarda la biblioteca. */
export function parseSong(fileName: string, file: PreparedFile): ParsedSong {
  const { format, data } = file;
  const score = loadScore(data, format);
  return {
    title: score.title.trim() || stripExtension(fileName),
    artist: score.artist.trim(),
    album: score.album.trim(),
    tempo: score.tempo,
    format,
    tracks: score.tracks.map((track) => ({
      name: track.name.trim() || `Pista ${track.index + 1}`,
      instrument: classifyTrack(track),
      tuning: track.staves[0] ? describeTuning(track.staves[0]) : null,
    })),
  };
}
