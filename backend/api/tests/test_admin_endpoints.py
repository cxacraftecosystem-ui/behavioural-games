"""Admin endpoints that replaced the console's "needs API" gaps: kiosk remote commands (KSK-10), users and
grants (PRV-08), deployment policy signing (PRV-01), retention policy/runs and legal holds (PRV-05), voice-line
state, ITC sign-offs and audio takes (VOX-07, VOX-02), and game draft versions (ENG-04)."""

from __future__ import annotations

import base64
import hashlib
import io
import math
import uuid
import wave
from array import array
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from shriii_api.canonical import canonical_bytes
from shriii_api.db.session import get_engine, session_scope
from shriii_api.security import verify_ed25519
from shriii_api.testing import make_batch, session_events

STAFF_PASSWORD = "correct horse battery staple 42"


def _audited(action: str) -> int:
    with get_engine().connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM governance.audit_events WHERE action = :a"), {"a": action}
            ).scalar_one()
        )


def _command(client: TestClient, admin: dict[str, str], kiosk_id: str = "kiosk-001", **body: Any) -> Any:
    return client.post(f"/api/v1/admin/kiosks/{kiosk_id}/commands", headers=admin, json=body)


# ---------------------------------------------------------------- kiosk remote commands


def test_kiosk_command_is_idempotent_signed_delivered_and_acknowledged(
    client: TestClient, admin: dict[str, str], kiosk: dict[str, Any]
) -> None:
    from shriii_api.db.models.ops import KioskCommand  # noqa: PLC0415
    from shriii_api.services.kiosk_commands import signed_payload  # noqa: PLC0415

    first = _command(client, admin, command="lock", idempotency_key="lock-0001", reason="end of day")
    assert first.status_code == 201, first.text
    again = _command(client, admin, command="lock", idempotency_key="lock-0001")
    assert again.status_code == 200, again.text
    assert again.json()["command_id"] == first.json()["command_id"]
    listed = client.get("/api/v1/admin/kiosks/kiosk-001/commands", headers=admin).json()
    assert [c["command_id"] for c in listed] == [first.json()["command_id"]]

    pending = client.get("/api/v1/admin/kiosk-device/commands", headers=kiosk["headers"])
    assert pending.status_code == 200, pending.text
    (envelope,) = pending.json()
    assert envelope["command"] == "lock" and envelope["kiosk_id"] == "kiosk-001"
    key = client.get("/api/v1/admin/gates/release-pack/public-key").json()
    assert envelope["key_id"] == key["key_id"]
    with session_scope() as db:
        row = db.get(KioskCommand, uuid.UUID(envelope["command_id"]))
        assert row is not None and row.status == "delivered" and row.delivered_at is not None
        payload = signed_payload(row)
    assert payload["issued_at"].endswith("Z") and "." not in payload["issued_at"]
    assert verify_ed25519(base64.b64decode(key["public_key"]), canonical_bytes(payload), envelope["signature"])
    tampered = {**payload, "command": "wipe"}
    assert not verify_ed25519(base64.b64decode(key["public_key"]), canonical_bytes(tampered), envelope["signature"])

    url = f"/api/v1/admin/kiosk-device/commands/{envelope['command_id']}/ack"
    ack = client.post(url, headers=kiosk["headers"], json={"status": "acknowledged", "result": {"locked": True}})
    assert ack.status_code == 200, ack.text
    assert ack.json()["status"] == "acknowledged" and ack.json()["acknowledged_at"]
    repeat = client.post(url, headers=kiosk["headers"], json={"status": "failed", "error": "late"})
    assert repeat.status_code == 200 and repeat.json()["status"] == "acknowledged"
    assert client.get("/api/v1/admin/kiosk-device/commands", headers=kiosk["headers"]).json() == []
    assert _audited("kiosks.command") == 2
    assert _audited("kiosks.command.deliver") == 2
    assert _audited("kiosks.command.ack") == 2


