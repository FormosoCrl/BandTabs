"""Pruebas de las partes del motor que no necesitan descargar modelos.

    python -m pytest src-tauri/engine/tests
"""

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bandtabs_engine as engine  # noqa: E402

SR = 22050


def tone(freqs, seconds, sr=SR):
    t = np.arange(int(sr * seconds)) / sr
    return sum(np.sin(2 * np.pi * f * t) for f in freqs) * 0.2 * np.exp(-1.5 * t)


def test_parse_spotify_page():
    page = """<html><head>
    <meta property="og:title" content="Bohemian Rhapsody - Remastered 2011"/>
    <meta property="og:description" content="Queen · A Night At The Opera · Song · 1975"/>
    <meta name="music:musician_description" content="Queen"/>
    </head></html>"""
    assert engine.parse_spotify_page(page) == {"title": "Bohemian Rhapsody - Remastered 2011", "artist": "Queen"}


def test_parse_spotify_page_without_musician_tag():
    page = '<meta content="Canción" property="og:title"><meta property="og:description" content="Canción · Rosalía · 2018">'
    assert engine.parse_spotify_page(page) == {"title": "Canción", "artist": "Rosalía"}


def test_spotify_and_youtube_links():
    assert engine.SPOTIFY_RE.match("https://open.spotify.com/intl-es/track/4u7EnebtmKWzUH433cf5Qv?si=1")
    assert engine.YOUTUBE_RE.match("https://youtu.be/dQw4w9WgXcQ")
    assert engine.YOUTUBE_RE.match("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert not engine.YOUTUBE_RE.match("https://example.com/watch")


def test_monophonic_keeps_the_loudest_note():
    notes = [
        {"start": 0.0, "end": 1.0, "pitch": 60, "velocity": 0.5},
        {"start": 0.2, "end": 0.6, "pitch": 72, "velocity": 0.3},
        {"start": 0.5, "end": 1.5, "pitch": 62, "velocity": 0.9},
    ]
    out = engine.monophonic(notes)
    assert [n["pitch"] for n in out] == [60, 62]
    assert out[0]["end"] == 0.5


def test_detect_chords_follows_the_harmony(tmp_path):
    beat = 0.5
    progression = [("C", (261.6, 329.6, 392.0)), ("Am", (220.0, 261.6, 329.6)),
                   ("F", (174.6, 220.0, 261.6)), ("G", (196.0, 246.9, 293.7))]
    audio = np.concatenate([tone(f, beat * 4) for _, f in progression for _ in range(2)])
    path = tmp_path / "guitar.wav"
    sf.write(path, audio, SR)
    beats = list(np.arange(0, len(audio) / SR, beat)[1:])
    chords = engine.detect_chords({"guitar": path}, None, beats)
    names = [c["name"] for c in chords]
    assert names == ["C", "Am", "F", "G"]
    assert abs(chords[1]["time"] - 8 * beat) <= beat


def test_transcribe_drums_tells_kick_snare_and_hihat(tmp_path):
    rng = np.random.default_rng(0)
    out = np.zeros(SR * 4)

    def hit(at, sound):
        start = int(at * SR)
        out[start : start + len(sound)] += sound

    t = np.arange(int(0.15 * SR)) / SR
    kick = np.sin(2 * np.pi * 55 * t) * np.exp(-25 * t)
    snare = rng.normal(0, 1, len(t)) * np.exp(-30 * t)
    snare = np.convolve(snare, np.ones(8) / 8, mode="same") * 0.8
    hat = np.diff(rng.normal(0, 1, len(t) + 1)) * np.exp(-60 * t) * 0.4
    for i in range(1, 8):
        hit(i * 0.5, kick if i % 2 == 0 else snare)
        hit(i * 0.5 + 0.25, hat)
    path = tmp_path / "drums.wav"
    sf.write(path, out / np.abs(out).max() * 0.8, SR)
    hits = engine.transcribe_drums(path)
    by_time = {}
    for h in hits:
        by_time.setdefault(round(h["time"] * 4) / 4, set()).add(h["piece"])
    assert by_time[1.0] == {"kick"}
    assert by_time[1.5] == {"snare"}
    assert by_time[1.25] == {"hihat"}
    assert len(hits) == 14


def test_clean_chords_quita_armonicos_y_junta_el_rasgueo():
    n = lambda start, pitch, vel=0.8: {"start": start, "end": start + 0.4, "pitch": pitch, "velocity": vel}
    # Quinta de potencia en Mi (40, 47, 52) rasgueada en 30 ms, con armónicos 59 (+19) y 64 (+24).
    notes = [n(1.0, 40), n(1.01, 47), n(1.03, 52), n(1.02, 59, 0.5), n(1.02, 64, 0.5), n(1.0, 70, 0.2)]
    out = engine.clean_chords(notes, max_notes=4)
    assert [x["pitch"] for x in out] == [40, 47, 52]
    assert {x["start"] for x in out} == {1.0}


def test_split_by_pan_separa_dos_guitarras_en_los_lados(tmp_path):
    # Guitarra A sonando a la izquierda (La3) y guitarra B a la derecha (Mi5).
    sr = 44100
    a = tone([220.0], 3, sr)
    b = tone([659.3], 3, sr)
    stereo = np.stack([a + 0.1 * b, b + 0.1 * a], axis=1).astype(np.float32)
    path = tmp_path / "guitar.wav"
    sf.write(path, stereo, sr)
    parts = engine.split_by_pan(path, tmp_path)
    assert set(parts) == {"left", "right"}

    def peak(side):
        import librosa

        y, rate = librosa.load(parts[side], sr=None)
        spectrum = np.abs(np.fft.rfft(y))
        return np.fft.rfftfreq(len(y), 1 / rate)[np.argmax(spectrum)]

    assert abs(peak("left") - 220) < 5
    assert abs(peak("right") - 659.3) < 5


def test_split_by_pan_no_parte_una_guitarra_centrada(tmp_path):
    a = tone([220.0, 330.0], 2)
    path = tmp_path / "guitar.wav"
    sf.write(path, np.stack([a, a], axis=1), SR)
    assert engine.split_by_pan(path, tmp_path) == {}


def _notes(pitches, step=0.25, start=0.0):
    return [
        {"start": start + i * step, "end": start + i * step + 0.2, "pitch": p, "velocity": 0.8}
        for i, p in enumerate(pitches)
    ]


def test_guitar_parts_junta_la_misma_parte_doblada_y_separa_partes_distintas(tmp_path):
    riff = _notes([40, 47, 52, 47] * 4)
    lead = _notes([64, 67, 69, 71, 72, 71, 69, 67] * 2)
    stem = tmp_path / "stems" / "guitar.wav"
    stem.parent.mkdir()
    stem.touch()

    def fake_pan(sides):
        return lambda path, out_dir: {s: tmp_path / f"{s}.wav" for s in sides}

    notes_for = {"left": riff, "right": riff, "center": lead}
    raw = lambda path: notes_for.get(path.stem, riff)  # noqa: E731

    original = engine.split_by_pan
    try:
        # Rítmica doblada a izquierda y derecha: una sola guitarra.
        engine.split_by_pan = fake_pan(["left", "right"])
        parts = engine.guitar_parts(stem, raw, None, tmp_path)
        assert [name for _, name, _ in parts] == ["Guitarra"]

        # Rítmica a la izquierda y solista en el centro: dos guitarras.
        engine.split_by_pan = fake_pan(["left", "center"])
        parts = engine.guitar_parts(stem, raw, None, tmp_path)
        assert sorted(name for _, name, _ in parts) == ["Guitarra (centro)", "Guitarra (izquierda)"]
    finally:
        engine.split_by_pan = original


def test_guitar_parts_parte_por_registro_si_se_piden_dos(tmp_path):
    # Acordes graves con una melodía aguda por encima, todo en el centro.
    chords = [n for i in range(12) for n in _notes([40, 47, 52], step=0.0, start=i * 0.5)]
    melody = _notes([71, 74, 76, 74, 71, 69, 71, 74, 76, 79, 76, 74], step=0.5, start=0.25)
    mixed = chords + melody
    stem = tmp_path / "stems" / "guitar.wav"
    stem.parent.mkdir()
    sf.write(stem, np.stack([tone([110.0], 1)] * 2, axis=1), SR)
    parts = engine.guitar_parts(stem, lambda path: mixed, 2, tmp_path)
    names = {name: notes for _, name, notes in parts}
    assert set(names) == {"Guitarra rítmica", "Guitarra solista"}
    assert {n["pitch"] for n in names["Guitarra solista"]} == set(p["pitch"] for p in melody)
    assert {n["pitch"] for n in names["Guitarra rítmica"]} == {40, 47, 52}
