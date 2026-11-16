"""Makes the spoken lines for the test-run video (Microsoft neural voices via edge-tts).

    python voice.py <out_dir> <lines.json>

lines.json: {"voice": "...", "rate": "+4%", "lines": [{"id": "t01", "text": "..."}]}
Writes <out_dir>/<id>.mp3 and prints a JSON map {id: seconds}. Unchanged lines are reused.
Only the sentence text is sent to Microsoft's speech service.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import edge_tts


def duration(path: Path) -> float:
    out = subprocess.check_output([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries",
                                   "format=duration", "-of", "csv=p=0", str(path)])
    return float(out.strip())


async def make(line: dict, voice: str, rate: str, out: Path, cache: dict) -> tuple[str, float]:
    key = hashlib.sha1(f"{voice}|{rate}|{line['text']}".encode()).hexdigest()
    f = out / f"{line['id']}.mp3"
    if cache.get(line["id"], {}).get("key") == key and f.exists():
        return line["id"], cache[line["id"]]["dur"]
    for attempt in range(5):
        try:
            audio = bytearray()
            async for chunk in edge_tts.Communicate(line["text"], voice, rate=rate).stream():
                if chunk["type"] == "audio":
                    audio += chunk["data"]
            # The service sometimes returns a near-empty file without an error.
            if len(audio) < 1200 * len(line["text"].split()):
                raise RuntimeError(f"speech for {line['id']} came back short")
            f.write_bytes(audio)
            break
        except Exception:  # noqa: BLE001
            if attempt == 4:
                raise
            await asyncio.sleep(2 + attempt * 2)
    d = round(duration(f), 2)
    cache[line["id"]] = {"key": key, "dur": d}
    return line["id"], d


async def main() -> None:
    out = Path(sys.argv[1])
    spec = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    out.mkdir(parents=True, exist_ok=True)
    cache_file = out / "cache.json"
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    voice, rate = spec.get("voice", "en-US-AndrewNeural"), spec.get("rate", "+4%")
    sem = asyncio.Semaphore(6)

    async def one(line):
        async with sem:
            return await make(line, voice, rate, out, cache)

    results = await asyncio.gather(*(one(l) for l in spec["lines"]))
    cache_file.write_text(json.dumps(cache, indent=1))
    print(json.dumps(dict(results)))


asyncio.run(main())
