# BandTabs

Alternativa open source a Songsterr: una app de PC para abrir tus tablaturas, verlas y escucharlas
sin muros de pago. Tus archivos se guardan solo en tu equipo.

> Estado: primera versión (fases 0 y 1 del [roadmap](docs/ROADMAP.md)).

## Qué hace ya

- **Importa** archivos Guitar Pro (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`), MusicXML (`.xml`,
  `.musicxml`, `.mxl`) y alphaTex (`.atex`), con el botón o arrastrándolos a la ventana.
- **Muestra** tablatura, partitura o ambas, con zoom.
- **Reproduce** la canción con un cursor que sigue la partitura. Barra espaciadora para
  reproducir o pausar.
- **Mezclador** por pista: volumen, silenciar (M) y solo (S). Puedes ver una pista o todas.
- **Biblioteca** local con búsqueda (sin importar tildes), filtros por instrumento y afinación,
  favoritas, recientes y listas.

Lo siguiente (velocidad, loop, metrónomo, imprimir, exportar, transcripción con IA…) está en el
[roadmap](docs/ROADMAP.md).

## Arrancar la app en Windows

### 1. Requisitos (una sola vez)

1. **Node.js 22 LTS** o superior: <https://nodejs.org>.
2. **Microsoft C++ Build Tools**: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>.
   En el instalador marca **"Desarrollo para el escritorio con C++"**.
3. **Rust**: instala `rustup` desde <https://rustup.rs> y acepta las opciones por defecto.
4. **WebView2** ya viene con Windows 10 y 11.

Cierra y vuelve a abrir la terminal después de instalar todo.

### 2. Instalar dependencias

```powershell
cd C:\Users\formo\Desktop\Repositorios\Apps\BandTabs
npm install
```

### 3. Abrir la app en modo desarrollo

```powershell
npm run app
```

La primera vez tarda unos minutos porque compila la parte de Rust. Después es casi inmediato, y
los cambios en `src/` se ven al momento.

### 4. Crear el instalador

```powershell
npm run app:build
```

El instalador queda en `src-tauri\target\release\bundle\nsis\` (`.exe`) y en
`src-tauri\target\release\bundle\msi\` (`.msi`).

### Solo la interfaz, en el navegador

`npm run dev` y abre <http://localhost:1420>. Útil para trabajar en la interfaz sin compilar Rust.

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm run app` | App de escritorio en modo desarrollo |
| `npm run app:build` | Instalador para Windows |
| `npm run dev` | Interfaz en el navegador |
| `npm test` | Tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | Comprobación de tipos |

Estructura:

```
src/
  App.tsx                 Ventana principal, importación y arrastrar y soltar
  components/Player.tsx   Visor y reproductor (alphaTab)
  components/LibraryPanel.tsx  Biblioteca, filtros y listas
  lib/importer.ts         Lee archivos y extrae título, artista y pistas
  lib/library.ts          Biblioteca sobre IndexedDB (Dexie)
  lib/instruments.ts      Clasifica pistas y describe afinaciones
src-tauri/                App de escritorio (Tauri 2, Rust)
tests/                    Tests
docs/ROADMAP.md           Plan por fases
```

## Créditos

- [alphaTab](https://alphatab.net) (MPL‑2.0) dibuja y reproduce las tablaturas.
- Fuente musical Bravura (SIL OFL) y soundfont Sonivox, incluidos con alphaTab.
- [Tauri](https://tauri.app), [React](https://react.dev) y [Dexie](https://dexie.org).

## Licencia

[GPL‑3.0 o posterior](LICENSE). Puedes usar, estudiar, modificar y compartir BandTabs; las
versiones modificadas que distribuyas también deben ser libres.
