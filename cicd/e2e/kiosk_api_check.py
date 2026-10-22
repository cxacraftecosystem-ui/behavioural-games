#!/usr/bin/env python3
"""Kiosk -> API end-to-end check (run after a full-session bot played against the real API).

The bot (``frontend/apps/kiosk/e2e/full-session.mjs --api``) plays one session in a kiosk build whose
uploader points at the API and leaves ``summary.json`` + ``events.ndjson`` (the kiosk outbox copy). This
script then checks, through the public API with a dev research token, that

* the server holds the session with no missing seq ranges and in a completed state;
* every event the kiosk stored was accepted: the server's raw events have exactly the kiosk's seqs, gapless
  from the first, with the same event ids;
* after the job worker drained the queue (``shriii-api worker --once``), the scoring pipeline wrote indicator
  rows for the session (at least ``--min-indicators``);
* with ``--timing-profile ci-headless-test`` (the test-only certified profile of the CI kiosk build), every
  kiosk event carries that profile and each indicator in ``--require-values`` has a real (non-null) value,
  unless its module ended on the time cap or the warm-up fell back to L1 (accepted with a warning).
  Without a certified profile every row is ``session_excluded``/``planned_missing`` by design.

Usage::

    uv run python cicd/e2e/kiosk_api_check.py --api-url http://127.0.0.1:8000 \
        --bot-dir e2e-artifacts/kiosk-api --token "$(uv run shriii-api dev-token --roles admin,researcher)"
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def get(api: str, path: str, token: str) -> Any:
    req = urllib.request.Request(f"{api}{path}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"GET {path}: HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:500]}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kiosk-api-check", description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--bot-dir", type=Path, required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--min-indicators", type=int, default=1)
    parser.add_argument("--timing-profile", default=None, help="timing_profile_version every event must carry")
    parser.add_argument(
        "--require-values",
        default="",
        help="comma-separated indicator ids that must have a non-null value for this session",
    )
    args = parser.parse_args(argv)
    api = args.api_url.rstrip("/")
    summary = json.loads((args.bot_dir / "summary.json").read_text(encoding="utf-8"))
    local = [json.loads(line) for line in (args.bot_dir / "events.ndjson").read_text("utf-8").splitlines() if line]
    sid = summary["sessionId"]
    failures: list[str] = []

    def check(ok: bool, msg: str) -> None:
        print(("PASS " if ok else "FAIL ") + msg)
        if not ok:
            failures.append(msg)

    detail = get(api, f"/api/v1/sessions/{sid}", args.token)
    session = detail.get("session", {})
    check(detail.get("missing_ranges") == [], f"no missing seq ranges ({detail.get('missing_ranges')})")
    check(session.get("status") in {"completed"}, f"session status ({session.get('status')})")

    server: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = get(api, f"/api/v1/sessions/{sid}/events?limit=1000&offset={offset}", args.token)
        rows = page.get("events", [])
        server.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    seqs = [int(e["seq"]) for e in server]
    check(len(server) == len(local), f"server holds every kiosk event ({len(server)} of {len(local)})")
    check(all(b == a + 1 for a, b in itertools.pairwise(seqs)), "server seq is gapless")
    check(
        [e["event_id"] for e in server] == [e["event_id"] for e in local],
        "server event ids match the kiosk outbox in seq order",
    )

    if args.timing_profile:
        profiles = sorted({str((e.get("versions") or {}).get("timing_profile_version")) for e in local})
        check(
            profiles == [args.timing_profile], f"kiosk events carry timing profile {args.timing_profile} ({profiles})"
        )

    values = get(api, f"/api/v1/features?session_id={sid}", args.token)
    with_value = [v for v in values if v.get("value") is not None]
    # Headless CI Chromium has no GPU, so most trials carry timing flags and the scorer excludes them
    # (expected): the check is that the pipeline ran and wrote indicator rows for this session.
    check(
        len(values) >= args.min_indicators,
        f"scoring produced indicator rows ({len(values)} rows, {len(with_value)} with a value)",
    )
    statuses: dict[str, int] = {}
    for v in values:
        statuses[str(v.get("status"))] = statuses.get(str(v.get("status")), 0) + 1
    print(f"  indicator statuses: {statuses}")
    for v in with_value[:20]:
        print(f"  {v.get('indicator_id')} = {v.get('value')} (n={v.get('n_valid_trials')})")
    by_id = {str(v.get("indicator_id")): v for v in values}
    # A required indicator must have a value, except for two outcomes that are correct scoring on slow CI
    # renderers rather than pipeline faults (accepted with a workflow warning):
    # - the module ended on its hard cap in wall time (GPU-less frames take 0.5-2.5 s, so Don't-Tap may not
    #   reach enough trials before 108 s): status module_incomplete, flags only module_ended:time_cap;
    # - the warm-up fell back to L1 (the bot missed warm-up windows): excluded by level_not_fixed_l2.
    # Anything else (session_excluded for quality or timing, error, missing row) fails.
    levels = [str((e.get("payload") or {}).get("level")) for e in local if e.get("event_type") == "calibration_result"]
    calibrated_l1 = levels[-1:] == ["L1"]
    for ind in [x.strip() for x in args.require_values.split(",") if x.strip()]:
        row = by_id.get(ind)
        flags = [] if row is None else list(row.get("quality_flags") or [])
        status = None if row is None else row.get("status")
        time_cap = status == "module_incomplete" and bool(flags) and set(flags) == {"module_ended:time_cap"}
        l1 = calibrated_l1 and flags == ["excluded_by:level_not_fixed_l2"]
        if row is not None and row.get("value") is None and (time_cap or l1):
            why = "the module ended on its time cap (slow renderer)" if time_cap else "the warm-up fell back to L1"
            print(f"PASS indicator {ind} has no value because {why} (expected)")
            print(f"::warning title=kiosk-api::{ind} has no value: {why}")
            continue
        check(
            row is not None and row.get("value") is not None,
            f"indicator {ind} has a real value "
            f"({None if row is None else (row.get('value'), status, flags)}; calibration {levels[-1:]})",
        )
    print(f"kiosk-api-check: {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
