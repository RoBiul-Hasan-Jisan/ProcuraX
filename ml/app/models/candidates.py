"""Forecasting candidates. Each takes the training history only and returns `steps` future weekly values."""
from __future__ import annotations

import numpy as np

LAGS = 4
MIN_WEEKS = {"moving_average": 6, "exponential_smoothing": 8, "random_forest": 20, "xgboost": 30}


def moving_average(train: np.ndarray, steps: int, window: int = 4) -> np.ndarray:
    w = min(window, len(train))
    return np.full(steps, float(np.mean(train[-w:])))


def _ses_level(train: np.ndarray, alpha: float) -> tuple[float, float]:
    level = train[0]
    sse = 0.0
    for y in train[1:]:
        sse += (y - level) ** 2
        level = alpha * y + (1 - alpha) * level
    return level, sse


def exponential_smoothing(train: np.ndarray, steps: int) -> np.ndarray:
    """Simple exponential smoothing; alpha chosen by one-step SSE on the training data only."""
    best = min(((_ses_level(train, a)[1], a) for a in np.linspace(0.1, 0.9, 9)))
    level, _ = _ses_level(train, best[1])
    return np.full(steps, float(level))


def _features(history: np.ndarray, t_index: int) -> list[float]:
    """Features for predicting week t_index using only weeks < t_index."""
    lags = [history[t_index - k] for k in range(1, LAGS + 1)]
    past = history[:t_index]
    r4 = float(np.mean(history[t_index - 4:t_index]))
    r13 = float(np.mean(past[-13:]))
    woy = (t_index % 52) / 52.0  # position in the yearly cycle relative to series start
    return lags + [r4, r13, float(np.sin(2 * np.pi * woy)), float(np.cos(2 * np.pi * woy))]


def _tree_forecast(make_model, train: np.ndarray, steps: int) -> np.ndarray:
    X = [_features(train, t) for t in range(LAGS, len(train))]
    y = train[LAGS:]
    model = make_model()
    model.fit(np.array(X), y)
    hist = list(train)
    out = []
    for _ in range(steps):  # recursive: feed predictions back as history
        arr = np.array(hist)
        pred = float(model.predict(np.array([_features(arr, len(arr))]))[0])
        pred = max(pred, 0.0)
        out.append(pred)
        hist.append(pred)
    return np.array(out)


def random_forest(train: np.ndarray, steps: int) -> np.ndarray:
    from sklearn.ensemble import RandomForestRegressor
    return _tree_forecast(lambda: RandomForestRegressor(n_estimators=200, min_samples_leaf=2, random_state=0, n_jobs=1), train, steps)


def xgboost_model(train: np.ndarray, steps: int) -> np.ndarray:
    from xgboost import XGBRegressor
    return _tree_forecast(lambda: XGBRegressor(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=0, n_jobs=1), train, steps)


def available_models() -> dict:
    models = {"moving_average": moving_average, "exponential_smoothing": exponential_smoothing, "random_forest": random_forest}
    try:
        import xgboost  # noqa: F401
        models["xgboost"] = xgboost_model
    except Exception:  # optional dependency
        pass
    return models
