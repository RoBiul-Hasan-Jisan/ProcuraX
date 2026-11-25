import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.api.server:app", host=os.environ.get("API_HOST", "0.0.0.0"), port=int(os.environ.get("API_PORT", "8000")))
