import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlphaTabApi,
  LayoutMode,
  NotationElement,
  PlayerMode,
  synth,
  type model,
} from '@coderline/alphatab';
import type { Song } from '../lib/db';
import { loadScore } from '../lib/importer';
import { INSTRUMENT_LABELS } from '../lib/instruments';
import { concatFloat32, encodeWav, exportGuitarPro, exportMidi } from '../lib/export';
import { safeFileName, saveFile } from '../lib/save';
import { ChordSheetView } from './ChordSheetView';
import { Icon } from './Icon';
import { TuningSelect } from './TuningSelect';
import { labelTabStrings } from '../lib/stringLabels';
import { retuneStaff, tuningLabel, type TuningValues } from '../lib/tunings';

interface Props {
  song: Song;
  data: Uint8Array;
  onNotice: (message: string) => void;
}

interface MixerChannel {
  volume: number;
  mute: boolean;
  solo: boolean;
}

type View = 'tab' | 'tab-score' | 'score' | 'chords';

const SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

/**
 * El perfil de pentagrama de alphaTab solo puede ocultar lo que el archivo muestra, así que la
 * vista se aplica sobre los pentagramas de cuerda del propio score. Batería y teclados siguen
 * siempre en partitura.
 */
function applyView(score: model.Score, view: View) {
  if (view === 'chords') return;
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (!staff.isStringed || track.isPercussion) continue;
      staff.showTablature = view !== 'score';
      staff.showStandardNotation = view !== 'tab';
    }
  }
}

/** Pentagramas de guitarra o bajo, que son los que se pueden reafinar. */
function tunableKind(track: model.Track, kind: string | undefined): 'guitar' | 'bass' | null {
  const staff = track.staves[0];
  if (!staff?.isStringed || track.isPercussion || staff.tuning.length < 4) return null;
  if (kind === 'bajo') return 'bass';
  if (kind === 'guitarra') return 'guitar';
  return staff.tuning.length <= 5 ? 'bass' : 'guitar';
}

// La afinación elegida se recuerda por canción y pista en este equipo.
const tuningKey = (songId: number) => `bandtabs.tunings.${songId}`;

function readTunings(songId: number): Record<number, TuningValues> {
  try {
    return JSON.parse(localStorage.getItem(tuningKey(songId)) ?? '{}');
  } catch {
    return {};
  }
}

