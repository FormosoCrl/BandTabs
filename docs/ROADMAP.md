# BandTabs: roadmap

> Estado: **aprobado**. Fases 0 y 1 implementadas (octubre de 2026).
> Alcance actual: **solo app de PC**. Móvil y otras plataformas, más adelante.

BandTabs es una alternativa open source a Songsterr. El objetivo es cubrir tres cosas:

1. **Importar** tablaturas ya hechas y practicar con ellas.
2. **Transcribir** una canción desde un enlace de YouTube o Spotify (o un audio propio) a tabs de todos los instrumentos y de la canción completa.
3. **Paridad** con todas las funciones gratis y Plus de Songsterr, sin muros de pago.

---

## 1. Resumen de decisiones

| Tema | Propuesta |
|---|---|
| Plataforma inicial | App de escritorio para PC (Windows primero) con **Tauri 2**. Funciona sin conexión |
| Frontend | Vite + React + TypeScript |
| Motor de tablaturas | [alphaTab](https://alphatab.net) (MPL‑2.0): lee Guitar Pro 3‑7, GPX y MusicXML; dibuja tab y partitura; reproduce con sintetizador |
| Almacenamiento | IndexedDB en el navegador (con Dexie). Tus archivos no salen de tu equipo |
| Servicio de IA | Python + FastAPI en un contenedor Docker, que corre en tu PC (GPU opcional) |
| Otras plataformas | macOS y Linux salen casi gratis con Tauri. Android e iOS con Tauri Mobile, en una fase posterior |
| Licencia | GPL‑3.0 o posterior (protege que los forks sigan siendo abiertos). Se puede cambiar mientras no haya contribuciones externas |

Orden de trabajo: **Importar → Practicar (paridad Plus) → Exportar → Audio real sincronizado → Transcripción IA → Editor → Otras plataformas**. Lo explico en la sección 6.

---

## 2. Importar tablaturas existentes

Es lo primero porque da valor inmediato y apenas tiene riesgo técnico.

| Formato | Cómo |
|---|---|
| Guitar Pro (.gp3, .gp4, .gp5, .gpx, .gp) | Nativo en alphaTab |
| MusicXML (.xml, .musicxml, .mxl) | Nativo en alphaTab |
| alphaTex (texto) | Nativo en alphaTab |
| MIDI (.mid) | Convertir con `@tonejs/midi` al modelo de alphaTab y calcular cuerda/traste automáticamente |
| Tabs ASCII (las de Ultimate Guitar, etc.) | Parser propio: texto plano → modelo de alphaTab. Ritmo aproximado, porque el ASCII no lo indica |
| Acordes + letra (ChordPro) | Parser propio para la vista de acordes |

Además: arrastrar y soltar archivos, importar carpetas enteras, biblioteca local con búsqueda por artista, título, instrumento y afinación, favoritos y listas.

**Sobre el catálogo:** no vamos a alojar tablaturas de canciones comerciales, porque tienen derechos de autor (Songsterr paga licencias por ellas). BandTabs será un reproductor de *tus* archivos. Más adelante se puede añadir un catálogo comunitario solo con contenido de licencia libre o dominio público.

---

## 3. YouTube / Spotify a tabs: viabilidad

### 3.1 Respuesta corta

**Es viable, con dos matices.** La tecnología open source ya permite separar instrumentos y transcribir notas con calidad aceptable, pero el resultado es un *borrador* que hay que revisar (Songsterr también lo presenta así). Y hay límites legales para obtener el audio, sobre todo con Spotify.

### 3.2 Obtener el audio (aspectos legales)

| Fuente | Situación | Propuesta |
|---|---|---|
| **Archivo propio** (MP3, WAV, FLAC) | Sin problema | Camino principal y recomendado |
| **YouTube** | Los Términos de YouTube prohíben descargar contenido salvo que la plataforma lo permita. Herramientas como `yt-dlp` existen, pero usarlas es responsabilidad del usuario | Opción "avanzada" que se ejecuta en el equipo del usuario, nunca en un servidor nuestro. Aviso claro de que solo debe usarse con contenido que tenga derecho a usar |
| **Spotify** | El audio está cifrado con DRM y la API pública no entrega audio (solo metadatos; las previews de 30 s se retiraron en 2024). Saltarse el DRM vulnera sus términos y, en la UE, la protección legal de medidas tecnológicas | **No descargaremos audio de Spotify.** El enlace se usará para leer título, artista, duración y tempo, y con eso buscar la canción en YouTube o pedir al usuario el archivo |

Otros puntos:

- Que un usuario transcriba una canción para practicar en privado tiene poco riesgo. **Publicar** esas tabs es otra cosa: una transcripción es una obra derivada. Por eso las transcripciones serán privadas por defecto.
- Si algún día hay un servidor público que procese audio, conviene asesoría legal antes. Mientras todo corra en el PC del usuario, el riesgo para el proyecto es mucho menor.

### 3.3 Pipeline de transcripción

```
Audio ──► 1. Separar pistas ──► 2. Ritmo y tempo ──► 3. Notas por pista ──► 4. Asignar cuerda/traste ──► 5. Archivo Guitar Pro
                │                                         │
                └─► voz ──► letra (Whisper)               └─► acordes
```

| Paso | Modelos open source | Notas |
|---|---|---|
| 1. Separación de pistas | **Demucs v4** (`htdemucs_6s`: voz, batería, bajo, guitarra, piano y resto; MIT). **BS‑RoFormer / Mel‑RoFormer** vía `python-audio-separator` (MIT, mejor calidad en voz/batería/bajo) | Separar guitarra rítmica de solista sigue siendo difícil. Habrá que resolverlo después, por registro y patrón |
| 2. Tempo, compases y downbeats | **Beat This!** (2024, MIT), **madmom** (BSD) | Es la base para que el ritmo de la tab salga bien cuantizado |
| 3a. Notas (guitarra, bajo, piano, voz) | **Basic Pitch** de Spotify (Apache‑2.0, ligero y polifónico), **MT3** de Google (Apache‑2.0, multiinstrumento, más pesado) | Basic Pitch para empezar; MT3 como mejora |
| 3b. Batería | **ADTOF** (modelos entrenados para transcripción de batería), u **Omnizart** (MIT) | Salida: bombo, caja, charles, toms, platos |
| 3c. Acordes | **madmom** (reconocimiento de acordes), modelos tipo BTC | Para la vista de acordes |
| 3d. Letra | **Whisper** (MIT) sobre la pista de voz, con alineación por palabra | Opcional |
| 4. Cuerda y traste | Algoritmo propio de programación dinámica que minimiza saltos de la mano, con afinación y cejilla configurables. Más adelante, modelos tipo TabCNN | Es el paso que convierte notas en *tablatura* tocable |
| 5. Exportar | alphaTab (modelo → Guitar Pro 7) | Se abre directamente en BandTabs |

**Requisitos:** con GPU NVIDIA una canción tarda alrededor de 1 a 3 minutos; solo con CPU, del orden de 5 a 15 minutos. Son estimaciones y las mediremos. Los modelos ocupan unos pocos GB. Por eso el servicio de IA será un contenedor Docker separado, opcional.

**Calidad esperada:** buena para bajo, batería y partes de guitarra claras. Regular para guitarras distorsionadas con varias capas, solos rápidos y técnicas (bends, slides, palm mute), que habrá que corregir en el editor. Mismos ajustes que ofrece Songsterr: compás, anacrusa, tempo, tresillos, afinación y cejilla, manuales o automáticos.

---

## 4. Paridad con Songsterr (todo gratis)

Basado en el [informe de funciones de Songsterr](https://claude.ai/artifact/NupjaseB9bs5F2APme4EmS).

### Funciones gratis de Songsterr

| Función | Cómo la cubrimos | Fase |
|---|---|---|
| Ver tabs completos | alphaTab | 1 ✅ |
| Búsqueda y filtros (instrumento y afinación ✅; dificultad en fase 2) | Biblioteca local | 1 ✅ |
| Favoritos, historial, listas | IndexedDB | 1 ✅ |
| Reproducción sincronizada con cursor | alphaTab | 1 ✅ |
| Varias pistas y mezclador | alphaTab | 1 ✅ |
| Metrónomo y transposición | alphaTab | 2 |
| Vista tab, acordes (con cejilla) y letra | alphaTab + vista propia | 2 |
| Partitura estándar (en todas las plataformas, no solo web) | alphaTab | 1 ✅ |
| Afinador cromático | Micrófono + librería `pitchy` | 2 |
| Editor de tabs | Editor propio sobre alphaTab | 5 |
| Historial de revisiones | Versionado local de cada archivo | 5 |

### Funciones Plus de Songsterr

| Función | Cómo la cubrimos | Fase |
|---|---|---|
| Cambio de velocidad sin cambiar el tono | alphaTab (sintetizador); `rubberband-wasm` o SoundTouch para audio real | 2 / 3 |
| Loop de compases | alphaTab (selección de rango) | 2 |
| Solo y mute de pistas | alphaTab | 1 ✅ |
| Pitch shift del sintetizador | Transposición de reproducción en alphaTab | 2 |
| Cuenta atrás (count-in) | alphaTab | 2 |
| Sin anuncios | No habrá anuncios | — |
| Imprimir (completo, por página, alto contraste) | Impresión de alphaTab + tema de alto contraste | 2 |
| Descargar Guitar Pro y MIDI | Exportadores de alphaTab | 2 |
| Descargar MP3 / WAV | Renderizar el sintetizador a audio (WebAudio offline) | 2 |
| Audio original sincronizado sin cortes | Cargar el audio del usuario y alinearlo con la tab (marcas de sincronía, alineación automática con beat tracking) | 3 |
| Backing track (canción sin tu instrumento) | Separación de pistas: quitar la tuya del audio original | 4 |
| Transcripción IA completa | Pipeline de la sección 3, sin límite mensual | 4 |
| Offline real | App de escritorio; todo es local | 1 ✅ |

### Extras que Songsterr no tiene

- Detectar si tocas bien con el micrófono (modo práctica con puntuación). Fase 6.
- Practicar con tus propios archivos sin subirlos a ningún servidor.
- Exportar a MusicXML (alphaTab no lo exporta; habrá que escribir el exportador).

---

## 5. Arquitectura

```
┌───────────────────────────── Navegador / Tauri ─────────────────────────────┐
│  React UI ── alphaTab (render + sintetizador) ── WebAudio (audio real)       │
│      │                                                                       │
│  Biblioteca (IndexedDB) ── Importadores (GP, MusicXML, MIDI, ASCII, ChordPro)│
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ HTTP local (opcional)
┌──────────────▼──────────────── Servicio IA (Docker, en tu PC) ──────────────┐
│  FastAPI ── cola de trabajos ── Demucs/RoFormer ── Beat This! ── Basic Pitch │
│            ── ADTOF ── Whisper ── asignación cuerda/traste ── exportar GP    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Estructura del repositorio:

```
BandTabs/
├── src/                  # Interfaz React + alphaTab
│   ├── components/       # Biblioteca y reproductor
│   └── lib/              # Importación, biblioteca (IndexedDB), instrumentos
├── src-tauri/            # App de escritorio (Rust, Tauri 2)
├── tests/                # Tests con Vitest
├── services/transcriber/ # Python FastAPI + modelos (fase 4)
└── docs/
```

Los importadores nuevos (MIDI, ASCII, ChordPro) irán en `src/lib/importers/`. Si el proyecto crece se puede pasar a monorepo.

---

## 6. Fases y orden de implementación

Cada fase termina con algo usable.

### Fase 0: Fundaciones ✅
- Git, licencia GPL‑3.0, README.
- Tauri 2 + Vite + React + TypeScript, ESLint, Vitest.
- CI en GitHub Actions (lint, tipos, tests, build web y compilación de la app en Windows).

### Fase 1: Importar y reproducir (MVP) ✅
- Abrir archivos GP, MusicXML y alphaTex; arrastrar y soltar.
- Render de tablatura, reproducción con cursor, selección de pista y mezclador (volumen, mute, solo).
- Vistas de tablatura, partitura o ambas, y zoom.
- Biblioteca local: búsqueda, filtros por instrumento y afinación, favoritos, recientes, listas.
- App de escritorio sin conexión.
- **Resultado:** ya sustituye a Songsterr para tus propios archivos.

### Fase 2: Práctica y exportación (paridad Plus)
- Velocidad, loop, count-in, metrónomo, transposición y pitch shift.
- Vistas de acordes y letra.
- Afinador.
- Imprimir y exportar a GP, MIDI, MP3 y WAV.
- Importadores de MIDI, ASCII y ChordPro.
- **Resultado:** todo lo de Songsterr Plus salvo audio real e IA.

### Fase 3: Audio real sincronizado
- Cargar MP3/WAV propio y sincronizarlo con la tab (manual y automático).
- Cambio de velocidad sin cambiar tono sobre audio real.

### Fase 4: Transcripción con IA
1. Servicio Docker con separación de pistas (Demucs) y backing tracks.
2. Tempo y compases (Beat This!).
3. Bajo y batería (los que mejor salen), luego guitarra, piano y voz.
4. Asignación cuerda/traste y exportación a Guitar Pro.
5. Entrada por enlace de YouTube (local, opcional) y metadatos de Spotify.
6. Ajustes manuales: compás, anacrusa, tempo, tresillos, afinación, cejilla.

### Fase 5: Editor
- Editor de tabs con teclado (como Songsterr: flechas, 0‑9 para trastes).
- Corregir transcripciones de la IA.
- Historial de versiones.

### Fase 6: Otras plataformas y extras
- Que la app de escritorio lance el servicio de IA sin Docker.
- macOS, Linux, Android e iOS.
- Modo práctica con micrófono.
- Catálogo comunitario solo con contenido de licencia libre (opcional).

**Por qué este orden:** las fases 1 y 2 son casi todo trabajo de interfaz sobre una librería probada, y ya cubren lo que más molesta de Songsterr (velocidad, loop, solo, imprimir, descargar). La IA es la parte más incierta y pesada, así que va después, cuando el reproductor donde se verán sus resultados ya existe. El editor va detrás de la IA porque su uso principal será corregir transcripciones.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Calidad de la transcripción insuficiente en guitarras complejas | Presentarla como borrador editable; empezar por bajo y batería; poder cambiar de modelo |
| Descarga de YouTube bloqueada o legalmente delicada | Archivo propio como camino principal; YouTube solo en local y opcional |
| Spotify no entrega audio | Solo metadatos; buscar en YouTube o pedir archivo |
| alphaTab no cubre algo (exportar MusicXML, importar MIDI) | Escribir esos conversores en `packages/importers` |
| Requisitos de hardware de la IA | Servicio opcional; modelos ligeros por defecto (Basic Pitch) |

---

## 8. Siguiente paso

Fase 2: herramientas de práctica (velocidad, loop, count-in, metrónomo), impresión y exportación.
