import hashlib
import mimetypes
import os
import re
import tempfile
from datetime import datetime, timezone
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
    YouTubeTranscriptRequest,
    YouTubeTranscriptResponse,
)
from app.utils.validators import is_valid_instagram_url


DRIVE_API = "https://www.googleapis.com/drive/v3/files"
DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
DEFAULT_ROOT_FOLDER = "Life OS"
DEFAULT_RESOURCES_FOLDER = "Resources"
DEFAULT_INSTAGRAM_FOLDER = "Instagram Imports"
DEFAULT_MAX_TRANSCRIPT_CHARS = 60000
MEDIA_TYPE_FOLDER_NAMES = {
    "reel": "Reels",
    "post": "Posts",
    "carousel": "Carousels",
    "unknown": "Posts",
}


class InstagramDownloaderError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def default_browser_cookies_target() -> str:
    # The local-first worker runs on the user's Mac, where Safari cookies are the
    # most reliable no-export path for Instagram sessions.
    if os.name == "posix" and hasattr(os, "uname") and os.uname().sysname == "Darwin":
        return "safari"
    return ""


def escape_drive_query(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("'", "\\'")


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^\w.\- ]+", "_", str(name or "").strip(), flags=re.ASCII)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("._")
    return cleaned[:180] or "download"


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def strip_extended_emoji(value: str) -> str:
    return re.sub(r"[\U00010000-\U0010ffff]", " ", str(value or ""))


def clean_caption_for_title(value: str) -> str:
    text = str(value or "").replace("\r", "\n")
    lines: list[str] = []
    for raw_line in text.split("\n"):
        line = normalize_whitespace(strip_extended_emoji(raw_line))
        if not line:
            continue
        if re.fullmatch(r"[#@][\w.]+(?:\s+[#@][\w.]+)*", line):
            continue
        line = re.sub(r"https?://\S+", " ", line)
        line = re.sub(r"(?:^|\s)[#@][\w.]+", " ", line)
        line = re.sub(r"\b(?:comment|dm)\s+the\s+word\s+\w+\b.*$", " ", line, flags=re.IGNORECASE)
        line = normalize_whitespace(line)
        if not line:
            continue
        lines.append(line)
        if len(lines) >= 2:
            break

    text = normalize_whitespace(" ".join(lines))
    if not text:
        return ""

    text = re.sub(r"^(?:video|post|reel|carousel)\s+by\s+[\w.]+\s*[:-]?\s*", "", text, flags=re.IGNORECASE)
    text = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    text = normalize_whitespace(text)

    words = text.split()
    if len(words) > 9:
        text = " ".join(words[:9])
    return text[:80].strip(" .,-_:;")


def normalize_creator_handle(info: dict[str, Any]) -> str:
    for key in ("channel", "uploader_id", "uploader"):
        value = normalize_whitespace(info.get(key) or "")
        if value:
            break
    else:
        value = ""

    title = normalize_whitespace(info.get("title") or "")
    if not value:
        match = re.search(r"\b(?:Video|Post|Reel|Carousel)\s+by\s+([\w.]+)\b", title, re.IGNORECASE)
        if match:
            value = match.group(1)

    value = value.lstrip("@")
    value = re.sub(r"[^\w.]+", "", value)
    return value[:40]


def normalize_published_at(info: dict[str, Any]) -> str:
    timestamp = info.get("timestamp")
    if timestamp in (None, ""):
        return ""
    try:
        return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return ""


def get_media_type_label(media_type: str) -> str:
    return {
        "reel": "Reel",
        "post": "Post",
        "carousel": "Carousel",
        "unknown": "Instagram Post",
    }.get(str(media_type or "unknown"), "Instagram Post")


def build_display_title(*, media_type: str, creator_handle: str = "", caption: str = "", transcript: str = "", published_at: str = "") -> str:
    topic = clean_caption_for_title(caption) or clean_caption_for_title(transcript)
    creator_label = f"@{creator_handle}" if creator_handle else ""
    media_label = get_media_type_label(media_type)
    date_label = published_at[:10] if published_at else ""

    if creator_label and topic:
        return f"{creator_label} - {topic}"
    if creator_label:
        return f"{creator_label} - {media_label}"
    if date_label:
        return f"Instagram {media_label} - {date_label}"
    return f"Instagram {media_label}"


