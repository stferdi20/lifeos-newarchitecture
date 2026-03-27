import hashlib
import mimetypes
import os
import re
from pathlib import Path
from typing import Any

import httpx
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.schemas.download import (
    DownloadRequest,
    DownloadResponse,
    DownloadedFile,
    GoogleDriveFile,
    GoogleDriveFolder,
)
from app.utils.validators import is_valid_instagram_url


DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
DEFAULT_ROOT_FOLDER = "Life OS"
DEFAULT_RESOURCES_FOLDER = "Resources"
DEFAULT_INSTAGRAM_FOLDER = "Instagram Imports"


class InstagramDownloaderError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def escape_drive_query(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("'", "\\'")


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w.\- ]+", "_", str(name or "").strip(), flags=re.ASCII)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("._")
    return cleaned[:180] or "download"


def build_request_download_dir(url: str, base_dir: str | None = None) -> Path:
    root = Path(base_dir or os.getenv("INSTAGRAM_DOWNLOADER_DOWNLOAD_ROOT") or "./downloads").expanduser().resolve()
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    directory = root / f"instagram-{digest}"
    suffix = 0

    while directory.exists():
        suffix += 1
        directory = root / f"instagram-{digest}-{suffix}"

    directory.mkdir(parents=True, exist_ok=False)
    return directory


def detect_file_type(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(file_path))
    if guessed and guessed.startswith("video/"):
        return "video"
    if guessed and guessed.startswith("image/"):
        return "image"
    return "unknown"


def infer_media_type(url: str, info: dict[str, Any]) -> str:
    entries = [entry for entry in (info.get("entries") or []) if entry]
    if len(entries) > 1:
        return "carousel"
    if "/reel/" in url:
        return "reel"
    if "/p/" in url or "/tv/" in url:
        return "post"
    return "unknown"


def build_ydl_options(download_dir: Path) -> dict[str, Any]:
    options: dict[str, Any] = {
        "outtmpl": str(download_dir / "%(autonumber)02d_%(title).80B_%(id)s.%(ext)s"),
        "noplaylist": False,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "restrictfilenames": False,
        "merge_output_format": "mp4",
    }

    cookiefile = os.getenv("INSTAGRAM_COOKIEFILE", "").strip()
    if cookiefile:
        options["cookiefile"] = cookiefile

    return options


def map_download_error(error: Exception) -> InstagramDownloaderError:
    message = str(error)
    lowered = message.lower()

    if "private" in lowered or "login" in lowered or "sign in" in lowered:
        return InstagramDownloaderError("Instagram content is private or requires login.", 403)
    if "unsupported url" in lowered:
        return InstagramDownloaderError("Unsupported Instagram URL.", 400)
    if "unable to download" in lowered or "unable to extract" in lowered:
        return InstagramDownloaderError("yt-dlp failed to extract or download the Instagram media.", 502)
    return InstagramDownloaderError("yt-dlp extraction failed.", 502)


def collect_downloaded_files(download_dir: Path) -> list[DownloadedFile]:
    files = []
    for path in sorted(download_dir.iterdir()):
        if not path.is_file():
            continue
        sanitized_name = sanitize_filename(path.name)
        if sanitized_name != path.name:
            target = path.with_name(sanitized_name)
            path.rename(target)
            path = target
        files.append(
            DownloadedFile(
                filename=path.name,
                filepath=str(path.resolve()),
                type=detect_file_type(path),
            )
        )
    return files


