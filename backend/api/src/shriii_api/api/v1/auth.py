"""Staff sign-in (AUTH_MODE=local: password, and Google when GOOGLE_CLIENT_ID is set), dev login (ENV=dev/test
only) and principal introspection."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, SecretStr

from shriii_api.api.deps import CurrentPrincipal, DbSession, SettingsDep, raise_error, set_audit
from shriii_api.auth import google as google_auth
from shriii_api.auth.tokens import AuthError, issue_dev_token, issue_local_token
from shriii_api.services import staff as staff_svc

router = APIRouter(prefix="/auth", tags=["auth"])

UserRole = Literal["admin", "researcher", "administrator", "analyst"]


class DevLoginRequest(BaseModel):
    sub: str = Field(min_length=1, max_length=256, examples=["dev-researcher"])
    roles: list[UserRole] = Field(min_length=1)
    studies: list[str] | None = Field(default=None, description="Study scope; omit or ['*'] for all studies")
    ttl_minutes: int | None = Field(default=None, ge=1, le=1440)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: int
    password_change_required: bool = Field(
        default=False, description="The account still uses an operator-issued initial password; prompt a change"
    )


class MeResponse(BaseModel):
    sub: str
    kind: str
    roles: list[str]
    studies: list[str]
    permissions: list[str]
    kiosk_id: str | None
    password_change_required: bool = False


@router.post("/dev-login", response_model=TokenResponse, summary="Issue a signed dev JWT (dev/test only)")
def dev_login(body: DevLoginRequest, settings: SettingsDep) -> TokenResponse:
    try:
        token, exp = issue_dev_token(settings, body.sub, list(body.roles), body.studies, body.ttl_minutes)
    except AuthError as exc:
        raise_error(404, "dev_login_disabled", str(exc))
    return TokenResponse(access_token=token, expires_at=exp)


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=128)
    password: SecretStr = Field(min_length=1, max_length=1024)


class PasswordChangeRequest(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=1024)
    new_password: SecretStr = Field(min_length=staff_svc.MIN_PASSWORD_LENGTH, max_length=1024)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Staff password login (AUTH_MODE=local)",
    responses={401: {"description": "Invalid credentials or locked account"}, 404: {"description": "Disabled"}},
)
def login(body: LoginRequest, request: Request, db: DbSession, settings: SettingsDep) -> TokenResponse:
    if settings.auth_mode != "local":
        raise_error(404, "password_login_disabled", "password login is not enabled on this deployment")
    username = body.username.strip().lower()
    set_audit(request, action="auth.login", resource_type="staff_user", resource_id=username)
    try:
        user = staff_svc.authenticate(db, settings, username, body.password.get_secret_value())
    except staff_svc.LoginError as exc:
        db.commit()  # keep the failure counter and lockout even though the request fails
        request.state.audit_outcome = "denied"
        raise_error(401, "invalid_credentials", str(exc))
    token, exp = issue_local_token(settings, user.username, user.roles, user.studies)
    return TokenResponse(access_token=token, expires_at=exp, password_change_required=user.must_change_password)


class GoogleLoginRequest(BaseModel):
    credential: SecretStr = Field(
        min_length=20, max_length=8192, description="Google ID token from Google Identity Services"
    )


class AuthProvidersResponse(BaseModel):
    password: bool
    google_client_id: str | None


@router.get("/providers", response_model=AuthProvidersResponse, summary="Sign-in methods enabled on this deployment")
def providers(settings: SettingsDep) -> AuthProvidersResponse:
    local = settings.auth_mode == "local"
    return AuthProvidersResponse(password=local, google_client_id=settings.google_client_id if local else None)


@router.post(
    "/google",
    response_model=TokenResponse,
    summary="Staff sign-in with a Google ID token (AUTH_MODE=local, GOOGLE_CLIENT_ID set)",
    responses={
        401: {"description": "Not a valid Google ID token for this client"},
        403: {"description": "Verified Google email is not an active staff account"},
        404: {"description": "Google sign-in is not configured"},
    },
)
def google_login(body: GoogleLoginRequest, request: Request, db: DbSession, settings: SettingsDep) -> TokenResponse:
    if settings.auth_mode != "local" or not settings.google_client_id:
        raise_error(404, "google_login_disabled", "Google sign-in is not enabled on this deployment")
    set_audit(request, action="auth.login_google", resource_type="staff_user")
    try:
        identity = google_auth.verify_google_id_token(
            body.credential.get_secret_value(),
            settings.google_client_id,
            key_resolver=google_auth.jwks_key_resolver(settings.google_jwks_url),
        )
    except google_auth.GoogleTokenError as exc:
        request.state.audit_outcome = "denied"
        set_audit(request, reason="invalid_token")
        raise_error(401, "invalid_google_token", str(exc))
    set_audit(request, resource_id=identity.email)
    try:
        user = staff_svc.authenticate_google(db, identity.email)
    except staff_svc.GoogleAccountNotAllowedError as exc:
        request.state.audit_outcome = "denied"
        set_audit(request, reason="not_a_staff_account")
        raise_error(403, "google_account_not_allowed", str(exc))
    token, exp = issue_local_token(settings, user.username, user.roles, user.studies)
    return TokenResponse(access_token=token, expires_at=exp, password_change_required=user.must_change_password)


@router.post("/password", status_code=204, summary="Change the caller's staff password (AUTH_MODE=local)")
def change_password(
    body: PasswordChangeRequest, request: Request, principal: CurrentPrincipal, db: DbSession, settings: SettingsDep
) -> Response:
    if settings.auth_mode != "local" or principal.kind != "user":
        raise_error(404, "password_login_disabled", "password login is not enabled on this deployment")
    set_audit(request, action="auth.password_change", resource_type="staff_user", resource_id=principal.sub)
    try:
        staff_svc.change_password(
            db, principal.sub, body.current_password.get_secret_value(), body.new_password.get_secret_value()
        )
    except staff_svc.LoginError as exc:
        raise_error(403, "invalid_credentials", str(exc))
    except ValueError as exc:
        raise_error(422, "weak_password", str(exc))
    return Response(status_code=204)


@router.get("/me", response_model=MeResponse, summary="Current principal")
def me(principal: CurrentPrincipal, db: DbSession, settings: SettingsDep) -> MeResponse:
    change = (
        settings.auth_mode == "local"
        and principal.kind == "user"
        and staff_svc.password_change_required(db, principal.sub)
    )
    return MeResponse(
        sub=principal.sub,
        kind=principal.kind,
        roles=sorted(r.value for r in principal.roles),
        studies=sorted(principal.studies),
        permissions=sorted(p.value for p in principal.permissions),
        kiosk_id=principal.kiosk_id,
        password_change_required=change,
    )
