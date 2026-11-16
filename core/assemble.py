"""Builds the test-run MP4: recorded frames + each spoken line placed where its test started.

    python assemble.py <out-dir>
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path


def build(out: Path) -> Path:
    work = out / ".work"
    frames_dir = work / "frames"
    meta = json.loads((frames_dir / "frames.json").read_text())
    e2e = json.loads((out / "e2e.json").read_text())
    frames, length = meta["frames"], meta["length"] / 1000
    if not frames:
        raise RuntimeError("No frames were recorded")

    # Frame list with exact display times (each frame shows until the next one arrives).
    lines = []
    for i, fr in enumerate(frames):
        end = frames[i + 1]["t"] if i + 1 < len(frames) else meta["length"]
        lines.append(f"file '{fr['f']}'\nduration {max(0.001, (end - fr['t']) / 1000):.3f}")
    lines.append(f"file '{frames[-1]['f']}'")
    (frames_dir / "list.txt").write_text("\n".join(lines) + "\n")

    voice_dir = work / "voice"
    cues = [c for c in e2e["cues"] if (voice_dir / f"{c['id']}.mp3").exists()]
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", str(frames_dir / "list.txt")]
    for c in cues:
        cmd += ["-i", str(voice_dir / f"{c['id']}.mp3")]
    vf = ("[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
          "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0d1117,fps=30,format=yuv420p[v]")
    parts = [vf]
    if cues:
        for i, c in enumerate(cues, 1):
            ms = max(0, int(c["t"]))
            parts.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
        mix = "".join(f"[a{i}]" for i in range(1, len(cues) + 1))
        parts.append(f"{mix}amix=inputs={len(cues)}:normalize=0:dropout_transition=0,"
                     f"apad,atrim=0:{length:.3f}[a]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[v]"]
    if cues:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"]
    video = out / "test-run.mp4"
    tmp = out / "test-run.part.mp4"
    cmd = [cmd[0], "-nostdin", *cmd[1:]]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-t", f"{length:.3f}",
            "-movflags", "+faststart", str(tmp)]
    subprocess.run(cmd, check=True, stdin=subprocess.DEVNULL)
    try:
        tmp.replace(video)
    except PermissionError:  # the old video is open in a player: keep the new one under its own name
        video = out / f"test-run-{time.strftime('%H%M%S')}.mp4"
        tmp.replace(video)
        print(f"test-run.mp4 is open in another program, so the new video is {video.name}")
    return video


if __name__ == "__main__":
    print(build(Path(sys.argv[1] if len(sys.argv) > 1 else "testrun/out")))
