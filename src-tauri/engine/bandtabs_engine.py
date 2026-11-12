"""Motor de transcripción de BandTabs.

Lo lanza la app de escritorio con el Python que instala la primera vez. Escribe una línea JSON por
evento en stdout para que la app muestre el progreso:

    {"type": "progress", "step": "separate", "progress": 0.4, "message": "..."}
    {"type": "done", "result": "C:/.../result.json"}
    {"type": "error", "message": "..."}

Uso:
    python bandtabs_engine.py check
    python bandtabs_engine.py transcribe --source URL_O_ARCHIVO --work CARPETA [--no-lyrics] [--guitars N]
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import os
import re
import subprocess
import sys
import traceback
import urllib.request
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
logging.disable(logging.WARNING)

SAMPLE_RATE = 44100
MAX_DURATION_S = 15 * 60

STEPS = {
    # paso: (inicio, fin) dentro de la barra de progreso total
    "download": (0.00, 0.12),
    "separate": (0.12, 0.62),
    "drums": (0.62, 0.64),
    "rhythm": (0.64, 0.68),
    "notes": (0.68, 0.86),
    "chords": (0.86, 0.88),
    "lyrics": (0.88, 1.00),
}


def emit(kind: str, **data) -> None:
    sys.stdout.write(json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(step: str, fraction: float, message: str) -> None:
    start, end = STEPS[step]
    emit("progress", step=step, progress=round(start + (end - start) * fraction, 4), message=message)


class UserError(Exception):
    """Error con un mensaje pensado para mostrarse tal cual al usuario."""


# --------------------------------------------------------------------------- audio de entrada

YOUTUBE_RE = re.compile(r"^https?://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/", re.I)
SPOTIFY_RE = re.compile(r"^https?://open\.spotify\.com/(intl-[a-z]+/)?track/([A-Za-z0-9]+)", re.I)


def ffmpeg_exe() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_spotify_page(page: str) -> dict:
    """Saca título y artista de las etiquetas públicas de la página de una canción de Spotify."""

    def meta(name: str) -> str | None:
        m = re.search(
            rf'<meta[^>]+(?:property|name)="{re.escape(name)}"[^>]+content="([^"]*)"', page
        ) or re.search(rf'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="{re.escape(name)}"', page)
        return html.unescape(m.group(1)).strip() if m else None

    title = meta("og:title")
    artist = meta("music:musician_description")
    description = meta("og:description") or ""
    if not artist:
        # "Canción · Artista · 2019" o "Listen to X on Spotify. Song · Artist · 2019."
        parts = [p.strip(" .") for p in description.split("·")]
        if len(parts) >= 3:
            artist = parts[-2]
    if not title:
        raise UserError("No he podido leer la canción de ese enlace de Spotify.")
    return {"title": title, "artist": artist or ""}


VIDEO_GONE = ("video unavailable", "private video", "not available", "has been removed", "members-only")
OFFLINE = ("getaddrinfo", "name resolution", "urlopen error", "timed out", "connection refused", "network is unreachable")


def friendly_error(error: BaseException) -> str | None:
    """Mensaje para el usuario de los fallos más habituales, o None si no se reconoce."""
    text = str(error).lower()
    if isinstance(error, MemoryError) or "not enough memory" in text or "defaultcpuallocator" in text:
        return "No hay memoria suficiente para analizar esta canción. Cierra otros programas o prueba con una más corta."
    if "sign in to confirm" in text or "not a bot" in text:
        return "YouTube ha bloqueado la descarga. Prueba más tarde o usa un archivo de audio."
    if any(clue in text for clue in VIDEO_GONE):
        return "Ese vídeo no está disponible (es privado, se ha borrado o está bloqueado en tu país)."
    if any(clue in text for clue in OFFLINE):
        return "No se pudo conectar. Comprueba la conexión a internet y vuelve a intentarlo."
    return None


def update_downloader() -> bool:
    """
    Actualiza yt-dlp en el Python del motor. YouTube cambia a menudo y las versiones viejas dejan
    de poder descargar, así que se prueba esto antes de dar la descarga por imposible.
    """
    progress("download", 0.02, "Actualizando el descargador de YouTube…")
    try:
        done = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "--quiet", "--only-binary", ":all:",
             "--disable-pip-version-check", "--no-warn-script-location", "yt-dlp", "yt-dlp-ejs"],
            capture_output=True,
            timeout=300,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if done.returncode != 0:
        return False
    for name in [m for m in sys.modules if m == "yt_dlp" or m.startswith("yt_dlp.")]:
        del sys.modules[name]
    return True


def download_audio(query: str, work: Path) -> dict:
    try:
        return download_audio_once(query, work)
    except UserError:
        raise
    except Exception as error:  # noqa: BLE001
        # Sin conexión o con el vídeo borrado, actualizar no arregla nada.
        if friendly_error(error) and "bloqueado la descarga" not in friendly_error(error):
            raise
        print(f"Falló la descarga, se prueba a actualizar yt-dlp: {error!r}", file=sys.stderr)
        if not update_downloader():
            raise
        return download_audio_once(query, work)


def download_audio_once(query: str, work: Path) -> dict:
    import yt_dlp

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progress("download", min(1.0, d.get("downloaded_bytes", 0) / total), "Descargando audio…")

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(work / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": ffmpeg_exe(),
        "progress_hooks": [hook],
        "match_filter": yt_dlp.utils.match_filter_func(f"duration < {MAX_DURATION_S}"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(query, download=True)
    if info and info.get("entries"):
        info = info["entries"][0]
    if not info:
        raise UserError("No se encontró el vídeo.")
    wav = work / "source.wav"
    if not wav.exists():
        raise UserError("No se pudo descargar el audio (¿vídeo demasiado largo o no disponible?).")
    return {
        "title": info.get("track") or info.get("title") or "Sin título",
        "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "",
        "path": wav,
        "url": info.get("webpage_url"),
    }


def resolve_source(source: str, work: Path) -> dict:
    if os.path.isfile(source):
        progress("download", 1, "Usando archivo local")
        return {"title": Path(source).stem, "artist": "", "path": Path(source), "url": None}
    if SPOTIFY_RE.match(source):
        progress("download", 0, "Leyendo la canción en Spotify…")
        meta = parse_spotify_page(fetch_text(source))
        query = f"ytsearch1:{meta['artist']} {meta['title']} audio".strip()
        progress("download", 0.05, f"Buscando «{meta['title']}» en YouTube…")
        found = download_audio(query, work)
        return {**found, "title": meta["title"], "artist": meta["artist"] or found["artist"]}
    if YOUTUBE_RE.match(source):
        progress("download", 0, "Conectando con YouTube…")
        return download_audio(source, work)
    raise UserError("Pega un enlace de YouTube o de Spotify, o elige un archivo de audio.")


def load_audio(path: Path, sample_rate: int = SAMPLE_RATE):
    """Decodifica cualquier formato con ffmpeg a float32 estéreo, forma (2, n)."""
    import numpy as np

    command = [
        ffmpeg_exe(), "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", str(sample_rate), "-",
    ]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()
    if audio.shape[1] < sample_rate:
        raise UserError("El audio es demasiado corto.")
    if audio.shape[1] > MAX_DURATION_S * sample_rate:
        raise UserError("La canción dura más de 15 minutos.")
    return audio


# --------------------------------------------------------------------------- análisis

def overlap_add(wav, chunk: int, overlap: int, run):
    """
    Procesa `wav` (canales, muestras) por trozos de `chunk` muestras que se pisan `overlap` y los
    une con un fundido, para que no quede un salto en cada unión (que la transcripción tomaría por
    notas). `run(trozo, fracción_hecha)` devuelve (fuentes, canales, muestras) de ese trozo.
    Por trozos también se puede informar del avance.
    """
    import torch

    total = wav.shape[-1]
    step = chunk - overlap
    out = None
    start = 0
    while True:
        piece = wav[..., start : start + chunk]
        n = piece.shape[-1]
        last = start + chunk >= total
        result = run(piece, 1.0 if last else (start + chunk) / total)
        weight = torch.ones(n)
        fade = min(overlap, n)
        if start > 0:
            weight[:fade] = torch.linspace(0, 1, fade + 2)[1:-1]
        if not last:
            weight[-fade:] = torch.linspace(1, 0, fade + 2)[1:-1]
        if out is None:
            out = torch.zeros(*result.shape[:-1], total)
            norm = torch.zeros(total)
        out[..., start : start + n] += result.cpu() * weight
        norm[start : start + n] += weight
        if last:
            break
        start += step
    return out / norm.clamp(min=1e-8)


def separate(audio, work: Path) -> dict[str, Path]:
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    progress("separate", 0, "Preparando el separador de instrumentos (la primera vez se descarga)…")
    model = get_model("htdemucs_6s")
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    wav = torch.from_numpy(audio)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    progress("separate", 0.05, "Separando instrumentos… (puede tardar varios minutos)")

    def run(piece, done: float):
        with torch.no_grad():
            out = apply_model(model, ((piece - mean) / std)[None], device=device, split=True, overlap=0.25, progress=False)[0]
        progress("separate", 0.05 + 0.95 * done, "Separando instrumentos…")
        return out * std + mean

    sources = overlap_add(wav, SAMPLE_RATE * 30, SAMPLE_RATE, run).cpu().numpy()

    stems_dir = work / "stems"
    stems_dir.mkdir(exist_ok=True)
    stems = {}
    for name, data in zip(model.sources, sources):
        path = stems_dir / f"{name}.wav"
        sf.write(path, np.clip(data.T, -1, 1), SAMPLE_RATE, subtype="PCM_16")
        stems[name] = path
    return stems


def rms(path: Path) -> float:
    import numpy as np
    import soundfile as sf

    data, _ = sf.read(path, dtype="float32")
    return float(np.sqrt(np.mean(np.square(data)))) if data.size else 0.0


def tempo_factor(period: float, drums: list[dict] | None) -> float:
    """
    Por cuánto hay que multiplicar la distancia entre tiempos que da librosa (0,5, 1 o 2), que a
    veces cuenta corcheas como tiempos o al revés. La caja suele ir en los tiempos 2 y 4, así que
    entre dos golpes de caja hay dos tiempos. Sin batería clara: por encima de 160 BPM se supone
    que librosa ha contado el doble.
    """
    import numpy as np

    snare = sorted({hit["time"] for hit in drums or [] if hit["piece"] == "snare"})
    gaps = np.diff(snare)
    gaps = gaps[(gaps > 0.2) & (gaps < 4.0)]
    if len(gaps) >= 8:
        typical = float(np.median(gaps))
        if np.mean(np.abs(gaps - typical) <= 0.1 * typical) >= 0.5:
            options = [f for f in (0.5, 1.0, 2.0) if 45 <= 60 / (period * f) <= 215]
            if options:
                return min(options, key=lambda f: abs(np.log(period * f / (typical / 2))))
    return 2.0 if 60 / period > 160 else 1.0


def analyze_rhythm(audio, stems: dict[str, Path] | None, drums: list[dict] | None = None) -> dict:
    import librosa
    import numpy as np

    progress("rhythm", 0, "Buscando el tempo y los compases…")
    mono = librosa.resample(audio.mean(0), orig_sr=SAMPLE_RATE, target_sr=22050)
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=22050, units="frames", tightness=120)
    tempo = float(np.atleast_1d(tempo)[0])

    if len(beat_frames) >= 16:
        factor = tempo_factor(float(np.median(np.diff(librosa.frames_to_time(beat_frames, sr=22050)))), drums)
        if factor == 2.0:
            # Uno de cada dos tiempos: el que más coincide con golpes fuertes.
            envelope = librosa.onset.onset_strength(y=mono, sr=22050)
            strength = envelope[np.minimum(beat_frames, len(envelope) - 1)]
            offset = int(np.argmax([strength[0::2].mean(), strength[1::2].mean()]))
            beat_frames = beat_frames[offset::2]
        elif factor == 0.5:
            # Faltan tiempos: se añade uno en medio de cada dos.
            middle = (beat_frames[:-1] + beat_frames[1:]) // 2
            beat_frames = np.sort(np.concatenate([beat_frames, middle]))
        tempo /= factor
    beats = librosa.frames_to_time(beat_frames, sr=22050)

    # El primer tiempo de cada compás suele coincidir con el bombo y el bajo, y con los cambios
    # de acorde.
    phase = 0
    if stems and "drums" in stems and len(beat_frames) >= 8:
        low, _ = librosa.load(stems["drums"], sr=22050, mono=True)
        bass, _ = librosa.load(stems["bass"], sr=22050, mono=True)
        size = min(len(low), len(bass))
        envelope = librosa.onset.onset_strength(y=low[:size] + bass[:size], sr=22050, fmax=200)
        strength = envelope[np.minimum(beat_frames, len(envelope) - 1)]
        chroma = librosa.util.sync(
            librosa.feature.chroma_stft(y=bass[:size], sr=22050, n_fft=4096, hop_length=512),
            beat_frames,
            aggregate=np.median,
        )[:, 1:]  # sync añade el tramo anterior al primer tiempo
        unit = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-9)
        change = np.concatenate([[0.0], 1 - np.sum(unit[:, 1:] * unit[:, :-1], axis=0)])
        change = np.pad(change, (0, max(0, len(strength) - len(change))))[: len(strength)]

        def by_phase(values) -> np.ndarray:
            means = np.array([values[p::4].mean() for p in range(4)])
            return means / (means.max() + 1e-9)

        phase = int(np.argmax(by_phase(strength) + by_phase(change)))
    # El tempo que da librosa sale de una tabla de valores fijos; la distancia real entre los
    # tiempos detectados es más exacta.
    if len(beats) >= 4:
        gaps = np.diff(beats)
        typical = np.median(gaps)
        tempo = 60.0 / float(gaps[np.abs(gaps - typical) <= 0.2 * typical].mean())
    progress("rhythm", 1, f"Tempo aproximado: {round(tempo)} BPM")
    return {"tempo": tempo, "beats": [round(float(b), 4) for b in beats], "downbeat": phase, "beatsPerBar": 4}


NOTE_RANGES = {
    # stem: (instrumento, programa MIDI, Hz mínimo, Hz máximo, monofónico)
    # Guitarra desde Do2 para que entren Drop D, Drop C y similares.
    "guitar": ("guitar", 29, 64, 1400, False),
    # Por encima de Mi4 en el bajo casi todo son armónicos de la nota real.
    "bass": ("bass", 33, 28, 350, True),
    "piano": ("piano", 0, 27, 4200, False),
    "vocals": ("vocals", 54, 75, 1100, True),
}

# Una pista con menos de esta parte del volumen de la más fuerte se da por vacía.
QUIET_STEM = 0.08

TRACK_NAMES = {"guitar": "Guitarra", "bass": "Bajo", "piano": "Piano", "vocals": "Voz"}


def monophonic(notes: list[dict]) -> list[dict]:
    """Deja una nota cada vez: si se pisan, gana la más fuerte y la otra se corta."""
    out: list[dict] = []
    for note in sorted(notes, key=lambda n: (n["start"], -n["velocity"])):
        if out and note["start"] < out[-1]["end"] - 0.03:
            if note["velocity"] <= out[-1]["velocity"]:
                continue
            out[-1]["end"] = note["start"]
        out.append(note)
    return [n for n in out if n["end"] - n["start"] > 0.05]


def transcribe_monophonic(path: Path, fmin: float, fmax: float, sr: int = 11025) -> list[dict]:
    """
    Transcribe un instrumento que da una nota cada vez siguiendo su frecuencia fundamental (pYIN).
    Para el bajo acierta la octava mucho mejor que Basic Pitch, que por debajo de Mi1 suele dar
    la octava de arriba. Las notas repetidas se separan por los ataques.
    """
    import librosa
    import numpy as np
    import scipy.signal

    y, _ = librosa.load(path, sr=sr, mono=True)
    hop, frame = 128, 2048
    # Solo hace falta saber el semitono: con pasos de un cuarto de semitono va cinco veces más
    # rápido que con la resolución por defecto y acierta igual.
    f0, voiced, _ = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, frame_length=frame, hop_length=hop, resolution=0.25
    )
    pitch = np.where(voiced, np.round(librosa.hz_to_midi(np.where(voiced, f0, 440.0))), -1)
    pitch = scipy.signal.medfilt(pitch, 5).astype(int)
    level = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0][: len(pitch)]
    pitch = pitch[: len(level)]
    peak = float(np.percentile(level, 95)) + 1e-9
    pitch = np.where(level > max(1e-4, peak * 0.06), pitch, -1)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, backtrack=False, delta=0.1)
    is_onset = np.zeros(len(pitch) + 1, dtype=bool)
    is_onset[onsets[onsets < len(pitch)]] = True

    seconds = hop / sr
    min_frames = int(np.ceil(0.07 / seconds))
    notes: list[dict] = []
    start: int | None = None

    def close(end: int) -> None:
        if start is None or end - start < min_frames:
            return
        # La ventana de análisis es larga y adelanta el principio de la nota: si hay un ataque
        # detectado cerca, la nota empieza ahí.
        near = onsets[np.abs(onsets - start) <= 8]
        begin = int(near[np.argmin(np.abs(near - start))]) if len(near) else start
        notes.append({
            "start": round(begin * seconds, 4),
            "end": round(max(end, begin + 1) * seconds, 4),
            "pitch": int(pitch[start]),
            "velocity": round(float(min(1.0, level[start:end].max() / peak)), 3),
        })

    for i in range(len(pitch)):
        if start is not None and (pitch[i] != pitch[start] or (is_onset[i] and i - start >= min_frames)):
            close(i)
            start = None
        if start is None and pitch[i] >= 0:
            start = i
    close(len(pitch))
    return notes


# Intervalos que coinciden con armónicos de una nota más grave (octava + quinta, dos octavas,
# dos octavas + tercera). Con distorsión, Basic Pitch los toma por notas reales.
OVERTONES = (19, 24, 28, 31)


def clean_chords(notes: list[dict], max_notes: int, window: float = 0.05) -> list[dict]:
    """
    Limpia los acordes de guitarra o piano: agrupa las notas que empiezan casi a la vez (un
    rasgueo no es simultáneo), quita armónicos y notas mucho más flojas que el resto del acorde,
    y deja como mucho `max_notes`. Todas las notas del grupo empiezan con la primera.
    """
    out: list[dict] = []
    ordered = sorted(notes, key=lambda n: n["start"])
    i = 0
    while i < len(ordered):
        group = [ordered[i]]
        while i + len(group) < len(ordered) and ordered[i + len(group)]["start"] - group[0]["start"] <= window:
            group.append(ordered[i + len(group)])
        i += len(group)
        loudest = max(n["velocity"] for n in group)
        group = [n for n in group if n["velocity"] >= loudest * 0.45]
        by_pitch: dict[int, dict] = {}
        for n in group:
            if n["pitch"] not in by_pitch or n["velocity"] > by_pitch[n["pitch"]]["velocity"]:
                by_pitch[n["pitch"]] = n
        pitches = sorted(by_pitch)
        keep = []
        for p in pitches:
            n = by_pitch[p]
            parent = next((by_pitch[p - k] for k in OVERTONES if p - k in by_pitch), None)
            octave = by_pitch.get(p - 12)
            if parent and n["velocity"] < parent["velocity"] * 1.1:
                continue
            if octave and n["velocity"] < octave["velocity"] * 0.6:
                continue
            keep.append(n)
        keep = sorted(keep, key=lambda n: -n["velocity"])[:max_notes]
        start = group[0]["start"]
        for n in sorted(keep, key=lambda n: n["pitch"]):
            out.append({**n, "start": start})
    return out


# --------------------------------------------------------------------------- varias guitarras
#
# Demucs da una sola pista de guitarra con todas las guitarras mezcladas. En el rock es habitual
# poner cada guitarra en un lado del estéreo, o grabar la misma parte dos veces (una en cada lado)
# y dejar la solista en el centro. Aquí se preparan dos "escuchas" de la pista: una en la que se
# cancela lo que suena a la derecha y otra en la que se cancela lo de la izquierda. Se transcribe
# cada una y se comparan: las notas que solo salen en una son de la guitarra de ese lado; las que
# salen en las dos están en el centro o las tocan las dos guitarras a la vez.
# Si el usuario pide más guitarras de las que salen así, la que más toca se parte por registro.

SIDE_MIN_PAN = 0.25  # a partir de aquí un sonido se considera "de un lado" (-1 izquierda, +1 derecha)
SIDE_MIN_MASS = 0.08  # parte mínima de la energía que tiene que haber en ese lado
OWN_MIN_SHARE = 0.3  # parte de las notas de un lado que no puede estar en el otro para ser otra guitarra
PART_MIN_NOTES = 8
PART_NAMES = {
    "left": "Guitarra (izquierda)",
    "right": "Guitarra (derecha)",
    "center": "Guitarra (centro)",
}


def side_gains(spec_l, spec_r) -> tuple[float | None, float | None]:
    """
    Busca dónde están panoramizadas las fuentes de cada lado. Devuelve (g_izq, g_der): cuánto se
    oye en el canal contrario lo que suena a la izquierda y a la derecha, de 0 (todo a un lado) a
    casi 1 (casi en el centro). Si a un lado no hay nada, devuelve None para ese lado.
    """
    import numpy as np

    mag_l, mag_r = np.abs(spec_l), np.abs(spec_r)
    energy = mag_l**2 + mag_r**2
    loud = energy > np.percentile(energy, 80)
    pan = ((mag_r - mag_l) / (mag_r + mag_l + 1e-9))[loud]
    hist, edges = np.histogram(pan, bins=40, range=(-1, 1), weights=energy[loud])
    hist = np.convolve(hist, [0.25, 0.5, 0.25], mode="same") / (hist.sum() + 1e-12)
    centers = (edges[:-1] + edges[1:]) / 2

    def gain(side: np.ndarray) -> float | None:
        if hist[side].sum() < SIDE_MIN_MASS:
            return None
        top = int(np.argmax(np.where(side, hist, 0)))
        near = slice(max(0, top - 1), top + 2)
        peak = abs(float(np.sum(centers[near] * hist[near]) / np.sum(hist[near])))
        # Casi del todo a un lado: se da por panoramizado del todo (el histograma no afina más).
        return 0.0 if peak >= 0.9 else float((1 - peak) / (1 + peak))

    return gain(centers <= -SIDE_MIN_PAN), gain(centers >= SIDE_MIN_PAN)


def stereo_views(stem: Path, out_dir: Path, sr: int = 22050) -> dict[str, Path] | None:
    """
    Escribe versiones mono de una pista estéreo: "left" (sin lo que suena a la derecha) y "right"
    (sin lo que suena a la izquierda). Lo que está en el centro queda en las dos. Si a un lado no
    hay ninguna fuente, la escucha contraria se llama "center": es lo que queda al quitar la del
    otro lado. Devuelve None si la pista es mono o no tiene nada a los lados.
    """
    import librosa
    import numpy as np
    import soundfile as sf

    data, file_sr = sf.read(stem, dtype="float32", always_2d=True)
    if data.shape[1] < 2:
        return None
    left = librosa.resample(data[:, 0], orig_sr=file_sr, target_sr=sr)
    right = librosa.resample(data[:, 1], orig_sr=file_sr, target_sr=sr)
    level = float(np.sqrt(np.mean((left**2 + right**2) / 2)))
    if level < 1e-5 or np.sqrt(np.mean((left - right) ** 2)) < 0.05 * level:
        return None

    gain_left, gain_right = side_gains(
        librosa.stft(left, n_fft=2048, hop_length=512), librosa.stft(right, n_fft=2048, hop_length=512)
    )
    if gain_left is None and gain_right is None:
        return None
    # Lo que suena a la derecha llega al canal izquierdo multiplicado por gain_right: restándolo
    # del izquierdo desaparece. Y al revés.
    views = {
        "left" if gain_left is not None else "center": left - (gain_right or 0.0) * right,
        "right" if gain_right is not None else "center": right - (gain_left or 0.0) * left,
    }

    # Donde una escucha se queda casi en silencio (solo suena la guitarra cancelada) se apaga del
    # todo: el transcriptor no distingue volúmenes y escribiría el resto que queda.
    frame, hop = 2048, 512
    loudness = lambda x: librosa.feature.rms(y=x, frame_length=frame, hop_length=hop)[0]  # noqa: E731
    reference = np.sqrt((loudness(left) ** 2 + loudness(right) ** 2) / 2) + 1e-9
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    for side, audio in views.items():
        audible = (loudness(audio) / reference > 0.15).astype(np.float32)
        audible = np.convolve(audible, np.ones(5) / 5, mode="same")
        gate = np.interp(np.arange(len(audio)), np.arange(len(audible)) * hop, audible)
        audio = audio * gate
        audio = audio * (level / (float(np.sqrt(np.mean(audio**2))) + 1e-9))
        paths[side] = out_dir / f"guitar_{side}.wav"
        sf.write(paths[side], np.clip(audio, -1, 1), sr, subtype="PCM_16")
    return paths


def merge_takes(takes: dict[str, list[dict]], tolerance: float = 0.06) -> list[dict]:
    """
    Junta varias transcripciones del mismo audio en una sola lista sin repetidos. Cada nota
    recuerda en qué transcripciones ha salido ("seen"): una nota cuenta como presente en otra
    transcripción si allí empieza a la vez o ya está sonando.
    """
    merged: list[dict] = []
    recent: dict[int, list[dict]] = {}
    tagged = [(note, source) for source, notes in takes.items() for note in notes]
    for note, source in sorted(tagged, key=lambda item: item[0]["start"]):
        same = next(
            (m for m in recent.get(note["pitch"], ()) if abs(m["start"] - note["start"]) <= tolerance),
            None,
        )
        if same:
            same["seen"].add(source)
            same["end"] = max(same["end"], note["end"])
            same["velocity"] = max(same["velocity"], note["velocity"])
            continue
        entry = {**note, "seen": {source}}
        merged.append(entry)
        recent[note["pitch"]] = [*recent.get(note["pitch"], [])[-3:], entry]

    sounding: dict[tuple[str, int], list[tuple[float, float]]] = {}
    for source, notes in takes.items():
        for note in notes:
            sounding.setdefault((source, note["pitch"]), []).append((note["start"], note["end"]))
    for entry in merged:
        for source in takes:
            if source not in entry["seen"] and any(
                start - tolerance <= entry["start"] <= end
                for start, end in sounding.get((source, entry["pitch"]), ())
            ):
                entry["seen"].add(source)
    return merged


def group_by_side(takes: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """
    Decide qué guitarras hay comparando las dos escuchas ("left"/"right", o "center" si a ese lado
    no hay nada). Una escucha cuenta como guitarra aparte si una buena parte de lo que suena en
    ella no está en la otra. Devuelve las notas de cada guitarra.
    """
    merged = merge_takes(takes)
    own = {side: [n for n in merged if n["seen"] == {side}] for side in takes}
    first, second = sorted(takes, key=lambda side: -len(own[side]))

    def separate(side: str) -> bool:
        return len(own[side]) >= max(PART_MIN_NOTES, OWN_MIN_SHARE * len(takes[side]))

    if separate(first) and separate(second):
        # Una guitarra en cada escucha: cada una es lo que se oye al cancelar la otra.
        return dict(takes)
    if separate(first) and len(takes[second]) >= PART_MIN_NOTES:
        # Una guitarra a un lado y el resto en el centro: en la otra escucha ya no está la del
        # lado, así que esa escucha entera es la guitarra del centro.
        return {first: own[first], "center": takes[second]}
    return {"center": [{k: v for k, v in n.items() if k != "seen"} for n in merged]}


def note_overlap(a: list[dict], b: list[dict], tolerance: float = 0.08) -> float:
    """Parecido entre dos transcripciones: qué parte de las notas de cada una está en la otra."""
    if not a or not b:
        return 0.0

    def matched(xs: list[dict], ys: list[dict]) -> float:
        by_class: dict[int, list[float]] = {}
        for y in ys:
            by_class.setdefault(y["pitch"] % 12, []).append(y["start"])
        hits = sum(
            any(abs(x["start"] - t) <= tolerance for t in by_class.get(x["pitch"] % 12, ()))
            for x in xs
        )
        return hits / len(xs)

    return (matched(a, b) + matched(b, a)) / 2


def split_by_register(notes: list[dict], window: float = 0.05) -> tuple[list[dict], list[dict]]:
    """
    Separa una guitarra mezclada en rítmica (acordes y notas graves) y solista (notas agudas que
    van por encima de los acordes). Es una aproximación: un riff con una cuerda aguda al aire
    puede acabar en la solista.
    """
    import numpy as np

    ordered = sorted(notes, key=lambda n: n["start"])
    groups: list[list[dict]] = []
    for n in ordered:
        if groups and n["start"] - groups[-1][0]["start"] <= window:
            groups[-1].append(n)
        else:
            groups.append([n])
    tops = [max(x["pitch"] for x in g) for g in groups if len({x["pitch"] for x in g}) >= 2]
    reference = np.median(tops) if tops else np.median([n["pitch"] for n in notes] or [60])
    split = max(55, int(reference) + 3)

    rhythm: list[dict] = []
    lead: list[dict] = []
    for g in groups:
        pitches = sorted({x["pitch"] for x in g})
        if len(pitches) == 1:
            (lead if pitches[0] >= split else rhythm).extend(g)
            continue
        gaps = [(pitches[i + 1] - pitches[i], i) for i in range(len(pitches) - 1)]
        gap, at = max(gaps)
        if gap >= 7 and pitches[-1] >= split:
            cut = pitches[at]
            rhythm.extend(x for x in g if x["pitch"] <= cut)
            lead.extend(x for x in g if x["pitch"] > cut)
        else:
            rhythm.extend(g)
    return rhythm, lead


def guitar_parts(
    stem: Path, raw_notes, wanted: int | None, work: Path
) -> list[tuple[str, str, list[dict]]]:
    """
    Decide cuántas guitarras escribir y con qué notas. `raw_notes(path)` transcribe un audio.
    `wanted` es el número de guitarras que pide el usuario (None = automático).
    Devuelve (id, nombre, notas sin limpiar) por guitarra.
    """
    views = None if wanted == 1 else stereo_views(stem, work / "stems")
    if views is None:
        grouped = {"center": raw_notes(stem)}
    else:
        grouped = group_by_side({side: raw_notes(path) for side, path in views.items()})

    order = ["left", "center", "right"]
    parts = [(f"guitar_{p}", PART_NAMES[p], grouped[p]) for p in order if p in grouped]

    # Sobran guitarras: la que menos toca se junta con la que más se le parece.
    while wanted and len(parts) > wanted:
        smallest = min(parts, key=lambda p: len(p[2]))
        parts.remove(smallest)
        target = max(range(len(parts)), key=lambda i: note_overlap(smallest[2], parts[i][2]))
        ident, name, notes = parts[target]
        parts[target] = (ident, name, sorted(notes + smallest[2], key=lambda n: n["start"]))

    # Faltan guitarras: la que más notas tiene se parte en rítmica y solista.
    while wanted and len(parts) < wanted:
        biggest = max(range(len(parts)), key=lambda i: len(parts[i][2]))
        ident, name, notes = parts[biggest]
        rhythm, lead = split_by_register(notes)
        if len(rhythm) < PART_MIN_NOTES or len(lead) < PART_MIN_NOTES or "rítmica" in name or "solista" in name:
            break
        suffix = name[len("Guitarra"):]
        parts[biggest : biggest + 1] = [
            (f"{ident}_rhythm", f"Guitarra rítmica{suffix}", rhythm),
            (f"{ident}_lead", f"Guitarra solista{suffix}", lead),
        ]

    if len(parts) == 1:
        parts = [("guitar", "Guitarra", parts[0][2])]
    elif len({name.partition(" (")[2] for _, name, _ in parts}) == 1:
        # Todas en la misma posición: decirla no aporta nada.
        parts = [(ident, name.partition(" (")[0], notes) for ident, name, notes in parts]
    return parts


def transcribe_notes(
    stems: dict[str, Path], tempo: float = 120.0, guitars: int | None = None, work: Path | None = None
) -> list[dict]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    model = Model(Path(ICASSP_2022_MODEL_PATH).parent / "nmp.onnx")

    def raw_notes(path: Path, kind: str, fmin: float, fmax: float) -> list[dict]:
        _, _, events = predict(
            str(path),
            model,
            onset_threshold=0.6 if kind == "guitar" else 0.55,
            frame_threshold=0.3,
            # Nada más corto que una semicorchea a este tempo (con margen).
            minimum_note_length=max(90.0, 60000 / max(tempo, 40) / 4 * 0.7),
            minimum_frequency=fmin,
            maximum_frequency=fmax,
            melodia_trick=True,
        )
        return [
            {"start": round(float(s), 4), "end": round(float(e), 4), "pitch": int(p), "velocity": float(a)}
            for s, e, p, a, _ in events
            if a > 0.25
        ]

    tracks = []
    wanted = [s for s in NOTE_RANGES if s in stems]
    levels = {stem: rms(stems[stem]) for stem in wanted}
    loudest = max(levels.values(), default=0.0)
    for i, stem in enumerate(wanted):
        kind, program, fmin, fmax, mono = NOTE_RANGES[stem]
        progress("notes", i / len(wanted), f"Transcribiendo {TRACK_NAMES[stem].lower()}…")
        # Pista prácticamente en silencio, o con solo los restos de otros instrumentos que deja
        # el separador (pasa sobre todo con el piano en canciones sin piano).
        if levels[stem] < max(0.004, QUIET_STEM * loudest):
            continue
        if kind == "bass":
            parts = [(stem, TRACK_NAMES[stem], transcribe_monophonic(stems[stem], fmin, fmax))]
        elif kind == "guitar":
            parts = guitar_parts(
                stems[stem],
                lambda path: raw_notes(path, kind, fmin, fmax),
                guitars,
                work or stems[stem].parent.parent,
            )
        else:
            parts = [(stem, TRACK_NAMES[stem], raw_notes(stems[stem], kind, fmin, fmax))]
        for ident, name, notes in parts:
            if mono:
                notes = monophonic(notes)
            elif kind == "guitar":
                notes = clean_chords(notes, max_notes=4)
            else:
                notes = clean_chords(notes, max_notes=6)
            if len(notes) >= 8:
                tracks.append({"stem": ident, "kind": kind, "name": name, "program": program, "notes": notes})
    progress("notes", 1, "Notas transcritas")
    return tracks


def transcribe_drums(path: Path) -> list[dict]:
    import librosa
    import numpy as np

    progress("drums", 0, "Transcribiendo batería…")
    if rms(path) < 0.004:
        return []
    y, sr = librosa.load(path, sr=22050, mono=True)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="samples", backtrack=False, delta=0.08)
    spectrum = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bands = {
        "kick": (freqs >= 30) & (freqs < 150),
        "snare": (freqs >= 150) & (freqs < 2500),
        "hihat": freqs >= 6000,
    }
    totals = {k: spectrum[m].sum(axis=0) for k, m in bands.items()}
    norms = {k: np.percentile(v, 95) + 1e-9 for k, v in totals.items()}
    hits = []
    for sample in onsets:
        frame = min(spectrum.shape[1] - 1, int(sample // 512) + 1)
        level = {k: totals[k][frame] / norms[k] for k in bands}
        time = round(float(sample / sr), 4)
        pieces = [k for k in ("kick", "snare", "hihat") if level[k] > 0.45]
        if "kick" in pieces and "snare" in pieces:
            pieces.remove("kick" if level["snare"] > level["kick"] * 1.3 else "snare")
        for piece in pieces or [max(level, key=level.get)]:
            hits.append({"time": time, "piece": piece})
    progress("drums", 1, "Batería transcrita")
    return hits


CHORD_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def detect_chords(stems: dict[str, Path] | None, audio, beats: list[float]) -> list[dict]:
    import librosa
    import numpy as np

    progress("chords", 0, "Buscando acordes…")
    if stems:
        harmonic = None
        for name, weight in (("guitar", 1.0), ("piano", 1.0), ("other", 0.7), ("bass", 0.5)):
            if name in stems:
                y, _ = librosa.load(stems[name], sr=22050, mono=True)
                harmonic = y * weight if harmonic is None else harmonic[: len(y)] + y[: len(harmonic)] * weight
    else:
        harmonic = librosa.resample(audio.mean(0), orig_sr=SAMPLE_RATE, target_sr=22050)
    if harmonic is None or len(beats) < 4:
        return []
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=22050, hop_length=512)
    frames = librosa.time_to_frames(beats, sr=22050, hop_length=512)
    synced = librosa.util.sync(chroma, frames, aggregate=np.median)
    energy = librosa.util.sync(librosa.feature.rms(y=harmonic, hop_length=512), frames, aggregate=np.mean)[0]

    templates, names = [], []
    for root in range(12):
        for quality, intervals in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12)
            t[[(root + i) % 12 for i in intervals]] = 1
            templates.append(t / np.linalg.norm(t))
            names.append(CHORD_NAMES[root] + quality)
    templates = np.array(templates)
    norm = synced / (np.linalg.norm(synced, axis=0, keepdims=True) + 1e-9)
    scores = templates @ norm  # (24, beats)

    # Suavizado: cambiar de acorde cuesta, así no salta en cada tiempo (Viterbi sencillo).
    n_states, n_beats = scores.shape
    penalty = 0.12
    cost = scores[:, 0].copy()
    back = np.zeros((n_states, n_beats), dtype=int)
    for t in range(1, n_beats):
        best_prev = int(np.argmax(cost))
        stay = cost
        switch = cost[best_prev] - penalty
        back[:, t] = np.where(stay >= switch, np.arange(n_states), best_prev)
        cost = np.maximum(stay, switch) + scores[:, t]
    path = [int(np.argmax(cost))]
    for t in range(n_beats - 1, 0, -1):
        path.append(back[path[-1], t])
    path.reverse()

    silent = energy < np.percentile(energy, 10) * 0.5
    chords, previous = [], None
    beat_times = [0.0] + list(beats)  # librosa.util.sync añade el tramo anterior al primer tiempo
    for i, state in enumerate(path):
        name = None if (i < len(silent) and silent[i]) else names[state]
        if name != previous and i < len(beat_times):
            if name:
                chords.append({"time": round(float(beat_times[i]), 4), "name": name})
            previous = name
    progress("chords", 1, f"{len(set(c['name'] for c in chords))} acordes distintos")
    return chords


def transcribe_lyrics(path: Path, model_size: str) -> dict:
    from faster_whisper import WhisperModel

    progress("lyrics", 0, "Preparando el reconocimiento de letra (la primera vez se descarga)…")
    import librosa

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    # Se le pasa el audio ya decodificado: el lector de faster-whisper usa PyAV con opciones que
    # las versiones nuevas de PyAV ya no aceptan ("metadata_errors").
    samples, _ = librosa.load(path, sr=16000, mono=True)
    segments, info = model.transcribe(
        samples, word_timestamps=True, vad_filter=True, condition_on_previous_text=False
    )
    duration = max(1.0, float(info.duration))
    words = []
    for segment in segments:
        for word in segment.words or []:
            text = word.word.strip()
            if text:
                words.append({"start": round(float(word.start), 3), "end": round(float(word.end), 3), "text": text})
        progress("lyrics", min(0.99, segment.end / duration), "Reconociendo la letra…")
    progress("lyrics", 1, "Letra reconocida")
    return {"language": info.language, "words": words}


# --------------------------------------------------------------------------- comandos

def command_check() -> None:
    import basic_pitch  # noqa: F401
    import demucs  # noqa: F401
    import faster_whisper  # noqa: F401
    import librosa  # noqa: F401
    import torch
    import yt_dlp

    emit("ok", python=sys.version.split()[0], torch=torch.__version__, ytdlp=yt_dlp.version.__version__)


def command_transcribe(args: argparse.Namespace) -> None:
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    source = resolve_source(args.source, work)
    audio = load_audio(source["path"])
    stems = separate(audio, work)
    drums = transcribe_drums(stems["drums"]) if "drums" in stems else []
    rhythm = analyze_rhythm(audio, stems, drums)
    tracks = transcribe_notes(stems, rhythm["tempo"], args.guitars, work)
    chords = detect_chords(stems, audio, rhythm["beats"])
    lyrics = {"language": None, "words": []}
    if args.lyrics and "vocals" in stems and rms(stems["vocals"]) > 0.01:
        try:
            lyrics = transcribe_lyrics(stems["vocals"], args.whisper)
        except Exception as error:  # noqa: BLE001
            # Sin letra la transcripción sigue valiendo; no se tira todo el trabajo por esto.
            print(f"No se pudo sacar la letra: {error!r}", file=sys.stderr)
            progress("lyrics", 1, "No se pudo sacar la letra")
    else:
        progress("lyrics", 1, "Sin letra")
    result = {
        "version": 1,
        "title": source["title"],
        "artist": source["artist"],
        "sourceUrl": source.get("url") or (args.source if "://" in args.source else None),
        "duration": round(audio.shape[1] / SAMPLE_RATE, 3),
        **rhythm,
        "tracks": tracks,
        "drums": drums,
        "chords": chords,
        "lyrics": lyrics,
        "stems": {k: str(v) for k, v in stems.items()},
    }
    out = work / "result.json"
    out.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    emit("done", result=str(out))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    t = sub.add_parser("transcribe")
    t.add_argument("--source", required=True)
    t.add_argument("--work", required=True)
    t.add_argument("--no-lyrics", dest="lyrics", action="store_false")
    t.add_argument("--whisper", default="small")
    # Número de guitarras a escribir; sin indicar, se deduce del estéreo.
    t.add_argument("--guitars", type=int, choices=(1, 2, 3), default=None)
    args = parser.parse_args()
    try:
        if args.command == "check":
            command_check()
        else:
            command_transcribe(args)
    except UserError as e:
        emit("error", message=str(e))
        sys.exit(2)
    except Exception as e:  # noqa: BLE001
        message = friendly_error(e) or str(e) or e.__class__.__name__
        emit("error", message=message, detail=traceback.format_exc()[-2000:])
        sys.exit(1)


if __name__ == "__main__":
    main()
