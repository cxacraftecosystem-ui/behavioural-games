"""Staff accounts for ``AUTH_MODE=local``: scrypt password hashes, login with lockout, CLI provisioning.

Passwords are hashed with the standard-library scrypt (N=2**15, r=8, p=1, 16-byte salt, 32-byte key) and
compared in constant time. Repeated failures lock the account for ``LOCAL_LOGIN_LOCKOUT_MINUTES``; an
unknown username costs the same hash work as a known one, so timing does not reveal which accounts exist.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from shriii_api.auth.rbac import Role
from shriii_api.db.models.ops import StaffUser
from shriii_api.settings import Settings

SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 64 * 1024 * 1024
MIN_PASSWORD_LENGTH = 16
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._@-]{1,127}$")
STAFF_ROLES = frozenset(r.value for r in Role if r is not Role.KIOSK_DEVICE)

# Verified against when the username is unknown, so a miss costs the same as a wrong password.
_DUMMY_HASH: str | None = None


class LoginError(Exception):
    """Login refused (wrong credentials, disabled or locked); the message is safe to return."""


def hash_password(password: str, *, n: int = SCRYPT_N) -> str:
    salt = os.urandom(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=n, r=SCRYPT_R, p=SCRYPT_P, maxmem=SCRYPT_MAXMEM, dklen=32)
    salt_b64, key_b64 = base64.b64encode(salt).decode(), base64.b64encode(key).decode()
    return "$".join(("scrypt", str(n), str(SCRYPT_R), str(SCRYPT_P), salt_b64, key_b64))


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, key_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(key_b64)
        key = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt_b64),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=SCRYPT_MAXMEM,
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(key, expected)


def _dummy_hash() -> str:
    global _DUMMY_HASH  # noqa: PLW0603 - computed once per process
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(base64.b64encode(os.urandom(18)).decode())
    return _DUMMY_HASH


def validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if password.strip() != password:
        raise ValueError("password must not start or end with whitespace")


@dataclass(frozen=True, slots=True)
class AuthenticatedStaff:
    username: str
    roles: list[str]
    studies: list[str]


def authenticate(db: Session, settings: Settings, username: str, password: str) -> AuthenticatedStaff:
    """Check a staff login; updates the failure counter, lockout and last-login time (caller commits)."""
    now = datetime.now(UTC)
    user = db.get(StaffUser, username.strip().lower(), with_for_update=True)
    if user is None:
        verify_password(password, _dummy_hash())
        raise LoginError("invalid username or password")
    if user.locked_until is not None and user.locked_until > now:
        verify_password(password, _dummy_hash())
        raise LoginError("account temporarily locked after repeated failures; try again later")
    if not verify_password(password, user.password_hash):
        user.failed_attempts += 1
        if user.failed_attempts >= settings.local_login_max_failures:
            user.locked_until = now + timedelta(minutes=settings.local_login_lockout_minutes)
            user.failed_attempts = 0
        raise LoginError("invalid username or password")
    if user.disabled:
        raise LoginError("invalid username or password")
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    return AuthenticatedStaff(user.username, list(user.roles), list(user.studies))


def change_password(db: Session, username: str, current: str, new: str) -> None:
    user = db.get(StaffUser, username, with_for_update=True)
    if user is None or user.disabled or not verify_password(current, user.password_hash):
        raise LoginError("current password is incorrect")
    validate_new_password(new)
    if hmac.compare_digest(current.encode(), new.encode()):
        raise ValueError("the new password must differ from the current one")
    user.password_hash = hash_password(new)
    user.password_changed_at = datetime.now(UTC)


def upsert_staff_user(
    db: Session,
    username: str,
    password: str,
    roles: Sequence[str],
    *,
    studies: Sequence[str] = ("*",),
    actor: str,
    reset: bool = False,
) -> dict[str, object]:
    """Create a staff account, or with ``reset`` replace its password and roles and unlock it."""
    username = username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("username must be 2-128 characters of a-z, 0-9, '.', '_', '@' or '-'")
    unknown = sorted(set(roles) - STAFF_ROLES)
    if not roles or unknown:
        raise ValueError(f"roles must be a non-empty subset of {sorted(STAFF_ROLES)} (unknown: {unknown})")
    validate_new_password(password)
    user = db.get(StaffUser, username)
    if user is not None and not reset:
        raise ValueError(f"staff user {username!r} already exists (pass --reset to replace its password)")
    now = datetime.now(UTC)
    if user is None:
        user = StaffUser(username=username, created_by=actor)
        db.add(user)
    user.password_hash = hash_password(password)
    user.roles = sorted(set(roles))
    user.studies = list(studies)
    user.disabled = False
    user.failed_attempts = 0
    user.locked_until = None
    user.password_changed_at = now
    db.flush()
    return {"username": username, "roles": user.roles, "studies": user.studies, "reset": reset}
