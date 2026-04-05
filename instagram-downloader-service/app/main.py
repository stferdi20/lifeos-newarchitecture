from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if ((key not in os.environ) or not os.environ[key]) and value:
            os.environ[key] = value


def _load_local_env() -> None:
    service_dir = Path(__file__).resolve().parent.parent
    for candidate in (service_dir / '.env', service_dir / '.env.local'):
        _load_env_file(candidate)


_load_local_env()

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
