"""Synthetic-data operations against production, run inside the API image on the instance (see synthetic.sh).

    python - smoke     one sealed UploadBatch per simulated session -> https://$SITE_HOST/api/v1/events/batch
                       (real TLS, real device auth, x25519-sealed AES-256-GCM chunks), then waits until the
                       worker container has processed the jobs the upload queued
    python - cleanup   after a demo-pipeline run: revoke the simulator kiosk and undo the dev-only instrument
                       approvals the pipeline records (synthetic permissions, dev-approved language versions)

Every study this touches is named SYNTHETIC; nothing here is participant data. Prints counts only, never
tokens or keys.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from nacl.public import PrivateKey, SealedBox
from shriii_api.canonical import canonical_sha256
from shriii_api.db.models.criterion import LanguageVersion, Permission
from shriii_api.db.models.ops import Job, Kiosk
from shriii_api.db.session import session_scope
from shriii_api.security import new_uuid7
from shriii_api.services import seed as seed_svc
from shriii_api.services.demo_pipeline import KIOSK_ID, DemoConfig, _device_token, simulate
from shriii_api.settings import get_settings
from sqlalchemy import func, select

SMOKE_STUDY = "synthetic-smoke"
SMOKE_NAME = "SYNTHETIC SMOKE TEST (deploy verification, not research data)"
DEV_APPROVERS = ["dev-synthetic-a", "dev-synthetic-b"]


def _sealed_chunk(private_key: bytes, session_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    dek, nonce = os.urandom(32), os.urandom(12)
    plaintext = b"\n".join(json.dumps(e, separators=(",", ":"), ensure_ascii=False).encode() for e in events)
    return {
        "encryption": "x25519_sealed_aes256gcm",
        "session_id": session_id,
        "first_seq": events[0]["seq"],
        "last_seq": events[-1]["seq"],
        "event_count": len(events),
        "sealed_dek": base64.b64encode(SealedBox(PrivateKey(private_key).public_key).encrypt(dek)).decode(),
        "nonce": base64.b64encode(nonce).decode(),
        "ciphertext": base64.b64encode(AESGCM(dek).encrypt(nonce, plaintext, None)).decode(),
    }


def smoke() -> int:
    settings = get_settings()
    host = os.environ["SITE_HOST"]
    private_key = settings.key_bytes("backend_x25519_private_key")
    started = datetime.now(UTC)
    with session_scope() as db:
        seed_svc.seed_demo_study(db, "ops:smoke", SMOKE_STUDY, name=SMOKE_NAME)
        token = _device_token(db)
    sim = simulate(DemoConfig(participants_per_language=1, retests=0, seed=4242), 4242, SMOKE_STUDY)
    statuses: dict[str, int] = {}
    batches = 0
    with httpx.Client(base_url=f"https://{host}", timeout=30.0) as client:  # default: verify TLS
        for s in sim.sessions:
            events = sorted(s.events, key=lambda e: e["seq"])
            for start in range(0, len(events), 400):
                part = events[start : start + 400]
                chunks = [_sealed_chunk(private_key, s.session_id, part)]
                body = {
                    "schema_version": "1.0",
                    "batch_id": str(new_uuid7()),
                    "kiosk_id": KIOSK_ID,
                    "kiosk_t_wall": part[-1]["timing"]["kiosk_t_wall"],
                    "sha256": canonical_sha256(chunks),
                    "event_count": len(part),
                    "session_chunks": chunks,
                }
                r = client.post("/api/v1/events/batch", json=body, headers={"Authorization": f"Bearer {token}"})
                if r.status_code != 200:
                    print(f"smoke: upload failed {r.status_code}: {r.text[:300]}")
                    return 1
                batches += 1
                for status, count in r.json()["summary"].items():
                    statuses[status] = statuses.get(status, 0) + int(count)
    print(json.dumps({"smoke_upload": {"sessions": len(sim.sessions), "batches": batches, "events": statuses}}))
    deadline = time.monotonic() + 300
    while True:
        with session_scope() as db:
            rows = db.execute(
                select(Job.status, Job.locked_by, func.count())
                .where(Job.created_at >= started)
                .group_by(Job.status, Job.locked_by)
            ).all()
        summary = [{"status": st, "worker": lb, "jobs": n} for st, lb, n in rows]
        pending = sum(n for st, _, n in rows if st in ("queued", "running"))
        if (rows and pending == 0) or time.monotonic() > deadline:
            break
        time.sleep(5)
    print(json.dumps({"jobs_since_upload": summary}))
    with session_scope() as db:
        kiosk = db.get(Kiosk, KIOSK_ID)
        if kiosk is not None:
            kiosk.status, kiosk.revoked_at = "revoked", datetime.now(UTC)
    failed = sum(n for st, _, n in rows if st == "failed")
    ok = statuses.get("accepted", 0) > 0 and rows and pending == 0 and failed == 0
    return 0 if ok else 1


def cleanup() -> int:
    now = datetime.now(UTC)
    restored = langs = 0
    with session_scope() as db:
        kiosk = db.get(Kiosk, KIOSK_ID)
        if kiosk is not None and kiosk.status != "revoked":
            kiosk.status, kiosk.revoked_at = "revoked", now
        instrument_ids = db.execute(select(Permission.instrument_id).distinct()).scalars().all()
        for instrument_id in instrument_ids:
            history = (
                db.execute(
                    select(Permission)
                    .where(Permission.instrument_id == instrument_id, Permission.language.is_(None))
                    .order_by(Permission.created_at.desc(), Permission.id.desc())
                )
                .scalars()
                .all()
            )
            if not history or history[0].holder != "synthetic":
                continue
            previous = next((p for p in history if p.holder != "synthetic"), None)
            db.add(
                Permission(
                    instrument_id=instrument_id,
                    language=None,
                    holder=previous.holder if previous else "unknown",
                    licence=previous.licence if previous else "unknown",
                    permission_status=previous.permission_status if previous else "pending",
                    permission_document=previous.permission_document if previous else None,
                    allowed_use=previous.allowed_use if previous else "Not yet licensed for production use.",
                    expiry=previous.expiry if previous else None,
                    commercial_use=previous.commercial_use if previous else False,
                    notes="Restored after a synthetic demo run (infra/ec2/synthetic_ops.py cleanup).",
                    recorded_by="ops:synthetic-cleanup",
                )
            )
            restored += 1
        for lv in db.execute(select(LanguageVersion).where(LanguageVersion.approved.is_(True))).scalars():
            if list(lv.approved_by or []) == DEV_APPROVERS:
                lv.approved, lv.itc_state, lv.approved_by, lv.approved_at = False, "draft", [], None
                langs += 1
    print(json.dumps({"cleanup": {"kiosk_revoked": KIOSK_ID, "permissions_restored": restored, "languages": langs}}))
    return 0


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "smoke":
        raise SystemExit(smoke())
    if command == "cleanup":
        raise SystemExit(cleanup())
    print(__doc__)
    raise SystemExit(2)