def build_download_metadata(url: str, info: dict[str, Any]) -> dict[str, str]:
    media_type = infer_media_type(url, info)
    creator_handle = normalize_creator_handle(info)
    caption = normalize_whitespace(info.get("description") or "")
    published_at = normalize_published_at(info)
    normalized_title = build_display_title(
        media_type=media_type,
        creator_handle=creator_handle,
        caption=caption,
        transcript="",
        published_at=published_at,
    )
    return {
        "media_type": media_type,
        "media_type_label": get_media_type_label(media_type),
        "creator_handle": creator_handle,
        "caption": caption,
        "published_at": published_at,
        "normalized_title": normalized_title,
    }


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

    browser = os.getenv("INSTAGRAM_COOKIES_FROM_BROWSER", "").strip().lower() or default_browser_cookies_target()
    if browser:
        options["cookiesfrombrowser"] = (browser,)

    cookiefile = os.getenv("INSTAGRAM_COOKIEFILE", "").strip()
    if cookiefile:
        options["cookiefile"] = cookiefile

    return options


def build_generic_ydl_options() -> dict[str, Any]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "restrictfilenames": False,
    }

    browser = (
        os.getenv("YTDLP_COOKIES_FROM_BROWSER", "").strip().lower()
        or os.getenv("YOUTUBE_COOKIES_FROM_BROWSER", "").strip().lower()
        or os.getenv("INSTAGRAM_COOKIES_FROM_BROWSER", "").strip().lower()
        or default_browser_cookies_target()
    )
    if browser:
        options["cookiesfrombrowser"] = (browser,)

    cookiefile = (
        os.getenv("YOUTUBE_COOKIEFILE", "").strip()
        or os.getenv("YTDLP_COOKIEFILE", "").strip()
        or os.getenv("INSTAGRAM_COOKIEFILE", "").strip()
    )
    if cookiefile:
        options["cookiefile"] = cookiefile

    return options


def map_download_error(error: Exception) -> InstagramDownloaderError:
    message = str(error)
    lowered = message.lower()

    if "empty media response" in lowered:
        return InstagramDownloaderError(
            "Instagram returned an empty media response. This post likely needs a logged-in Instagram session or cookies for yt-dlp.",
            403,
        )
    if "private" in lowered or "login" in lowered or "sign in" in lowered:
        return InstagramDownloaderError("Instagram content is private or requires login.", 403)
    if "unsupported url" in lowered:
        return InstagramDownloaderError("Unsupported Instagram URL.", 400)
    if "unable to download" in lowered or "unable to extract" in lowered:
        return InstagramDownloaderError("yt-dlp failed to extract or download the Instagram media.", 502)
    return InstagramDownloaderError("yt-dlp extraction failed.", 502)


def collect_downloaded_files(download_dir: Path, base_title: str = "") -> list[DownloadedFile]:
    raw_paths = [path for path in sorted(download_dir.iterdir()) if path.is_file()]
    total_files = len(raw_paths)
    files = []
    safe_base_title = sanitize_filename(base_title or "Instagram_Post")
    for index, path in enumerate(raw_paths, start=1):
        extension = path.suffix or ""
        normalized_name = (
            f"{safe_base_title}{extension}"
            if total_files == 1
            else f"{safe_base_title}_{index:02d}{extension}"
        )
        sanitized_name = sanitize_filename(normalized_name)
        if sanitized_name != path.name:
            target = path.with_name(sanitized_name)
            if target.exists():
                target = path.with_name(sanitize_filename(f"{target.stem}_{index:02d}{target.suffix}"))
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
        details = response.text.strip()
        if response.status_code == 403:
            message = "Google Drive denied the upload (403). Reconnect Google Drive so LifeOS has full Drive access."
        else:
            message = f"Google Drive upload failed with status {response.status_code}."
        if details:
            message = f"{message} Details: {details[:240]}"
        raise InstagramDownloaderError(message, 502)

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
    upload_name: str | None = None,
) -> GoogleDriveFile:
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    boundary = f"boundary-{hashlib.sha1(file_path.name.encode('utf-8')).hexdigest()[:12]}"
    target_name = sanitize_filename(upload_name or file_path.name)
    metadata = f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{{"name":"{target_name}","parents":["{folder_id}"]}}\r\n'
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


async def maybe_upload_to_drive(
    request: DownloadRequest,
    download_dir: Path,
    files: list[DownloadedFile],
    media_type: str,
) -> tuple[GoogleDriveFolder | None, list[GoogleDriveFile]]:
    if not request.google_drive:
        return None, []

    async with httpx.AsyncClient() as client:
        parent_id = request.google_drive.parent_folder_id
        folder_name = MEDIA_TYPE_FOLDER_NAMES.get(media_type, MEDIA_TYPE_FOLDER_NAMES["unknown"])

        if not parent_id:
            root = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_ROOT_FOLDER)
            resources = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_RESOURCES_FOLDER, root["id"])
            instagram = await ensure_drive_folder(client, request.google_drive.access_token, DEFAULT_INSTAGRAM_FOLDER, resources["id"])
            parent_id = instagram["id"]

        folder = await ensure_drive_folder(client, request.google_drive.access_token, folder_name, parent_id)
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
                    item.filename,
                )
            )

        return drive_folder, uploaded_files


