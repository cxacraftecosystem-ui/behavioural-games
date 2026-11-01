"""Signing the approved deployment policy (PRV-01).

The console stores the policy as the ``deployment_policy`` runtime setting (a ``PolicyDocument`` written by
``frontend/apps/web/src/features/admin/settings/policy.ts``): values, version, proposer, approvals and a
SHA-256 of the canonical JSON of ``{policy_version, values}``. Signing re-checks everything the console
checked (two different people, the hash, the rejected combinations) and then signs with the release-pack
Ed25519 key, so a kiosk can verify the file it is given.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from shriii_api.canonical import canonical_bytes, canonical_sha256
from shriii_api.db.models.ops import RuntimeSetting
from shriii_api.security import sign_ed25519
from shriii_api.services import gates as gate_svc
from shriii_api.settings import Settings

POLICY_SETTING_KEY = "deployment_policy"
MINIMUM_AGE = 18
REQUIRED_SIGNERS = 2


class PolicySignError(Exception):
    """Signing refused; ``code`` and ``status`` map to the API error."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True, slots=True)
class PolicySignature:
    policy_version: str
    sha256: str
    signature: str
    key_id: str
    algorithm: str
    signed_by: str
    signed_at: datetime


def policy_hash(policy_version: str, values: dict[str, Any]) -> str:
    """Same as the console's ``policyHash``: SHA-256 hex of canonical JSON of ``{policy_version, values}``."""
    return canonical_sha256({"policy_version": policy_version, "values": values})


def _signers(doc: dict[str, Any]) -> set[str]:
    people = {str(doc.get("proposed_by", "")).strip().casefold()}
    for approval in doc.get("approvals") or []:
        if isinstance(approval, dict):
            people.add(str(approval.get("by", "")).strip().casefold())
    people.discard("")
    return people


def rejected_combinations(db: Session, values: dict[str, Any]) -> list[str]:
    """PRV-01 rejected combinations (the console runs the same checks before approval)."""
    problems: list[str] = []
    age = values.get("minimum_age")
    if isinstance(age, (int, float)) and not isinstance(age, bool) and age < MINIMUM_AGE:
        problems.append("minimum age below 18")
    if values.get("allow_minors") is True:
        problems.append("allow_minors without the PRV-12 preconditions")
    if values.get("report_mode") == "player_report":
        if values.get("site_mode") == "open_public":
            problems.append("player reports at open public sites")
        pack = gate_svc.current_release_pack(db)
        if pack is None or pack.expires_at <= datetime.now(UTC):
            problems.append("player_report without a valid release pack")
    return problems


def sign_policy(db: Session, settings: Settings, policy_version: str, actor: str) -> PolicySignature:
    row = db.get(RuntimeSetting, POLICY_SETTING_KEY)
    if row is None or not isinstance(row.value, dict):
        raise PolicySignError(404, "no_policy", "no deployment policy is stored")
    doc: dict[str, Any] = dict(row.value)
    if str(doc.get("policy_version")) != policy_version:
        raise PolicySignError(409, "version_mismatch", f"the stored policy is v{doc.get('policy_version')}")
    if doc.get("status") != "approved" or len(_signers(doc)) < REQUIRED_SIGNERS:
        raise PolicySignError(409, "not_approved", "the policy needs approval by two different people")
    values = doc.get("values")
    if not isinstance(values, dict):
        raise PolicySignError(409, "hash_mismatch", "the stored policy has no values")
    digest = policy_hash(policy_version, values)
    if digest != doc.get("sha256"):
        raise PolicySignError(409, "hash_mismatch", "the stored values do not match their hash")
    problems = rejected_combinations(db, values)
    if problems:
        raise PolicySignError(422, "rejected_combination", "; ".join(problems))
    signed_at = datetime.now(UTC)
    signature = sign_ed25519(
        settings.key_bytes("release_pack_signing_key"),
        canonical_bytes({"policy_version": policy_version, "values": values, "sha256": digest}),
    )
    meta = {
        "key_id": settings.release_pack_key_id,
        "algorithm": "ed25519",
        "signed_by": actor,
        "signed_at": signed_at.isoformat(),
    }
    doc["signature"], doc["signature_meta"] = signature, meta
    last = doc.get("last_approved")
    if isinstance(last, dict) and str(last.get("policy_version")) == policy_version:
        doc["last_approved"] = {**last, "signature": signature, "signature_meta": meta}
    row.value = doc
    row.updated_by = actor
    row.updated_at = signed_at
    db.flush()
    return PolicySignature(
        policy_version=policy_version,
        sha256=digest,
        signature=signature,
        key_id=settings.release_pack_key_id,
        algorithm="ed25519",
        signed_by=actor,
        signed_at=signed_at,
    )
