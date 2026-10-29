import { importer, Settings, model } from '@coderline/alphatab';
import { detectFormat, type SongFormat } from './formats';
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

/** Lee un archivo de tablatura y extrae los metadatos que guarda la biblioteca. */
export function parseSong(fileName: string, data: Uint8Array): ParsedSong {
  const format = detectFormat(fileName);
  if (!format) throw new UnsupportedFormatError(fileName);
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
