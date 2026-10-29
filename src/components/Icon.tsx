// Iconos propios a 16 px, de trazo, para que todos tengan el mismo peso visual.
const PATHS = {
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M5 3.5v9M11 3.5v9',
  stop: 'M4 4h8v8H4z',
  loop: 'M3 7V6a2 2 0 0 1 2-2h7l-2-2M13 9v1a2 2 0 0 1-2 2H4l2 2',
  star: 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6z',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  close: 'M4 4l8 8M12 4l-8 8',
  open: 'M2.5 4.5v8h11v-6h-6l-1.5-2z',
  link: 'M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.5.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.5-.5',
  fork: 'M6 2v5a2 2 0 0 0 4 0V2M8 9v5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  const solid = filled || name === 'play' || name === 'stop';
  return (
    <svg
      className="i"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.4 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
