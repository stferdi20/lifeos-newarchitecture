import base64
import asyncio
import logging
import os
import socket
from contextlib import suppress
from pathlib import Path

import httpx

from app.schemas.download import DownloadRequest, DownloadResponse, YouTubeTranscriptRequest
from app.services.instagram_downloader import (
    cleanup_download_dir,
    apply_durable_preview_urls,
    compress_thumbnail_bytes,
    build_thumbnail_upload_name,
    find_first_file_by_type,
    generate_reel_preview_frame,
    InstagramDownloaderError,
    download_instagram_media_locally,
    fetch_youtube_transcript,
    normalize_whitespace,
    select_thumbnail_source_file,
    upload_instagram_files_to_drive,
)


WORKER_VERSION = "0.2.0"
INSTAGRAM_JOB_TYPE = "instagram_download"
YOUTUBE_TRANSCRIPT_JOB_TYPE = "youtube_transcript"
RESOURCE_CAPTURE_JOB_TYPE = "resource_capture"
logger = logging.getLogger(__name__)


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
        return (
            os.getenv("YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET", "").strip()
            or os.getenv("INSTAGRAM_DOWNLOADER_SHARED_SECRET", "").strip()
        )

    @property
    def poll_interval(self) -> float:
        return float(os.getenv("INSTAGRAM_DOWNLOADER_POLL_INTERVAL_SECONDS", "10"))

    @property
    def worker_id(self) -> str:
        return os.getenv("INSTAGRAM_DOWNLOADER_WORKER_ID", "").strip() or socket.gethostname()

    @property
    def worker_label(self) -> str:
        return os.getenv("INSTAGRAM_DOWNLOADER_WORKER_LABEL", "").strip() or "MacBook Downloader"

    @property
    def heartbeat_interval(self) -> float:
        return max(min(self.poll_interval, 15.0), 5.0)

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

    async def heartbeat(self, client: httpx.AsyncClient, current_job_id: str | None = None):
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
                "current_job_id": current_job_id,
            },
            timeout=20.0,
        )

    async def heartbeat_youtube(self, client: httpx.AsyncClient, current_job_id: str | None = None):
        await client.post(
            f"{self.api_base_url}/youtube-transcript/worker/heartbeat",
            headers={"x-downloader-secret": self.shared_secret},
            json={
                "worker_id": self.worker_id,
                "label": self.worker_label,
                "version": WORKER_VERSION,
                "metadata": {
                    "hostname": socket.gethostname(),
                    "download_root": os.getenv("INSTAGRAM_DOWNLOADER_DOWNLOAD_ROOT", "./downloads"),
                },
                "current_job_id": current_job_id,
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

    async def claim_youtube_transcript_job(self, client: httpx.AsyncClient):
        response = await client.post(
            f"{self.api_base_url}/youtube-transcript/worker/claim",
            headers={
                "x-downloader-secret": self.shared_secret,
                "x-worker-id": self.worker_id,
            },
            timeout=30.0,
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("job")

    async def claim_resource_capture_job(self, client: httpx.AsyncClient):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/resource-capture/claim",
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

    async def complete_youtube_transcript_job(self, client: httpx.AsyncClient, job_id: str, transcript):
        response = await client.post(
            f"{self.api_base_url}/youtube-transcript/worker/jobs/{job_id}/complete",
            headers={"x-downloader-secret": self.shared_secret},
            json=transcript.model_dump(),
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

    async def fail_youtube_transcript_job(self, client: httpx.AsyncClient, job_id: str, error_message: str):
        response = await client.post(
            f"{self.api_base_url}/youtube-transcript/worker/jobs/{job_id}/fail",
            headers={"x-downloader-secret": self.shared_secret},
            json={"error": error_message},
            timeout=30.0,
        )
        response.raise_for_status()

    async def complete_resource_capture_job(self, client: httpx.AsyncClient, job_id: str):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/resource-capture/jobs/{job_id}/complete",
            headers={"x-downloader-secret": self.shared_secret},
            json={"success": True},
            timeout=180.0,
        )
        response.raise_for_status()

    async def fail_resource_capture_job(self, client: httpx.AsyncClient, job_id: str, error_message: str):
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/resource-capture/jobs/{job_id}/fail",
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

    async def upload_thumbnail(self, client: httpx.AsyncClient, claimed_job: dict, thumbnail_path: str, thumbnail_bytes: bytes):
        job = claimed_job.get("job") or {}
        response = await client.post(
            f"{self.api_base_url}/instagram-downloader/worker/thumbnails/upload",
            headers={"x-downloader-secret": self.shared_secret},
            json={
                "owner_user_id": job["owner_user_id"],
                "resource_id": job["resource_id"],
                "filename": thumbnail_path,
                "content_type": "image/webp",
                "data_base64": base64.b64encode(thumbnail_bytes).decode("ascii"),
            },
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json()

    async def build_thumbnail_upload(self, client: httpx.AsyncClient, metadata: dict, files: list, preview_file):
        candidate_path = select_thumbnail_source_file(files, preview_file=preview_file)
        candidate_bytes = b""
        candidate_name = "thumbnail.webp"

        if candidate_path and candidate_path.exists():
            candidate_bytes = candidate_path.read_bytes()
            candidate_name = build_thumbnail_upload_name(candidate_path.name)
        else:
            for item in metadata.get("media_items", []) or []:
                for key in ("thumbnail_url", "source_url"):
                    candidate_url = normalize_whitespace(item.get(key) or "")
                    if not candidate_url:
                        continue
                    if candidate_url.startswith("http://") or candidate_url.startswith("https://"):
                        try:
                            response = await client.get(candidate_url, timeout=30.0, follow_redirects=True)
                            if response.is_success:
                                candidate_bytes = response.content
                                candidate_name = build_thumbnail_upload_name(candidate_url.rsplit("/", 1)[-1] or "thumbnail.webp")
                                break
                        except Exception:
                            continue
                if candidate_bytes:
                    break

        if not candidate_bytes and normalize_whitespace(metadata.get("thumbnail_url") or ""):
            candidate_url = normalize_whitespace(metadata.get("thumbnail_url") or "")
            if candidate_url.startswith("http://") or candidate_url.startswith("https://"):
                try:
                    response = await client.get(candidate_url, timeout=30.0, follow_redirects=True)
                    if response.is_success:
                        candidate_bytes = response.content
                        candidate_name = build_thumbnail_upload_name(candidate_url.rsplit("/", 1)[-1] or "thumbnail.webp")
                except Exception:
                    candidate_bytes = b""

        if not candidate_bytes:
            return None

        compressed_bytes = compress_thumbnail_bytes(candidate_bytes)
        if not compressed_bytes:
            return None

        return {
            "filename": candidate_name,
            "bytes": compressed_bytes,
        }

    async def process_claimed_job(self, client: httpx.AsyncClient, claimed_job: dict):
        job = claimed_job.get("job") or {}
        google_drive = claimed_job.get("google_drive") or {}
        job_type = (job.get("payload") or {}).get("job_type") or INSTAGRAM_JOB_TYPE
        self.current_job_id = job.get("id")

        async def send_heartbeat():
            await self.heartbeat(
                client,
                self.current_job_id if job_type != YOUTUBE_TRANSCRIPT_JOB_TYPE else None,
            )
            await self.heartbeat_youtube(
                client,
                self.current_job_id if job_type == YOUTUBE_TRANSCRIPT_JOB_TYPE else None,
            )

        await send_heartbeat()
        heartbeat_task = asyncio.create_task(self._heartbeat_while_processing(client, send_heartbeat))

        try:
            if job_type == RESOURCE_CAPTURE_JOB_TYPE:
                await self.complete_resource_capture_job(client, job["id"])
            elif job_type == YOUTUBE_TRANSCRIPT_JOB_TYPE:
                settings = claimed_job.get("settings") or {}
                transcript = await fetch_youtube_transcript(
                    YouTubeTranscriptRequest(
                        url=job["source_url"],
                        preferred_subtitle_languages=[
                            language.strip()
                            for language in str(settings.get("preferred_subtitle_languages") or "").split(",")
                            if language.strip()
                        ],
                        prefer_manual_captions=bool(settings.get("prefer_manual_captions", True)),
                    )
                )
                await self.complete_youtube_transcript_job(client, job["id"], transcript)
            else:
                download_dir = None
                try:
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
                    preview_file = None
                    if metadata.get("media_type") == "reel":
                        primary_video = find_first_file_by_type(files, "video")
                        if primary_video:
                            preview_file = generate_reel_preview_frame(Path(primary_video.filepath))

                    drive_folder, drive_files, preview_drive_file = await upload_instagram_files_to_drive(
                        request,
                        download_dir,
                        files,
                        metadata["media_type"],
                        subfolder_name=metadata.get("drive_subfolder_name"),
                        preview_file=preview_file,
                    )
                    metadata = apply_durable_preview_urls(metadata, files, drive_files, preview_drive_file)

                    thumbnail_upload = await self.build_thumbnail_upload(client, metadata, files, preview_file)
                    if thumbnail_upload:
                        try:
                            uploaded_thumbnail = await self.upload_thumbnail(
                                client,
                                claimed_job,
                                thumbnail_upload["filename"],
                                thumbnail_upload["bytes"],
                            )
                            metadata["thumbnail_url"] = uploaded_thumbnail.get("thumbnail_url") or metadata.get("thumbnail_url") or ""
                        except Exception:
                            logger.exception("Failed to upload compressed Instagram thumbnail", extra={"job_id": job.get("id"), "job_type": job_type})

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
                        thumbnail_url=metadata.get("thumbnail_url"),
                        extractor=metadata.get("extractor"),
                        review_state=metadata.get("review_state"),
                        review_reason=metadata.get("review_reason"),
                        error=None,
                    )
                    await self.complete_job(client, job["id"], download)
                finally:
                    if download_dir:
                        cleanup_download_dir(download_dir)
        except InstagramDownloaderError as error:
            logger.exception("Worker job failed with InstagramDownloaderError", extra={"job_id": job.get("id"), "job_type": job_type})
            if job_type == RESOURCE_CAPTURE_JOB_TYPE:
                await self.fail_resource_capture_job(client, job["id"], error.message)
            elif job_type == YOUTUBE_TRANSCRIPT_JOB_TYPE:
                await self.fail_youtube_transcript_job(client, job["id"], error.message)
            else:
                await self.fail_job(client, job["id"], error.message)
        except Exception as error:
            logger.exception("Worker job failed", extra={"job_id": job.get("id"), "job_type": job_type})
            if job_type == RESOURCE_CAPTURE_JOB_TYPE:
                await self.fail_resource_capture_job(client, job["id"], str(error))
            elif job_type == YOUTUBE_TRANSCRIPT_JOB_TYPE:
                await self.fail_youtube_transcript_job(client, job["id"], str(error))
            else:
                await self.fail_job(client, job["id"], str(error))
        finally:
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task
            self.current_job_id = None
            await send_heartbeat()

    async def _heartbeat_while_processing(self, client: httpx.AsyncClient, heartbeat_fn):
        while self.running and self.current_job_id:
            await asyncio.sleep(self.heartbeat_interval)
            try:
                await heartbeat_fn()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Worker heartbeat failed during processing", extra={"job_id": self.current_job_id})

    async def run(self):
        async with httpx.AsyncClient() as client:
            while self.running:
                try:
                    await self.heartbeat(client, None)
                    await self.heartbeat_youtube(client, None)
                    claimed_job = await self.claim_job(client)
                    if claimed_job:
                        await self.process_claimed_job(client, claimed_job)
                        continue

                    claimed_youtube_job = await self.claim_youtube_transcript_job(client)
                    if claimed_youtube_job:
                        await self.process_claimed_job(client, claimed_youtube_job)
                        continue

                    claimed_capture_job = await self.claim_resource_capture_job(client)
                    if claimed_capture_job:
                        await self.process_claimed_job(client, claimed_capture_job)
                        continue
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Keep the local worker resilient; next loop attempts again.
                    logger.exception("Worker polling loop failed")

                await asyncio.sleep(max(self.poll_interval, 2.0))


worker_loop = WorkerLoop()
