from __future__ import annotations

import math
from datetime import date

import numpy as np

from app.utils.version import MODEL_VERSION

MIN_OBS = 6
MIN_SPAN_DAYS = 60
T80 = 1.2816


def forecast_price(obs: list[tuple[date, float]], as_of: date, horizons=(30, 60, 90)) -> dict:
    """Linear trend of unit price against time, with a prediction interval. A trend estimate, not a guaranteed price."""
    base = {"modelVersion": MODEL_VERSION, "isForecast": True}
    obs = sorted(obs)
    if len(obs) < MIN_OBS:
        return {**base, "status": "insufficient_data", "reason": f"Need at least {MIN_OBS} price observations; found {len(obs)}."}
    span = (obs[-1][0] - obs[0][0]).days
    if span < MIN_SPAN_DAYS:
        return {**base, "status": "insufficient_data", "reason": f"Observations span {span} days; need at least {MIN_SPAN_DAYS}."}
    t0 = obs[0][0]
    x = np.array([(d - t0).days for d, _ in obs], dtype=float)
    y = np.array([p for _, p in obs], dtype=float)
    n = len(x)
    slope, intercept = np.polyfit(x, y, 1)
    fitted = slope * x + intercept
    resid = y - fitted
    dof = n - 2
    s = float(np.sqrt(np.sum(resid ** 2) / dof))
    sxx = float(np.sum((x - x.mean()) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(np.sum(resid ** 2)) / ss_tot if ss_tot > 0 else 0.0
    last_price = float(y[-1])
    xa = float((as_of - t0).days)
    out = []
    for h in horizons:
        xf = xa + h
        pred = float(slope * xf + intercept)
        se = s * math.sqrt(1 + 1 / n + (xf - x.mean()) ** 2 / sxx) if sxx > 0 else s
        out.append({"days": h, "price": max(pred, 0.0), "low": max(pred - T80 * se, 0.0), "high": pred + T80 * se,
                    "changePercent": (pred - last_price) / last_price * 100 if last_price else None})
    return {**base, "status": "ok", "method": "linear_trend", "observations": n, "spanDays": span, "lastPrice": last_price,
            "slopePerDay": float(slope), "r2": r2, "residualStd": s, "horizons": out,
            "interval": {"level": 0.8, "method": "normal approximation (t-value approximated as 1.28); indicative only"},
            "notes": ["Price estimate, not a guaranteed future price.", "Trend is extrapolated from history and ignores market events."]}
