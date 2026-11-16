"""pytest plugin: writes every test's result and one-line description to a JSON file.

    pytest -p testvideo_pytest_plugin   (output path in env TESTVIDEO_PYTEST_JSON)
"""
from __future__ import annotations

import inspect
import json
import os
from pathlib import Path

import pytest

_results: list[dict] = []


def pytest_runtest_logreport(report):
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        outcome = report.outcome
        if hasattr(report, "wasxfail"):
            outcome = "xfailed" if report.skipped else "xpassed"
        _results.append({
            "nodeid": report.nodeid,
            "file": report.nodeid.split("::")[0],
            "outcome": outcome,
            "duration": round(report.duration, 3),
            "doc": getattr(report, "aic_doc", ""),
            "reason": getattr(report, "wasxfail", "") or (str(report.longrepr)[-400:] if report.failed else ""),
        })


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Attach the test's docstring so the video can show a plain-English description."""
    outcome = yield
    rep = outcome.get_result()
    doc = inspect.getdoc(getattr(item, "obj", None)) or ""
    rep.aic_doc = doc.splitlines()[0] if doc else item.name.replace("test_", "").replace("_", " ")


def pytest_sessionfinish(session, exitstatus):
    path = os.environ.get("TESTVIDEO_PYTEST_JSON")
    if path:
        Path(path).write_text(json.dumps(_results, indent=1), encoding="utf-8")
