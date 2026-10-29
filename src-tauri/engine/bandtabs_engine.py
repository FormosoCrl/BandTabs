"""Motor de transcripción de BandTabs.

Lo lanza la app de escritorio con el Python que instala la primera vez. Escribe una línea JSON por
evento en stdout para que la app muestre el progreso:

    {"type": "progress", "step": "separate", "progress": 0.4, "message": "..."}
    {"type": "done", "result": "C:/.../result.json"}
    {"type": "error", "message": "..."}

Uso:
    python bandtabs_engine.py check
    python bandtabs_engine.py transcribe --source URL_O_ARCHIVO --work CARPETA [--no-lyrics]
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
    "rhythm": (0.62, 0.66),
    "notes": (0.66, 0.84),
    "drums": (0.84, 0.86),
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


def download_audio(query: str, work: Path) -> dict:
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

    # Por trozos para poder informar del avance.
    chunk = SAMPLE_RATE * 30
    total = wav.shape[1]
    parts = []
    with torch.no_grad():
        for start in range(0, total, chunk):
            piece = wav[:, start : start + chunk]
            piece = (piece - mean) / std
            out = apply_model(model, piece[None], device=device, split=True, overlap=0.25, progress=False)[0]
            parts.append(out * std + mean)
            progress("separate", 0.05 + 0.95 * min(1, (start + chunk) / total), "Separando instrumentos…")
    sources = torch.cat(parts, dim=-1).cpu().numpy()

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


def analyze_rhythm(audio, stems: dict[str, Path] | None) -> dict:
    import librosa
    import numpy as np

    progress("rhythm", 0, "Buscando el tempo y los compases…")
    mono = librosa.resample(audio.mean(0), orig_sr=SAMPLE_RATE, target_sr=22050)
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=22050, units="frames", tightness=120)
    beats = librosa.frames_to_time(beat_frames, sr=22050)
    tempo = float(np.atleast_1d(tempo)[0])

    # El primer tiempo de cada compás suele coincidir con el bombo y el bajo.
    if stems and "drums" in stems and len(beat_frames) >= 8:
        low, _ = librosa.load(stems["drums"], sr=22050, mono=True)
        bass, _ = librosa.load(stems["bass"], sr=22050, mono=True)
        envelope = librosa.onset.onset_strength(y=low + bass, sr=22050, fmax=200)
        strength = envelope[np.minimum(beat_frames, len(envelope) - 1)]
        phase = int(np.argmax([strength[p::4].mean() for p in range(4)]))
    else:
        phase = 0
    progress("rhythm", 1, f"Tempo aproximado: {round(tempo)} BPM")
    return {"tempo": tempo, "beats": [round(float(b), 4) for b in beats], "downbeat": phase, "beatsPerBar": 4}


NOTE_RANGES = {
    # stem: (instrumento, programa MIDI, Hz mínimo, Hz máximo, monofónico)
    "guitar": ("guitar", 29, 75, 1400, False),
    "bass": ("bass", 33, 30, 420, True),
    "piano": ("piano", 0, 27, 4200, False),
    "vocals": ("vocals", 54, 75, 1100, True),
}

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


def transcribe_notes(stems: dict[str, Path]) -> list[dict]:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    model = Model(Path(ICASSP_2022_MODEL_PATH).parent / "nmp.onnx")
    tracks = []
    wanted = [s for s in NOTE_RANGES if s in stems]
    for i, stem in enumerate(wanted):
        kind, program, fmin, fmax, mono = NOTE_RANGES[stem]
        progress("notes", i / len(wanted), f"Transcribiendo {TRACK_NAMES[stem].lower()}…")
        if rms(stems[stem]) < 0.004:
            continue  # pista prácticamente en silencio
        _, _, events = predict(
            str(stems[stem]),
            model,
            onset_threshold=0.55,
            frame_threshold=0.3,
            minimum_note_length=90,
            minimum_frequency=fmin,
            maximum_frequency=fmax,
            melodia_trick=True,
        )
        notes = [
            {"start": round(float(s), 4), "end": round(float(e), 4), "pitch": int(p), "velocity": float(a)}
            for s, e, p, a, _ in events
            if a > 0.25
        ]
        if mono:
            notes = monophonic(notes)
        if len(notes) >= 8:
            tracks.append({"stem": stem, "kind": kind, "name": TRACK_NAMES[stem], "program": program, "notes": notes})
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
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(path), word_timestamps=True, vad_filter=True, condition_on_previous_text=False
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
    rhythm = analyze_rhythm(audio, stems)
    tracks = transcribe_notes(stems)
    drums = transcribe_drums(stems["drums"]) if "drums" in stems else []
    chords = detect_chords(stems, audio, rhythm["beats"])
    lyrics = {"language": None, "words": []}
    if args.lyrics and "vocals" in stems and rms(stems["vocals"]) > 0.01:
        lyrics = transcribe_lyrics(stems["vocals"], args.whisper)
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
        message = str(e)
        if "Sign in to confirm" in message or "bot" in message.lower():
            message = "YouTube ha bloqueado la descarga. Prueba más tarde o usa un archivo de audio."
        emit("error", message=message or e.__class__.__name__, detail=traceback.format_exc()[-2000:])
        sys.exit(1)


if __name__ == "__main__":
    main()
