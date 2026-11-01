"""Recording takes uploaded through the admin console (VOX-02).

The server re-measures what it can from the bytes it received instead of trusting the browser: for PCM
WAV that is the duration, the sample peak and the RMS level (dBFS, all channels). Compressed formats are
stored with those fields empty; ``tools/audio-pipeline`` measures integrated loudness (LUFS) and true peak
in the full QC run.
"""

from __future__ import annotations

import io
import math
import sys
import wave
from array import array
from dataclasses import dataclass

MAX_BYTES = 10 * 1024 * 1024
WAV_TYPES = frozenset({"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"})
ACCEPTED_TYPES = WAV_TYPES | frozenset({"audio/ogg", "audio/opus"})
_ARRAY_CODES = {1: "b", 2: "h", 4: "i"}


@dataclass(frozen=True, slots=True)
class Measurement:
    duration_ms: int | None
    peak_dbfs: float | None
    rms_dbfs: float | None


def _dbfs(value: float) -> float:
    return round(20 * math.log10(value), 2) if value > 0 else -120.0


def measure(data: bytes, content_type: str) -> Measurement:
    """Duration, peak and RMS of a PCM WAV take; empty for other formats or unreadable files."""
    if content_type not in WAV_TYPES:
        return Measurement(None, None, None)
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            width = wav.getsampwidth()
            raw = wav.readframes(frames)
    except (wave.Error, EOFError):
        return Measurement(None, None, None)
    duration_ms = round(frames * 1000 / rate) if rate > 0 else None
    code = _ARRAY_CODES.get(width)
    if code is None or not raw:
        return Measurement(duration_ms, None, None)
    samples = array(code)
    samples.frombytes(raw[: len(raw) - len(raw) % width])
    if sys.byteorder == "big":
        samples.byteswap()
    if width == 1:
        # 8-bit WAV is unsigned: re-centre on zero.
        values = [s + 128 if s < 0 else s - 128 for s in samples]
        full_scale = 128.0
    else:
        values = list(samples)
        full_scale = float(2 ** (8 * width - 1))
    if not values:
        return Measurement(duration_ms, None, None)
    peak = max(abs(v) for v in values) / full_scale
    rms = math.sqrt(sum(v * v for v in values) / len(values)) / full_scale
    return Measurement(duration_ms, _dbfs(peak), _dbfs(rms))