async def download_instagram_media_locally(request: DownloadRequest) -> tuple[dict[str, str], Path, list[DownloadedFile]]:
    if not is_valid_instagram_url(request.url):
        raise InstagramDownloaderError("Invalid or unsupported Instagram URL.", 400)

    try:
        with YoutubeDL(build_ydl_options(Path("."))) as ydl:
            info = ydl.extract_info(request.url, download=False)
    except DownloadError as error:
        raise map_download_error(error) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to inspect Instagram URL: {error}", 502) from error

    metadata = build_download_metadata(request.url, info if isinstance(info, dict) else {})
    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    try:
        with YoutubeDL(build_ydl_options(download_dir)) as ydl:
            ydl.extract_info(request.url, download=True)
    except DownloadError as error:
        raise map_download_error(error) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Download failed: {error}", 502) from error

    files = collect_downloaded_files(download_dir, metadata["normalized_title"])
    if not files:
        raise InstagramDownloaderError("Download completed but no files were found.", 500)

    return metadata, download_dir, files


async def upload_instagram_files_to_drive(
    request: DownloadRequest,
    download_dir: Path,
    files: list[DownloadedFile],
    media_type: str,
) -> tuple[GoogleDriveFolder | None, list[GoogleDriveFile]]:
    return await maybe_upload_to_drive(request, download_dir, files, media_type)


async def download_instagram_media(request: DownloadRequest) -> DownloadResponse:
    metadata, download_dir, files = await download_instagram_media_locally(request)
    request_media_type = metadata["media_type"]
    drive_folder, drive_files = await upload_instagram_files_to_drive(request, download_dir, files, request_media_type)

    return DownloadResponse(
        success=True,
        input_url=request.url,
        media_type=request_media_type,
        media_type_label=metadata["media_type_label"],
        download_dir=str(download_dir),
        files=files,
        drive_folder=drive_folder,
        drive_files=drive_files,
        normalized_title=metadata["normalized_title"],
        creator_handle=metadata["creator_handle"],
        caption=metadata["caption"],
        published_at=metadata["published_at"],
        error=None,
    )


def rank_subtitle_language(language: str) -> int:
    normalized = str(language or "").lower()
    if normalized == "en":
        return 100
    if normalized.startswith("en-") or normalized.startswith("en_"):
        return 90
    if "orig" in normalized:
        return 40
    if "auto" in normalized:
        return 10
    return 20


def choose_best_subtitle_track(subtitles: dict[str, Any] | None, automatic_captions: dict[str, Any] | None) -> tuple[str, str] | None:
    manual_entries = sorted((subtitles or {}).keys(), key=rank_subtitle_language, reverse=True)
    auto_entries = sorted((automatic_captions or {}).keys(), key=rank_subtitle_language, reverse=True)

    if manual_entries:
        return ("manual", manual_entries[0])
    if auto_entries:
        return ("auto", auto_entries[0])
    return None


