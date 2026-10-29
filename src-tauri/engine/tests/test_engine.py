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
