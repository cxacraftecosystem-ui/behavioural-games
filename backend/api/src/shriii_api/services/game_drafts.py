"""New draft versions of a game config saved from the admin console (ENG-04).

A draft is validated against the ``game-config`` contract and compared with the latest approved version:
identity and science fields are locked (they change only through a signed amendment and a content commit).
:data:`LOCKED_FIELDS` mirrors ``frontend/apps/web/src/features/admin/games/config-checks.ts`` so the server
refuses what the editor flags; ``*`` matches one JSON-pointer segment.
"""

from __future__ import annotations

from typing import Any

from shriii_contracts.schema_validation import iter_errors

LOCKED_FIELDS: tuple[str, ...] = (
    "/module_id",
    "/kind",
    "/schema_version",
    "/pathways",
    "/constructs",
    "/indicators",
    "/scorable",
    "/min_counts",
    "/blocks/*/min_trials",
    "/blocks/*/scorable",
    "/requires_numeracy",
    "/slot",
    "/paradigms",
    "/blocks/*/block_id",
    "/blocks/*/phase",
    "/blocks/*/condition_id",
    "/blocks/*/conditions",
    "/context_shift",
    "/constraints/premature_threshold_ms",
    "/constraints/integrity_dice_mode",
    "/constraints/true_outcome_logged",
    "/constraints/luck_tokens_group_only",
    "/constraints/voice_forbidden",
    "/constraints/headset_required_open_public",
    "/constraints/site_mode_required",
    "/constraints/separate_consent_per_player",
)


def _escape(segment: str) -> str:
    return segment.replace("~", "~0").replace("/", "~1")


def json_diff(before: Any, after: Any, path: str = "") -> list[str]:
    """JSON pointers of leaf-level changes (arrays index by index), like the web's ``jsonDiff``."""
    if isinstance(before, dict) and isinstance(after, dict):
        out: list[str] = []
        for key in sorted(set(before) | set(after)):
            child = f"{path}/{_escape(str(key))}"
            if key not in before or key not in after:
                out.append(child)
            else:
                out += json_diff(before[key], after[key], child)
        return out
    if isinstance(before, list) and isinstance(after, list):
        out = []
        for i in range(max(len(before), len(after))):
            child = f"{path}/{i}"
            if i >= len(before) or i >= len(after):
                out.append(child)
            else:
                out += json_diff(before[i], after[i], child)
        return out
    if type(before) is not type(after) or before != after:
        return [path or "/"]
    return []


def _matches(path: str, pattern: str) -> bool:
    p, q = path.split("/"), pattern.split("/")
    return len(p) >= len(q) and all(seg in ("*", p[i]) for i, seg in enumerate(q))


def _ancestor_of(path: str, pattern: str) -> bool:
    p = [""] if path == "/" else path.split("/")
    q = pattern.split("/")
    return len(p) < len(q) and all(q[i] in ("*", seg) for i, seg in enumerate(p))


def locked_changes(base: dict[str, Any], draft: dict[str, Any]) -> list[str]:
    """Changed paths that touch a locked field (at, under or above it)."""
    return [
        path
        for path in json_diff(base, draft)
        if any(_matches(path, pat) or _ancestor_of(path, pat) for pat in LOCKED_FIELDS)
    ]


def schema_errors(config: dict[str, Any]) -> list[str]:
    """Contract violations of a game config (empty when valid)."""
    out: list[str] = []
    for err in iter_errors("game-config", config):
        where = "/" + "/".join(str(p) for p in err.absolute_path)
        out.append(f"{where}: {err.message}")
    return out
