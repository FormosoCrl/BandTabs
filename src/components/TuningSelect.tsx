import { useState } from 'react';
import {
  BASS_TUNINGS,
  findPreset,
  GUITAR_TUNINGS,
  parseTuning,
  tuningNotes,
  type TuningValues,
} from '../lib/tunings';

interface Props {
  kind: 'guitar' | 'bass';
  /** null = automática (solo si se pasa `allowAuto`). */
  value: TuningValues | null;
  onChange: (values: TuningValues | null) => void;
  /** La afinación que trae el archivo, para marcarla como original. */
  original?: TuningValues;
  allowAuto?: boolean;
  label: string;
}

const CUSTOM = 'custom';
const AUTO = 'auto';
const CURRENT = 'current';

export function TuningSelect({ kind, value, onChange, original, allowAuto, label }: Props) {
  const presets = kind === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const reference = value ?? original ?? presets[0].values;

  const selected =
    value == null
      ? AUTO
      : findPreset(presets, value)
        ? String(presets.indexOf(findPreset(presets, value)!))
        : CURRENT;
  const originalTag = (values: TuningValues) =>
    original && values.join() === original.join() ? ' (original)'
      : '';

  const submit = () => {
    const parsed = parseTuning(text, reference);
    if (!parsed) return;
    onChange(parsed);
    setEditing(false);
  };

  return (
    <div className="tuning-select">
      <select
        aria-label={label}
        value={editing ? CUSTOM : selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === AUTO) {
            setEditing(false);
            onChange(null);
          } else if (v === CURRENT) {
            setEditing(false);
          } else if (v === CUSTOM) {
            setText(tuningNotes(reference));
            setEditing(true);
          } else {
            setEditing(false);
            onChange(presets[Number(v)].values);
          }
        }}
      >
        {allowAuto && <option value={AUTO}>Automática (según las notas)</option>}
        {presets.map((p, i) => (
          <option key={p.name} value={i}>
            {p.name}
            {originalTag(p.values)}
          </option>
        ))}
        {selected === CURRENT && value && (
          <option value={CURRENT}>
            {tuningNotes(value)}
            {originalTag(value)}
          </option>
        )}
        <option value={CUSTOM}>Personalizada…</option>
      </select>
      {editing && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="De grave a agudo: D A D G B E"
            aria-label="Afinación personalizada, de la cuerda más grave a la más aguda"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={!parseTuning(text, reference)}>
            Aplicar
          </button>
        </form>
      )}
    </div>
  );
}
