"""Turn raw dated consumption records into a regular weekly series. Pure functions, no I/O."""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np


def to_weekly(points: list[tuple[date, float]], end: date | None = None) -> tuple[date, np.ndarray]:
    """Sum quantities into 7-day buckets. The LAST bucket ends on `end` (default: last observation), so the
    most recent bucket is always complete; earlier days that do not fill a whole bucket are dropped from the start.
    Returns (start date of first bucket, weekly totals). Missing days count as zero consumption."""
    if not points:
        return (end or date.today()), np.array([], dtype=float)
    last = end or max(d for d, _ in points)
    first = min(d for d, _ in points)
    n_weeks = (last - first).days // 7 + 1 if (last - first).days >= 0 else 0
    # buckets are [last-7k-6, last-7k]
    totals = np.zeros(n_weeks, dtype=float)
    for d, q in points:
        age = (last - d).days
        if age < 0:
            continue  # after `end`: never used (no future leakage)
        k = age // 7
        if k < n_weeks:
            totals[n_weeks - 1 - k] += q
    # drop the oldest bucket if it is only partially covered by the data window
    start = last - timedelta(days=7 * n_weeks - 1)
    if start < first and n_weeks > 1:
        totals = totals[1:]
        start = start + timedelta(days=7)
    return start, totals
