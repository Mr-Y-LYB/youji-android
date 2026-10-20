import hashlib
import json
from pathlib import Path


root = Path(__file__).resolve().parents[1]
feed = json.loads((root / "update.json").read_text(encoding="utf-8"))
assert feed["tag_name"] == "v1.3.1"
assets = {item["name"]: item for item in feed["assets"]}
for name, local in (
    ("YouJi-v1.3.1.apk", "游迹-v1.3.1.apk"),
    ("YouJi-Windows-v1.3.1.zip", "YouJi-Windows-v1.3.1.zip"),
):
    path = root / "dist" / local
    item = assets[name]
    assert item["size"] == path.stat().st_size
    assert item["digest"] == "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    assert item["browser_download_url"] == (
        "https://github.com/Mr-Y-LYB/youji-android/releases/download/v1.3.1/" + name
    )
print("Update feed matches the built packages")
