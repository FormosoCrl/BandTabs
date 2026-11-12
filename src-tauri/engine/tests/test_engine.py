"""Pruebas de las partes del motor que no necesitan descargar modelos.

    python -m pytest src-tauri/engine/tests
"""

import sys
from pathlib import Path

import numpy as np
import pytest
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


def _stereo(path, left, right, sr=44100):
    sf.write(path, np.stack([left, right], axis=1).astype(np.float32), sr)


def _peak_hz(path):
    y, rate = sf.read(path, dtype="float32")
    spectrum = np.abs(np.fft.rfft(y))
    return np.fft.rfftfreq(len(y), 1 / rate)[np.argmax(spectrum)]


def test_stereo_views_cancela_la_guitarra_del_otro_lado(tmp_path):
    # Guitarra A a la izquierda (La3) y guitarra B a la derecha (Mi5), sin llegar al extremo:
    # cada una se oye también, más floja, en el canal contrario.
    sr = 44100
    a, b = tone([220.0], 3, sr), tone([659.3], 3, sr)
    _stereo(tmp_path / "guitar.wav", a + 0.3 * b, b + 0.3 * a)
    views = engine.stereo_views(tmp_path / "guitar.wav", tmp_path)
    assert set(views) == {"left", "right"}
    assert abs(_peak_hz(views["left"]) - 220) < 5
    assert abs(_peak_hz(views["right"]) - 659.3) < 5

    def level(path, hz):
        y, rate = sf.read(path, dtype="float32")
        spectrum = np.abs(np.fft.rfft(y))
        return spectrum[np.argmin(np.abs(np.fft.rfftfreq(len(y), 1 / rate) - hz))]

    # La guitarra cancelada queda al menos 20 dB por debajo.
    assert level(views["left"], 659.3) < 0.1 * level(views["left"], 220)
    assert level(views["right"], 220) < 0.1 * level(views["right"], 659.3)


def test_stereo_views_llama_centro_a_lo_que_no_esta_a_un_lado(tmp_path):
    # Una guitarra a la izquierda y otra en el centro: a la derecha no hay nada propio.
    sr = 44100
    a, b = tone([220.0], 3, sr), tone([659.3], 3, sr)
    _stereo(tmp_path / "guitar.wav", a + 0.7 * b, 0.7 * b)
    views = engine.stereo_views(tmp_path / "guitar.wav", tmp_path)
    assert set(views) == {"left", "center"}
    assert abs(_peak_hz(views["center"]) - 659.3) < 5


def test_stereo_views_no_parte_una_guitarra_centrada(tmp_path):
    a = tone([220.0, 330.0], 2)
    _stereo(tmp_path / "guitar.wav", a, a, SR)
    assert engine.stereo_views(tmp_path / "guitar.wav", tmp_path) is None
    sf.write(tmp_path / "mono.wav", a, SR)
    assert engine.stereo_views(tmp_path / "mono.wav", tmp_path) is None


def test_stereo_views_apaga_los_tramos_donde_solo_suena_la_otra(tmp_path):
    # La guitarra de la derecha entra a mitad: antes, su escucha tiene que estar en silencio.
    sr = 44100
    a = np.concatenate([tone([220.0], 2, sr), tone([220.0], 2, sr)])
    b = np.concatenate([np.zeros(2 * sr), tone([659.3], 2, sr)])
    _stereo(tmp_path / "guitar.wav", a + 0.05 * b, b + 0.05 * a)
    views = engine.stereo_views(tmp_path / "guitar.wav", tmp_path)
    y, rate = sf.read(views["right"], dtype="float32")
    assert np.abs(y[: int(1.5 * rate)]).max() < 0.01 * np.abs(y).max()


def _notes(pitches, step=0.25, start=0.0):
    return [
        {"start": start + i * step, "end": start + i * step + 0.2, "pitch": p, "velocity": 0.8}
        for i, p in enumerate(pitches)
    ]


RIFF = _notes([40, 47, 52, 47] * 4)
LEAD = _notes([64, 67, 69, 71, 72, 71, 69, 67] * 2)


def test_merge_takes_recuerda_donde_sale_cada_nota():
    held = [{"start": 0.0, "end": 2.0, "pitch": 52, "velocity": 0.5}]
    merged = engine.merge_takes({"left": RIFF[:4], "right": held + LEAD[:2]})
    seen = {(n["pitch"], round(n["start"], 2)): n["seen"] for n in merged}
    assert seen[(40, 0.0)] == {"left"}
    assert seen[(64, 0.0)] == {"right"}
    # El 52 de la izquierda empieza mientras a la derecha ya está sonando: está en las dos.
    assert seen[(52, 0.5)] == {"left", "right"}
    assert len(merged) == 4 + 3


