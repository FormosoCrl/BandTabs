# BandTabs

Alternativa open source a Songsterr: una app de PC para abrir tus tablaturas, verlas y escucharlas
sin muros de pago. Tus archivos se guardan solo en tu equipo.

> Estado: primera versión (fases 0 y 1 del [roadmap](docs/ROADMAP.md)).

## Qué hace ya

- **Importa** archivos Guitar Pro (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`), MusicXML (`.xml`,
  `.musicxml`, `.mxl`), MIDI (`.mid`), tabs en texto copiadas de webs (`.txt`, `.tab`) y alphaTex
  (`.atex`), con el botón o arrastrándolos a la ventana. En MIDI y texto calcula cuerda y traste,
  y en las tabs de texto estima el ritmo, que esas tabs no indican.
- **Muestra** tablatura, partitura, ambas, o acordes con la letra, con zoom.
- **Reproduce** la canción con un cursor que sigue la partitura (barra espaciadora).
- **Práctica**: velocidad del 25 al 150 % sin cambiar el tono, repetir unos compases (arrastra
  sobre la partitura y pulsa Repetir o la tecla L), cuenta atrás, metrónomo y tono de −12 a +12
  semitonos.
- **Mezclador** por pista: volumen, silenciar (M) y solo (S). Puedes ver una pista o todas.
- **Exporta** a Guitar Pro, MIDI y WAV, e **imprime** la partitura.
- **Afinador** con el micrófono para guitarra, bajo y ukelele.
- **Biblioteca** local con búsqueda (sin importar tildes), filtros por instrumento y afinación,
  favoritas, recientes y listas.

Lo siguiente (audio original sincronizado, transcripción con IA, editor…) está en el
[roadmap](docs/ROADMAP.md).

## Instalar BandTabs

1. Entra en [Releases](https://github.com/FormosoCrl/BandTabs/releases/latest).
2. Descarga `BandTabs_X.Y.Z_x64-setup.exe`.
3. Ábrelo. Se instala sin pedir permisos de administrador y queda en el menú Inicio.

No hace falta instalar nada más: el instalador trae todo lo necesario. Si Windows SmartScreen
avisa de que la app no es conocida, pulsa **Más información → Ejecutar de todas formas** (pasa
con cualquier app nueva que no tiene firma de pago).

## Trabajar en el código (Windows)

Haz doble clic en **`iniciar.cmd`**. La primera vez instala por ti Node.js, Rust y las
herramientas de C++ de Microsoft (con `winget`), descarga las dependencias del proyecto y abre la
app. Las siguientes veces la abre directamente.

Para generar tú mismo el instalador: `npm run app:build`. Queda en
`src-tauri\target\release\bundle\nsis\`.

Para publicar una versión nueva: en GitHub, **Actions → Release → Run workflow**, escribe la
versión (p. ej. `0.3.0`) y espera unos 15 minutos. También vale subir una etiqueta `vX.Y.Z`. La
acción compila el instalador
y lo publica en Releases.

Para trabajar solo en la interfaz, en el navegador: `npm run dev` y abre <http://localhost:1420>.

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm run app` | App de escritorio en modo desarrollo |
| `npm run app:build` | Instalador para Windows |
| `iniciar.cmd` | Instala requisitos y abre la app (Windows) |
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
