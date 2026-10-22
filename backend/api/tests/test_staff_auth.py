"""Self-hosted staff login (AUTH_MODE=local): hashing, settings, login, lockout, password change, CLI."""

from __future__ import annotations

import io
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from shriii_api.services import staff as staff_svc
from shriii_api.settings import Settings, get_settings

LOCAL_SECRET = "local-test-secret-0123456789abcdef-0123456789"
PASSWORD = "correct horse battery staple 42"


def test_password_hash_round_trip() -> None:
    stored = staff_svc.hash_password(PASSWORD, n=2**10)
    assert stored.startswith("scrypt$1024$8$1$")
    assert PASSWORD not in stored
    assert staff_svc.verify_password(PASSWORD, stored)
    assert not staff_svc.verify_password(PASSWORD + "x", stored)
    assert not staff_svc.verify_password(PASSWORD, "not-a-hash")
    assert staff_svc.hash_password(PASSWORD, n=2**10) != stored  # salted


def test_new_password_rules() -> None:
    with pytest.raises(ValueError, match="at least"):
        staff_svc.validate_new_password("short")
    with pytest.raises(ValueError, match="whitespace"):
        staff_svc.validate_new_password(" " + PASSWORD)
    staff_svc.validate_new_password(PASSWORD)


def test_local_mode_needs_a_strong_secret() -> None:
    with pytest.raises(ValueError, match="LOCAL_JWT_SECRET"):
        Settings(ENV="test", auth_mode="local")
    with pytest.raises(ValueError, match="LOCAL_JWT_SECRET"):
        Settings(ENV="test", auth_mode="local", local_jwt_secret="too-short")
    assert Settings(ENV="test", auth_mode="local", local_jwt_secret=LOCAL_SECRET).auth_mode == "local"


def test_prod_accepts_local_mode_with_explicit_keys() -> None:
    key = "A" * 43 + "="
    names = (
        "pid_hmac_pepper",
        "session_key_kek",
        "backend_x25519_private_key",
        "release_pack_signing_key",
        "identity_vault_key",
    )
    keys: dict[str, Any] = dict.fromkeys(names, key)
    s = Settings(ENV="prod", auth_mode="local", local_jwt_secret=LOCAL_SECRET, **keys)
    assert not s.is_dev and s.accept_plaintext_chunks is False
    with pytest.raises(ValueError, match="AUTH_MODE=dev"):
        Settings(ENV="prod", auth_mode="dev", **keys)


@pytest.fixture
def local_client(db_ready: None) -> Iterator[TestClient]:
    from shriii_api.main import create_app  # noqa: PLC0415

    local = Settings(ENV="test", auth_mode="local", local_jwt_secret=LOCAL_SECRET, local_login_max_failures=3)
    app = create_app(local)
    app.dependency_overrides[get_settings] = lambda: local
    with TestClient(app) as c:
        yield c


def _create(username: str = "ops-admin", roles: tuple[str, ...] = ("admin",), **kw: Any) -> dict[str, Any]:
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        return staff_svc.upsert_staff_user(db, username, PASSWORD, list(roles), actor="test", **kw)


def test_login_issues_a_working_token(local_client: TestClient) -> None:
    _create()
    r = local_client.post("/api/v1/auth/login", json={"username": "OPS-admin ", "password": PASSWORD})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = local_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["sub"] == "ops-admin" and me.json()["roles"] == ["admin"]
    # dev login is refused in local mode
    dev = local_client.post("/api/v1/auth/dev-login", json={"sub": "x", "roles": ["admin"]})
    assert dev.status_code == 404


def test_wrong_password_and_lockout(local_client: TestClient) -> None:
    _create()
    for _ in range(3):
        r = local_client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": "wrong-password"})
        assert r.status_code == 401
        assert r.json()["detail"]["code"] == "invalid_credentials"
    locked = local_client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": PASSWORD})
    assert locked.status_code == 401 and "locked" in locked.json()["detail"]["message"]
    unknown = local_client.post("/api/v1/auth/login", json={"username": "nobody", "password": PASSWORD})
    assert unknown.status_code == 401


def test_password_change(local_client: TestClient) -> None:
    _create(roles=("researcher",))
    token = local_client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": PASSWORD}).json()[
        "access_token"
    ]
    headers = {"Authorization": f"Bearer {token}"}
    new = "an entirely different passphrase 7"
    bad = local_client.post(
        "/api/v1/auth/password", json={"current_password": "nope", "new_password": new}, headers=headers
    )
    assert bad.status_code == 403
    ok = local_client.post(
        "/api/v1/auth/password", json={"current_password": PASSWORD, "new_password": new}, headers=headers
    )
    assert ok.status_code == 204, ok.text
    assert local_client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": new}).status_code == 200
    assert (
        local_client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": PASSWORD}).status_code == 401
    )


def test_login_is_disabled_outside_local_mode(client: TestClient) -> None:
    r = client.post("/api/v1/auth/login", json={"username": "ops-admin", "password": PASSWORD})
    assert r.status_code == 404


def test_upsert_rules(db_ready: None) -> None:
    _create()
    with pytest.raises(ValueError, match="already exists"):
        _create()
    _create(reset=True, roles=("admin", "researcher"))
    with pytest.raises(ValueError, match="roles"):
        _create("someone", roles=("kiosk_device",))
    with pytest.raises(ValueError, match="username"):
        _create("Bad Name!")


def test_cli_reads_the_password_from_stdin(db_ready: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from shriii_api.cli import main  # noqa: PLC0415

    monkeypatch.setattr("sys.stdin", io.StringIO(PASSWORD + "\n"))
    assert main(["create-staff-user", "cli-admin", "--roles", "admin"]) == 0
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    assert main(["create-staff-user", "cli-admin2"]) == 2
    from shriii_api.db.models.ops import StaffUser  # noqa: PLC0415
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        user = db.get(StaffUser, "cli-admin")
        assert user is not None and user.roles == ["admin"] and PASSWORD not in user.password_hash
        assert db.get(StaffUser, "cli-admin2") is None
