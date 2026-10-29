import type { model } from '@coderline/alphatab';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Símbolos SMuFL de la clave "TAB" de 6 y de 4 cuerdas que dibuja alphaTab.
const TAB_CLEF = /[]/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MARK = 'bt-string-label';

/** Líneas del pentagrama de tablatura alrededor de la clave: las rayas horizontales finas. */
function staffLines(svg: SVGSVGElement, cx: number, cy: number): number[] {
  const ys = new Set<number>();
  for (const rect of svg.querySelectorAll('rect')) {
    const h = Number(rect.getAttribute('height'));
    const w = Number(rect.getAttribute('width'));
    const x = Number(rect.getAttribute('x'));
    if (h > 0 && h < 3 && w > 8 && x <= cx) ys.add(Math.round((Number(rect.getAttribute('y')) + h / 2) * 100) / 100);
  }
  const sorted = [...ys].sort((a, b) => a - b);
  // Las líneas forman un bloque con la misma separación que contiene la clave.
  const above = sorted.filter((y) => y <= cy);
  const below = sorted.filter((y) => y > cy);
  if (!above.length || !below.length) return [];
  const block = [above[above.length - 1], below[0]];
  const gap = block[1] - block[0];
  for (let i = above.length - 2; i >= 0 && Math.abs(block[0] - above[i] - gap) < 0.6; i--) block.unshift(above[i]);
  for (let i = 1; i < below.length && Math.abs(below[i] - block[block.length - 1] - gap) < 0.6; i++) block.push(below[i]);
  return block;
}

/**
 * Sustituye la clave "TAB" del principio de cada línea por el nombre de la nota al aire de cada
 * cuerda, como hace Songsterr (D A D G B E de abajo arriba en Drop D). alphaTab no tiene esta
 * opción, así que se dibuja sobre el SVG que genera, después de cada render.
 */
export function labelTabStrings(host: HTMLElement, tracks: model.Track[]) {
  const tabStaves = tracks
    .map((t) => t.staves[0])
    .filter((s) => s && s.isStringed && !s.track.isPercussion && s.showTablature);
  if (!tabStaves.length) return;

  host.querySelectorAll(`.${MARK}`).forEach((el) => el.remove());
  const clefs = [...host.querySelectorAll('svg text')].filter((t) => TAB_CLEF.test(t.textContent ?? ''));
  clefs.forEach((text, i) => {
    const group = text.parentElement;
    const svg = (text as SVGTextElement).ownerSVGElement;
    const match = group?.getAttribute('transform')?.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
    if (!group || !svg || !match) return;
    const cx = Number(match[1]);
    const cy = Number(match[2]);
    const lines = staffLines(svg, cx, cy);
    const staff = tabStaves[i % tabStaves.length];
    const tuning = staff.tuning;
    if (lines.length !== tuning.length) return;

    const gap = lines[1] - lines[0];
    const size = gap * 0.95;
    (text as SVGTextElement).style.opacity = '0';
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', MARK);
    lines.forEach((y, s) => {
      const name = NOTE_NAMES[((tuning[s] % 12) + 12) % 12];
      const width = size * (name.length > 1 ? 1.25 : 0.8);
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', String(cx - width / 2 - 1));
      bg.setAttribute('y', String(y - size / 2));
      bg.setAttribute('width', String(width + 2));
      bg.setAttribute('height', String(size));
      bg.setAttribute('fill', '#ffffff');
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(y));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('font-family', 'system-ui, "Segoe UI", sans-serif');
      label.setAttribute('font-size', String(size));
      label.setAttribute('font-weight', '600');
      label.setAttribute('fill', '#1f1d1a');
      label.textContent = name;
      layer.append(bg, label);
    });
    svg.append(layer);
  });
}
