"""Canción de prueba con las notas conocidas: dos guitarras, bajo, batería y voz.

    pip install --no-deps tinysoundfont
    python make_song.py ../../../../public/soundfont/sonivox.sf2 CARPETA [bpm] [variante]

Variantes (dónde suena cada guitarra): wide (rítmica y solista a medio lado), hard (del todo a cada
lado), center (las dos en el centro), rock (rítmica doblada a los lados y solista en el centro),
leftcenter (rítmica a la izquierda y solista en el centro).
Escribe song.wav, una pista true_*.wav por instrumento y truth.json con las notas.
"""
import json, sys
import numpy as np, soundfile as sf, tinysoundfont

SF2, OUT = sys.argv[1], sys.argv[2]
BPM = float(sys.argv[3]) if len(sys.argv) > 3 else 150
VARIANT = sys.argv[4] if len(sys.argv) > 4 else "wide"
SR = 44100
BEAT = 60 / BPM
BARS = 24
LEAD_IN = 0.37  # la música no empieza en el segundo 0

# progresión en Re (Drop D): D5 Bb5 F5 C5
ROOTS = [38, 46, 41, 36 + 12]  # D2 Bb2 F2 C3
def power(root): return [root, root + 7, root + 12]

tracks = {k: [] for k in ("rhythm", "lead", "bass", "vocals", "drums")}
lead_pat = [0, 7, 12, 16, 12, 7, 12, 19]  # arpegio mayor sobre la fundamental + octava
for bar in range(BARS):
    root = ROOTS[bar % 4]
    t0 = LEAD_IN + bar * 4 * BEAT
    for e in range(8):  # corcheas
        t = t0 + e * BEAT / 2
        # rítmica: quintas en corcheas, con un silencio en la 4ª corchea de compases impares
        if not (bar % 2 == 1 and e == 3):
            for p in power(root):
                tracks["rhythm"].append((t, t + BEAT / 2 * 0.9, p, 100))
        tracks["bass"].append((t, t + BEAT / 2 * 0.9, root - 12, 105))
        tracks["drums"].append((t, t + 0.1, 42, 80))
        if bar >= 4:
            third = 3 if bar % 4 == 99 else 4
            iv = [0, 7, 12, 12 + third, 12, 7, 12, 19][e]
            tracks["lead"].append((t, t + BEAT / 2 * 0.95, root + 12 + iv, 95))
    for b in range(4):
        t = t0 + b * BEAT
        tracks["drums"].append((t, t + 0.1, 36 if b % 2 == 0 else 38, 110))
    if bar >= 8:
        mel = [[62, 65, 69, 65], [65, 62, 58, 62], [60, 65, 69, 72], [67, 64, 60, 64]][bar % 4]
        for b in range(0, 4, 2):
            t = t0 + b * BEAT
            tracks["vocals"].append((t, t + BEAT * 1.8, mel[b], 100))

PROGRAMS = {"rhythm": 30, "lead": 29, "bass": 33, "vocals": 53}
PAN = {"wide": {"rhythm": -0.8, "lead": 0.8}, "hard": {"rhythm": -1.0, "lead": 1.0},
       "center": {"rhythm": 0.0, "lead": 0.0}, "rock": {"rhythm": 0.0, "lead": 0.0},
       "leftcenter": {"rhythm": -0.9, "lead": 0.0}}[VARIANT]
total = int((LEAD_IN + BARS * 4 * BEAT + 2) * SR)

rng = np.random.default_rng(3)
def render(name, notes, bend=0, jitter=0.0):
    if jitter:
        notes = [(s + rng.uniform(-jitter, jitter), e, p, int(v * rng.uniform(0.85, 1.0))) for s, e, p, v in notes]
        notes = [(max(0, s), max(e, s + 0.05), p, v) for s, e, p, v in notes]
    synth = tinysoundfont.Synth(samplerate=SR)
    sfid = synth.sfload(SF2)
    ch = 9 if name == "drums" else 0
    if name == "drums":
        synth.program_select(9, sfid, 128, 0, True)
    else:
        synth.program_select(0, sfid, 0, PROGRAMS[name])
        if bend: synth.pitchbend(0, 8192 + bend)
    events = sorted([(s, 1, p, v) for s, e, p, v in notes] + [(e, 0, p, v) for s, e, p, v in notes])
    out = np.zeros((total, 2), dtype=np.float32)
    pos = 0
    for t, on, p, v in events:
        n = int(t * SR)
        if n > pos:
            out[pos:n] = np.frombuffer(synth.generate(n - pos), dtype=np.float32).reshape(-1, 2)
            pos = n
        (synth.noteon(ch, p, v) if on else synth.noteoff(ch, p))
    out[pos:] = np.frombuffer(synth.generate(total - pos), dtype=np.float32).reshape(-1, 2)
    return out

import os
os.makedirs(OUT, exist_ok=True)
mix = np.zeros((total, 2), dtype=np.float32)
GAIN = {"rhythm": 0.8, "lead": 0.7, "bass": 1.0, "vocals": 0.8, "drums": 1.0}
for name, notes in tracks.items():
    audio = render(name, notes).mean(axis=1) * GAIN[name]
    pan = PAN.get(name, 0.0)
    stereo = np.stack([audio * np.sqrt((1 - pan) / 2) , audio * np.sqrt((1 + pan) / 2)], axis=1) * 1.4
    if VARIANT == "rock" and name == "rhythm":  # rítmica grabada dos veces, una toma a cada lado
        take2 = render(name, notes, bend=250, jitter=0.012).mean(axis=1) * GAIN[name]
        stereo = np.stack([audio, take2 * 0.95], axis=1)
    sf.write(f"{OUT}/true_{name}.wav", stereo, SR)
    mix += stereo
mix = mix / np.abs(mix).max() * 0.9
sf.write(f"{OUT}/song.wav", mix, SR)
json.dump({"bpm": BPM, "lead_in": LEAD_IN, "tracks": tracks}, open(f"{OUT}/truth.json", "w"))
print("ok", total / SR, "s")