def test_kiosk_command_refusals_and_cancel(
    client: TestClient, admin: dict[str, str], researcher: dict[str, str], kiosk: dict[str, Any]
) -> None:
    denied = _command(client, researcher, command="restart", idempotency_key="restart-01")
    assert denied.status_code == 403
    assert _command(client, admin, "kiosk-nope", command="sync", idempotency_key="sync-0001").status_code == 404
    bad_key = _command(client, admin, command="sync", idempotency_key="no spaces allowed")
    assert bad_key.status_code == 422
    assert client.get("/api/v1/admin/kiosk-device/commands", headers=admin).json()["detail"]["code"] == "device_only"

    sync = _command(client, admin, command="sync", idempotency_key="sync-0001").json()
    url = f"/api/v1/admin/kiosks/kiosk-001/commands/{sync['command_id']}/cancel"
    cancelled = client.post(url, headers=admin)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert client.post(url, headers=admin).json()["detail"]["code"] == "command_not_cancellable"
    assert _audited("kiosks.command.cancel") == 1

    other = client.post(
        "/api/v1/admin/kiosks", json={"kiosk_id": "kiosk-002", "site_id": "site-pune-01"}, headers=admin
    )
    other_headers = {"Authorization": f"Bearer {other.json()['device_token']}"}
    mine = _command(client, admin, command="pull_logs", idempotency_key="logs-0001").json()
    foreign = client.post(
        f"/api/v1/admin/kiosk-device/commands/{mine['command_id']}/ack",
        headers=other_headers,
        json={"status": "acknowledged"},
    )
    assert foreign.status_code == 404

    client.post("/api/v1/admin/kiosks/kiosk-002/revoke", headers=admin)
    revoked = _command(client, admin, "kiosk-002", command="lock", idempotency_key="lock-0002")
    assert revoked.status_code == 409 and revoked.json()["detail"]["code"] == "kiosk_revoked"


def test_wipe_needs_confirmation_and_is_blocked_by_a_legal_hold(
    client: TestClient, admin: dict[str, str], kiosk: dict[str, Any]
) -> None:
    no_reason = _command(client, admin, command="wipe", idempotency_key="wipe-0001", confirm_kiosk_id="kiosk-001")
    assert no_reason.status_code == 422 and no_reason.json()["detail"]["code"] == "confirm_required"
    wrong = _command(client, admin, command="wipe", idempotency_key="wipe-0001", reason="stolen", confirm_kiosk_id="x")
    assert wrong.status_code == 422 and wrong.json()["detail"]["code"] == "confirm_required"

    deployed = client.post(
        "/api/v1/admin/deployments",
        headers=admin,
        json={
            "kiosk_id": "kiosk-001",
            "site_id": "site-pune-01",
            "site_mode": "supervised",
            "study_id": "S-HOLD",
            "policy_version": "1.0.0",
            "app_version": "0.1.0",
        },
    )
    assert deployed.status_code == 201, deployed.text
    hold = client.post(
        "/api/v1/admin/legal-holds",
        headers=admin,
        json={"scope_kind": "study", "scope_value": "S-HOLD", "reason": "regulator inquiry"},
    )
    assert hold.status_code == 201, hold.text
    body = {"command": "wipe", "idempotency_key": "wipe-0002", "reason": "stolen", "confirm_kiosk_id": "kiosk-001"}
    blocked = _command(client, admin, **body)
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "legal_hold"
    client.post(f"/api/v1/admin/legal-holds/{hold.json()['id']}/release", headers=admin)
    allowed = _command(client, admin, **body)
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["command"] == "wipe" and allowed.json()["reason"] == "stolen"


# ---------------------------------------------------------------- users and grants


def test_users_and_grants(client: TestClient, admin: dict[str, str], researcher: dict[str, str]) -> None:
    from shriii_api.services import staff as staff_svc  # noqa: PLC0415

    with session_scope() as db:
        staff_svc.upsert_staff_user(db, "ops-user", STAFF_PASSWORD, ["analyst"], actor="test")
        staff_svc.upsert_staff_user(db, "admin-1", STAFF_PASSWORD, ["admin"], actor="test")
    users = client.get("/api/v1/admin/users", headers=admin)
    assert users.status_code == 200, users.text
    assert [u["username"] for u in users.json()] == ["admin-1", "ops-user"]
    assert all("password_hash" not in u for u in users.json())
    assert client.get("/api/v1/admin/users", headers=researcher).status_code == 403

    put = client.put(
        "/api/v1/admin/users/ops-user/grants",
        headers=admin,
        json={"roles": ["researcher", "analyst"], "studies": ["S-1"]},
    )
    assert put.status_code == 200, put.text
    assert put.json()["roles"] == ["analyst", "researcher"] and put.json()["studies"] == ["S-1"]
    assert _audited("users.grants") == 1

    self_demote = client.put("/api/v1/admin/users/admin-1/grants", headers=admin, json={"roles": ["researcher"]})
    assert self_demote.status_code == 409 and self_demote.json()["detail"]["code"] == "self_lockout"
    self_disable = client.put(
        "/api/v1/admin/users/admin-1/grants", headers=admin, json={"roles": ["admin"], "disabled": True}
    )
    assert self_disable.status_code == 409
    unknown = client.put("/api/v1/admin/users/nobody/grants", headers=admin, json={"roles": ["analyst"]})
    assert unknown.status_code == 404
    kiosk_role = client.put("/api/v1/admin/users/ops-user/grants", headers=admin, json={"roles": ["kiosk_device"]})
    assert kiosk_role.status_code == 422


