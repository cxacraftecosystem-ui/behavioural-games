"""Google Sign-In (ID-token flow) for ``AUTH_MODE=local`` deployments.

The web app uses Google Identity Services, which hands the browser a Google-signed ID token (a JWT). The API
verifies it here and then signs the caller in **only** if the verified email belongs to an existing, active
staff account (``services.staff.authenticate_google``). Google is an authenticator, never a source of roles:
roles and study scope always come from ``governance.staff_users``.

Checks (all must pass):

* signature: RS256 against Google's published JWKS (``GOOGLE_JWKS_URL``, keys cached for 5 minutes);
* ``iss`` is ``accounts.google.com`` or ``https://accounts.google.com``;
* ``aud`` equals ``GOOGLE_CLIENT_ID`` (a token minted for another app is refused);
* ``exp`` (and ``iat``) present and not expired, with 60 s of leeway for clock skew;
* ``email`` present and ``email_verified`` true.

This flow needs only the OAuth client id. No client secret is used or stored.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt

GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
CLOCK_LEEWAY_S = 60


class GoogleTokenError(Exception):
    """The ID token is not a valid Google ID token for this client (401)."""


@dataclass(frozen=True, slots=True)
class GoogleIdentity:
    email: str
    subject: str
    hosted_domain: str | None


KeyResolver = Callable[[str], Any]
"""Returns the public key for a JWT (by its ``kid``); injectable for tests."""


@lru_cache(maxsize=2)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=300, timeout=10)


def jwks_key_resolver(url: str = GOOGLE_JWKS_URL) -> KeyResolver:
    client = _jwks_client(url)
    return lambda token: client.get_signing_key_from_jwt(token).key


def verify_google_id_token(
    token: str,
    client_id: str,
    *,
    key_resolver: KeyResolver | None = None,
    now: float | None = None,
) -> GoogleIdentity:
    """Verify a Google ID token and return the verified identity; raises ``GoogleTokenError``."""
    if not client_id:
        raise GoogleTokenError("Google sign-in is not configured")
    if not token or token.count(".") != 2:
        raise GoogleTokenError("malformed ID token")
    resolver = key_resolver or jwks_key_resolver()
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise GoogleTokenError("unexpected token algorithm")
        key = resolver(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=GOOGLE_ISSUERS,
            leeway=CLOCK_LEEWAY_S,
            options={"require": ["exp", "iat", "iss", "aud", "sub"], "verify_iat": False},
        )
    except GoogleTokenError:
        raise
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise GoogleTokenError(f"invalid Google ID token: {exc}") from exc
    # Explicit expiry check against an injectable clock (PyJWT checks against the real clock already).
    current = time.time() if now is None else now
    if float(claims["exp"]) + CLOCK_LEEWAY_S < current:
        raise GoogleTokenError("Google ID token has expired")
    email = claims.get("email")
    if not isinstance(email, str) or "@" not in email:
        raise GoogleTokenError("Google ID token carries no email")
    verified = claims.get("email_verified")
    if verified is not True and str(verified).lower() != "true":
        raise GoogleTokenError("Google account email is not verified")
    hd = claims.get("hd")
    return GoogleIdentity(
        email=email.strip().lower(), subject=str(claims["sub"]), hosted_domain=hd if isinstance(hd, str) else None
    )
