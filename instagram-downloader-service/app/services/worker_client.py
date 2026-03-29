import asyncio
import os
import socket
from contextlib import suppress

import httpx

from app.schemas.download import DownloadRequest, DownloadResponse, YouTubeTranscriptRequest
from app.services.instagram_downloader import (
    InstagramDownloaderError,
    download_instagram_media_locally,
    fetch_youtube_transcript,
    upload_instagram_files_to_drive,
)


WORKER_VERSION = "0.2.0"
INSTAGRAM_JOB_TYPE = "instagram_download"
YOUTUBE_TRANSCRIPT_JOB_TYPE = "youtube_transcript"


class WorkerLoop:
    def __init__(self):
        self.task: asyncio.Task | None = None
        self.running = False
        self.current_job_id: str | None = None

    @property
    def api_base_url(self) -> str:
        return os.getenv("LIFEOS_API_BASE_URL", "").strip().rstrip("/")

    @property
    def shared_secret(self) -> str:
        return os.getenv("INSTAGRAM_DOWNLOADER_SHARED_SECRET", "").strip()

    @property
    def poll_interval(self) -> float:
        return float(os.getenv("INSTAGRAM_DOWNLOADER_POLL_INTERVAL_SECONDS", "10"))

    @property
    def worker_id(self) -> str:
        return os.getenv("INSTAGRAM_DOWNLOADER_WORKER_ID", "").strip() or socket.gethostname()

    @property
    def worker_label(self) -> str:
        return os.getenv("INSTAGRAM_DOWNLOADER_WORKER_LABEL", "").strip() or "MacBook Downloader"

    def enabled(self) -> bool:
        return bool(self.api_base_url and self.shared_secret)

    async def start(self):
        if not self.enabled() or self.running:
            return
        self.running = True
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def heartbeat(self, client: httpx.AsyncClient):
        await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/heartbeat",
            headers={"x-downloader-secret": self.shared_secret},
            json={
                "worker_id": self.worker_id,
                "label": self.worker_label,
                "version": WORKER_VERSION,
                "metadata": {
                    "hostname": socket.gethostname(),
                    "download_root": os.getenv("INSTAGRAM_DOWNLOADER_DOWNLOAD_ROOT", "./downloads"),
                },
                "current_job_id": self.current_job_id,
            },
            timeout=20.0,
        )

    async def claim_job(self, client: httpx.AsyncClient):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/claim",
            headers={
                "x-downloader-secret": self.shared_secret,
                "x-worker-id": self.worker_id,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("job")

    async def complete_job(self, client: httpx.AsyncClient, job_id: str, download: DownloadResponse):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/jobs/{job_id}/complete",
            headers={"x-downloader-secret": self.shared_secret},
            json=download.model_dump(),
            timeout=60.0,
        )
        response.raise_for_status()

    async def fail_job(self, client: httpx.AsyncClient, job_id: str, error_message: str):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/jobs/{job_id}/fail",
            headers={"x-downloader-secret": self.shared_secret},
            json={"error": error_message},
            timeout=30.0,
        )
        response.raise_for_status()

    async def enrich_instagram_resource(self, client: httpx.AsyncClient, claimed_job: dict, metadata: dict):
        job = claimed_job.get("job") or {}
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/resources/{job['resource_id']}/enrich",
            headers={"x-downloader-secret": self.shared_secret},
            json={
                "owner_user_id": job["owner_user_id"],
                "source_url": job["source_url"],
                **metadata,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()

    async def update_instagram_download_state(self, client: httpx.AsyncClient, claimed_job: dict, status: str):
        job = claimed_job.get("job") or {}
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/resources/{job['resource_id']}/download-state",
            headers={"x-downloader-secret": self.shared_secret},
            json={
                "owner_user_id": job["owner_user_id"],
                "status": status,
            },
            timeout=30.0,
        )
        response.raise_for_status()

    async def process_claimed_job(self, client: httpx.AsyncClient, claimed_job: dict):
        job = claimed_job.get("job") or {}
        google_drive = claimed_job.get("google_drive") or {}
        job_type = (job.get("payload") or {}).get("job_type") or INSTAGRAM_JOB_TYPE
        self.current_job_id = job.get("id")
        await self.heartbeat(client)

        try:
          if job_type == YOUTUBE_TRANSCRIPT_JOB_TYPE:
              transcript = await fetch_youtube_transcript(
                  YouTubeTranscriptRequest(
                      url=job["source_url"],
                  )
              )
              if transcript.success:
                  await self.complete_job(client, job["id"], transcript)
              else:
                  await self.fail_job(client, job["id"], transcript.error or "YouTube transcript extraction failed.")
          else:
              request = DownloadRequest(
                  url=job["source_url"],
                  google_drive=google_drive,
                  include_analysis=job.get("include_analysis", True),
                  download_base_dir=(claimed_job.get("settings") or {}).get("download_base_dir"),
              )
              metadata, download_dir, files = await download_instagram_media_locally(request)
              enrichment_task = None
              if job.get("include_analysis", True):
                  enrichment_task = asyncio.create_task(
                      self.enrich_instagram_resource(client, claimed_job, metadata)
                  )

              await self.update_instagram_download_state(client, claimed_job, "uploading")
              drive_folder, drive_files = await upload_instagram_files_to_drive(
                  request,
                  download_dir,
                  files,
                  metadata["media_type"],
                  subfolder_name=metadata.get("drive_subfolder_name"),
              )

              enrichment_result = None
              if enrichment_task:
                  enrichment_result = await asyncio.gather(enrichment_task, return_exceptions=True)
                  if enrichment_result and isinstance(enrichment_result[0], Exception):
                      # The backend route persists enrichment failure state. Keep download completion independent.
                      pass

              download = DownloadResponse(
                  success=True,
                  input_url=job["source_url"],
                  media_type=metadata["media_type"],
                  media_type_label=metadata["media_type_label"],
                  download_dir=str(download_dir),
                  files=files,
                  media_items=metadata.get("media_items", []),
                  drive_folder=drive_folder,
                  drive_files=drive_files,
                  normalized_title=metadata["normalized_title"],
                  creator_handle=metadata["creator_handle"],
                  caption=metadata["caption"],
                  published_at=metadata["published_at"],
                  extractor=metadata.get("extractor"),
                  review_state=metadata.get("review_state"),
                  review_reason=metadata.get("review_reason"),
                  error=None,
              )
              await self.complete_job(client, job["id"], download)
        except InstagramDownloaderError as error:
          await self.fail_job(client, job["id"], error.message)
        except Exception as error:
          await self.fail_job(client, job["id"], str(error))
        finally:
          self.current_job_id = None
          await self.heartbeat(client)

    async def run(self):
        async with httpx.AsyncClient() as client:
            while self.running:
                try:
                    await self.heartbeat(client)
                    claimed_job = await self.claim_job(client)
                    if claimed_job:
                        await self.process_claimed_job(client, claimed_job)
                        continue
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Keep the local worker resilient; next loop attempts again.
                    pass

                await asyncio.sleep(max(self.poll_interval, 2.0))


worker_loop = WorkerLoop()
