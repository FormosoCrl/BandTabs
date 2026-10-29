import { useEffect, useRef, useState } from 'react';
import {
  cancelEngine,
  describeSource,
  engineStatus,
  installEngine,
  isDesktop,
  onEngineEvent,
  pickAudioFile,
  transcribe,
  type EngineStatus,
} from '../lib/engine';
import { transcriptionToAlphaTex } from '../lib/importers/transcription';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onImport: (fileName: string, data: Uint8Array) => Promise<void>;
}

type Phase = 'idle' | 'installing' | 'working' | 'error';

const SOURCE_LABELS = {
  youtube: 'Vídeo de YouTube',
  spotify: 'Canción de Spotify: se busca el audio en YouTube',
  file: 'Archivo de audio de tu equipo',
  unknown: '',
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TranscribeDialog({ onClose, onImport }: Props) {
  const desktop = isDesktop();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [source, setSource] = useState('');
  const [lyrics, setLyrics] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const busy = phase === 'installing' || phase === 'working';
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!desktop) return;
    void engineStatus().then(setStatus);
    let unlisten: (() => void) | undefined;
    void onEngineEvent((e) => {
      if (e.type === 'progress') {
        if (e.progress != null) setProgress(e.progress);
        if (e.message) setMessage(e.message);
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [desktop]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busyRef.current && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const kind = describeSource(source.trim());
  const ready = status?.installed && !status.needsUpdate;

  const start = async () => {
    setError(null);
    setProgress(0);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      if (!ready) {
        setPhase('installing');
        setMessage('Preparando la instalación…');
        await installEngine();
        setStatus(await engineStatus());
      }
      setPhase('working');
      setProgress(0);
      setMessage('Empezando…');
      const result = await transcribe(source.trim(), lyrics);
      const tex = transcriptionToAlphaTex(result);
      await onImport(`${result.title}.atex`, new TextEncoder().encode(tex));
      onClose();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text === 'Cancelado') {
        setPhase('idle');
      } else {
        setError(text);
        setPhase('error');
      }
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal transcribe"
        role="dialog"
        aria-label="Transcribir desde un enlace"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Transcribir desde un enlace</h2>
          {!busy && (
            <button className="icon" onClick={onClose} aria-label="Cerrar">
              <Icon name="close" />
            </button>
          )}
        </header>

        {!desktop ? (
          <p>Esto solo funciona en la app de escritorio, porque el análisis se hace en tu equipo.</p>
        ) : busy ? (
          <div className="transcribe-progress">
            <p className="step">{message}</p>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div style={{ width: `${Math.max(2, progress * 100)}%` }} />
            </div>
            <p className="meta">
              {Math.round(progress * 100)} % · {formatElapsed(now - startedAt)}
              {phase === 'working' && ' · una canción de 4 minutos tarda unos 5–10 minutos'}
            </p>
            <button className="btn" onClick={() => void cancelEngine()}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              Enlace de YouTube o Spotify
              <input
                autoFocus
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                spellCheck={false}
              />
            </label>
            <div className="source-row">
              <span className="muted">{SOURCE_LABELS[kind]}</span>
              <button
                className="link"
                onClick={async () => {
                  const path = await pickAudioFile();
                  if (path) setSource(path);
                }}
              >
                o elige un archivo de audio
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={lyrics} onChange={(e) => setLyrics(e.target.checked)} />
              Sacar también la letra
            </label>

            <p className="note">
              Se separan los instrumentos y se escriben guitarra, bajo, piano, voz y batería, con los
              acordes y la letra. El resultado es un borrador: acierta bastante con el bajo y la
              batería, y menos con guitarras distorsionadas o solos rápidos.
            </p>
            {!ready && status && (
              <p className="note">
                {status.needsUpdate
                  ? 'Hay una versión nueva del analizador. Se actualizará antes de empezar.'
                  : 'La primera vez se descargan el analizador y sus modelos (unos 2 GB). Solo se hace una vez y después funciona sin conexión, salvo para bajar el audio.'}
              </p>
            )}
            <p className="legal">
              Usa solo canciones que tengas derecho a usar. El audio se descarga y se analiza en tu
              equipo, y no se sube a ningún sitio. De Spotify solo se leen el título y el artista;
              el audio se busca en YouTube. Descargar de YouTube puede ir contra sus condiciones de
              uso: la responsabilidad es de quien lo hace.
            </p>
            {error && <p className="error-text">{error}</p>}
            <div className="actions">
              <button className="btn" onClick={onClose}>
                Cerrar
              </button>
              <button
                className="btn primary"
                onClick={() => void start()}
                disabled={kind === 'unknown' || !status}
              >
                {ready ? 'Transcribir' : 'Instalar y transcribir'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
