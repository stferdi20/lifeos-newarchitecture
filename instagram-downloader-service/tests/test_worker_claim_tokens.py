import os
import unittest
from unittest.mock import patch

from app.schemas.download import DownloadResponse
from app.services.instagram_downloader import InstagramDownloaderError
from app.services.worker_client import RESOURCE_CAPTURE_JOB_TYPE, WorkerLoop


class _FakeResponse:
    def raise_for_status(self):
        return None


class _FakeClient:
    def __init__(self):
        self.calls = []

    async def post(self, url, *, headers=None, json=None, timeout=None):
        self.calls.append({
            "url": url,
            "headers": headers or {},
            "json": json or {},
            "timeout": timeout,
        })
        return _FakeResponse()


class WorkerClaimTokenTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["LIFEOS_API_BASE_URL"] = "https://example.test/api"
        os.environ["INSTAGRAM_DOWNLOADER_SHARED_SECRET"] = "secret"
        os.environ["INSTAGRAM_DOWNLOADER_WORKER_ID"] = "test-worker"
        self.loop = WorkerLoop()
        self.loop.running = True

    async def asyncTearDown(self):
        for key in (
            "LIFEOS_API_BASE_URL",
            "INSTAGRAM_DOWNLOADER_SHARED_SECRET",
            "INSTAGRAM_DOWNLOADER_WORKER_ID",
        ):
            os.environ.pop(key, None)

    async def _noop(self, *_args, **_kwargs):
        return None

    async def test_complete_job_includes_claim_token(self):
        client = _FakeClient()
        download = DownloadResponse(
            success=True,
            input_url="https://www.instagram.com/reel/abc123/",
            media_type="reel",
            download_dir="/tmp/job",
            files=[],
            drive_files=[],
            error=None,
        )

        await self.loop.complete_job(client, "job-1", download, "claim-123")

        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0]["json"]["worker_id"], "test-worker")
        self.assertEqual(client.calls[0]["json"]["claim_token"], "claim-123")

    async def test_process_claimed_resource_capture_job_passes_claim_token(self):
        recorded = {}

        async def capture_complete(_client, job_id, claim_token=""):
            recorded["job_id"] = job_id
            recorded["claim_token"] = claim_token

        claimed_job = {
            "job": {
                "id": "capture-job-1",
                "payload": {
                    "job_type": RESOURCE_CAPTURE_JOB_TYPE,
                    "claim_token": "capture-claim-token",
                },
            },
        }

        self.loop.heartbeat = self._noop
        self.loop._heartbeat_youtube_optional = self._noop
        self.loop.complete_resource_capture_job = capture_complete
        self.loop._heartbeat_while_processing = self._noop

        await self.loop.process_claimed_job(_FakeClient(), claimed_job)

        self.assertEqual(recorded, {
            "job_id": "capture-job-1",
            "claim_token": "capture-claim-token",
        })

    async def test_process_claimed_instagram_failure_passes_claim_token(self):
        recorded = {}

        async def capture_fail(_client, job_id, error_message, claim_token=""):
            recorded["job_id"] = job_id
            recorded["error_message"] = error_message
            recorded["claim_token"] = claim_token

        claimed_job = {
            "job": {
                "id": "instagram-job-1",
                "source_url": "https://www.instagram.com/reel/abc123/",
                "payload": {
                    "job_type": "instagram_download",
                    "claim_token": "instagram-claim-token",
                },
            },
            "google_drive": {
                "access_token": "drive-token",
            },
            "settings": {},
        }

        self.loop.heartbeat = self._noop
        self.loop._heartbeat_youtube_optional = self._noop
        self.loop.fail_job = capture_fail
        self.loop._heartbeat_while_processing = self._noop

        with patch(
            "app.services.worker_client.download_instagram_media_locally",
            side_effect=InstagramDownloaderError("boom", 500),
        ):
            await self.loop.process_claimed_job(_FakeClient(), claimed_job)

        self.assertEqual(recorded, {
            "job_id": "instagram-job-1",
            "error_message": "boom",
            "claim_token": "instagram-claim-token",
        })


if __name__ == "__main__":
    unittest.main()
