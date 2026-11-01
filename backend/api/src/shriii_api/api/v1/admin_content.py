"""/api/v1/admin/content: voice-line catalogue state, ITC sign-offs and recording takes (VOX-07, VOX-02)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import defer
from starlette.concurrency import run_in_threadpool

from shriii_api.api.deps import DbSession, raise_error, require, set_audit
from shriii_api.api.schemas import ApiModel
from shriii_api.auth.rbac import Perm, Principal
from shriii_api.canonical import sha256_hex
from shriii_api.db.models.ops import AudioTake, ContentLineTransition
from shriii_api.services import audio_takes as audio_svc
from shriii_api.services import content_lines as lines_svc

router = APIRouter(prefix="/admin/content", tags=["admin"])


class LineTransitionOut(ApiModel):
    id: int | None = Field(default=None, description="Null for sign-offs recorded in the repository files")
    line_id: str
    language: str
    from_status: str
    to_status: str
    role: str
    signer: str
    comment: str
    source: str = Field(description="'api' for console sign-offs, else the repository source (e.g. xlsx:<file>)")
    recorded_by: str | None = None
    created_at: str = Field(description="ISO-8601 time (API) or date (repository)")


class LineLanguageState(BaseModel):
    status: str
    recording_status: str | None
    history: list[LineTransitionOut]
    takes: int


class ContentLineOut(BaseModel):
    line_id: str
    category: str | None
    module_id: str | None
    voice_forbidden: bool
    target_duration_ms: int | None
    languages: dict[str, LineLanguageState]


class ContentLinesOut(BaseModel):
    catalogue_version: str
    reference_language: str
    languages: list[str]
    lines: list[ContentLineOut]


class LineTransitionIn(BaseModel):
    to_status: str = Field(min_length=1, max_length=64)
    role: str = Field(min_length=1, max_length=64)
    signer: str = Field(min_length=1, max_length=256, description="Full name of the person signing off")
    comment: str = Field(default="", max_length=4000)


class AudioTakeOut(ApiModel):
    id: uuid.UUID
    line_id: str
    language: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    duration_ms: int | None
    peak_dbfs: float | None
    rms_dbfs: float | None
    status: str
    uploaded_by: str
    created_at: datetime


def _history(line_id: str, language: str, state: lines_svc.LineState) -> list[LineTransitionOut]:
    by_time = {r.created_at.isoformat(): r for r in state.transitions}
    out: list[LineTransitionOut] = []
    for h in state.history:
        row = by_time.get(h.at) if h.source == "api" else None
        out.append(
            LineTransitionOut(
                id=row.id if row else None,
                line_id=line_id,
                language=language,
                from_status=h.from_status,
                to_status=h.to_status,
                role=h.role,
                signer=h.signer,
                comment=h.comment,
                source=h.source,
                recorded_by=row.recorded_by if row else None,
                created_at=h.at,
            )
        )
    return out


def _check_line(line_id: str, language: str, *, workflow_only: bool) -> None:
    if lines_svc.line(line_id) is None:
        raise_error(404, "unknown_line", f"no voice line {line_id}")
    known = lines_svc.workflow_languages() if workflow_only else list(lines_svc.catalogue().get("languages", []))
    if language not in known:
        raise_error(404, "unknown_language", f"{language} is not an enabled language")


@router.get("/lines", response_model=ContentLinesOut, summary="Voice lines with current ITC status per language")
def content_lines(
    db: DbSession, principal: Annotated[Principal, Depends(require(Perm.ADMIN_CONTENT))]
) -> ContentLinesOut:
    cat = lines_svc.catalogue()
    languages = [str(lang) for lang in cat.get("languages", [])]
    takes = lines_svc.take_counts(db)
    lines: list[ContentLineOut] = []
    for item in cat.get("lines", []):
        line_id = str(item["id"])
        states: dict[str, LineLanguageState] = {}
        for language in languages:
            st = lines_svc.state(db, line_id, language)
            states[language] = LineLanguageState(
                status=st.status,
                recording_status=st.recording_status,
                history=_history(line_id, language, st),
                takes=takes.get((line_id, language), 0),
            )
        duration = item.get("target_duration_ms")
        lines.append(
            ContentLineOut(
                line_id=line_id,
                category=item.get("category"),
                module_id=item.get("module_id"),
                voice_forbidden=bool(item.get("voice_forbidden", False)),
                target_duration_ms=int(duration) if duration is not None else None,
                languages=states,
            )
        )
    return ContentLinesOut(
        catalogue_version=str(cat.get("catalogue_version", "")),
        reference_language=str(cat.get("reference_language", "")),
        languages=languages,
        lines=lines,
    )


@router.post(
    "/lines/{line_id}/languages/{language}/transitions",
    response_model=LineTransitionOut,
    status_code=201,
    summary="Record an ITC sign-off for one line and language (workflow rules enforced)",
)
def create_line_transition(
    line_id: str,
    language: str,
    body: LineTransitionIn,
    request: Request,
    db: DbSession,
    principal: Annotated[Principal, Depends(require(Perm.ADMIN_CONTENT))],
) -> LineTransitionOut:
    _check_line(line_id, language, workflow_only=True)
    state = lines_svc.state(db, line_id, language)
    problems = lines_svc.transition_problems(
        state.status,
        state.history,
        to_status=body.to_status,
        role=body.role,
        signer=body.signer,
        comment=body.comment,
    )
    if problems:
        code, _ = problems[0]
        raise_error(422, code, "; ".join(message for _, message in problems))
    row = ContentLineTransition(
        line_id=line_id,
        language=language,
        from_status=state.status,
        to_status=body.to_status,
        role=body.role,
        signer=body.signer.strip(),
        comment=body.comment.strip(),
        recorded_by=principal.sub,
    )
    db.add(row)
    db.flush()
    db.refresh(row)
    set_audit(
        request,
        action="content.line_transition",
        resource_type="content_line",
        resource_id=f"{line_id}/{language}",
        from_status=row.from_status,
        to_status=row.to_status,
    )
    return LineTransitionOut(
        id=row.id,
        line_id=line_id,
        language=language,
        from_status=row.from_status,
        to_status=row.to_status,
        role=row.role,
        signer=row.signer,
        comment=row.comment,
        source="api",
        recorded_by=row.recorded_by,
        created_at=row.created_at.isoformat(),
    )


@router.post(
    "/audio/{line_id}/{language}",
    response_model=AudioTakeOut,
    status_code=201,
    summary="Upload a recording take (the server re-measures duration, peak and RMS of PCM WAV)",
)
async def upload_audio_take(
    line_id: str,
    language: str,
    request: Request,
    db: DbSession,
    principal: Annotated[Principal, Depends(require(Perm.ADMIN_CONTENT))],
    file: Annotated[UploadFile, File(description="WAV (PCM) or Ogg/Opus, at most 10 MB")],
) -> AudioTakeOut:
    _check_line(line_id, language, workflow_only=False)
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in audio_svc.ACCEPTED_TYPES:
        raise_error(415, "unsupported_media_type", "upload a WAV or Ogg/Opus file")
    data = await file.read(audio_svc.MAX_BYTES + 1)
    if len(data) > audio_svc.MAX_BYTES:
        raise_error(413, "too_large", "audio takes are limited to 10 MB")
    if not data:
        raise_error(422, "empty_file", "the file is empty")
    filename = (file.filename or "take")[:256]

    def store() -> AudioTakeOut:
        measured = audio_svc.measure(data, content_type)
        row = AudioTake(
            line_id=line_id,
            language=language,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            sha256=sha256_hex(data),
            duration_ms=measured.duration_ms,
            peak_dbfs=measured.peak_dbfs,
            rms_dbfs=measured.rms_dbfs,
            status="pending_qc",
            uploaded_by=principal.sub,
            data=data,
        )
        db.add(row)
        db.flush()
        db.refresh(row)
        set_audit(
            request,
            action="content.audio_upload",
            resource_type="audio_take",
            resource_id=str(row.id),
            line_id=line_id,
            language=language,
            sha256=row.sha256,
        )
        return AudioTakeOut.model_validate(row)

    return await run_in_threadpool(store)


@router.get("/audio/{line_id}/{language}", response_model=list[AudioTakeOut], summary="Recording takes, newest first")
def list_audio_takes(
    line_id: str, language: str, db: DbSession, principal: Annotated[Principal, Depends(require(Perm.ADMIN_CONTENT))]
) -> list[AudioTakeOut]:
    _check_line(line_id, language, workflow_only=False)
    rows = db.execute(
        select(AudioTake)
        .options(defer(AudioTake.data))
        .where(AudioTake.line_id == line_id, AudioTake.language == language)
        .order_by(AudioTake.created_at.desc())
    ).scalars()
    return [AudioTakeOut.model_validate(r) for r in rows]