# ---------------------------------------------------------------- deployment policy signing


def _policy(version: str = "1.0.0", **values: Any) -> dict[str, Any]:
    from shriii_api.services.policy_signing import policy_hash  # noqa: PLC0415

    vals = {"minimum_age": 18, "allow_minors": False, "site_mode": "supervised", "report_mode": "thank_you", **values}
    return {
        "policy_version": version,
        "values": vals,
        "status": "approved",
        "proposed_by": "Dr A. Rao",
        "proposed_at": "2026-11-01T09:00:00Z",
        "approvals": [{"by": "Dr B. Iyer", "at": "2026-11-01T10:00:00Z"}],
        "sha256": policy_hash(version, vals),
        "previous_sha256": None,
        "signature": None,
        "change_note": "first policy",
        "last_approved": None,
    }


def _store_policy(client: TestClient, admin: dict[str, str], doc: dict[str, Any]) -> None:
    r = client.put("/api/v1/admin/settings/deployment_policy", headers=admin, json={"value": doc})
    assert r.status_code == 200, r.text


def test_policy_signing(client: TestClient, admin: dict[str, str]) -> None:
    from shriii_api.services.policy_signing import policy_hash  # noqa: PLC0415

    sign = "/api/v1/admin/policies/1.0.0/sign"
    assert client.post(sign, headers=admin).json()["detail"]["code"] == "no_policy"

    _store_policy(client, admin, {**_policy(), "approvals": []})
    assert client.post(sign, headers=admin).json()["detail"]["code"] == "not_approved"
    _store_policy(client, admin, {**_policy(), "approvals": [{"by": "dr a. rao", "at": "x"}]})
    assert client.post(sign, headers=admin).json()["detail"]["code"] == "not_approved"
    _store_policy(client, admin, {**_policy(), "sha256": "0" * 64})
    assert client.post(sign, headers=admin).json()["detail"]["code"] == "hash_mismatch"
    _store_policy(client, admin, _policy(minimum_age=16))
    minors = client.post(sign, headers=admin)
    assert minors.status_code == 422 and minors.json()["detail"]["code"] == "rejected_combination"
    _store_policy(client, admin, _policy(report_mode="player_report"))
    assert client.post(sign, headers=admin).json()["detail"]["code"] == "rejected_combination"
    assert client.post("/api/v1/admin/policies/2.0.0/sign", headers=admin).json()["detail"]["code"] == (
        "version_mismatch"
    )

    doc = _policy()
    _store_policy(client, admin, doc)
    signed = client.post(sign, headers=admin)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["sha256"] == policy_hash("1.0.0", doc["values"]) and body["algorithm"] == "ed25519"
    key = client.get("/api/v1/admin/gates/release-pack/public-key").json()
    message = canonical_bytes({"policy_version": "1.0.0", "values": doc["values"], "sha256": body["sha256"]})
    assert verify_ed25519(base64.b64decode(key["public_key"]), message, body["signature"])
    stored = next(
        s for s in client.get("/api/v1/admin/settings", headers=admin).json() if s["key"] == "deployment_policy"
    )
    assert stored["value"]["signature"] == body["signature"]
    assert stored["value"]["signature_meta"]["key_id"] == key["key_id"]
    assert _audited("policies.sign") == 1


def test_policy_hash_matches_the_console() -> None:
    from shriii_api.services.policy_signing import policy_hash  # noqa: PLC0415

    # sha256(canonicalJson({policy_version: "1.0.0", values: {b: 1, a: [true, "x"]}})) from the web helper.
    assert policy_hash("1.0.0", {"b": 1, "a": [True, "x"]}) == (
        hashlib.sha256(b'{"policy_version":"1.0.0","values":{"a":[true,"x"],"b":1}}').hexdigest()
    )


# ---------------------------------------------------------------- retention and legal holds


