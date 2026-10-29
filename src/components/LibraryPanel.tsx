import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Song } from '../lib/db';
import type { Library, SongSort } from '../lib/library';
import { INSTRUMENT_LABELS, type InstrumentKind } from '../lib/instruments';

type Section = 'all' | 'favorites' | 'recent' | 'playlist';

interface Props {
  library: Library;
  activeSongId: number | null;
  onOpen: (id: number) => void;
  onImportClick: () => void;
  onTunerClick: () => void;
  onTranscribeClick: () => void;
  onRemoved: (id: number) => void;
}

export function LibraryPanel({
  library,
  activeSongId,
  onOpen,
  onImportClick,
  onTunerClick,
  onTranscribeClick,
  onRemoved,
}: Props) {
  const [section, setSection] = useState<Section>('all');
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [instrument, setInstrument] = useState<InstrumentKind | ''>('');
  const [tuning, setTuning] = useState('');
  const [sort, setSort] = useState<SongSort>('title');
  const [newPlaylist, setNewPlaylist] = useState('');

  const playlists = useLiveQuery(() => library.playlists(), [library]) ?? [];
  const tunings = useLiveQuery(() => library.tunings(), [library]) ?? [];
  const songs =
    useLiveQuery(async () => {
      const filter = {
        query,
        instrument: instrument || null,
        tuning: tuning || null,
        favoritesOnly: section === 'favorites',
        playlistId: section === 'playlist' ? playlistId : null,
      };
      if (section === 'recent') {
        const recent = await library.recent(50);
        const matching = new Set((await library.search(filter)).map((s) => s.id));
        return recent.filter((s) => matching.has(s.id));
      }
      if (section === 'playlist' && playlistId == null) return [];
      return library.search(filter, sort);
    }, [library, section, playlistId, query, instrument, tuning, sort]) ?? [];

  const createPlaylist = async () => {
    if (!newPlaylist.trim()) return;
    const created = await library.createPlaylist(newPlaylist);
    setNewPlaylist('');
    setSection('playlist');
    setPlaylistId(created.id);
  };

  return (
    <aside className="library">
      <div className="library-top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ♪
          </span>
          BandTabs
        </div>
        <div className="top-actions">
          <button className="btn" onClick={onTunerClick} title="Afinador">
            Afinador
          </button>
          <button className="btn primary" onClick={onImportClick}>
            + Importar
          </button>
        </div>
      </div>
      <button className="btn" onClick={onTranscribeClick}>
        Sacar tab de YouTube o Spotify
      </button>

      <nav className="sections" aria-label="Secciones">
        {(
          [
            ['all', 'Todas'],
            ['favorites', 'Favoritas'],
            ['recent', 'Recientes'],
            ['playlist', 'Listas'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={section === key ? 'active' : ''}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'playlist' && (
        <div className="playlists">
          <select
            value={playlistId ?? ''}
            onChange={(e) => setPlaylistId(e.target.value ? Number(e.target.value) : null)}
            aria-label="Lista"
          >
            <option value="">Elige una lista…</option>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.songIds.length})
              </option>
            ))}
          </select>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void createPlaylist();
            }}
          >
            <input
              value={newPlaylist}
              onChange={(e) => setNewPlaylist(e.target.value)}
              placeholder="Nueva lista"
              aria-label="Nombre de la nueva lista"
            />
            <button className="btn" type="submit" disabled={!newPlaylist.trim()}>
              Crear
            </button>
          </form>
          {playlistId != null && (
            <button
              className="link danger"
              onClick={async () => {
                await library.deletePlaylist(playlistId);
                setPlaylistId(null);
              }}
            >
              Borrar esta lista
            </button>
          )}
        </div>
      )}

      <div className="filters">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar canción, artista o álbum"
          aria-label="Buscar"
        />
        <div className="filter-row">
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as InstrumentKind | '')}
            aria-label="Instrumento"
          >
            <option value="">Instrumento</option>
            {Object.entries(INSTRUMENT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select value={tuning} onChange={(e) => setTuning(e.target.value)} aria-label="Afinación">
            <option value="">Afinación</option>
            {tunings.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {(section === 'all' || section === 'favorites') && (
          <select value={sort} onChange={(e) => setSort(e.target.value as SongSort)} aria-label="Ordenar">
            <option value="title">Ordenar por título</option>
            <option value="artist">Ordenar por artista</option>
            <option value="added">Añadidas recientemente</option>
            <option value="recent">Abiertas recientemente</option>
          </select>
        )}
      </div>

      <ul className="song-list">
        {songs.map((song) => (
          <SongItem
            key={song.id}
            song={song}
            active={song.id === activeSongId}
            library={library}
            playlists={playlists}
            currentPlaylistId={section === 'playlist' ? playlistId : null}
            onOpen={onOpen}
            onRemoved={onRemoved}
          />
        ))}
        {songs.length === 0 && <li className="empty">{emptyMessage(section, playlistId)}</li>}
      </ul>
    </aside>
  );
}

function emptyMessage(section: Section, playlistId: number | null): string {
  if (section === 'favorites') return 'Aún no tienes favoritas. Pulsa ☆ en una canción.';
  if (section === 'recent') return 'Las canciones que abras aparecerán aquí.';
  if (section === 'playlist') {
    return playlistId == null ? 'Crea o elige una lista.' : 'Esta lista está vacía.';
  }
  return 'No hay canciones. Importa archivos Guitar Pro, MusicXML, MIDI o tabs en texto.';
}

interface SongItemProps {
  song: Song;
  active: boolean;
  library: Library;
  playlists: { id: number; name: string; songIds: number[] }[];
  currentPlaylistId: number | null;
  onOpen: (id: number) => void;
  onRemoved: (id: number) => void;
}

function SongItem({
  song,
  active,
  library,
  playlists,
  currentPlaylistId,
  onOpen,
  onRemoved,
}: SongItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className={`song ${active ? 'active' : ''}`}>
      <button className="song-main" onClick={() => onOpen(song.id)}>
        <span className="song-title">{song.title}</span>
        <span className="song-meta">{song.artist || 'Artista desconocido'}</span>
        <span className="badges">
          {song.instruments.map((i) => (
            <span key={i} className="badge">
              {INSTRUMENT_LABELS[i]}
            </span>
          ))}
        </span>
      </button>
      <div className="song-actions">
        <button
          className={`icon ${song.favorite ? 'fav' : ''}`}
          onClick={() => library.setFavorite(song.id, !song.favorite)}
          aria-pressed={song.favorite === 1}
          title={song.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}
        >
          {song.favorite ? '★' : '☆'}
        </button>
        <button
          className="icon"
          onClick={() => {
            setMenuOpen((o) => !o);
            setConfirmDelete(false);
          }}
          aria-expanded={menuOpen}
          title="Más opciones"
        >
          ⋯
        </button>
      </div>
      {menuOpen && (
        <div className="song-menu">
          {playlists.length > 0 && (
            <select
              value=""
              onChange={async (e) => {
                await library.addToPlaylist(Number(e.target.value), song.id);
                setMenuOpen(false);
              }}
              aria-label="Añadir a lista"
            >
              <option value="">Añadir a una lista…</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id} disabled={p.songIds.includes(song.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {currentPlaylistId != null && (
            <button
              className="link"
              onClick={() => library.removeFromPlaylist(currentPlaylistId, song.id)}
            >
              Quitar de esta lista
            </button>
          )}
          <button
            className="link danger"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              await library.remove(song.id);
              onRemoved(song.id);
            }}
          >
            {confirmDelete ? '¿Seguro? Pulsa otra vez para borrar' : 'Borrar de la biblioteca'}
          </button>
          <span className="file-name">{song.fileName}</span>
        </div>
      )}
    </li>
  );
}
