import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player } from './components/Player';
import { LibraryPanel } from './components/LibraryPanel';
import { Tuner } from './components/Tuner';
import { db, type Song } from './lib/db';
import { Library, type ImportResult } from './lib/library';
import { ACCEPTED_EXTENSIONS } from './lib/formats';
import { DEMO_ALPHATEX, DEMO_FILE_NAME } from './lib/demo';

interface OpenSong {
  song: Song;
  data: Uint8Array;
}

async function readFiles(files: FileList | File[]) {
  return Promise.all(
    Array.from(files).map(async (file) => ({
      name: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

function summarize(result: ImportResult): string {
  const parts: string[] = [];
  if (result.added.length === 1) parts.push(`Importada «${result.added[0].title}».`);
  else if (result.added.length > 1) parts.push(`Importadas ${result.added.length} canciones.`);
  if (result.failed.length) {
    parts.push(
      `No se pudieron importar ${result.failed.length}: ${result.failed
        .map((f) => f.fileName)
        .join(', ')}.`,
    );
  }
  return parts.join(' ');
}

export function App() {
  const library = useMemo(() => new Library(db), []);
  const [current, setCurrent] = useState<OpenSong | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const open = useCallback(
    async (id: number) => {
      const opened = await library.open(id);
      if (opened) setCurrent(opened);
    },
    [library],
  );

  const importFiles = useCallback(
    async (files: { name: string; data: Uint8Array }[]) => {
      if (files.length === 0) return;
      const result = await library.importFiles(files);
      setNotice(summarize(result));
      if (result.added.length > 0) await open(result.added[0].id);
    },
    [library, open],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Arrastrar y soltar en toda la ventana. En Tauri está activado con dragDropEnabled: false.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      await importFiles(await readFiles(e.dataTransfer!.files));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  const importDemo = () =>
    importFiles([{ name: DEMO_FILE_NAME, data: new TextEncoder().encode(DEMO_ALPHATEX) }]);

  return (
    <div className="app">
      <LibraryPanel
        library={library}
        activeSongId={current?.song.id ?? null}
        onOpen={open}
        onImportClick={() => fileInputRef.current?.click()}
        onTunerClick={() => setTunerOpen(true)}
        onRemoved={(id) => {
          if (current?.song.id === id) setCurrent(null);
        }}
      />
      <main className="main">
        {current ? (
          <Player
            key={current.song.id}
            song={current.song}
            data={current.data}
            onNotice={setNotice}
          />
        ) : (
          <div className="welcome">
            <h1>Tus tablaturas, sin muros de pago</h1>
            <p>
              Importa archivos Guitar Pro (.gp, .gp3, .gp4, .gp5, .gpx), MusicXML o alphaTex. Se
              guardan solo en este equipo.
            </p>
            <div className="welcome-actions">
              <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
                Importar archivos
              </button>
              <button className="btn" onClick={importDemo}>
                Probar con un ejemplo
              </button>
            </div>
            <p className="hint">También puedes arrastrar archivos a cualquier parte de la ventana.</p>
          </div>
        )}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (files) await importFiles(await readFiles(files));
          e.target.value = '';
        }}
      />

      {tunerOpen && <Tuner onClose={() => setTunerOpen(false)} />}
      {dragging && (
        <div className="drop-overlay">
          <div>Suelta los archivos para añadirlos a tu biblioteca</div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
