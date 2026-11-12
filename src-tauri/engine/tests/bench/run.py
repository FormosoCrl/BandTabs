"""Ejecuta el motor sobre una canción de make_song.py usando sus pistas reales en lugar de Demucs,
para medir todo lo que viene después de la separación (no hace falta descargar el modelo).

    python run.py CARPETA_CANCION CARPETA_TRABAJO [--guitars N]
"""
import sys, json
from pathlib import Path
import numpy as np, soundfile as sf
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import bandtabs_engine as e

song, work = Path(sys.argv[1]), Path(sys.argv[2])
def fake_separate(audio, work):
    d = work / "stems"; d.mkdir(parents=True, exist_ok=True)
    g = sf.read(song / "true_rhythm.wav")[0] + sf.read(song / "true_lead.wav")[0]
    sf.write(d / "guitar.wav", g, 44100)
    out = {"guitar": d / "guitar.wav"}
    for k in ("bass", "drums", "vocals"):
        out[k] = song / f"true_{k}.wav"
    for k in ("piano", "other"):
        sf.write(d / f"{k}.wav", np.zeros_like(g), 44100); out[k] = d / f"{k}.wav"
    return out
e.separate = fake_separate
e.emit = lambda kind, **d: None if kind == "progress" else print(kind, d)
sys.argv = ["x", "transcribe", "--source", str(song / "song.wav"), "--work", str(work), "--no-lyrics"] + sys.argv[3:]
e.main()
