import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer } from '@coderline/alphatab';
import { transcriptionToAlphaTex, type EngineResult } from '../src/lib/importers/transcription';

// Solo en la acción "Engine": comprueba que un resultado real del motor se convierte en una
// partitura válida.
const path = process.env.ENGINE_RESULT;

describe.skipIf(!path)('resultado real del motor', () => {
  it('se convierte en una partitura con pistas y compases', () => {
    const result = JSON.parse(readFileSync(path!, 'utf8')) as EngineResult;
    const score = importer.ScoreLoader.loadAlphaTex(transcriptionToAlphaTex(result));
    console.log(
      JSON.stringify({
        tempo: result.tempo,
        tracks: result.tracks.map((t) => [t.name, t.notes.length]),
        drums: result.drums.length,
        chords: result.chords.map((c) => c.name).slice(0, 12),
        words: result.lyrics.words.length,
        bars: score.masterBars.length,
      }),
    );
    expect(score.tracks.length).toBeGreaterThan(0);
    expect(score.masterBars.length).toBeGreaterThan(2);
  });
});
