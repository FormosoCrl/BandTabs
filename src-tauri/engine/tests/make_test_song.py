"""Genera una canción sintética corta (guitarra, bajo, batería y melodía) para probar el motor."""

import sys

import numpy as np
import soundfile as sf

SR = 44100
BPM = 100
BEAT = 60 / BPM
BARS = 6
rng = np.random.default_rng(1)
song = np.zeros(int(SR * BEAT * 4 * BARS) + SR)


def add(at, sound, gain=1.0):
    start = int(at * SR)
    end = min(len(song), start + len(sound))
    song[start:end] += sound[: end - start] * gain


def pluck(freq, seconds, bright=6):
    t = np.arange(int(SR * seconds)) / SR
    wave = sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, bright))
    return wave * np.exp(-3 * t)


hz = lambda midi: 440 * 2 ** ((midi - 69) / 12)  # noqa: E731
chords = [(40, 47, 52, 55, 59, 64), (45, 52, 57, 60, 64), (36, 43, 48, 52, 55, 60), (43, 50, 55, 59, 62, 67)]
bass = [28, 33, 36, 31]
melody = [64, 67, 69, 67, 64, 62, 60, 62]
for bar in range(BARS):
    t0 = bar * 4 * BEAT
    for beat in range(4):
        at = t0 + beat * BEAT
        for i, note in enumerate(chords[bar % 4]):
            add(at + i * 0.01, pluck(hz(note), BEAT * 0.95), 0.05)
        add(at, pluck(hz(bass[bar % 4]), BEAT * 0.9, 3), 0.25)
        t = np.arange(int(0.15 * SR)) / SR
        if beat % 2 == 0:
            add(at, np.sin(2 * np.pi * 55 * t) * np.exp(-25 * t), 0.6)
        else:
            add(at, rng.normal(0, 1, len(t)) * np.exp(-30 * t), 0.25)
        add(at + BEAT / 2, np.diff(rng.normal(0, 1, len(t) + 1)) * np.exp(-60 * t), 0.08)
        tone = melody[(bar * 4 + beat) % len(melody)]
        tt = np.arange(int(SR * BEAT * 0.9)) / SR
        add(at, np.sin(2 * np.pi * hz(tone) * tt) * np.minimum(1, tt * 20) * np.exp(-0.5 * tt), 0.15)

stereo = np.stack([song, song], axis=1) / np.abs(song).max() * 0.8
sf.write(sys.argv[1] if len(sys.argv) > 1 else "test-song.wav", stereo, SR)