def normalize_long_text(value: str, limit: int = DEFAULT_MAX_TRANSCRIPT_CHARS) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def normalize_transcript_text(value: str, limit: int = DEFAULT_MAX_TRANSCRIPT_CHARS) -> str:
    text = str(value or "")
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("\u00a0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    normalized = "\n".join(lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()
    return normalized[:limit]


def push_transcript_cue(cues: list[str], cue_lines: list[str]) -> None:
    unique_lines: list[str] = []
    previous_key = ""

    for line in cue_lines:
        cleaned = normalize_long_text(line, 1000)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key == previous_key:
            continue
        previous_key = key
        unique_lines.append(cleaned)

    if not unique_lines:
        return

    cue = normalize_transcript_text("\n".join(unique_lines), 2000)
    if not cue:
        return

    if cues and cues[-1].lower() == cue.lower():
        return
    cues.append(cue)


def parse_vtt_transcript(text: str) -> str:
    lines = str(text or "").replace("\ufeff", "").splitlines()
    cues: list[str] = []
    cue_lines: list[str] = []
    skip_block = False

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            push_transcript_cue(cues, cue_lines)
            cue_lines = []
            skip_block = False
            continue
        if line.upper().startswith("WEBVTT"):
            continue
        if re.match(r"^(NOTE|STYLE|REGION)\b", line, re.IGNORECASE):
            push_transcript_cue(cues, cue_lines)
            cue_lines = []
            skip_block = True
            continue
        if skip_block:
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if re.match(r"^\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d{3}", line):
            push_transcript_cue(cues, cue_lines)
            cue_lines = []
            continue

        cleaned = re.sub(r"<[^>]+>", " ", line)
        cleaned = re.sub(r"\{\\an\d+\}", " ", cleaned)
        cleaned = normalize_long_text(cleaned, 1000)
        if not cleaned:
            continue
        cue_lines.append(cleaned)

    push_transcript_cue(cues, cue_lines)

    return normalize_transcript_text("\n\n".join(cues))


def map_youtube_subtitle_error(error: Exception) -> tuple[str, str]:
    message = str(error).strip()
    lowered = message.lower()

    if "video unavailable" in lowered:
        return ("error", "yt-dlp could not access this YouTube video from the worker runtime (video unavailable).")
    if "sign in" in lowered or "login" in lowered or "cookies" in lowered:
        return ("error", "yt-dlp needs valid YouTube cookies or account access for this video.")
    return ("error", message or "yt-dlp transcript extraction failed.")


async def fetch_youtube_transcript(request: YouTubeTranscriptRequest) -> YouTubeTranscriptResponse:
    inspect_options = {
        **build_generic_ydl_options(),
        "skip_download": True,
    }

    try:
        with YoutubeDL(inspect_options) as ydl:
            info = ydl.extract_info(request.url, download=False)
    except DownloadError as error:
        status, message = map_youtube_subtitle_error(error)
        return YouTubeTranscriptResponse(
            success=False,
            input_url=request.url,
            status=status,
            error=message,
        )
    except Exception as error:
        return YouTubeTranscriptResponse(
            success=False,
            input_url=request.url,
            status="error",
            error=str(error) or "Failed to inspect YouTube subtitles.",
        )

    selected = choose_best_subtitle_track(info.get("subtitles"), info.get("automatic_captions"))
    if not selected:
        return YouTubeTranscriptResponse(
            success=False,
            input_url=request.url,
            status="no_subtitles",
            error="yt-dlp found no subtitle tracks for this video.",
        )

    selected_mode, selected_language = selected

    with tempfile.TemporaryDirectory(prefix="lifeos-ytdlp-") as temp_dir:
        subtitle_options: dict[str, Any] = {
            **build_generic_ydl_options(),
            "skip_download": True,
            "outtmpl": str(Path(temp_dir) / "transcript.%(ext)s"),
            "subtitleslangs": [selected_language],
            "subtitlesformat": "vtt",
            "writesubtitles": selected_mode == "manual",
            "writeautomaticsub": selected_mode == "auto",
        }

        try:
            with YoutubeDL(subtitle_options) as ydl:
                ydl.extract_info(request.url, download=True)
        except DownloadError as error:
            status, message = map_youtube_subtitle_error(error)
            return YouTubeTranscriptResponse(
                success=False,
                input_url=request.url,
                language=selected_language,
                status=status,
                error=message,
                selected_mode=selected_mode,
            )
        except Exception as error:
            return YouTubeTranscriptResponse(
                success=False,
                input_url=request.url,
                language=selected_language,
                status="error",
                error=str(error) or "Failed to download YouTube subtitles.",
                selected_mode=selected_mode,
            )

        subtitle_file = next((path for path in Path(temp_dir).iterdir() if path.suffix == ".vtt"), None)
        if subtitle_file is None:
            return YouTubeTranscriptResponse(
                success=False,
                input_url=request.url,
                language=selected_language,
                status="subtitle_download_empty",
                error=f'yt-dlp selected {selected_mode} subtitles ({selected_language}) but no VTT subtitle file was created.',
                selected_mode=selected_mode,
            )

        transcript = parse_vtt_transcript(subtitle_file.read_text(encoding="utf-8", errors="ignore"))
        if not transcript:
            return YouTubeTranscriptResponse(
                success=False,
                input_url=request.url,
                language=selected_language,
                status="subtitle_parse_empty",
                error=f'yt-dlp downloaded {selected_mode} subtitles ({selected_language}) but the parsed transcript was empty.',
                selected_mode=selected_mode,
            )

        return YouTubeTranscriptResponse(
            success=True,
            input_url=request.url,
            transcript=transcript,
            language=selected_language,
            status="ok",
            error=None,
            selected_mode=selected_mode,
        )
