import type { BandTabsDb, Playlist, Song } from './db';
import { parseSong, prepareFile } from './importer';
import type { InstrumentKind } from './instruments';

export interface ImportResult {
  added: Song[];
  failed: { fileName: string; reason: string }[];
}

export interface SongFilter {
  query?: string;
  instrument?: InstrumentKind | null;
  tuning?: string | null;
  favoritesOnly?: boolean;
  playlistId?: number | null;
}

export type SongSort = 'title' | 'artist' | 'recent' | 'added';

export class Library {
  constructor(private readonly db: BandTabsDb) {}

  async importFile(fileName: string, data: Uint8Array): Promise<Song> {
    const prepared = prepareFile(fileName, data);
    const parsed = parseSong(fileName, prepared);
    const song: Omit<Song, 'id'> = {
      ...parsed,
      fileName,
      instruments: [...new Set(parsed.tracks.map((t) => t.instrument))],
      tunings: [...new Set(parsed.tracks.flatMap((t) => (t.tuning ? [t.tuning] : [])))],
      favorite: 0,
      addedAt: Date.now(),
      lastOpenedAt: null,
    };
    return this.db.transaction('rw', this.db.songs, this.db.files, async () => {
      const id = await this.db.songs.add(song as Song);
      await this.db.files.add({ songId: id, data: prepared.data });
      return { ...song, id };
    });
  }

  async importFiles(files: { name: string; data: Uint8Array }[]): Promise<ImportResult> {
    const result: ImportResult = { added: [], failed: [] };
    for (const file of files) {
      try {
        result.added.push(await this.importFile(file.name, file.data));
      } catch (e) {
        result.failed.push({
          fileName: file.name,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return result;
  }

  async search(filter: SongFilter = {}, sort: SongSort = 'title'): Promise<Song[]> {
    let songs = await this.db.songs.toArray();
    if (filter.playlistId != null) {
      const playlist = await this.db.playlists.get(filter.playlistId);
      const order = playlist?.songIds ?? [];
      songs = order.flatMap((id) => songs.filter((s) => s.id === id));
    }
    const query = normalize(filter.query ?? '');
    songs = songs.filter(
      (s) =>
        (!query || normalize(`${s.title} ${s.artist} ${s.album}`).includes(query)) &&
        (!filter.instrument || s.instruments.includes(filter.instrument)) &&
        (!filter.tuning || s.tunings.includes(filter.tuning)) &&
        (!filter.favoritesOnly || s.favorite === 1),
    );
    if (filter.playlistId != null) return songs;
    return songs.sort(SORTERS[sort]);
  }

  async recent(limit = 20): Promise<Song[]> {
    return this.db.songs
      .orderBy('lastOpenedAt')
      .reverse()
      .filter((s) => s.lastOpenedAt != null)
      .limit(limit)
      .toArray();
  }

  /** Afinaciones presentes en la biblioteca, para el filtro. */
  async tunings(): Promise<string[]> {
    const keys = (await this.db.songs.orderBy('tunings').uniqueKeys()) as string[];
    return keys.sort((a, b) => (a === 'Estándar' ? -1 : b === 'Estándar' ? 1 : a.localeCompare(b)));
  }

  async open(id: number): Promise<{ song: Song; data: Uint8Array } | null> {
    const song = await this.db.songs.get(id);
    const file = await this.db.files.get(id);
    if (!song || !file) return null;
    const lastOpenedAt = Date.now();
    await this.db.songs.update(id, { lastOpenedAt });
    return { song: { ...song, lastOpenedAt }, data: file.data };
  }

  async setFavorite(id: number, favorite: boolean): Promise<void> {
    await this.db.songs.update(id, { favorite: favorite ? 1 : 0 });
  }

  async remove(id: number): Promise<void> {
    await this.db.transaction('rw', this.db.songs, this.db.files, this.db.playlists, async () => {
      await this.db.songs.delete(id);
      await this.db.files.delete(id);
      await this.db.playlists.toCollection().modify((p) => {
        p.songIds = p.songIds.filter((songId) => songId !== id);
      });
    });
  }

  async playlists(): Promise<Playlist[]> {
    return this.db.playlists.orderBy('name').toArray();
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const playlist = { name: name.trim(), songIds: [], createdAt: Date.now() };
    const id = await this.db.playlists.add(playlist as unknown as Playlist);
    return { ...playlist, id };
  }

  async renamePlaylist(id: number, name: string): Promise<void> {
    await this.db.playlists.update(id, { name: name.trim() });
  }

  async deletePlaylist(id: number): Promise<void> {
    await this.db.playlists.delete(id);
  }

  async addToPlaylist(playlistId: number, songId: number): Promise<void> {
    await this.db.playlists.where('id').equals(playlistId).modify((p) => {
      if (!p.songIds.includes(songId)) p.songIds.push(songId);
    });
  }

  async removeFromPlaylist(playlistId: number, songId: number): Promise<void> {
    await this.db.playlists.where('id').equals(playlistId).modify((p) => {
      p.songIds = p.songIds.filter((id) => id !== songId);
    });
  }
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

const SORTERS: Record<SongSort, (a: Song, b: Song) => number> = {
  title: (a, b) => a.title.localeCompare(b.title, 'es'),
  artist: (a, b) => a.artist.localeCompare(b.artist, 'es') || a.title.localeCompare(b.title, 'es'),
  recent: (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
  added: (a, b) => b.addedAt - a.addedAt,
};
