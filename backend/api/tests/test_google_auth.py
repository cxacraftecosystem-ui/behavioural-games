"""Google sign-in: the ID-token verifier (mocked JWKS) and the staff allowlist rule."""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from shriii_api.auth import google as google_auth
from shriii_api.services import staff as staff_svc
from shriii_api.settings import Settings, get_settings

CLIENT_ID = "1234567890-test.apps.googleusercontent.com"
LOCAL_SECRET = "local-test-secret-0123456789abcdef-0123456789"
PASSWORD = "correct horse battery staple 42"

_GOOGLE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _resolver(token: str) -> Any:
    """Mocked Google JWKS: one key with kid 'g1'; any other kid is unknown."""
    kid = jwt.get_unverified_header(token).get("kid")
    if kid != "g1":
        raise jwt.PyJWKClientError(f"Unable to find a signing key that matches: {kid!r}")
    return _GOOGLE_KEY.public_key()


def _token(key: Any = _GOOGLE_KEY, kid: str = "g1", alg: str = "RS256", **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "110169484474386276334",
        "email": "Staff.Member@Example.org",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    for k in [k for k, v in claims.items() if v is None]:
        del claims[k]
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid})


def _verify(token: str) -> google_auth.GoogleIdentity:
    return google_auth.verify_google_id_token(token, CLIENT_ID, key_resolver=_resolver)


# --- verifier -----------------------------------------------------------------------------------


def test_valid_token_yields_a_normalised_identity() -> None:
    identity = _verify(_token())
    assert identity.email == "staff.member@example.org"
    assert identity.subject == "110169484474386276334"
    # Both issuer spellings Google uses are accepted.
    assert _verify(_token(iss="accounts.google.com")).email == "staff.member@example.org"
    # email_verified sometimes arrives as a string.
    assert _verify(_token(email_verified="true")).email == "staff.member@example.org"


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"aud": "someone-else.apps.googleusercontent.com"}, "(?i)audience"),
        ({"iss": "https://evil.example.com"}, "issuer"),
        ({"exp": int(time.time()) - 3600}, "expired"),
        ({"exp": None}, "exp"),
        ({"email_verified": False}, "not verified"),
        ({"email_verified": None}, "not verified"),
        ({"email": None}, "no email"),
        ({"sub": None}, "sub"),
    ],
)
def test_claims_are_enforced(overrides: dict[str, Any], match: str) -> None:
    with pytest.raises(google_auth.GoogleTokenError, match=match):
        _verify(_token(**overrides))


def test_signature_and_key_are_enforced() -> None:
    with pytest.raises(google_auth.GoogleTokenError, match="Signature"):
        _verify(_token(key=_OTHER_KEY))  # right kid, wrong key
    with pytest.raises(google_auth.GoogleTokenError, match="signing key"):
        _verify(_token(kid="unknown"))
    hs = jwt.encode({"iss": "accounts.google.com", "aud": CLIENT_ID}, "x" * 32, algorithm="HS256")
    with pytest.raises(google_auth.GoogleTokenError, match="algorithm"):
        _verify(hs)
    with pytest.raises(google_auth.GoogleTokenError, match="malformed"):
        _verify("not-a-jwt")


def test_injected_clock_rejects_tokens_expired_at_that_time() -> None:
    token = _token()
    with pytest.raises(google_auth.GoogleTokenError, match="expired"):
        google_auth.verify_google_id_token(token, CLIENT_ID, key_resolver=_resolver, now=time.time() + 7200)


def test_unconfigured_client_id_refuses() -> None:
    with pytest.raises(google_auth.GoogleTokenError, match="not configured"):
        google_auth.verify_google_id_token(_token(), "", key_resolver=_resolver)


def test_blank_client_id_setting_means_disabled() -> None:
    assert Settings(ENV="test", google_client_id="  ").google_client_id is None
    assert Settings(ENV="test", google_client_id=f" {CLIENT_ID} ").google_client_id == CLIENT_ID


# --- allowlist rule and endpoint (PostgreSQL) -----------------------------------------------------


