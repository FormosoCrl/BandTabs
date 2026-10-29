export type SongFormat = 'guitarpro' | 'musicxml' | 'alphatex';

const EXTENSIONS: Record<string, SongFormat> = {
  gp: 'guitarpro',
  gp3: 'guitarpro',
  gp4: 'guitarpro',
  gp5: 'guitarpro',
  gpx: 'guitarpro',
  xml: 'musicxml',
  musicxml: 'musicxml',
  mxl: 'musicxml',
  atex: 'alphatex',
  alphatex: 'alphatex',
  tex: 'alphatex',
};

/** Valor para el atributo `accept` del selector de archivos. */
export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',');

export function detectFormat(fileName: string): SongFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[ext] ?? null;
}

export const FORMAT_LABELS: Record<SongFormat, string> = {
  guitarpro: 'Guitar Pro',
  musicxml: 'MusicXML',
  alphatex: 'alphaTex',
};
