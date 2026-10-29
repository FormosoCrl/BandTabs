import { useMemo } from 'react';
import type { model } from '@coderline/alphatab';
import { buildChordSheet, joinSyllables } from '../lib/chordsheet';

interface Props {
  score: model.Score;
  barsPerLine?: number;
}

/** Vista de acordes sobre la letra, agrupada en líneas de compases. */
export function ChordSheetView({ score, barsPerLine = 4 }: Props) {
  const sheet = useMemo(() => buildChordSheet(score), [score]);
  const lines = useMemo(() => {
    const out = [];
    for (let i = 0; i < sheet.bars.length; i += barsPerLine) {
      const bars = sheet.bars.slice(i, i + barsPerLine);
      if (bars.some((b) => b.segments.length)) out.push(bars);
    }
    return out;
  }, [sheet, barsPerLine]);

  if (lines.length === 0) {
    return (
      <div className="chord-sheet empty-sheet">
        Esta canción no tiene acordes ni letra. Prueba con la vista de tablatura.
      </div>
    );
  }

  return (
    <div className="chord-sheet">
      {sheet.chords.length > 0 && (
        <p className="chord-list">
          Acordes:{' '}
          {sheet.chords.map((c) => (
            <span key={c} className="chord">
              {c}
            </span>
          ))}
        </p>
      )}
      {lines.map((bars) => (
        <div key={bars[0].index} className="sheet-line">
          {bars.map((bar) => (
            <span key={bar.index} className="sheet-bar">
              {joinSyllables(bar.segments).map((seg, i) => (
                <span key={i} className="sheet-seg">
                  <span className="chord">{seg.chord ?? ' '}</span>
                  {sheet.hasLyrics && <span className="lyric">{seg.text || ' '}</span>}
                </span>
              ))}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
