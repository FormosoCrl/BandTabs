import { useEffect, useMemo, useRef, useState } from 'react';
import { AlphaTabApi, LayoutMode, PlayerMode, synth, type model } from '@coderline/alphatab';
import type { Song } from '../lib/db';
import { loadScore } from '../lib/importer';
import { INSTRUMENT_LABELS } from '../lib/instruments';

interface Props {
  song: Song;
  data: Uint8Array;
}

interface MixerChannel {
  volume: number;
  mute: boolean;
  solo: boolean;
}

type View = 'tab' | 'tab-score' | 'score';

/**
 * El perfil de pentagrama de alphaTab solo puede ocultar lo que el archivo muestra, así que la
 * vista se aplica sobre los pentagramas de cuerda del propio score. Batería y teclados siguen
 * siempre en partitura.
 */
function applyView(score: model.Score, view: View) {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (!staff.isStringed || track.isPercussion) continue;
      staff.showTablature = view !== 'score';
      staff.showStandardNotation = view !== 'tab';
    }
  }
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function Player({ song, data }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  // App monta un Player nuevo por canción (key = id), así que el estado empieza limpio.
  const parsed = useMemo(() => {
    try {
      const loaded = loadScore(data, song.format);
      applyView(loaded, 'tab');
      return { score: loaded, error: null };
    } catch (e) {
      return { score: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [data, song.format]);
  const score: model.Score | null = parsed.score;
  const [renderError, setRenderError] = useState<string | null>(null);
  const error = parsed.error ?? renderError;
  const [rendering, setRendering] = useState(true);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState({ current: 0, end: 0 });
  const [selectedTrack, setSelectedTrack] = useState<number | 'all'>(0);
  const [mixer, setMixer] = useState<MixerChannel[]>(() =>
    (parsed.score?.tracks ?? []).map(() => ({ volume: 1, mute: false, solo: false })),
  );
  const [view, setView] = useState<View>('tab');
  const [zoom, setZoom] = useState(1);

  // La instancia de alphaTab vive mientras el componente esté montado.
  useEffect(() => {
    const api = new AlphaTabApi(hostRef.current!, {
      core: { fontDirectory: '/font/' },
      display: { layoutMode: LayoutMode.Page },
      player: {
        playerMode: PlayerMode.EnabledSynthesizer,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: viewportRef.current!,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true,
      },
    });
    api.renderStarted.on(() => setRendering(true));
    api.renderFinished.on(() => setRendering(false));
    api.playerReady.on(() => setPlayerReady(true));
    api.playerStateChanged.on((e) => setPlaying(e.state === synth.PlayerState.Playing));
    api.playerPositionChanged.on((e) => {
      setPosition((prev) => {
        // Evita re-renderizar la app en cada tick cuando el segundo no cambia.
        const current = Math.floor(e.currentTime / 1000) * 1000;
        return prev.current === current && prev.end === e.endTime
          ? prev
          : { current, end: e.endTime };
      });
    });
    api.error.on((e) => setRenderError(e.message));
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (score) apiRef.current?.renderScore(score, [0]);
  }, [score]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== 'Space' || target.closest('input, select, textarea, button')) return;
      e.preventDefault();
      apiRef.current?.playPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // El primer render ya lo hace renderScore con la vista por defecto.
  const viewInitialized = useRef(false);
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !score) return;
    if (!viewInitialized.current) {
      viewInitialized.current = true;
      return;
    }
    applyView(score, view);
    api.settings.display.scale = zoom;
    api.updateSettings();
    api.render();
  }, [view, zoom, score]);

  const showTrack = (index: number | 'all') => {
    const api = apiRef.current;
    if (!api || !score) return;
    setSelectedTrack(index);
    api.renderTracks(index === 'all' ? score.tracks : [score.tracks[index]]);
  };

  const updateChannel = (index: number, change: Partial<MixerChannel>) => {
    const api = apiRef.current;
    if (!api || !score) return;
    const track = [score.tracks[index]];
    if (change.volume !== undefined) api.changeTrackVolume(track, change.volume);
    if (change.mute !== undefined) api.changeTrackMute(track, change.mute);
    if (change.solo !== undefined) api.changeTrackSolo(track, change.solo);
    setMixer((prev) => prev.map((ch, i) => (i === index ? { ...ch, ...change } : ch)));
  };

  return (
    <div className="player">
      <header className="player-header">
        <div className="player-title">
          <h1>{song.title}</h1>
          <p>
            {[song.artist, song.album].filter(Boolean).join(' · ') || 'Artista desconocido'}
            {song.tempo ? ` · ${song.tempo} BPM` : ''}
          </p>
        </div>
        <div className="transport">
          <button
            className="btn primary"
            onClick={() => apiRef.current?.playPause()}
            disabled={!playerReady || !score}
            title={playerReady ? 'Reproducir o pausar (barra espaciadora)' : 'Cargando sonidos…'}
          >
            {playing ? '❚❚ Pausa' : '▶ Reproducir'}
          </button>
          <button className="btn" onClick={() => apiRef.current?.stop()} disabled={!playerReady}>
            ■ Parar
          </button>
          <span className="time">
            {formatTime(position.current)} / {formatTime(position.end)}
          </span>
        </div>
        <div className="view-options">
          <label>
            Vista
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              <option value="tab">Tablatura</option>
              <option value="tab-score">Tablatura y partitura</option>
              <option value="score">Partitura</option>
            </select>
          </label>
          <label>
            Zoom
            <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
              {[0.75, 0.9, 1, 1.25, 1.5].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)} %
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="player-body">
        <aside className="tracks" aria-label="Pistas">
          <h2>Pistas</h2>
          {score && score.tracks.length > 1 && (
            <button
              className={`track-name ${selectedTrack === 'all' ? 'active' : ''}`}
              onClick={() => showTrack('all')}
            >
              Todas las pistas
            </button>
          )}
          {score?.tracks.map((track, i) => (
            <div key={track.index} className="track">
              <button
                className={`track-name ${selectedTrack === i ? 'active' : ''}`}
                onClick={() => showTrack(i)}
                title="Mostrar esta pista"
              >
                <span>{song.tracks[i]?.name ?? track.name}</span>
                <small>
                  {song.tracks[i] ? INSTRUMENT_LABELS[song.tracks[i].instrument] : ''}
                  {song.tracks[i]?.tuning ? ` · ${song.tracks[i].tuning}` : ''}
                </small>
              </button>
              <div className="mixer">
                <button
                  className={`chip ${mixer[i]?.mute ? 'on' : ''}`}
                  onClick={() => updateChannel(i, { mute: !mixer[i]?.mute })}
                  aria-pressed={mixer[i]?.mute}
                  title="Silenciar"
                >
                  M
                </button>
                <button
                  className={`chip ${mixer[i]?.solo ? 'on' : ''}`}
                  onClick={() => updateChannel(i, { solo: !mixer[i]?.solo })}
                  aria-pressed={mixer[i]?.solo}
                  title="Solo"
                >
                  S
                </button>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={mixer[i]?.volume ?? 1}
                  onChange={(e) => updateChannel(i, { volume: Number(e.target.value) })}
                  aria-label={`Volumen de ${track.name}`}
                />
              </div>
            </div>
          ))}
        </aside>

        <div className="score-viewport" ref={viewportRef}>
          {error && <div className="error">No se pudo abrir el archivo: {error}</div>}
          {rendering && !error && <div className="loading">Dibujando tablatura…</div>}
          <div ref={hostRef} className="score-host" />
        </div>
      </div>
    </div>
  );
}
