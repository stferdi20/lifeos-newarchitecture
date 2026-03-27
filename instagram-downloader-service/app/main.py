from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.routes.download import router as download_router
from app.services.worker_client import worker_loop


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await worker_loop.start()
    try:
        yield
    finally:
        await worker_loop.stop()


app = FastAPI(title="LifeOS Instagram Downloader", version="0.1.0", lifespan=lifespan)
app.include_router(download_router)


@app.get("/health")
async def health_check():
    return {
        "ok": True,
        "service": "instagram-downloader",
        "worker_enabled": worker_loop.enabled(),
        "worker_id": worker_loop.worker_id if worker_loop.enabled() else None,
        "current_job_id": worker_loop.current_job_id,
    }
