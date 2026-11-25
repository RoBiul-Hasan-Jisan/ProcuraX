from __future__ import annotations

import hmac
import os
from datetime import date

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.inference.demand import forecast_demand
from app.inference.price import forecast_price
from app.utils.version import MODEL_VERSION

app = FastAPI(title="SteelProcure ML service", version=MODEL_VERSION)


def require_key(x_internal_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ML_INTERNAL_KEY", "")
    if not expected or not x_internal_key or not hmac.compare_digest(expected, x_internal_key):
        raise HTTPException(status_code=401, detail="invalid internal key")


class Point(BaseModel):
    date: date
    value: float = Field(ge=0)


class DemandRequest(BaseModel):
    points: list[Point] = Field(max_length=5000)
    asOf: date | None = None


class PriceRequest(BaseModel):
    points: list[Point] = Field(max_length=5000)
    asOf: date


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post("/v1/forecast/demand", dependencies=[Depends(require_key)])
def demand(req: DemandRequest):
    return forecast_demand([(p.date, p.value) for p in req.points], req.asOf)


@app.post("/v1/forecast/price", dependencies=[Depends(require_key)])
def price(req: PriceRequest):
    return forecast_price([(p.date, p.value) for p in req.points], req.asOf)
