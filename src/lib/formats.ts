/** Formatos que se guardan tal cual. MIDI y tabs en texto se convierten a alphaTex al importar. */
export type SongFormat = 'guitarpro' | 'musicxml' | 'alphatex';
export type ImportFormat = SongFormat | 'midi' | 'asciitab';

const EXTENSIONS: Record<string, ImportFormat> = {
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
  mid: 'midi',
  midi: 'midi',
  txt: 'asciitab',
  tab: 'asciitab',
};

/** Valor para el atributo `accept` del selector de archivos. */
export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(',');

export function detectFormat(fileName: string): ImportFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[ext] ?? null;
}

export const FORMAT_LABELS: Record<SongFormat, string> = {
  guitarpro: 'Guitar Pro',
  musicxml: 'MusicXML',
  alphatex: 'alphaTex',
};