async def drive_request(
    client: httpx.AsyncClient,
    access_token: str,
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = await client.request(
        method,
        url,
        params=params,
        json=json_body,
        content=content,
        headers={
            "Authorization": f"Bearer {access_token}",
            **(headers or {}),
        },
        timeout=60.0,
    )

    if not response.is_success:
        raise InstagramDownloaderError(
            f"Google Drive upload failed with status {response.status_code}.",
            502,
        )

    if not response.content:
        return {}
    return response.json()


async def ensure_drive_folder(
    client: httpx.AsyncClient,
    access_token: str,
    name: str,
    parent_id: str | None = None,
) -> dict[str, Any]:
    predicates = [
        f"name='{escape_drive_query(name)}'",
        f"mimeType='{FOLDER_MIME_TYPE}'",
        "trashed=false",
    ]
    if parent_id:
        predicates.append(f"'{parent_id}' in parents")

    query = " and ".join(predicates)
    existing = await drive_request(
        client,
        access_token,
        "GET",
        DRIVE_API,
        params={
            "q": query,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
            "fields": "files(id,name,webViewLink)",
            "pageSize": "1",
        },
    )
    files = existing.get("files") or []
    if files:
        return files[0]

    payload = {
        "name": name,
        "mimeType": FOLDER_MIME_TYPE,
    }
    if parent_id:
        payload["parents"] = [parent_id]

    return await drive_request(
        client,
        access_token,
        "POST",
        DRIVE_API,
        params={
            "supportsAllDrives": "true",
            "fields": "id,name,webViewLink",
        },
        json_body=payload,
    )


async def upload_file_to_drive(
    client: httpx.AsyncClient,
    access_token: str,
    folder_id: str,
    file_path: Path,
) -> GoogleDriveFile:
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    boundary = f"boundary-{hashlib.sha1(file_path.name.encode('utf-8')).hexdigest()[:12]}"
    metadata = f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{{"name":"{file_path.name}","parents":["{folder_id}"]}}\r\n'
    media_header = f"--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n".encode("utf-8")
    footer = f"\r\n--{boundary}--".encode("utf-8")
    body = metadata.encode("utf-8") + media_header + file_path.read_bytes() + footer

    uploaded = await drive_request(
        client,
        access_token,
        "POST",
        DRIVE_UPLOAD_API,
        params={
            "uploadType": "multipart",
            "supportsAllDrives": "true",
            "fields": "id,name,mimeType,size,webViewLink,webContentLink",
        },
        content=body,
        headers={
            "Content-Type": f'multipart/related; boundary="{boundary}"',
        },
    )

    return GoogleDriveFile(
        id=uploaded["id"],
        name=uploaded["name"],
        mime_type=uploaded.get("mimeType"),
        size=int(uploaded["size"]) if uploaded.get("size") is not None else None,
        url=uploaded.get("webViewLink") or uploaded.get("webContentLink") or f"https://drive.google.com/file/d/{uploaded['id']}/view",
    )


async def maybe_upload_to_drive(request: DownloadRequest, download_dir: Path, files: list[DownloadedFile]) -> tuple[GoogleDriveFolder | None, list[GoogleDriveFile]]:
    if not request.google_drive:
        return None, []

    async with httpx.AsyncClient() as client:
        parent_id = request.google_drive.parent_folder_id
        if not parent_id:
            root = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_ROOT_FOLDER)
            resources = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_RESOURCES_FOLDER, root["id"])
            instagram = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_INSTAGRAM_FOLDER, resources["id"])
            parent_id = instagram["id"]

        folder = await ensure_drive_folder(client, request.google_drive.access_token, download_dir.name, parent_id)
        drive_folder = GoogleDriveFolder(
            id=folder["id"],
            name=folder["name"],
            url=folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder['id']}",
        )

        uploaded_files = []
        for item in files:
            uploaded_files.append(
                await upload_file_to_drive(
                    client,
                    request.google_drive.access_token,
                    drive_folder.id,
                    Path(item.filepath),
                )
            )

        return drive_folder, uploaded_files


async def download_instagram_media(request: DownloadRequest) -> DownloadResponse:
    if not is_valid_instagram_url(request.url):
        raise InstagramDownloaderError("Invalid or unsupported Instagram URL.", 400)

    try:
        with YoutubeDL(build_ydl_options(Path("."))) as ydl:
            info = ydl.extract_info(request.url, download=False)
    except DownloadError as error:
        raise map_download_error(error) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to inspect Instagram URL: {error}", 502) from error

    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    try:
        with YoutubeDL(build_ydl_options(download_dir)) as ydl:
            ydl.extract_info(request.url, download=True)
    except DownloadError as error:
        raise map_download_error(error) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Download failed: {error}", 502) from error

    files = collect_downloaded_files(download_dir)
    if not files:
        raise InstagramDownloaderError("Download completed but no files were found.", 500)

    drive_folder, drive_files = await maybe_upload_to_drive(request, download_dir, files)

    return DownloadResponse(
        success=True,
        input_url=request.url,
        media_type=infer_media_type(request.url, info if isinstance(info, dict) else {}),
        download_dir=str(download_dir),
        files=files,
        drive_folder=drive_folder,
        drive_files=drive_files,
        error=None,
    )
