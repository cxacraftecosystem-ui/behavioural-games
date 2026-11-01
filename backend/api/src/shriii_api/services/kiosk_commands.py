"""Signed remote commands for kiosks (KSK-10): issue, deliver to the device, acknowledge.

A command is idempotent per kiosk by its ``idempotency_key`` (a retried click never queues a second one),
signed with the release-pack Ed25519 key so the kiosk can reject anything it did not get from this server,
and expires after :data:`COMMAND_TTL` (a lock still applies at the kiosk's next boot within that window).
A ``wipe`` is refused while an active legal hold covers the study the kiosk is deployed for.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from shriii_api.canonical import canonical_bytes
from shriii_api.db.models.ops import Deployment, KioskCommand, LegalHold
from shriii_api.security import sign_ed25519
from shriii_api.settings import Settings

COMMANDS: tuple[str, ...] = ("lock", "unlock", "restart", "sync", "pull_logs", "wipe")
COMMAND_TTL = timedelta(days=7)
OPEN_STATUSES: tuple[str, ...] = ("queued", "delivered")
FINAL_STATUSES: tuple[str, ...] = ("acknowledged", "failed", "cancelled", "expired")


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def signed_payload(cmd: KioskCommand) -> dict[str, Any]:
    """The exact object whose canonical JSON (RFC 8785) is signed and verified on the kiosk."""
    return {
        "command_id": str(cmd.command_id),
        "kiosk_id": cmd.kiosk_id,
        "command": cmd.command,
        "issued_at": _iso(cmd.created_at),
        "expires_at": _iso(cmd.expires_at),
        "nonce": cmd.nonce,
    }


def find_by_key(db: Session, kiosk_id: str, idempotency_key: str) -> KioskCommand | None:
    return db.execute(
        select(KioskCommand).where(KioskCommand.kiosk_id == kiosk_id, KioskCommand.idempotency_key == idempotency_key)
    ).scalar_one_or_none()


def held_study(db: Session, kiosk_id: str) -> str | None:
    """The study of the kiosk's active deployment when an active legal hold covers it, else None."""
    deployment = db.execute(
        select(Deployment).where(Deployment.kiosk_id == kiosk_id, Deployment.status == "active").limit(1)
    ).scalar_one_or_none()
    if deployment is None or deployment.study_id is None:
        return None
    hold = db.execute(
        select(LegalHold.id).where(
            LegalHold.released_at.is_(None),
            LegalHold.scope_kind == "study",
            LegalHold.scope_value == deployment.study_id,
        )
    ).first()
    return deployment.study_id if hold is not None else None


def issue(
    db: Session,
    settings: Settings,
    *,
    kiosk_id: str,
    command: str,
    idempotency_key: str,
    reason: str | None,
    actor: str,
    now: datetime | None = None,
) -> KioskCommand:
    """Create and sign a command (the caller has already checked the kiosk, the key and the refusals)."""
    created = (now or datetime.now(UTC)).replace(microsecond=0)
    cmd = KioskCommand(
        kiosk_id=kiosk_id,
        command=command,
        idempotency_key=idempotency_key,
        reason=reason,
        status="queued",
        issued_by=actor,
        created_at=created,
        expires_at=created + COMMAND_TTL,
        nonce=secrets.token_hex(16),
        signature="",
        key_id=settings.release_pack_key_id,
        result={},
    )
    db.add(cmd)
    db.flush()
    cmd.signature = sign_ed25519(settings.key_bytes("release_pack_signing_key"), canonical_bytes(signed_payload(cmd)))
    db.flush()
    return cmd


def expire_stale(db: Session, kiosk_id: str, now: datetime | None = None) -> None:
    """Mark open commands past their expiry as ``expired``."""
    moment = now or datetime.now(UTC)
    for cmd in db.execute(
        select(KioskCommand).where(
            KioskCommand.kiosk_id == kiosk_id,
            KioskCommand.status.in_(OPEN_STATUSES),
            KioskCommand.expires_at <= moment,
        )
    ).scalars():
        cmd.status = "expired"
    db.flush()


def pending_for_device(db: Session, kiosk_id: str, now: datetime | None = None) -> list[KioskCommand]:
    """Open, unexpired commands for the kiosk, oldest first; first delivery is stamped."""
    moment = now or datetime.now(UTC)
    expire_stale(db, kiosk_id, moment)
    rows = list(
        db.execute(
            select(KioskCommand)
            .where(KioskCommand.kiosk_id == kiosk_id, KioskCommand.status.in_(OPEN_STATUSES))
            .order_by(KioskCommand.created_at, KioskCommand.command_id)
        ).scalars()
    )
    for cmd in rows:
        if cmd.status == "queued":
            cmd.status = "delivered"
            cmd.delivered_at = moment
    db.flush()
    return rows


def acknowledge(
    cmd: KioskCommand, *, status: str, result: dict[str, Any], error: str | None, now: datetime | None = None
) -> bool:
    """Record the kiosk's outcome; returns False (and changes nothing) when the command is already final."""
    if cmd.status in FINAL_STATUSES:
        return False
    cmd.status = status
    cmd.result = result
    cmd.error = error
    cmd.acknowledged_at = now or datetime.now(UTC)
    return True
