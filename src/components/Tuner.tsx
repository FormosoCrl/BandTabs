import { useEffect, useRef, useState } from 'react';
import { PitchDetector } from 'pitchy';
import { midiToName, noteFromFrequency, TUNER_PRESETS, type DetectedNote } from '../lib/tuner';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
}

/** Afinador cromático con el micrófono del equipo. */
export function Tuner({ onClose }: Props) {
  const [note, setNote] = useState<DetectedNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState(0);
  const [a4, setA4] = useState(440);
  const a4Ref = useRef(a4);

  useEffect(() => {
    a4Ref.current = a4;
  }, [a4]);

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (stopped) return;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        context.createMediaStreamSource(stream).connect(analyser);
        const detector = PitchDetector.forFloat32Array(analyser.fftSize);
        detector.minVolumeDecibels = -45;
        const input = new Float32Array(detector.inputLength);
        const tick = () => {
          analyser.getFloatTimeDomainData(input);
          const [pitch, clarity] = detector.findPitch(input, context!.sampleRate);
          if (clarity > 0.92 && pitch > 25 && pitch < 2000) {
            setNote(noteFromFrequency(pitch, a4Ref.current));
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'No hay permiso para usar el micrófono.'
            : 'No se encontró ningún micrófono.',
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inTune = note && Math.abs(note.cents) <= 5;
  const strings = TUNER_PRESETS[preset].strings;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal tuner"
        role="dialog"
        aria-label="Afinador"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Afinador</h2>
          <button className="icon" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <div className={`tuner-note ${inTune ? 'in-tune' : ''}`}>
              {note ? (
                <>
                  {note.name}
                  <sub>{note.octave}</sub>
                </>
              ) : (
                '–'
              )}
            </div>
            <div className="tuner-meter" aria-label={note ? `${note.cents} cents` : undefined}>
              <div className="tuner-center" />
              {note && (
                <div
                  className="tuner-needle"
                  style={{ left: `${50 + Math.max(-50, Math.min(50, note.cents))}%` }}
                />
              )}
            </div>
            <p className="tuner-info">
              {note
                ? `${note.frequency.toFixed(1)} Hz · ${note.cents > 0 ? '+' : ''}${note.cents} cents${
                    inTune ? ' · afinado' : note.cents < 0 ? ' · sube' : ' · baja'
                  }`
                : 'Toca una cuerda'}
            </p>
          </>
        )}
        <div className="tuner-strings">
          {strings.map((midi, i) => (
            <span key={i} className={`string ${note?.midi === midi ? 'active' : ''}`}>
              {midiToName(midi)}
            </span>
          ))}
        </div>
        <div className="tuner-options">
          <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} aria-label="Instrumento">
            {TUNER_PRESETS.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
          <label>
            La4 =
            <input
              type="number"
              min={415}
              max={466}
              value={a4}
              onChange={(e) => setA4(Number(e.target.value) || 440)}
            />
            Hz
          </label>
        </div>
      </div>
    </div>
  );
}
