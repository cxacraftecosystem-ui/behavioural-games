"""The production CORS settings in infra/ec2/api.prod.env allow exactly the Vercel app and this team's previews."""

from __future__ import annotations

import re
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[3] / "infra" / "ec2" / "api.prod.env"


def _env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip("'\"")
    return out


def test_prod_cors_is_exact() -> None:
    env = _env()
    assert env["API_CORS_ORIGINS"].split(",") == ["https://behavioural-games.vercel.app"]
    regex = re.compile(env["API_CORS_ORIGIN_REGEX"])
    allowed = [
        "https://behavioural-games-6x2kq9abc-cxacraftecosystem-8028s-projects.vercel.app",
        "https://behavioural-games-git-feat-live-backend-auth-cxacraftecosystem-8028s-projects.vercel.app",
    ]
    refused = [
        "https://behavioural-games.vercel.app.evil.example",
        "https://behavioural-games-evil.vercel.app",
        "https://behavioural-games-x-otherteam-projects.vercel.app",
        "http://behavioural-games-abc-cxacraftecosystem-8028s-projects.vercel.app",
        "https://behavioural-games-abc-cxacraftecosystem-8028s-projects.vercel.app.evil.example",
        "https://other-app-cxacraftecosystem-8028s-projects.vercel.app",
    ]
    assert all(regex.fullmatch(o) for o in allowed)
    assert not any(regex.fullmatch(o) for o in refused)
