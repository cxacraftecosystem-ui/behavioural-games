"""Voice-line catalogue state for the admin console (VOX-07) and ITC sign-offs recorded through the API.

The catalogue (``content/i18n/lines.yaml``), the translation files (``content/i18n/translations/<lang>.yaml``)
and the workflow (``content/i18n/translations/workflow.yaml``) are read from the repository. Sign-offs made in
the console are appended to ``governance.content_line_transitions``; the current status of a line in a
language is the last such transition, else the status in its translation file, else the workflow's initial
status. Transition rules mirror ``tools/i18n`` (``checks.transition_problems``): allowed next status, the
target's sign-off role, a review comment when required, and independent signers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from shriii_contracts.paths import content_dir
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from shriii_api.db.models.ops import AudioTake, ContentLineTransition


def _i18n_dir() -> Path:
    return content_dir() / "i18n"


def _read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


@cache
def catalogue() -> dict[str, Any]:
    return _read_yaml(_i18n_dir() / "lines.yaml")


@cache
def workflow() -> dict[str, Any]:
    return _read_yaml(_i18n_dir() / "translations" / "workflow.yaml")


@cache
def translation_file(language: str) -> dict[str, Any]:
    for lang in workflow().get("languages", []):
        if lang.get("tag") == language:
            path = _i18n_dir() / "translations" / str(lang.get("translation_file", f"{language}.yaml"))
            return _read_yaml(path) if path.is_file() else {}
    return {}


def clear_caches() -> None:
    catalogue.cache_clear()
    workflow.cache_clear()
    translation_file.cache_clear()


def workflow_languages() -> list[str]:
    return [str(lang["tag"]) for lang in workflow().get("languages", []) if "tag" in lang]


def line(line_id: str) -> dict[str, Any] | None:
    for item in catalogue().get("lines", []):
        if item.get("id") == line_id:
            return dict(item)
    return None


def _entry(language: str, line_id: str) -> dict[str, Any] | None:
    for item in translation_file(language).get("entries", []):
        if item.get("id") == line_id:
            return dict(item)
    return None


@dataclass(frozen=True, slots=True)
class HistoryItem:
    from_status: str
    to_status: str
    role: str
    signer: str
    comment: str
    source: str
    at: str


@dataclass(slots=True)
class LineState:
    status: str
    recording_status: str | None
    history: list[HistoryItem] = field(default_factory=list)
    transitions: list[ContentLineTransition] = field(default_factory=list)


def _yaml_history(entry: dict[str, Any] | None) -> list[HistoryItem]:
    out: list[HistoryItem] = []
    for ev in (entry or {}).get("history", []) or []:
        out.append(
            HistoryItem(
                from_status=str(ev.get("from_status", "")),
                to_status=str(ev.get("to_status", "")),
                role=str(ev.get("role", "")),
                signer=str(ev.get("by", "")),
                comment=str(ev.get("comment", "") or ""),
                source=str(ev.get("source", "manual")),
                at=str(ev.get("date", "")),
            )
        )
    return out


def state(db: Session, line_id: str, language: str) -> LineState:
    item = line(line_id) or {}
    recording = (item.get("recording") or {}).get(language) or {}
    entry = _entry(language, line_id)
    rows = list(
        db.execute(
            select(ContentLineTransition)
            .where(ContentLineTransition.line_id == line_id, ContentLineTransition.language == language)
            .order_by(ContentLineTransition.id)
        ).scalars()
    )
    if rows:
        status = rows[-1].to_status
    elif entry is not None and entry.get("status"):
        status = str(entry["status"])
    elif language in workflow_languages():
        status = str(workflow().get("initial_status", ""))
    else:
        status = str(recording.get("itc_state", ""))
    history = _yaml_history(entry) + [
        HistoryItem(
            from_status=r.from_status,
            to_status=r.to_status,
            role=r.role,
            signer=r.signer,
            comment=r.comment,
            source="api",
            at=r.created_at.isoformat(),
        )
        for r in rows
    ]
    rec = recording.get("status")
    return LineState(
        status=status,
        recording_status=str(rec) if rec is not None else None,
        history=history,
        transitions=rows,
    )


def take_counts(db: Session) -> dict[tuple[str, str], int]:
    rows = db.execute(
        select(AudioTake.line_id, AudioTake.language, func.count()).group_by(AudioTake.line_id, AudioTake.language)
    ).all()
    return {(str(line_id), str(language)): int(n) for line_id, language, n in rows}


def _status(status_id: str) -> dict[str, Any] | None:
    for s in workflow().get("statuses", []):
        if s.get("id") == status_id:
            return dict(s)
    return None


def transition_problems(
    current: str, history: list[HistoryItem], *, to_status: str, role: str, signer: str, comment: str
) -> list[tuple[str, str]]:
    """(code, message) problems for one sign-off; mirrors ``tools/i18n`` checks.transition_problems."""
    wf = workflow()
    target = _status(to_status)
    if target is None or _status(current) is None:
        return [("invalid_transition", f"{current!r} -> {to_status!r} uses an undeclared status")]
    problems: list[tuple[str, str]] = []
    allowed = list((wf.get("transitions") or {}).get(current, []))
    if to_status not in allowed:
        allowed_text = ", ".join(allowed) or "none"
        problems.append(
            ("invalid_transition", f"{current} -> {to_status} is not allowed; allowed next: {allowed_text}")
        )
    if not signer.strip():
        problems.append(("signoff_missing", f"moving to {to_status} needs a reviewer name"))
    required_role = target.get("signoff_role")
    if required_role == "*":
        if role not in wf.get("roles", []):
            problems.append(("wrong_role", f"role {role!r} is not a known role"))
    elif required_role and role != required_role:
        problems.append(("wrong_role", f"moving to {to_status} must be signed by a {required_role}, got {role!r}"))
    if "review_comment" in (target.get("requires") or []) and not comment.strip():
        problems.append(("comment_missing", f"moving to {to_status} needs a review comment"))
    prior: dict[str, str] = {}
    for ev in history:
        prior[ev.to_status] = ev.signer
    for pair in wf.get("independent_signers", []) or []:
        earlier, later = str(pair[0]), str(pair[1])
        if to_status == later and earlier in prior and prior[earlier].strip().casefold() == signer.strip().casefold():
            problems.append(("same_signer", f"{later} must be signed by someone other than the {earlier} signer"))
    return problems
