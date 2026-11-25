from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np

from app.evaluation.backtest import backtest
from app.models.candidates import MIN_WEEKS, available_models
from app.preprocessing.series import to_weekly
from app.utils.version import MODEL_VERSION

HORIZONS = (7, 30, 60, 90)
MIN_HISTORY_WEEKS = 8
Z80 = 1.2816  # two-sided 80% interval under a normal approximation


def horizon_total(weekly: np.ndarray, days: int) -> float:
    weeks = math.ceil(days / 7)
    full = float(np.sum(weekly[: weeks - 1]))
    return full + float(weekly[weeks - 1]) * (days - 7 * (weeks - 1)) / 7.0


def forecast_demand(points: list[tuple[date, float]], as_of: date | None = None, horizons=HORIZONS) -> dict:
    """Returns a machine-readable forecast, or {"status": "insufficient_data", ...}. Never invents numbers."""
    start, series = to_weekly(points, as_of)
    base = {"modelVersion": MODEL_VERSION, "isForecast": True, "historyWeeks": int(len(series)), "unit": "per_week"}
    if len(series) < MIN_HISTORY_WEEKS:
        return {**base, "status": "insufficient_data", "reason": f"Need at least {MIN_HISTORY_WEEKS} weeks of history; found {len(series)}."}
    if float(np.sum(series)) == 0:
        return {**base, "status": "insufficient_data", "reason": "No consumption recorded in the history window."}

    candidates, usable = [], {}
    for name, fn in available_models().items():
        if len(series) < MIN_WEEKS[name]:
            candidates.append({"model": name, "status": "skipped", "reason": f"needs {MIN_WEEKS[name]} weeks of history, have {len(series)}"})
            continue
        bt = backtest(fn, series, min_train=max(MIN_WEEKS[name], 6))
        if bt is None:
            candidates.append({"model": name, "status": "skipped", "reason": "not enough history left for backtesting"})
            continue
        candidates.append({"model": name, "status": "evaluated", **bt})
        usable[name] = (fn, bt)
    if not usable:
        return {**base, "status": "insufficient_data", "reason": "History too short to backtest any model."}

    # Lowest backtest RMSE wins; ties go to the simpler (earlier) model.
    best = min(usable, key=lambda k: (round(usable[k][1]["rmse"], 9), list(usable).index(k)))
    fn, bt = usable[best]
    max_h = max(horizons)
    steps = math.ceil(max_h / 7)
    weekly = fn(series, steps)
    end = as_of or max(d for d, _ in points)
    std = bt["residual_std"]
    weekly_out = [{"weekStart": (end + timedelta(days=1 + 7 * i)).isoformat(), "point": float(weekly[i]),
                   "low": max(0.0, float(weekly[i]) - Z80 * std), "high": float(weekly[i]) + Z80 * std} for i in range(steps)]
    hz = []
    for h in horizons:
        total = horizon_total(weekly, h)
        weeks = math.ceil(h / 7)
        band = Z80 * std * math.sqrt(weeks)  # errors assumed independent across weeks
        hz.append({"days": h, "total": total, "low": max(0.0, total - band), "high": total + band})
    return {**base, "status": "ok", "selectedModel": best, "candidates": candidates, "horizons": hz, "weekly": weekly_out,
            "historyStart": start.isoformat(), "historyEnd": end.isoformat(), "history": [float(x) for x in series],
            "interval": {"level": 0.8, "method": "normal approximation from backtest residuals; indicative only"},
            "notes": ["This is a forecast, not an actual value.", "Models are re-fitted on each request using only data up to the history end."]}
