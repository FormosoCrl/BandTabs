import { describe, expect, it } from 'vitest';
import { importer } from '@coderline/alphatab';
import { buildChordSheet, joinSyllables } from '../src/lib/chordsheet';

const TEX = `\\title "Acordes"
.
\\track "Voz y guitarra"
\\staff {tabs} \\tuning e4 b3 g3 d3 a2 e2
\\lyrics "Ho-la mun-do que tal"
:4 (0.1 1.2 2.3 2.4 0.5){ch "Am"} 0.1 0.1 0.1 | (0.1 1.2 0.3 2.4 3.5){ch "C"} 0.1 (0.1 0.2 0.3 2.4 2.5 0.6){ch "Em"} 0.1 |
`;

describe('buildChordSheet', () => {
  it('ordena acordes y letra por compás', () => {
    const sheet = buildChordSheet(importer.ScoreLoader.loadAlphaTex(TEX));
    expect(sheet.chords).toEqual(['Am', 'C', 'Em']);
    expect(sheet.hasLyrics).toBe(true);
    expect(sheet.bars[0].segments).toEqual([
      { chord: 'Am', text: 'Ho-' },
      { chord: null, text: 'la' },
      { chord: null, text: 'mun-' },
      { chord: null, text: 'do' },
    ]);
    expect(sheet.bars[1].segments).toEqual([
      { chord: 'C', text: 'que' },
      { chord: null, text: 'tal' },
      { chord: 'Em', text: '' },
    ]);
  });

  it('une las sílabas partidas con guion', () => {
    const joined = joinSyllables([
      { chord: 'Am', text: 'Ho-' },
      { chord: null, text: 'la' },
    ]);
    expect(joined.map((s) => s.text).join('')).toBe('Hola ');
  });
});
