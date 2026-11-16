"""One command: run an app's tests and record a narrated test-run video.

    python run.py <testvideo-dir> [--quick] [--only "name,name"] [--skip-suite] [--reuse-suite] [--voice ID]

<testvideo-dir> holds testrun.json (settings) and tests.mjs (the browser tests); sample files go in files/.
Output goes to <testvideo-dir>/out: test-run.mp4, report.html, results.json.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from assemble import build  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def fill(value, subs: dict):
    """Replace {port}, {out}, {dir} in strings, lists and dicts."""
    if isinstance(value, str):
        for k, v in subs.items():
            value = value.replace("{" + k + "}", str(v))
        return value
    if isinstance(value, list):
        return [fill(v, subs) for v in value]
    if isinstance(value, dict):
        return {k: fill(v, subs) for k, v in value.items()}
    return value


def resolve_cmd(cmd: list, cwd: Path) -> list:
    """A program given as a relative path ("./x", ".venv/...") is relative to the command's own cwd."""
    cmd = [str(c) for c in cmd]
    first = Path(cmd[0])
    if not first.is_absolute() and (cmd[0].startswith(".") or "/" in cmd[0] or "\\" in cmd[0]):
        cmd[0] = str((cwd / first).resolve())
    return cmd


def reachable(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            return r.status < 500
    except Exception:  # noqa: BLE001
        return False


def run_suite(cfg: dict, base: Path, out: Path) -> dict:
    suite = cfg["suite"]
    cwd = base / suite.get("cwd", ".")
    cmd = resolve_cmd(suite["command"], cwd)
    json_path = out / "pytest.json"
    json_path.unlink(missing_ok=True)
    env = {**os.environ, "TESTVIDEO_PYTEST_JSON": str(json_path),
           "PYTHONPATH": os.pathsep.join(filter(None, [str(HERE), os.environ.get("PYTHONPATH", "")]))}
    if any("pytest" in str(c) for c in cmd):
        cmd += ["-p", "testvideo_pytest_plugin", "-p", "no:cacheprovider"]
    print("Running the automated test suite...", flush=True)
    t0 = time.time()
    with open(out / "suite.log", "w", encoding="utf-8") as log:
        subprocess.run(cmd, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    tests = json.loads(json_path.read_text()) if json_path.exists() else []
    if not tests:
        print("  the suite wrote no results (only pytest suites are shown on the board); see out/suite.log", flush=True)
    seconds = round(time.time() - t0)
    print(f"  {len(tests)} tests, {sum(t['outcome'] == 'passed' for t in tests)} passed, {seconds} s", flush=True)
    return {"tests": tests, "seconds": seconds}


def start_app(app: dict, base: Path, out: Path):
    url = app["url"]
    if not app.get("start"):
        if not reachable(url):
            sys.exit(f"The app isn't running at {url}. Start it, or add \"start\" to the app settings.")
        return None
    env = {**os.environ, **app.get("env", {})}
    print(f"Starting the app at {url} ...", flush=True)
    cwd = base / app.get("cwd", ".")
    proc = subprocess.Popen(resolve_cmd(app["start"], cwd), cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                            stdout=open(out / "app.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(300):
        if reachable(url):
            return proc
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    proc.kill()
    sys.exit("The app did not start; see out/app.log")


def write_report(out: Path, report: dict) -> Path:
    html = (HERE / "cards.html").read_text(encoding="utf-8")
    data = json.dumps(report).replace("</", "<\\/")
    html = html.replace("<script>", f"<script>window.REPORT = {data};</script>\n<script>", 1)
    path = out / "report.html"
    path.write_text(html, encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--quick", action="store_true", help="only the tests listed under \"quick\", no suite")
    ap.add_argument("--only", default="", help="comma list of test names (or parts of names) to run")
    ap.add_argument("--skip-suite", action="store_true")
    ap.add_argument("--reuse-suite", action="store_true", help="reuse the last suite results")
    ap.add_argument("--voice")
    args = ap.parse_args()

    base = Path(args.dir).resolve()
    out = base / "out"
    out.mkdir(exist_ok=True)
    lock = out / ".running"
    if lock.exists() and time.time() - lock.stat().st_mtime < 3 * 3600 and _alive(lock.read_text().strip()):
        sys.exit(f"Another test-video run is using {out}. Wait for it to finish (or delete {lock} if it crashed).")
    lock.write_text(str(os.getpid()))
    try:
        return _main(args, base, out)
    finally:
        lock.unlink(missing_ok=True)
        _cleanup(base, out)


def _alive(pid: str) -> bool:
    """Is the run that wrote the lock still going? A run that was stopped leaves a stale lock behind."""
    if not pid.isdigit():
        return True
    if os.name == "nt":
        r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True)
        return pid in r.stdout
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def _cleanup(base: Path, out: Path) -> None:
    """Optional "cleanup" command from testrun.json, run even when the run fails, e.g. to delete a
    throwaway database that holds a copied API key."""
    try:
        cfg = json.loads((base / "testrun.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    cmd = cfg.get("cleanup")
    if cmd:
        cmd = [str(c).replace("{out}", str(out)) for c in cmd]
        r = subprocess.run(resolve_cmd(cmd, base), cwd=base)
        if r.returncode:
            print(f"cleanup command failed (exit {r.returncode}); check {out} by hand")


def _main(args, base: Path, out: Path) -> int:
    cfg = json.loads((base / "testrun.json").read_text(encoding="utf-8"))
    if args.voice:
        cfg["voice"] = args.voice
    started = datetime.now()
    port = free_port()
    subs = {"port": port, "out": out, "dir": base}
    app = fill(cfg["app"], subs)
    cfg["vars"] = fill(cfg.get("vars", {}), subs)

    if args.reuse_suite and (out / "pytest.json").exists():
        unit = {"tests": json.loads((out / "pytest.json").read_text()), "seconds": 0}
    elif cfg.get("suite") and not (args.quick or args.skip_suite):
        unit = run_suite(cfg, base, out)
    else:
        unit = {"tests": [], "seconds": 0}

    if cfg.get("prepare"):
        subprocess.run(resolve_cmd(fill(cfg["prepare"], subs), base), cwd=base, check=True)
    proc = start_app(app, base, out)
    title = {"name": cfg.get("title", "Test run"),
             "subtitle": f"{'Quick run' if args.quick else 'Run'} on {started:%d %B %Y at %H:%M}"
                         + (f" · {cfg['subtitle']}" if cfg.get("subtitle") else ""),
             "parts": cfg.get("parts", [])}
    plan = {"config": cfg, "app_url": app["url"], "python": sys.executable, "scripts_dir": str(HERE),
            "files_dir": str(base / "files"), "tests_file": str(base / "tests.mjs"), "unit": unit,
            "quick": args.quick, "only": [s.strip() for s in args.only.split(",") if s.strip()],
            "title": title, "vars": cfg["vars"]}
    (out / "plan.json").write_text(json.dumps(plan, indent=1))
    # Never build a video from an older run's results.
    for stale in ("e2e.json", "results.json"):
        (out / stale).unlink(missing_ok=True)
    try:
        print("Running the recorded browser tests...", flush=True)
        rc = subprocess.run(["node", str(HERE / "harness.mjs"), str(out)], cwd=base).returncode
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(10)
            except subprocess.TimeoutExpired:
                proc.kill()
    if not (out / "e2e.json").exists():
        print("The browser run stopped before the end; no video was made.")
        return 1
    e2e = json.loads((out / "e2e.json").read_text())
    print("Building the video...", flush=True)
    video = build(out)
    report = write_report(out, {"title": title, "tests": unit["tests"], "seconds": unit["seconds"],
                                "labels": (cfg.get("suite") or {}).get("labels", {}),
                                "e2e": e2e["results"], "unit": unit["tests"], "checks": e2e["checks"]})
    suite_bad = [t for t in unit["tests"] if t["outcome"] in ("failed", "xpassed")]
    e2e_bad = [r for r in e2e["results"] if r["status"] != "pass"]
    summary = {
        "started": started.isoformat(timespec="seconds"),
        "suite": {"total": len(unit["tests"]), "passed": sum(t["outcome"] == "passed" for t in unit["tests"]),
                  "failed": len(suite_bad)},
        "browser": {"total": len(e2e["results"]), "passed": len(e2e["results"]) - len(e2e_bad),
                    "failed": len(e2e_bad), "checks": e2e["checks"]},
        "failures": [t["nodeid"] for t in suite_bad] + [f"{r['name']}: {r['error']}" for r in e2e_bad],
        "video": str(video), "report": str(report),
    }
    (out / "results.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 1 if (suite_bad or e2e_bad or rc) else 0


if __name__ == "__main__":
    sys.exit(main())
