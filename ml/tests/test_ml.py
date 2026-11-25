from datetime import date, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.server import app
from app.evaluation.backtest import backtest, metrics
from app.inference.demand import forecast_demand, horizon_total
from app.inference.price import forecast_price
from app.models.candidates import exponential_smoothing, moving_average, random_forest
from app.preprocessing.series import to_weekly

END = date(2026, 11, 1)


def weekly_points(values, end=END):
    n = len(values)
    return [(end - timedelta(days=7 * (n - 1 - i)), float(v)) for i, v in enumerate(values)]


def test_to_weekly_sums_and_ignores_future():
    pts = [(END, 5.0), (END - timedelta(days=3), 2.0), (END - timedelta(days=8), 4.0), (END + timedelta(days=2), 999.0)]
    _, w = to_weekly(pts, END)
    assert list(w) == [4.0, 7.0] or list(w)[-1] == 7.0  # last bucket = 5 + 2
    assert 999.0 not in list(w)


def test_missing_days_count_as_zero():
    _, w = to_weekly([(END, 3.0), (END - timedelta(days=27), 3.0)], END)
    assert list(w) == [3.0, 0.0, 0.0, 3.0]


def test_partially_covered_oldest_bucket_is_dropped_not_understated():
    # the first record sits in a bucket that starts before the data does, so that bucket would be understated
    _, w = to_weekly([(END, 3.0), (END - timedelta(days=21), 3.0)], END)
    assert list(w) == [0.0, 0.0, 3.0]


def test_metrics_and_mape_undefined_with_zero_actual():
    m = metrics(np.array([10.0, 20.0]), np.array([12.0, 18.0]))
    assert m["mae"] == 2.0 and m["rmse"] == 2.0 and m["mape"] == pytest.approx(15.0)
    assert metrics(np.array([0.0, 20.0]), np.array([1.0, 18.0]))["mape"] is None


def test_moving_average_and_ses_on_constant_series():
    s = np.full(12, 7.0)
    assert list(moving_average(s, 3)) == [7.0, 7.0, 7.0]
    assert exponential_smoothing(s, 2) == pytest.approx([7.0, 7.0])


def test_backtest_never_uses_the_test_week():
    seen = []

    def spy(train, steps):
        seen.append(len(train))
        return np.zeros(steps)

    series = np.arange(1.0, 21.0)
    backtest(spy, series, min_train=10, max_folds=5)
    assert seen == [15, 16, 17, 18, 19]  # train length is always strictly less than the test index


def test_no_future_leakage_changing_later_data_does_not_change_earlier_forecast():
    base = np.array([10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19, 18, 20, 19, 21, 20, 22.0])
    a = random_forest(base[:18], 1)
    changed = base.copy(); changed[18:] = 9999
    b = random_forest(changed[:18], 1)
    assert a == pytest.approx(b)


def test_insufficient_history_is_reported_not_invented():
    r = forecast_demand(weekly_points([5, 6, 7]), END)
    assert r["status"] == "insufficient_data" and "horizons" not in r


def test_zero_consumption_is_insufficient():
    r = forecast_demand(weekly_points([0] * 20), END)
    assert r["status"] == "insufficient_data"


def test_short_history_skips_tree_models_with_a_reason():
    r = forecast_demand(weekly_points([10, 11, 9, 10, 12, 11, 10, 9, 11, 10, 12, 10]), END)
    assert r["status"] == "ok"
    skipped = {c["model"]: c for c in r["candidates"] if c["status"] == "skipped"}
    assert "random_forest" in skipped and "needs" in skipped["random_forest"]["reason"]
    assert r["selectedModel"] in ("moving_average", "exponential_smoothing")


def test_constant_demand_forecasts_constant_with_zero_width_band():
    r = forecast_demand(weekly_points([10.0] * 30), END)
    h = {x["days"]: x for x in r["horizons"]}
    assert h[7]["total"] == pytest.approx(10.0)
    assert h[30]["total"] == pytest.approx(10.0 * 30 / 7)
    assert h[30]["low"] == pytest.approx(h[30]["high"])
    assert r["isForecast"] is True


def test_long_history_evaluates_all_available_models_and_picks_lowest_rmse():
    rng = np.random.default_rng(1)
    vals = 100 + 10 * np.sin(np.arange(60) * 2 * np.pi / 13) + rng.normal(0, 2, 60)
    r = forecast_demand(weekly_points(vals), END)
    ev = [c for c in r["candidates"] if c["status"] == "evaluated"]
    assert {c["model"] for c in ev} >= {"moving_average", "exponential_smoothing", "random_forest"}
    best = min(ev, key=lambda c: c["rmse"])
    assert r["selectedModel"] == best["model"]
    assert all(x["low"] <= x["total"] <= x["high"] for x in r["horizons"])
    assert len(r["weekly"]) == 13  # ceil(90/7)


def test_horizon_total_handles_partial_weeks():
    w = np.array([7.0, 7.0, 7.0, 7.0, 7.0])
    assert horizon_total(w, 7) == 7.0
    assert horizon_total(w, 30) == pytest.approx(30.0)


def test_price_trend_detects_increase_and_labels_estimate():
    obs = [(date(2026, 1, 1) + timedelta(days=15 * i), 100 + 1.0 * 15 * i / 15 * 2 + (i % 2)) for i in range(12)]
    r = forecast_price(obs, date(2026, 6, 30))
    assert r["status"] == "ok" and r["slopePerDay"] > 0
    h30 = r["horizons"][0]
    assert h30["changePercent"] > 0 and h30["low"] <= h30["price"] <= h30["high"]
    assert any("not a guaranteed" in n for n in r["notes"])


def test_price_insufficient_data():
    assert forecast_price([(date(2026, 1, 1), 1.0)], date(2026, 6, 1))["status"] == "insufficient_data"
    short = [(date(2026, 1, 1) + timedelta(days=i), 10.0) for i in range(8)]
    assert "span" in forecast_price(short, date(2026, 2, 1))["reason"]


def test_flat_price_gives_zero_change():
    obs = [(date(2026, 1, 1) + timedelta(days=20 * i), 50.0) for i in range(8)]
    r = forecast_price(obs, date(2026, 6, 1))
    assert r["horizons"][0]["changePercent"] == pytest.approx(0.0, abs=1e-6)


client = TestClient(app)


def test_api_requires_internal_key():
    body = {"points": [{"date": "2026-10-01", "value": 1}]}
    assert client.post("/v1/forecast/demand", json=body).status_code == 401
    assert client.post("/v1/forecast/demand", json=body, headers={"X-Internal-Key": "wrong"}).status_code == 401
    assert client.get("/health").status_code == 200


def test_api_demand_roundtrip_and_validation():
    pts = [{"date": (END - timedelta(days=7 * i)).isoformat(), "value": 10 + i % 3} for i in range(30)]
    r = client.post("/v1/forecast/demand", json={"points": pts, "asOf": END.isoformat()}, headers={"X-Internal-Key": "test-key"})
    assert r.status_code == 200 and r.json()["status"] == "ok"
    bad = client.post("/v1/forecast/demand", json={"points": [{"date": "2026-10-01", "value": -5}]}, headers={"X-Internal-Key": "test-key"})
    assert bad.status_code == 422