def test_retention_policy_runs_and_holds(
    client: TestClient, admin: dict[str, str], researcher: dict[str, str], kiosk: dict[str, Any]
) -> None:
    policy = client.get("/api/v1/admin/retention/policy", headers=admin)
    assert policy.status_code == 200, policy.text
    rules = {r["id"]: r for r in policy.json()["rules"]}
    assert rules["play_only_raw_events"]["ttl_days"] == 90 and len(policy.json()["sha256"]) == 64
    assert client.get("/api/v1/admin/retention/policy", headers=researcher).status_code == 403

    events = session_events(pid=None)
    client.post("/api/v1/events/batch", json=make_batch(events), headers=kiosk["headers"])
    held = session_events(pid=None)
    client.post("/api/v1/events/batch", json=make_batch(held), headers=kiosk["headers"])
    first = client.post(
        "/api/v1/admin/legal-holds",
        headers=admin,
        json={"scope_kind": "session", "scope_value": held[0]["session_id"], "reason": "inquiry"},
    )
    assert first.status_code == 201 and first.json()["released_at"] is None and first.json()["created_by"] == "admin-1"
    second = client.post(
        "/api/v1/admin/legal-holds",
        headers=admin,
        json={"scope_kind": "study", "scope_value": "S-9", "reason": "audit"},
    )
    client.post(f"/api/v1/admin/legal-holds/{second.json()['id']}/release", headers=admin)
    holds = client.get("/api/v1/admin/legal-holds", headers=admin).json()
    assert [h["id"] for h in holds] == [first.json()["id"], second.json()["id"]]
    active = client.get("/api/v1/admin/legal-holds", headers=admin, params={"active_only": "true"}).json()
    assert [h["id"] for h in active] == [first.json()["id"]]

    from shriii_api.services.retention import run_retention  # noqa: PLC0415
    from shriii_api.settings import get_settings  # noqa: PLC0415

    with session_scope() as db:
        run = run_retention(
            db, get_settings(), dry_run=True, triggered_by="test", now=datetime.now(UTC) + timedelta(days=400)
        )
        # Only the unheld session's raw events would be purged.
        assert run.report["rules"]["play_only_raw_events"]["affected"] == len(events)
    runs = client.get("/api/v1/admin/retention/runs", headers=admin)
    assert runs.status_code == 200 and runs.json()[0]["dry_run"] is True


# ---------------------------------------------------------------- voice lines, ITC sign-offs, audio takes

LINE, LANG = "attract.greeting", "hi-IN"
TRANSITIONS = f"/api/v1/admin/content/lines/{LINE}/languages/{LANG}/transitions"


def test_line_transitions_follow_the_workflow(client: TestClient, admin: dict[str, str]) -> None:
    lines = client.get("/api/v1/admin/content/lines", headers=admin)
    assert lines.status_code == 200, lines.text
    greeting = next(item for item in lines.json()["lines"] if item["line_id"] == LINE)
    assert greeting["languages"][LANG]["status"] == "draft_machine_needs_native_review"

    skip = client.post(TRANSITIONS, headers=admin, json={"to_status": "approved", "role": "itc_lead", "signer": "X"})
    assert skip.status_code == 422 and skip.json()["detail"]["code"] == "invalid_transition"
    forward = {"to_status": "forward_translated", "role": "translator", "signer": "Asha Rao"}
    wrong_role = client.post(TRANSITIONS, headers=admin, json={**forward, "role": "itc_lead"})
    assert wrong_role.status_code == 422 and wrong_role.json()["detail"]["code"] == "wrong_role"
    done = client.post(TRANSITIONS, headers=admin, json=forward)
    assert done.status_code == 201, done.text
    assert done.json()["from_status"] == "draft_machine_needs_native_review" and done.json()["source"] == "api"

    back = {"to_status": "back_translated", "role": "back_translator", "signer": "asha rao"}
    same = client.post(TRANSITIONS, headers=admin, json=back)
    assert same.status_code == 422 and same.json()["detail"]["code"] == "same_signer"
    assert client.post(TRANSITIONS, headers=admin, json={**back, "signer": "Ravi Kumar"}).status_code == 201
    flagged = client.post(
        TRANSITIONS, headers=admin, json={"to_status": "flagged_for_revision", "role": "expert_reviewer", "signer": "Z"}
    )
    assert flagged.status_code == 422 and flagged.json()["detail"]["code"] == "comment_missing"

    state = next(
        i for i in client.get("/api/v1/admin/content/lines", headers=admin).json()["lines"] if i["line_id"] == LINE
    )
    language = state["languages"][LANG]
    assert language["status"] == "back_translated"
    assert [h["to_status"] for h in language["history"] if h["source"] == "api"] == [
        "forward_translated",
        "back_translated",
    ]
    assert _audited("content.line_transition") == 2
    unknown = client.post(
        "/api/v1/admin/content/lines/no.such.line/languages/hi-IN/transitions", headers=admin, json=forward
    )
    assert unknown.status_code == 404
    bad_language = client.post(
        f"/api/v1/admin/content/lines/{LINE}/languages/fr-FR/transitions", headers=admin, json=forward
    )
    assert bad_language.status_code == 404


