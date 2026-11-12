"""Compara el result.json del motor con el truth.json de make_song.py: por pista, qué parte de las
notas escritas son correctas (P), qué parte de las reales se han encontrado (R) y su media (F).

    python evaluate.py CARPETA_TRABAJO/result.json CARPETA_CANCION/truth.json
"""
import json, sys
res = json.load(open(sys.argv[1])); truth = json.load(open(sys.argv[2]))

def f1(est, ref, tol=0.06, octave=False):
    used = set(); hit = 0
    for s, p in est:
        for i, (rs, rp) in enumerate(ref):
            ok = (p - rp) % 12 == 0 if octave else p == rp
            if i not in used and ok and abs(s - rs) <= tol:
                used.add(i); hit += 1; break
    pr = hit / len(est) if est else 0; rc = hit / len(ref) if ref else 0
    return (2 * pr * rc / (pr + rc) if pr + rc else 0, pr, rc)

print(f"tempo {res['tempo']:.1f} (real {truth['bpm']}), beats {len(res['beats'])}, downbeat {res['downbeat']}")
if len(res["beats"]) > 4:
    import statistics
    b = res["beats"]; d = [b[i+1]-b[i] for i in range(len(b)-1)]
    print(f"  beat medio {60/statistics.median(d):.1f} BPM, primer downbeat en {b[res['downbeat']]:.3f}s (real {truth['lead_in']} + k*{4*60/truth['bpm']:.3f})")
refs = {k: [(s, p) for s, e, p, v in v] for k, v in truth["tracks"].items()}
for t in res["tracks"]:
    est = [(n["start"], n["pitch"]) for n in t["notes"]]
    cands = ["rhythm", "lead"] if t["kind"] == "guitar" else [t["kind"]]
    line = f"{t['name']:28s} {len(est):4d} notas |"
    for c in cands + (["rhythm+lead"] if t["kind"] == "guitar" else []):
        ref = refs["rhythm"] + refs["lead"] if c == "rhythm+lead" else refs.get(c, [])
        f, p, r = f1(est, ref)
        line += f" vs {c}: F={f:.2f} P={p:.2f} R={r:.2f} |"
    print(line)
est = [(d["time"], {"kick": 36, "snare": 38, "hihat": 42}[d["piece"]]) for d in res["drums"]]
print("batería F=%.2f P=%.2f R=%.2f" % f1(est, refs["drums"]))
print("acordes:", " ".join(f"{c['name']}@{c['time']:.1f}" for c in res["chords"][:12]))
