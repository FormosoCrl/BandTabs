export interface SaveFilter {
  name: string;
  extensions: string[];
}

const isTauri = () => '__TAURI_INTERNALS__' in window;

/**
 * Guarda un archivo generado. En la app de escritorio abre el diálogo de "Guardar como" del
 * sistema; en el navegador lo descarga. Devuelve false si el usuario cancela.
 */
export async function saveFile(
  suggestedName: string,
  data: Uint8Array,
  filter: SaveFilter,
): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const path = await save({ defaultPath: suggestedName, filters: [filter] });
    if (!path) return false;
    await writeFile(path, data);
    return true;
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Nombre de archivo seguro en Windows a partir del título de la canción. */
export function safeFileName(title: string): string {
  const clean = [...title].filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch));
  return clean.join('').trim().slice(0, 120) || 'cancion';
}