def _wav(seconds: float = 0.5, rate: int = 16000, amplitude: float = 0.5) -> bytes:
    samples = array(
        "h", (int(amplitude * 32767 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(seconds * rate)))
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def test_audio_take_upload_is_remeasured(client: TestClient, admin: dict[str, str], researcher: dict[str, str]) -> None:
    url = f"/api/v1/admin/content/audio/{LINE}/{LANG}"
    data = _wav()
    up = client.post(url, headers=admin, files={"file": ("greeting-hi.wav", data, "audio/wav")})
    assert up.status_code == 201, up.text
    body = up.json()
    assert body["duration_ms"] == 500 and body["size_bytes"] == len(data) and body["status"] == "pending_qc"
    assert -6.5 < body["peak_dbfs"] < -5.5 and -9.6 < body["rms_dbfs"] < -8.5
    assert body["sha256"] == hashlib.sha256(data).hexdigest()
    listed = client.get(url, headers=admin).json()
    assert [t["id"] for t in listed] == [body["id"]] and "data" not in listed[0]
    lines = client.get("/api/v1/admin/content/lines", headers=admin).json()["lines"]
    assert next(i for i in lines if i["line_id"] == LINE)["languages"][LANG]["takes"] == 1
    assert _audited("content.audio_upload") == 1

    text_file = client.post(url, headers=admin, files={"file": ("notes.txt", b"hello", "text/plain")})
    assert text_file.status_code == 415
    unknown = client.post(
        f"/api/v1/admin/content/audio/no.such.line/{LANG}", headers=admin, files={"file": ("a.wav", data, "audio/wav")}
    )
    assert unknown.status_code == 404
    denied = client.post(url, headers=researcher, files={"file": ("a.wav", data, "audio/wav")})
    assert denied.status_code == 403


# ---------------------------------------------------------------- game draft versions


def test_game_draft_versions(client: TestClient, admin: dict[str, str], researcher: dict[str, str]) -> None:
    assert client.post("/api/v1/games/sync", headers=admin).status_code == 200
    game = next(g for g in client.get("/api/v1/games", headers=admin).json() if g["game_id"] == "dont_tap")
    version = game["latest_version"]["version"]
    base = client.get(f"/api/v1/games/dont_tap/versions/{version}", headers=admin).json()["config"]
    url = "/api/v1/games/dont_tap/versions"

    edited = {**base, "version": "9.9.0", "blocks": [{**base["blocks"][0], "trials": base["blocks"][0]["trials"] + 2}]}
    edited["blocks"] += base["blocks"][1:]
    created = client.post(url, headers=admin, json={"version": "9.9.0", "config": edited})
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "draft" and created.json()["source_path"] is None
    assert _audited("games.draft_create") == 1
    assert client.post(url, headers=admin, json={"version": "9.9.0", "config": edited}).status_code == 409

    locked = {**base, "version": "9.9.1", "requires_numeracy": not base["requires_numeracy"]}
    refused = client.post(url, headers=admin, json={"version": "9.9.1", "config": locked})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "locked_field_changed"
    assert refused.json()["detail"]["paths"] == ["/requires_numeracy"]

    wrong_game = client.post(url, headers=admin, json={"version": "9.9.2", "config": {**base, "module_id": "tower"}})
    assert wrong_game.status_code == 422 and wrong_game.json()["detail"]["code"] == "invalid_config"
    invalid = client.post(
        url, headers=admin, json={"version": "9.9.3", "config": {**base, "kind": 7, "version": "9.9.3"}}
    )
    assert invalid.status_code == 422
    assert client.post(
        "/api/v1/games/nope/versions", headers=admin, json={"version": "1.0.0", "config": base}
    ).status_code == (404)
    assert client.post(url, headers=researcher, json={"version": "9.9.4", "config": edited}).status_code == 403
