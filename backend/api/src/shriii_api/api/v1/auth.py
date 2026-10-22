"""Staff password login (AUTH_MODE=local), dev login (ENV=dev/test only) and principal introspection."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, SecretStr

from shriii_api.api.deps import CurrentPrincipal, DbSession, SettingsDep, raise_error, set_audit
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


class MeResponse(BaseModel):
    sub: str
    kind: str
    roles: list[str]
    studies: list[str]
    permissions: list[str]
    kiosk_id: str | None


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
    return TokenResponse(access_token=token, expires_at=exp)


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
def me(principal: CurrentPrincipal) -> MeResponse:
    return MeResponse(
        sub=principal.sub,
        kind=principal.kind,
        roles=sorted(r.value for r in principal.roles),
        studies=sorted(principal.studies),
        permissions=sorted(p.value for p in principal.permissions),
        kiosk_id=principal.kiosk_id,
    )