def test_group_by_side_distingue_dos_guitarras_de_una_doblada():
    # La misma parte en las dos escuchas: no hay nada que repartir.
    assert engine.group_by_side({"left": RIFF, "right": [dict(n) for n in RIFF[:-2]]}) is None

    two = engine.group_by_side({"left": RIFF, "right": LEAD})
    assert [n["pitch"] for n in two["left"]] == [n["pitch"] for n in RIFF]
    assert [n["pitch"] for n in two["right"]] == [n["pitch"] for n in LEAD]

    # La rítmica a la izquierda y la solista en el centro: la escucha izquierda oye las dos.
    side_and_center = engine.group_by_side({"left": RIFF + LEAD, "center": LEAD})
    assert {n["pitch"] for n in side_and_center["left"]} == {40, 47, 52}
    assert len(side_and_center["center"]) == len(LEAD)


def _guitar_parts(tmp_path, views, notes_for, wanted):
    original = engine.stereo_views
    engine.stereo_views = lambda stem, out_dir: views and {k: tmp_path / f"{k}.wav" for k in views}
    try:
        return engine.guitar_parts(tmp_path / "guitar.wav", lambda path: notes_for[path.stem], wanted, tmp_path)
    finally:
        engine.stereo_views = original


def test_guitar_parts_nombra_las_guitarras_por_su_lado(tmp_path):
    notes_for = {"left": RIFF, "right": LEAD, "guitar": RIFF + LEAD}
    parts = _guitar_parts(tmp_path, ["left", "right"], notes_for, None)
    assert [name for _, name, _ in parts] == ["Guitarra (izquierda)", "Guitarra (derecha)"]
    # Si se pide una sola, no se reparte nada.
    parts = _guitar_parts(tmp_path, ["left", "right"], notes_for, 1)
    assert [(name, len(notes)) for _, name, notes in parts] == [("Guitarra", len(RIFF + LEAD))]


def test_guitar_parts_no_repite_las_notas_de_una_guitarra_doblada(tmp_path):
    # La misma parte grabada dos veces: la segunda toma va 40 ms tarde. Juntar las dos escuchas
    # repetiría notas; se usa la transcripción de la pista entera.
    late = [{**n, "start": n["start"] + 0.04, "end": n["end"] + 0.04} for n in RIFF]
    notes_for = {"left": RIFF, "right": late, "guitar": RIFF}
    parts = _guitar_parts(tmp_path, ["left", "right"], notes_for, None)
    assert [(name, notes) for _, name, notes in parts] == [("Guitarra", RIFF)]


def test_stereo_views_da_cada_canal_si_es_la_misma_parte_grabada_dos_veces(tmp_path):
    # Dos tomas de las mismas notas, una en cada canal, con la afinación un pelo distinta: no hay
    # picos a los lados (todo suena igual de fuerte en los dos canales) pero los canales no se
    # parecen entre sí.
    sr = 44100
    t = np.arange(3 * sr) / sr
    left = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.2, 329.6)) * 0.2
    right = sum(np.sin(2 * np.pi * f * 1.004 * t + 1.0) for f in (220.0, 277.2, 329.6)) * 0.2
    _stereo(tmp_path / "guitar.wav", left, right)
    views = engine.stereo_views(tmp_path / "guitar.wav", tmp_path)
    assert set(views) == {"left", "right"}
    for side, channel in (("left", left), ("right", right)):
        y, rate = sf.read(views[side], dtype="float32")
        size = min(len(y), len(channel[::2]))
        assert np.corrcoef(y[1000 : size - 1000], channel[::2][1000 : size - 1000])[0, 1] > 0.98


def _activations(frames=120, step=0.0116):
    return np.zeros((frames, 88)), np.zeros((frames, 88)), np.arange(frames) * step


def test_restrike_corta_el_acorde_en_cada_golpe_de_un_rasgueo():
    onset, frame, times = _activations()
    chord = [{"start": 0.1, "end": 1.2, "pitch": p, "velocity": 0.6} for p in (50, 57, 62)]
    for p in (50, 57, 62):
        frame[8:105, p - 21] = 0.5
        # Tres golpes más después del primero, marcados flojo en cada cuerda.
        for f in (30, 52, 74):
            onset[f - 1 : f + 2, p - 21] = (0.2, 0.35, 0.2)
    out = engine.restrike(chord, onset, frame, times, 40, 88, 0.05)
    assert len(out) == 12
    starts = sorted({n["start"] for n in out})
    assert np.allclose(starts, [0.1, times[30], times[52], times[74]], atol=0.02)
    # Cada trozo acaba donde empieza el siguiente.
    for p in (50, 57, 62):
        own = sorted((n for n in out if n["pitch"] == p), key=lambda n: n["start"])
        assert all(a["end"] == b["start"] for a, b in zip(own, own[1:]))
    assert chord[0]["end"] == 1.2  # no cambia la lista original


