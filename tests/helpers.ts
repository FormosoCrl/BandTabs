import { exporter, importer, Settings } from '@coderline/alphatab';
import { DEMO_ALPHATEX } from '../src/lib/demo';

export const encode = (text: string) => new TextEncoder().encode(text);

/** Genera un .gp real a partir de alphaTex para probar la ruta de Guitar Pro. */
export function makeGuitarPro(tex: string = DEMO_ALPHATEX): Uint8Array {
  const score = importer.ScoreLoader.loadAlphaTex(tex);
  return new exporter.Gp7Exporter().export(score, new Settings());
}

export const DROP_D_TEX = `\\title "Drop D" \\artist "Ñandú"
.
\\track "Rítmica" \\instrument 30
\\staff {tabs} \\tuning e4 b3 g3 d3 a2 d2
:4 0.6 0.6 0.6 0.6 |
\\track "Batería" \\instrument percussion
\\staff {score}
:4 36 38 36 38 |
`;