@pytest.fixture
def google_client(db_ready: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    from shriii_api.main import create_app  # noqa: PLC0415

    monkeypatch.setattr(google_auth, "jwks_key_resolver", lambda url=google_auth.GOOGLE_JWKS_URL: _resolver)
    local = Settings(ENV="test", auth_mode="local", local_jwt_secret=LOCAL_SECRET, google_client_id=CLIENT_ID)
    app = create_app(local)
    app.dependency_overrides[get_settings] = lambda: local
    with TestClient(app) as c:
        yield c


def _create(username: str, roles: tuple[str, ...] = ("researcher",), **kw: Any) -> None:
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        staff_svc.upsert_staff_user(db, username, PASSWORD, list(roles), actor="test", **kw)


def _audit_rows(action: str) -> list[Any]:
    from sqlalchemy import select  # noqa: PLC0415

    from shriii_api.db.models.ops import AuditEvent  # noqa: PLC0415
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        rows = db.execute(select(AuditEvent).where(AuditEvent.action == action)).scalars().all()
        return [(r.outcome, r.status_code, r.resource_id, dict(r.details)) for r in rows]


def test_google_signs_in_only_existing_active_staff(google_client: TestClient) -> None:
    _create("staff.member@example.org", roles=("researcher",), studies=("study-a",))
    r = google_client.post("/api/v1/auth/google", json={"credential": _token()})
    assert r.status_code == 200, r.text
    assert r.json()["password_change_required"] is True  # CLI-issued initial password still in place
    me = google_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.status_code == 200, me.text
    # Roles and study scope come from the staff record, never from Google.
    assert me.json()["sub"] == "staff.member@example.org"
    assert me.json()["roles"] == ["researcher"] and me.json()["studies"] == ["study-a"]
    assert me.json()["password_change_required"] is True


def test_unknown_google_email_is_refused_and_audited(google_client: TestClient) -> None:
    r = google_client.post("/api/v1/auth/google", json={"credential": _token(email="stranger@example.org")})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "google_account_not_allowed"
    rows = _audit_rows("auth.login_google")
    assert rows == [("denied", 403, "stranger@example.org", {"reason": "not_a_staff_account"})]
    # No account was created as a side effect.
    from shriii_api.db.models.ops import StaffUser  # noqa: PLC0415
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        assert db.get(StaffUser, "stranger@example.org") is None


def test_disabled_staff_and_bad_tokens_are_refused(google_client: TestClient) -> None:
    _create("staff.member@example.org")
    from shriii_api.db.models.ops import StaffUser  # noqa: PLC0415
    from shriii_api.db.session import session_scope  # noqa: PLC0415

    with session_scope() as db:
        user = db.get(StaffUser, "staff.member@example.org")
        assert user is not None
        user.disabled = True
    assert google_client.post("/api/v1/auth/google", json={"credential": _token()}).status_code == 403
    bad = google_client.post("/api/v1/auth/google", json={"credential": _token(aud="other-client")})
    assert bad.status_code == 401 and bad.json()["detail"]["code"] == "invalid_google_token"
    unverified = google_client.post("/api/v1/auth/google", json={"credential": _token(email_verified=False)})
    assert unverified.status_code == 401
    outcomes = {row[:2] for row in _audit_rows("auth.login_google")}
    assert outcomes == {("denied", 403), ("denied", 401)}


def test_providers_and_disabled_google(client: TestClient, google_client: TestClient) -> None:
    assert google_client.get("/api/v1/auth/providers").json() == {"password": True, "google_client_id": CLIENT_ID}
    # The default test app runs AUTH_MODE=dev: Google sign-in is off (404) and not advertised.
    assert client.get("/api/v1/auth/providers").json() == {"password": False, "google_client_id": None}
    assert client.post("/api/v1/auth/google", json={"credential": _token()}).status_code == 404


def test_password_change_clears_the_prompt(google_client: TestClient) -> None:
    _create("ops-researcher")
    login = google_client.post("/api/v1/auth/login", json={"username": "ops-researcher", "password": PASSWORD})
    assert login.json()["password_change_required"] is True
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    new = "an entirely different passphrase 7"
    ok = google_client.post(
        "/api/v1/auth/password", json={"current_password": PASSWORD, "new_password": new}, headers=headers
    )
    assert ok.status_code == 204, ok.text
    assert google_client.get("/api/v1/auth/me", headers=headers).json()["password_change_required"] is False
    again = google_client.post("/api/v1/auth/login", json={"username": "ops-researcher", "password": new})
    assert again.json()["password_change_required"] is False


def test_service_accounts_can_skip_the_prompt(google_client: TestClient) -> None:
    _create("smoke-test@shriii.local", require_change=False)
    login = google_client.post("/api/v1/auth/login", json={"username": "smoke-test@shriii.local", "password": PASSWORD})
    assert login.status_code == 200 and login.json()["password_change_required"] is False
