import os

from fastapi import APIRouter, Header, Response, status

from app.schemas.download import DownloadRequest, DownloadResponse, YouTubeTranscriptRequest, YouTubeTranscriptResponse
from app.services.instagram_downloader import InstagramDownloaderError, download_instagram_media, fetch_youtube_transcript


router = APIRouter()


def is_authorized(secret_header: str | None) -> bool:
    expected = (
        os.getenv("YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET", "").strip()
        or os.getenv("INSTAGRAM_DOWNLOADER_SHARED_SECRET", "").strip()
    )
    if not expected:
        return True
    return bool(secret_header) and secret_header == expected


@router.post("/download", response_model=DownloadResponse)
async def download_instagram(
    payload: DownloadRequest,
    response: Response,
    x_downloader_secret: str | None = Header(default=None),
):
    if not is_authorized(x_downloader_secret):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return DownloadResponse(success=False, error="Unauthorized downloader request.")

    try:
        return await download_instagram_media(payload)
    except InstagramDownloaderError as error:
        response.status_code = error.status_code
        return DownloadResponse(
            success=False,
            input_url=payload.url,
            media_type="unknown",
            download_dir=None,
            files=[],
            drive_folder=None,
            drive_files=[],
            error=error.message,
        )


@router.post("/youtube-transcript", response_model=YouTubeTranscriptResponse)
async def youtube_transcript(
    payload: YouTubeTranscriptRequest,
    response: Response,
    x_downloader_secret: str | None = Header(default=None),
):
    if not is_authorized(x_downloader_secret):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return YouTubeTranscriptResponse(success=False, input_url=payload.url, status="unauthorized", error="Unauthorized downloader request.")

    result = await fetch_youtube_transcript(payload)
    if not result.success:
        response.status_code = status.HTTP_502_BAD_GATEWAY
    return result
