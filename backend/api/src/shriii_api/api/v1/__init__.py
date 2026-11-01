"""API v1 router (spec section 14 groups plus auth and studies)."""

from __future__ import annotations

from fastapi import APIRouter

from shriii_api.api.schemas import ERROR_RESPONSES
from shriii_api.api.v1 import (
    admin,
    admin_content,
    assessment,
    auth,
    events,
    features,
    games,
    instruments,
    models,
    norms,
    participants,
    reports,
    sessions,
    studies,
    validation,
)

api_router = APIRouter(responses=ERROR_RESPONSES)
for module in (
    auth,
    sessions,
    events,
    games,
    participants,
    instruments,
    assessment,
    features,
    validation,
    models,
    norms,
    reports,
    studies,
    admin,
    admin_content,
):
    api_router.include_router(module.router)

__all__ = ["api_router"]
