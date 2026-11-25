"""Rolling-origin (expanding window) backtesting. The model for fold k sees only weeks before the test week; no shuffling."""
from __future__ import annotations

import numpy as np


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    err = actual - predicted
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    # MAPE divides by the actual value, so it is undefined when any actual is zero.
    mape = float(np.mean(np.abs(err) / np.abs(actual)) * 100) if np.all(actual != 0) else None
    return {"mae": mae, "rmse": rmse, "mape": mape}


def backtest(fn, series: np.ndarray, min_train: int, max_folds: int = 8) -> dict | None:
    """One-step-ahead errors over the last `max_folds` weeks. Returns None if there is not enough data."""
    n = len(series)
    folds = min(max_folds, n - min_train)
    if folds < 3:
        return None
    actual, pred = [], []
    for t in range(n - folds, n):
        train = series[:t]  # strictly before the test week
        pred.append(float(fn(train, 1)[0]))
        actual.append(float(series[t]))
    a, p = np.array(actual), np.array(pred)
    out = metrics(a, p)
    out["folds"] = folds
    out["residual_std"] = float(np.std(a - p, ddof=1)) if folds > 1 else 0.0
    return out