def test_restrike_no_parte_una_nota_suelta_ni_la_cola_de_una_que_se_apaga():
    # Una sola nota larga con un ataque flojo en medio: sin otra cuerda que lo confirme, se deja.
    onset, frame, times = _activations()
    frame[8:105, 60 - 21] = 0.5
    onset[49:52, 60 - 21] = (0.2, 0.4, 0.2)
    onset[49:52, 72 - 21] = (0.5, 0.9, 0.5)  # otra nota que empieza ahí, pero que no venía sonando
    single = [{"start": 0.1, "end": 1.2, "pitch": 60, "velocity": 0.6}]
    assert engine.restrike(single, onset, frame, times, 40, 88, 0.05) == single

    # Dos notas que se están apagando cuando llega el golpe: no vuelven a empezar.
    onset, frame, times = _activations()
    notes = [{"start": 0.1, "end": 0.75, "pitch": p, "velocity": 0.6} for p in (50, 57)]
    for p in (50, 57):
        frame[8:50, p - 21] = 0.6
        frame[50:65, p - 21] = 0.2
        onset[49:52, p - 21] = (0.2, 0.35, 0.2)
    assert engine.restrike(notes, onset, frame, times, 40, 88, 0.05) == notes


def test_refine_beats_quita_el_baile_de_los_tiempos():
    # Un golpe seco cada 0,38 s. Los tiempos llegan redondeados a saltos de 23 ms, como los da
    # librosa: la distancia entre ellos alterna entre 16 y 17 saltos.
    sr = 22050
    clicks = 0.5 + 0.38 * np.arange(40)
    audio = np.zeros(int(sr * 17))
    burst = np.random.default_rng(0).normal(size=400) * np.exp(-np.arange(400) / 60)
    for c in clicks:
        audio[int(c * sr) : int(c * sr) + 400] += burst
    rough = np.round(clicks * sr / 512) * 512 / sr
    assert np.std(np.diff(rough)) > 0.008
    beats = engine.refine_beats(rough, audio, sr)
    assert len(beats) == len(clicks)
    assert np.std(np.diff(beats)) < 0.002
    # Todos quedan a la misma distancia del golpe (el desfase común se corrige después).
    assert np.std(beats - clicks) < 0.003


def test_guitar_parts_parte_por_registro_si_se_piden_dos(tmp_path):
    # Acordes graves con una melodía aguda por encima, todo en el centro.
    chords = [n for i in range(12) for n in _notes([40, 47, 52], step=0.0, start=i * 0.5)]
    melody = _notes([71, 74, 76, 74, 71, 69, 71, 74, 76, 79, 76, 74], step=0.5, start=0.25)
    parts = _guitar_parts(tmp_path, None, {"guitar": chords + melody}, 2)
    names = {name: notes for _, name, notes in parts}
    assert set(names) == {"Guitarra rítmica", "Guitarra solista"}
    assert {n["pitch"] for n in names["Guitarra solista"]} == set(p["pitch"] for p in melody)
    assert {n["pitch"] for n in names["Guitarra rítmica"]} == {40, 47, 52}


def test_guitar_parts_junta_las_que_sobran(tmp_path):
    notes_for = {"left": RIFF, "right": LEAD}
    parts = _guitar_parts(tmp_path, ["left", "right"], notes_for, 3)
    assert len(parts) == 2  # ninguna se puede partir más: se queda en dos


