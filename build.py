"""Build a reproducible flat ZIP for Super Productivity's plugin uploader."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).parent
OUTPUT = ROOT / "dist" / "superprod-keyboard-ergonomics.zip"
FILES = ("manifest.json", "plugin.js")


def build() -> Path:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if not all(manifest.get(key) for key in ("id", "name", "version", "minSupVersion")):
        raise ValueError("Incomplete plugin manifest")
    if not isinstance(manifest.get("hooks"), list) or not isinstance(
        manifest.get("permissions"), list
    ):
        raise ValueError("Manifest requires hooks and permissions arrays")

    OUTPUT.parent.mkdir(exist_ok=True)
    with ZipFile(OUTPUT, "w") as archive:
        for name in FILES:
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    return OUTPUT


if __name__ == "__main__":
    print(build())
