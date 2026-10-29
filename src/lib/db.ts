import Dexie, { type EntityTable } from 'dexie';
import type { SongFormat } from './formats';
import type { TrackSummary } from './importer';
import type { InstrumentKind } from './instruments';

export interface Song {
  id: number;
  title: string;
  artist: string;
  album: string;
  tempo: number;
  fileName: string;
  format: SongFormat;
  tracks: TrackSummary[];
  /** Índices derivados de `tracks` para poder filtrar con IndexedDB. */
  instruments: InstrumentKind[];
  tunings: string[];
  favorite: 0 | 1;
  addedAt: number;
  lastOpenedAt: number | null;
}

/** El contenido del archivo va aparte para que listar la biblioteca no cargue todos los bytes. */
export interface SongFile {
  songId: number;
  data: Uint8Array;
}

export interface Playlist {
  id: number;
  name: string;
  songIds: number[];
  createdAt: number;
}

export class BandTabsDb extends Dexie {
  songs!: EntityTable<Song, 'id'>;
  files!: EntityTable<SongFile, 'songId'>;
  playlists!: EntityTable<Playlist, 'id'>;

  constructor(name = 'bandtabs') {
    super(name);
    this.version(1).stores({
      songs: '++id, title, artist, favorite, addedAt, lastOpenedAt, *instruments, *tunings',
      files: 'songId',
      playlists: '++id, name',
    });
  }
}

export const db = new BandTabsDb();