def test_transcribe_monophonic_acierta_la_octava_y_separa_notas_repetidas(tmp_path):
    # Re1 (36,7 Hz) con la fundamental floja, como suena un bajo real: tres notas iguales seguidas
    # y luego La1.
    sr = 22050

    def pluck(hz, seconds=0.4):
        t = np.arange(int(sr * seconds)) / sr
        wave = 0.3 * np.sin(2 * np.pi * hz * t) + sum(np.sin(2 * np.pi * hz * k * t) / k for k in (2, 3, 4))
        return wave * np.exp(-4 * t) * np.minimum(1, t * 200)

    audio = np.concatenate([np.zeros(sr // 4)] + [pluck(36.71)] * 3 + [pluck(55.0)] + [np.zeros(sr // 4)])
    path = tmp_path / "bass.wav"
    sf.write(path, audio / np.abs(audio).max() * 0.8, sr)
    notes = engine.transcribe_monophonic(path, 28, 350)
    assert [n["pitch"] for n in notes] == [26, 26, 26, 33]
    for note, expected in zip(notes, (0.25, 0.65, 1.05, 1.45)):
        assert abs(note["start"] - expected) < 0.05


def test_transcribe_monophonic_separa_notas_repetidas_sin_cambio_de_timbre(tmp_path):
    # La misma nota cuatro veces, ligada: el sonido no cambia, solo cae el volumen y vuelve a
    # subir. Después, una nota larga con un vibrato suave de volumen, que es una sola.
    sr = 22050
    t = np.arange(int(sr * 0.3)) / sr
    swell = (0.35 + 0.65 * np.exp(-6 * t)) * np.minimum(1, 0.35 + t * 40)
    held = np.arange(int(sr * 1.2)) / sr
    envelope = np.concatenate([np.tile(swell, 4), 0.8 + 0.1 * np.sin(2 * np.pi * 3 * held)])
    time = np.arange(len(envelope)) / sr
    phase = 2 * np.pi * np.where(time < 1.2, 55.0, 73.42) * time
    wave = sum(np.sin(k * phase) / k for k in (1, 2, 3)) * envelope
    audio = np.concatenate([np.zeros(sr // 4), wave, np.zeros(sr // 4)])
    path = tmp_path / "bass.wav"
    sf.write(path, audio / np.abs(audio).max() * 0.8, sr)
    notes = engine.transcribe_monophonic(path, 28, 350)
    assert [n["pitch"] for n in notes] == [33, 33, 33, 33, 38]
    for note, expected in zip(notes, (0.25, 0.55, 0.85, 1.15, 1.45)):
        assert abs(note["start"] - expected) < 0.05


def test_overlap_add_une_los_trozos_sin_saltos():
    torch = pytest.importorskip("torch")

    wav = torch.linspace(-1, 1, 1000).repeat(2, 1)
    seen = []

    def run(piece, done):
        seen.append((piece.shape[-1], done))
        return torch.stack([piece, piece * 2])  # dos "fuentes"

    out = engine.overlap_add(wav, chunk=300, overlap=50, run=run)
    assert out.shape == (2, 2, 1000)
    assert torch.allclose(out[0], wav, atol=1e-6)
    assert torch.allclose(out[1], wav * 2, atol=1e-6)
    assert [n for n, _ in seen] == [300, 300, 300, 250]
    assert seen[-1][1] == 1.0
    # Una canción más corta que un trozo va de una vez.
    assert torch.allclose(engine.overlap_add(wav[:, :100], 300, 50, lambda p, d: p[None])[0], wav[:, :100])


def test_tempo_factor_usa_la_caja_para_decidir():
    snare = lambda gap: [{"time": 1 + i * gap, "piece": "snare"} for i in range(20)]  # noqa: E731
    # 190 BPM con la caja cada dos tiempos: el tempo está bien, no hay que partirlo.
    assert engine.tempo_factor(60 / 190, snare(2 * 60 / 190)) == 1.0
    # librosa dice 200 pero la caja va cada 1,2 s: en realidad son 100.
    assert engine.tempo_factor(60 / 200, snare(1.2)) == 2.0
    # librosa dice 75 pero la caja va cada 0,8 s: son 150.
    assert engine.tempo_factor(60 / 75, snare(0.8)) == 0.5
    # Sin batería se mantiene la regla de siempre: por encima de 160 se parte.
    assert engine.tempo_factor(60 / 180, []) == 2.0
    assert engine.tempo_factor(60 / 120, None) == 1.0


def test_friendly_error_no_confunde_errores():
    assert "bloqueado" in engine.friendly_error(Exception("Sign in to confirm you're not a bot"))
    assert "no está disponible" in engine.friendly_error(Exception("ERROR: Video unavailable"))
    assert "conexión" in engine.friendly_error(Exception("<urlopen error [Errno 11001] getaddrinfo failed>"))
    assert "memoria" in engine.friendly_error(MemoryError())
    # Un error cualquiera que contenga "bot" (both, bottom…) no es un bloqueo de YouTube.
    assert engine.friendly_error(ValueError("operands could not be broadcast, both shapes differ")) is None


def test_download_audio_actualiza_yt_dlp_y_reintenta(tmp_path):
    calls = []

    def once(query, work):
        calls.append(query)
        if len(calls) == 1:
            raise RuntimeError("Unable to extract player response")
        return {"title": "x"}

    originals = engine.download_audio_once, engine.update_downloader
    engine.download_audio_once, engine.update_downloader = once, lambda: calls.append("update") or True
    try:
        assert engine.download_audio("q", tmp_path) == {"title": "x"}
        assert calls == ["q", "update", "q"]
        # Si el vídeo no existe no se pierde tiempo actualizando.
        calls.clear()
        engine.download_audio_once = lambda q, w: (_ for _ in ()).throw(RuntimeError("Video unavailable"))
        try:
            engine.download_audio("q", tmp_path)
            raise AssertionError("tenía que fallar")
        except RuntimeError:
            assert calls == []
    finally:
        engine.download_audio_once, engine.update_downloader = originals