function writeTunings(songId: number, value: Record<number, TuningValues>) {
  try {
    localStorage.setItem(tuningKey(songId), JSON.stringify(value));
  } catch {
    // Sin almacenamiento la afinación vale solo para esta sesión.
  }
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function Player({ song, data, onNotice }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  // App monta un Player nuevo por canción (key = id), así que el estado empieza limpio.
  const parsed = useMemo(() => {
    try {
      const loaded = loadScore(data, song.format);
      const originals = loaded.tracks.map((t) => [...(t.staves[0]?.tuning ?? [])]);
      for (const [index, values] of Object.entries(readTunings(song.id))) {
        const staff = loaded.tracks[Number(index)]?.staves[0];
        if (staff?.isStringed) retuneStaff(staff, values);
      }
      applyView(loaded, 'tab');
      return { score: loaded, originals, error: null };
    } catch (e) {
      return { score: null, originals: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [data, song.format, song.id]);
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
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [hasRange, setHasRange] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [pitch, setPitch] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [tunings, setTunings] = useState<TuningValues[]>(() =>
    (parsed.score?.tracks ?? []).map((t) => [...(t.staves[0]?.tuning ?? [])]),
  );

  // La instancia de alphaTab vive mientras el componente esté montado.
  useEffect(() => {
    const api = new AlphaTabApi(hostRef.current!, {
      // Sin carga diferida para poder imprimir la canción entera.
      core: { fontDirectory: '/font/', enableLazyLoading: false },
      display: { layoutMode: LayoutMode.Page },
      // La afinación va en letras junto a cada cuerda (labelTabStrings), no en la cabecera.
      notation: { elements: new Map([[NotationElement.GuitarTuning, false]]) },
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
    api.renderFinished.on(() => {
      setRendering(false);
      labelTabStrings(hostRef.current!, api.tracks);
    });
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
    api.playbackRangeChanged.on((e) => setHasRange(e.playbackRange != null));
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

  // Ajustes de práctica: se vuelven a aplicar cuando el reproductor termina de cargar.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.playbackSpeed = speed;
    api.isLooping = loop;
    api.countInVolume = countIn ? 1 : 0;
    api.metronomeVolume = metronome ? 1 : 0;
  }, [speed, loop, countIn, metronome, playerReady]);

  useEffect(() => {
    const api = apiRef.current;
    if (api && score) api.changeTrackTranspositionPitch(score.tracks, pitch);
  }, [pitch, score, playerReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, select, textarea')) return;
      if (e.code === 'Space' && !target.closest('button')) {
        e.preventDefault();
        apiRef.current?.playPause();
      } else if (e.key === 'l' || e.key === 'L') {
        setLoop((l) => !l);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // El primer render ya lo hace renderScore con la vista por defecto.
  const viewInitialized = useRef(false);
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !score || view === 'chords') return;
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

  const changeTuning = (index: number, values: TuningValues | null) => {
    const api = apiRef.current;
    const staff = score?.tracks[index]?.staves[0];
    if (!api || !score || !staff || !values) return;
    const raised = retuneStaff(staff, values);
    setTunings((prev) => prev.map((t, i) => (i === index ? [...values] : t)));
    const stored = readTunings(song.id);
    if (values.join() === parsed.originals[index]?.join()) delete stored[index];
    else stored[index] = values;
    writeTunings(song.id, stored);
    api.render();
    onNotice(
      raised
        ? `Afinación cambiada a ${tuningLabel(values)}. ${raised} notas no caben y suben una octava.`
        : `Afinación cambiada a ${tuningLabel(values)}. Suena igual; cambian cuerdas y trastes.`,
    );
  };

  const clearRange = () => {
    const api = apiRef.current;
    if (!api) return;
    api.playbackRange = null;
    api.clearPlaybackRangeHighlight();
    setHasRange(false);
  };

  const exportAudio = async (): Promise<Uint8Array> => {
    const api = apiRef.current!;
    const options = new synth.AudioExportOptions();
    options.sampleRate = 44100;
    options.masterVolume = 1;
    options.metronomeVolume = 0;
    score!.tracks.forEach((t, i) => {
      const ch = mixer[i];
      const anySolo = mixer.some((m) => m.solo);
      const audible = !ch?.mute && (!anySolo || ch?.solo);
      options.trackVolume.set(t.index, audible ? (ch?.volume ?? 1) : 0);
      if (pitch) options.trackTranspositionPitches.set(t.index, pitch);
    });
    const exporter = await api.exportAudio(options);
    const chunks: Float32Array[] = [];
    try {
      for (;;) {
        const chunk = await exporter.render(2000);
        if (!chunk) break;
        chunks.push(chunk.samples);
        setExporting(`Exportando audio… ${Math.round((chunk.currentTime / chunk.endTime) * 100)} %`);
      }
    } finally {
      exporter.destroy();
    }
    return encodeWav(concatFloat32(chunks), options.sampleRate);
  };

  const runExport = async (kind: string) => {
    if (!score) return;
    const base = safeFileName(song.title);
    try {
      if (kind === 'print') {
        window.print();
        return;
      }
      setExporting('Exportando…');
      let saved = false;
      if (kind === 'gp') {
        saved = await saveFile(`${base}.gp`, exportGuitarPro(score), {
          name: 'Guitar Pro',
          extensions: ['gp'],
        });
      } else if (kind === 'midi') {
        saved = await saveFile(`${base}.mid`, exportMidi(score), { name: 'MIDI', extensions: ['mid'] });
      } else if (kind === 'wav') {
        saved = await saveFile(`${base}.wav`, await exportAudio(), { name: 'WAV', extensions: ['wav'] });
      }
      if (saved) onNotice('Archivo exportado.');
    } catch (e) {
      onNotice(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className={`player view-${view}`}>
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
            {playing ? <Icon name="pause" /> : <Icon name="play" />}
            {playing ? 'Pausa' : 'Reproducir'}
          </button>
          <button className="btn" onClick={() => apiRef.current?.stop()} disabled={!playerReady}>
            <Icon name="stop" /> Parar
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
              <option value="chords">Acordes y letra</option>
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
          <select
            value=""
            onChange={(e) => void runExport(e.target.value)}
            disabled={!score || exporting != null}
            aria-label="Exportar o imprimir"
          >
            <option value="">{exporting ?? 'Exportar…'}</option>
            <option value="gp">Guitar Pro (.gp)</option>
            <option value="midi">MIDI (.mid)</option>
            <option value="wav">Audio (.wav)</option>
            <option value="print">Imprimir…</option>
          </select>
        </div>
      </header>

      <div className="practice-bar" aria-label="Práctica">
        <label title="Cambia la velocidad sin cambiar el tono">
          Velocidad
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)} %
              </option>
            ))}
          </select>
        </label>
        <button
          className={`toggle ${loop ? 'on' : ''}`}
          onClick={() => setLoop((l) => !l)}
          aria-pressed={loop}
          title="Repite la selección o, si no hay, la canción entera (tecla L)"
        >
          <Icon name="loop" /> Repetir
        </button>
        {hasRange ? (
          <button className="link" onClick={clearRange}>
            Quitar selección
          </button>
        ) : (
          <span className="hint">Arrastra sobre los compases para repetir solo un trozo</span>
        )}
        <button
          className={`toggle ${countIn ? 'on' : ''}`}
          onClick={() => setCountIn((c) => !c)}
          aria-pressed={countIn}
          title="Un compás de claqueta antes de empezar"
        >
          Cuenta atrás
        </button>
        <button
          className={`toggle ${metronome ? 'on' : ''}`}
          onClick={() => setMetronome((m) => !m)}
          aria-pressed={metronome}
        >
          Metrónomo
        </button>
        <label title="Sube o baja el tono del sonido, por ejemplo para tocar con otra afinación">
          Tono
          <select value={pitch} onChange={(e) => setPitch(Number(e.target.value))}>
            {Array.from({ length: 25 }, (_, i) => i - 12).map((p) => (
              <option key={p} value={p}>
                {p > 0 ? `+${p}` : p === 0 ? 'Original' : p}
              </option>
            ))}
          </select>
        </label>
      </div>

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
                  {tunings[i]?.length && tunableKind(track, song.tracks[i]?.instrument)
                    ? ` · ${tuningLabel(tunings[i])}`
                    : song.tracks[i]?.tuning
                      ? ` · ${song.tracks[i].tuning}`
                      : ''}
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
              {tunableKind(track, song.tracks[i]?.instrument) && (
                <TuningSelect
                  kind={tunableKind(track, song.tracks[i]?.instrument)!}
                  value={tunings[i]}
                  original={parsed.originals[i]}
                  onChange={(values) => changeTuning(i, values)}
                  label={`Afinación de ${track.name}`}
                />
              )}
            </div>
          ))}
        </aside>

        <div className="score-area">
          {view === 'chords' && score && <ChordSheetView score={score} />}
          {/* alphaTab sigue montado en la vista de acordes para que la reproducción continúe. */}
          <div className="score-viewport" ref={viewportRef} hidden={view === 'chords'}>
            {error && <div className="error">No se pudo abrir el archivo: {error}</div>}
            {rendering && !error && <div className="loading">Cargando…</div>}
            <div ref={hostRef} className="score-host" />
          </div>
        </div>
      </div>
    </div>
  );
}
