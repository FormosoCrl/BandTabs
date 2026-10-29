"""Genera THIRD-PARTY-NOTICES.md con las licencias de lo que va dentro del instalador.

Necesita `cargo install cargo-about --features cli` y las dependencias de npm instaladas.
Uso, desde la raíz del repositorio: python scripts/third-party-notices.py
"""

import json
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HEADER = """# Avisos de terceros

BandTabs es software propietario (ver LICENSE), pero incluye o descarga componentes de terceros
con licencias propias. Esas licencias se aplican a esos componentes y nada en la licencia de
BandTabs las limita. Este archivo se genera con `python scripts/third-party-notices.py`.

## Recursos incluidos con alphaTab

- **Bravura** (fuente musical), Copyright (c) Steinberg Media Technologies GmbH, con licencia SIL
  Open Font License 1.1. Texto completo en `Bravura-OFL.txt` junto a la fuente.
- **Soundfont Sonivox**, Copyright (c) 2004-2006 Sonic Network Inc., con licencia Apache-2.0.

## Componentes que se descargan al instalar el motor de transcripción

No van dentro del instalador. La app los descarga de python.org y PyPI en el equipo del usuario
la primera vez que usa la transcripción, y se ejecutan como programas y bibliotecas aparte. Cada
uno se rige por su propia licencia:

| Componente | Licencia |
|---|---|
| Python (embeddable) | PSF-2.0 |
| PyTorch, torchaudio | BSD-3-Clause, BSD-2-Clause |
| Demucs y su modelo `htdemucs_6s` | MIT |
| Basic Pitch y su modelo | Apache-2.0 |
| faster-whisper, CTranslate2 y los modelos Whisper | MIT |
| ONNX Runtime | MIT |
| librosa, resampy | ISC |
| yt-dlp, yt-dlp-ejs | Unlicense (dominio público), MIT, ISC |
| deno | MIT |
| FFmpeg (vía imageio-ffmpeg) | GPL-3.0; se ejecuta como programa aparte. Código fuente en <https://ffmpeg.org> |
| PyAV (incluye FFmpeg) | BSD-3-Clause; FFmpeg con LGPL-2.1 |
| soxr | LGPL-2.1 o posterior |
| lameenc | LGPL-3.0 o posterior |
| certifi, tqdm | MPL-2.0 |
| scikit-learn, SciPy, NumPy, numba y el resto | BSD, MIT o Apache-2.0 (ver `requirements.lock`) |

Los componentes LGPL y GPL se usan sin modificar y como bibliotecas o programas independientes;
el usuario puede sustituirlos por otras versiones dentro de la carpeta del motor.
"""


def npm_section() -> str:
    out = subprocess.run(
        [shutil.which('npx') or 'npx', '--yes', 'license-checker-rseidelsohn@4', '--production', '--json'],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    lines = ['## Bibliotecas de JavaScript incluidas en la app', '']
    for name, info in sorted(data.items()):
        if name.startswith('bandtabs@'):
            continue
        lines.append(f"### {name} ({info['licenses']})")
        lines.append('')
        if info.get('repository'):
            lines.append(info['repository'])
            lines.append('')
        file = info.get('licenseFile')
        if file and Path(file).name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING')):
            lines.append('```')
            lines.append(Path(file).read_text(encoding='utf-8', errors='replace').strip())
            lines.append('```')
            lines.append('')
    return '\n'.join(lines)


def rust_section() -> str:
    out = subprocess.run(
        ['cargo', 'about', 'generate', '--format', 'json', '--locked'],
        cwd=ROOT / 'src-tauri', capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    # Agrupa los textos idénticos para no repetir cientos de veces la misma licencia MIT.
    groups: dict[str, list[str]] = defaultdict(list)
    names: dict[str, str] = {}
    for lic in data['licenses']:
        text = lic['text'].strip()
        names[text] = lic['name']
        for used in lic['used_by']:
            crate = used['crate']
            if crate['name'] != 'bandtabs':
                groups[text].append(f"{crate['name']} {crate['version']}")
    lines = ['## Bibliotecas de Rust incluidas en la app', '']
    for text, crates in sorted(groups.items(), key=lambda kv: (names[kv[0]], kv[1])):
        lines.append(f'### {names[text]}')
        lines.append('')
        lines.append('Usada por: ' + ', '.join(sorted(set(crates))))
        lines.append('')
        lines.append('```')
        lines.append(text)
        lines.append('```')
        lines.append('')
    return '\n'.join(lines)


def main() -> None:
    body = '\n'.join([HEADER, npm_section(), rust_section()])
    (ROOT / 'THIRD-PARTY-NOTICES.md').write_text(body.rstrip() + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
