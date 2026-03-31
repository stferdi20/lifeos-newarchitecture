import hashlib
import http.cookiejar
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import browser_cookie3
import httpx
import instaloader
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.schemas.download import (
    DownloadRequest,
    DownloadResponse,
    DownloadedFile,
    GoogleDriveFile,
    GoogleDriveFolder,
    InstagramMediaItem,
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
FASTDL_SHORTCUT_BASE = "https://f-d.app/"
DEFAULT_MAX_TRANSCRIPT_CHARS = 60000
MEDIA_TYPE_FOLDER_NAMES = {
    "reel": "Reels",
    "post": "Posts",
    "carousel": "Carousels",
    "unknown": "Posts",
}
BROWSER_COOKIE_LOADERS = {
    "chrome": browser_cookie3.chrome,
    "safari": browser_cookie3.safari,
    "firefox": browser_cookie3.firefox,
    "edge": browser_cookie3.edge,
    "opera": browser_cookie3.opera,
    "brave": browser_cookie3.brave,
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
        "thumbnail_url": normalize_whitespace(info.get("thumbnail") or ""),
        "extractor": "yt_dlp",
        "review_state": "none",
        "review_reason": "",
        "media_items": [],
    }


def parse_instagram_shortcode(url: str) -> str:
    match = re.search(r"instagram\.com\/(?:share\/)?(?:reel|p|tv)\/([^/?#]+)/?", str(url or ""), re.IGNORECASE)
    return match.group(1) if match else ""


def should_use_instaloader(url: str) -> bool:
    value = str(url or "").lower()
    return "/p/" in value or "/tv/" in value


def should_try_fastdl(url: str) -> bool:
    value = str(url or "").lower()
    return any(fragment in value for fragment in ("/p/", "/reel/", "/tv/"))


def get_instagram_browser_cookie_target() -> str:
    return os.getenv("INSTAGRAM_COOKIES_FROM_BROWSER", "").strip().lower() or default_browser_cookies_target()


def build_metadata_result(
    *,
    media_type: str,
    creator_handle: str = "",
    caption: str = "",
    published_at: str = "",
    transcript: str = "",
    extractor: str = "yt_dlp",
    review_state: str = "none",
    review_reason: str = "",
    media_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "media_type": media_type,
        "media_type_label": get_media_type_label(media_type),
        "creator_handle": creator_handle,
        "caption": caption,
        "published_at": published_at,
        "normalized_title": build_display_title(
            media_type=media_type,
            creator_handle=creator_handle,
            caption=caption,
            transcript=transcript,
            published_at=published_at,
        ),
        "thumbnail_url": "",
        "extractor": extractor,
        "review_state": review_state,
        "review_reason": review_reason,
        "media_items": list(media_items or []),
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


def resolve_ffmpeg_binary() -> str:
    candidates = [
        os.getenv("FFMPEG_BIN", "").strip(),
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        resolved = shutil.which(candidate) or (candidate if Path(candidate).exists() else "")
        if resolved:
            return resolved
    return ""


def build_drive_image_url(file_id: str) -> str:
    identifier = str(file_id or "").strip()
    if not identifier:
        return ""
    return f"https://drive.google.com/uc?export=view&id={identifier}"


def generate_reel_preview_frame(video_path: Path, offset_seconds: float = 1.0) -> Path | None:
    ffmpeg_bin = resolve_ffmpeg_binary()
    if not ffmpeg_bin or not video_path.exists():
        return None

    preview_path = video_path.with_name(f"{video_path.stem}__preview.jpg")
    attempts = [offset_seconds, 0.0] if offset_seconds > 0 else [0.0]

    for attempt in attempts:
        if preview_path.exists():
            preview_path.unlink(missing_ok=True)
        command = [
            ffmpeg_bin,
            "-y",
            "-ss",
            f"{attempt:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(preview_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
        except Exception:
            continue
        if completed.returncode == 0 and preview_path.exists() and preview_path.stat().st_size > 0:
            return preview_path

    return None


def infer_media_type(url: str, info: dict[str, Any]) -> str:
    entries = [entry for entry in (info.get("entries") or []) if entry]
    if len(entries) > 1:
        return "carousel"
    if "/reel/" in url:
        return "reel"
    if "/p/" in url or "/tv/" in url:
        return "post"
    return "unknown"


def infer_instaloader_media_type(url: str, post: instaloader.Post) -> str:
    typename = str(getattr(post, "typename", "") or "")
    if typename == "GraphSidecar":
        return "carousel"
    if "/reel/" in str(url or "").lower():
        return "reel"
    if typename in {"GraphImage", "GraphVideo"}:
        return "post"
    return "unknown"


def normalize_duration_seconds(value: Any) -> float | None:
    try:
        if value in (None, "", 0):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_media_dimension(node: Any, attr: str) -> int | None:
    value = getattr(node, attr, None)
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def build_instaloader_media_items(post: instaloader.Post) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if str(getattr(post, "typename", "") or "") == "GraphSidecar":
        nodes = list(post.get_sidecar_nodes())
        for index, node in enumerate(nodes):
            items.append({
                "index": index,
                "label": f"#{index + 1}",
                "type": "video" if getattr(node, "is_video", False) else "image",
                "source_url": getattr(node, "video_url", None) if getattr(node, "is_video", False) else getattr(node, "display_url", None),
                "thumbnail_url": getattr(node, "display_url", None),
                "width": normalize_media_dimension(node, "display_url_width"),
                "height": normalize_media_dimension(node, "display_url_height"),
                "duration_seconds": normalize_duration_seconds(getattr(node, "video_duration", None)),
            })
        return items

    items.append({
        "index": 0,
        "label": "#1",
        "type": "video" if getattr(post, "is_video", False) else "image",
        "source_url": getattr(post, "video_url", None) if getattr(post, "is_video", False) else getattr(post, "url", None),
        "thumbnail_url": getattr(post, "url", None),
        "width": None,
        "height": None,
        "duration_seconds": normalize_duration_seconds(getattr(post, "video_duration", None)),
    })
    items[0]["width"] = normalize_media_dimension(post, "display_url_width")
    items[0]["height"] = normalize_media_dimension(post, "display_url_height")
    return items


def build_instaloader_metadata(url: str, post: instaloader.Post, *, extractor: str = "instaloader") -> dict[str, Any]:
    media_type = infer_instaloader_media_type(url, post)
    creator_handle = normalize_whitespace(getattr(post, "owner_username", "") or "")
    caption = normalize_whitespace(getattr(post, "caption", "") or "")
    published_at = ""
    date_utc = getattr(post, "date_utc", None)
    if date_utc is not None:
        try:
            published_at = date_utc.replace(tzinfo=timezone.utc).isoformat()
        except Exception:
            published_at = ""
    result = build_metadata_result(
        media_type=media_type,
        creator_handle=creator_handle,
        caption=caption,
        published_at=published_at,
        extractor=extractor,
        media_items=build_instaloader_media_items(post),
    )
    result["thumbnail_url"] = normalize_whitespace(getattr(post, "url", None) or "")
    return result


def build_ydl_options(download_dir: Path, *, force_browser_session: bool = False) -> dict[str, Any]:
    options: dict[str, Any] = {
        "outtmpl": str(download_dir / "%(autonumber)02d_%(title).80B_%(id)s.%(ext)s"),
        "noplaylist": False,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "restrictfilenames": False,
        "merge_output_format": "mp4",
    }

    browser = get_instagram_browser_cookie_target()
    if browser:
        options["cookiesfrombrowser"] = (browser,)

    cookiefile = os.getenv("INSTAGRAM_COOKIEFILE", "").strip()
    if cookiefile:
        options["cookiefile"] = cookiefile

    if force_browser_session and not browser and not cookiefile:
        raise InstagramDownloaderError("No Instagram browser session is configured for the local worker.", 403)

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


def map_instaloader_error(error: Exception) -> InstagramDownloaderError:
    message = str(error).strip()
    lowered = message.lower()
    if "403" in lowered or "forbidden" in lowered or "please wait a few minutes" in lowered:
        return InstagramDownloaderError("Instagram blocked Instaloader from returning downloadable media for this post.", 403)
    if "login" in lowered or "private" in lowered or "401" in lowered:
        return InstagramDownloaderError("Instagram post requires a logged-in browser session.", 403)
    if "404" in lowered or "not found" in lowered:
        return InstagramDownloaderError("Instagram post could not be resolved by Instaloader.", 404)
    return InstagramDownloaderError(message or "Instaloader failed to extract the Instagram post.", 502)


def map_instaloader_auth_error(error: InstagramDownloaderError) -> InstagramDownloaderError:
    message = error.message or "Instaloader authentication failed."
    return InstagramDownloaderError(f"{message} Configure a saved Instaloader session file for a stronger logged-in session.", error.status_code)


def map_gallery_dl_error(error: Exception, stderr: str = "") -> InstagramDownloaderError:
    combined = normalize_whitespace(f"{error} {stderr}".strip()).lower()
    if "redirect to login" in combined or "accounts/login" in combined:
        return InstagramDownloaderError("gallery-dl was redirected to the Instagram login page.", 403)
    if "private" in combined or "login" in combined or "forbidden" in combined or "403" in combined:
        return InstagramDownloaderError("gallery-dl could not access downloadable media for this Instagram post.", 403)
    if "no downloadable media" in combined or "no files" in combined:
        return InstagramDownloaderError("gallery-dl returned no downloadable media for this Instagram post.", 502)
    return InstagramDownloaderError("gallery-dl failed to extract the Instagram post.", 502)


def map_fastdl_error(error: Exception | str) -> InstagramDownloaderError:
    message = normalize_whitespace(str(error or "")).strip()
    lowered = message.lower()
    if "timed out" in lowered or "timeout" in lowered:
        return InstagramDownloaderError("FastDL timed out while preparing carousel downloads.", 504)
    if "no carousel download links" in lowered or "returned fewer than two" in lowered:
        return InstagramDownloaderError("FastDL did not expose downloadable carousel items for this post.", 502)
    return InstagramDownloaderError(message or "FastDL carousel extraction failed.", 502)


def should_attempt_browser_fallback(error: Exception) -> bool:
    lowered = str(error or "").lower()
    return any(fragment in lowered for fragment in (
        "403",
        "forbidden",
        "login",
        "private",
        "empty media response",
        "no downloadable",
        "no files",
        "blocked",
        "graphql",
        "returned no sidecar",
        "gallery-dl",
        "redirected to the instagram login page",
        "fastdl",
    ))


def load_instaloader_browser_session(loader: instaloader.Instaloader) -> str:
    browser = get_instagram_browser_cookie_target()
    cookie_loader = BROWSER_COOKIE_LOADERS.get(browser)
    if not cookie_loader:
        raise InstagramDownloaderError("No supported Instagram browser session is configured for Instaloader.", 403)

    cookie_file = os.getenv("INSTAGRAM_BROWSER_COOKIE_FILE", "").strip() or None
    try:
        cookies = cookie_loader(cookie_file=cookie_file, domain_name="instagram.com")
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to load Instagram browser cookies from {browser}.", 403) from error

    if not cookies:
        raise InstagramDownloaderError(f"No Instagram browser cookies were found in {browser}.", 403)

    loader.context._session.cookies.update(cookies)
    return browser


def load_instaloader_cookie_file(loader: instaloader.Instaloader, cookie_file: str) -> str:
    if not cookie_file:
        raise InstagramDownloaderError("No Instaloader cookie file path is configured.", 403)

    jar = http.cookiejar.MozillaCookieJar()
    try:
        jar.load(cookie_file, ignore_discard=True, ignore_expires=True)
    except FileNotFoundError as error:
        raise InstagramDownloaderError(f"Instaloader cookie file not found: {cookie_file}", 403) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to load Instaloader cookie file: {cookie_file}", 403) from error

    if len(jar) == 0:
        raise InstagramDownloaderError(f"Instaloader cookie file is empty: {cookie_file}", 403)

    loader.context._session.cookies.update(jar)
    return cookie_file


def load_instaloader_saved_session(loader: instaloader.Instaloader, username: str, session_file: str) -> str:
    if not username or not session_file:
        raise InstagramDownloaderError("Instaloader session mode requires INSTALOADER_USERNAME and INSTALOADER_SESSION_FILE.", 403)

    if not Path(session_file).expanduser().exists():
        raise InstagramDownloaderError(f"Instaloader session file not found: {session_file}", 403)

    try:
        loader.load_session_from_file(username, session_file)
    except FileNotFoundError as error:
        raise InstagramDownloaderError(f"Instaloader session file not found: {session_file}", 403) from error
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to load Instaloader session file: {session_file}", 403) from error

    try:
        authenticated_user = loader.test_login()
    except Exception as error:
        raise InstagramDownloaderError("Instaloader session file was loaded but Instagram rejected the saved session.", 403) from error

    if not authenticated_user:
        raise InstagramDownloaderError("Instaloader session file did not produce a logged-in Instagram session.", 403)

    return authenticated_user


def authenticate_instaloader(loader: instaloader.Instaloader) -> str:
    username = os.getenv("INSTALOADER_USERNAME", "").strip()
    session_file = os.getenv("INSTALOADER_SESSION_FILE", "").strip()
    cookie_file = os.getenv("INSTALOADER_COOKIEFILE", "").strip() or os.getenv("INSTAGRAM_COOKIEFILE", "").strip()

    if session_file:
        authenticated_user = load_instaloader_saved_session(loader, username, session_file)
        return f"instaloader_session:{authenticated_user}"

    if cookie_file:
        load_instaloader_cookie_file(loader, cookie_file)
        return f"cookie_file:{cookie_file}"

    browser = load_instaloader_browser_session(loader)
    return f"browser:{browser}"


def collect_downloaded_files(download_dir: Path, base_title: str = "") -> list[DownloadedFile]:
    raw_paths = [path for path in sorted(download_dir.iterdir()) if path.is_file()]
    typed_paths = [(path, detect_file_type(path)) for path in raw_paths]
    media_paths = [(path, file_type) for path, file_type in typed_paths if file_type != "unknown"]
    total_files = len(media_paths)
    files = []
    safe_base_title = sanitize_filename(base_title or "Instagram_Post")
    for index, (path, file_type) in enumerate(media_paths, start=1):
        extension = path.suffix.lower() or ""
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
                type=file_type,
            )
        )
    return files


def attach_media_filenames(media_items: list[dict[str, Any]], files: list[DownloadedFile]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for index, item in enumerate(media_items or []):
        file = files[index] if index < len(files) else None
        enriched.append({
            **item,
            "index": item.get("index", index),
            "label": item.get("label") or f"#{index + 1}",
            "type": item.get("type") or (file.type if file else "unknown"),
            "filename": file.filename if file else item.get("filename"),
            "filepath": file.filepath if file else item.get("filepath"),
            "thumbnail_url": item.get("thumbnail_url"),
        })
    return enriched


def find_first_file_by_type(files: list[DownloadedFile], file_type: str) -> DownloadedFile | None:
    for item in files or []:
        if item.type == file_type:
            return item
    return None


def apply_durable_preview_urls(
    metadata: dict[str, Any],
    files: list[DownloadedFile],
    drive_files: list[GoogleDriveFile],
    preview_drive_file: GoogleDriveFile | None = None,
) -> dict[str, Any]:
    updated_items: list[dict[str, Any]] = []
    drive_files_by_name = {entry.name: entry for entry in drive_files or []}
    chosen_thumbnail = normalize_whitespace(metadata.get("thumbnail_url") or "")
    preview_drive_url = build_drive_image_url(preview_drive_file.id) if preview_drive_file else ""

    for index, item in enumerate(metadata.get("media_items", []) or []):
        file = files[index] if index < len(files) else None
        drive_file = drive_files_by_name.get(file.filename) if file else None
        next_item = {**item}

        if file and file.type == "image" and drive_file:
            next_item["thumbnail_url"] = build_drive_image_url(drive_file.id) or next_item.get("thumbnail_url")
            if not chosen_thumbnail:
                chosen_thumbnail = normalize_whitespace(next_item.get("thumbnail_url") or "")

        updated_items.append(next_item)

    if preview_drive_url and updated_items:
        updated_items[0]["thumbnail_url"] = preview_drive_url
        chosen_thumbnail = preview_drive_url
    elif not chosen_thumbnail:
        chosen_thumbnail = derive_thumbnail_from_media_items(updated_items)

    return {
        **metadata,
        "media_items": updated_items,
        "thumbnail_url": chosen_thumbnail,
    }


def derive_thumbnail_from_media_items(media_items: list[dict[str, Any]]) -> str:
    for item in media_items or []:
        thumbnail_url = normalize_whitespace(item.get("thumbnail_url") or "")
        if thumbnail_url:
            return thumbnail_url
    for item in media_items or []:
        if item.get("type") == "image":
            source_url = normalize_whitespace(item.get("source_url") or "")
            if source_url:
                return source_url
    return ""


def content_type_to_extension(content_type: str, fallback_extension: str = "") -> str:
    normalized = str(content_type or "").split(";")[0].strip().lower()
    mapping = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "image/heic": ".heic",
        "image/heif": ".heif",
    }
    if normalized in mapping:
        return mapping[normalized]
    guessed = mimetypes.guess_extension(normalized) if normalized else None
    return guessed or fallback_extension or ""


def derive_fastdl_filename(href: str, index: int, content_type: str) -> str:
    parsed = parse_qs(urlparse(href).query)
    raw_filename = unquote(parsed.get("filename", [f"carousel_item_{index + 1:02d}"])[0] or "")
    stem = sanitize_filename(Path(raw_filename).stem or f"carousel_item_{index + 1:02d}")
    original_extension = Path(raw_filename).suffix.lower()
    extension = content_type_to_extension(content_type, original_extension)
    return f"{index + 1:02d}_{stem}{extension}"


def build_fastdl_media_items(download_links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, item in enumerate(download_links):
        items.append({
            "index": index,
            "label": f"#{index + 1}",
            "type": item.get("type") or "unknown",
            "filename": item.get("filename"),
            "filepath": item.get("filepath"),
            "source_url": item.get("source_url"),
            "thumbnail_url": item.get("preview_url") or item.get("source_url"),
            "width": None,
            "height": None,
            "duration_seconds": None,
        })
    return items


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
    subfolder_name: str | None = None,
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
        target_folder = folder
        if subfolder_name:
            target_folder = await ensure_drive_folder(
                client,
                request.google_drive.access_token,
                normalize_whitespace(subfolder_name)[:120] or "Instagram Carousel",
                folder["id"],
            )

        drive_folder = GoogleDriveFolder(
            id=target_folder["id"],
            name=target_folder["name"],
            url=target_folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{target_folder['id']}",
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


def build_instaloader_instance(download_dir: Path) -> instaloader.Instaloader:
    return instaloader.Instaloader(
        sleep=False,
        quiet=True,
        dirname_pattern=str(download_dir),
        filename_pattern="{shortcode}",
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern="",
        storyitem_metadata_txt_pattern="",
        download_video_thumbnails=False,
        sanitize_paths=False,
        max_connection_attempts=1,
        request_timeout=30.0,
    )


def build_gallery_dl_command(download_dir: Path, url: str) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "gallery_dl",
        "--write-metadata",
        "--destination",
        str(download_dir),
    ]

    cookie_file = (
        os.getenv("GALLERY_DL_COOKIEFILE", "").strip()
        or os.getenv("INSTALOADER_COOKIEFILE", "").strip()
        or os.getenv("INSTAGRAM_COOKIEFILE", "").strip()
    )
    browser = (
        os.getenv("GALLERY_DL_COOKIES_FROM_BROWSER", "").strip().lower()
        or get_instagram_browser_cookie_target()
    )

    if cookie_file:
        command.extend(["--cookies", cookie_file])
    elif browser:
        command.extend(["--cookies-from-browser", browser])

    command.append(url)
    return command


def build_gallery_dl_media_items(files: list[DownloadedFile]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, file in enumerate(files):
        items.append({
            "index": index,
            "label": f"#{index + 1}",
            "type": file.type,
            "filename": file.filename,
            "filepath": file.filepath,
            "source_url": None,
            "thumbnail_url": None,
            "width": None,
            "height": None,
            "duration_seconds": None,
        })
    return items


def build_gallery_dl_metadata(
    request: DownloadRequest,
    files: list[DownloadedFile],
    *,
    fallback_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    info = fallback_info or {}
    media_type = "carousel" if len(files) > 1 else (infer_media_type(request.url, info) if info else "post")
    if media_type == "unknown":
        media_type = "carousel" if len(files) > 1 else "post"

    creator_handle = normalize_creator_handle(info) if info else ""
    caption = normalize_whitespace(info.get("description") or "") if info else ""
    published_at = normalize_published_at(info) if info else ""

    result = build_metadata_result(
        media_type=media_type,
        creator_handle=creator_handle,
        caption=caption,
        published_at=published_at,
        extractor="gallery_dl",
        media_items=build_gallery_dl_media_items(files),
    )
    result["thumbnail_url"] = normalize_whitespace(info.get("thumbnail") or "") if info else ""
    return result


def build_fastdl_shortcut_url(url: str) -> str:
    return f"{FASTDL_SHORTCUT_BASE}{url}"


async def fetch_fastdl_download_links(url: str) -> tuple[str, list[dict[str, Any]]]:
    target_url = build_fastdl_shortcut_url(url)
    wait_timeout_ms = int(os.getenv("FASTDL_WAIT_TIMEOUT_MS", "60000"))
    ready_wait_ms = int(os.getenv("FASTDL_READY_WAIT_MS", "4000"))
    selector = "a.button__download[href*='media.fastdl.app/get']"

    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page()
            try:
                await page.goto(target_url, wait_until="domcontentloaded", timeout=wait_timeout_ms)
                await page.wait_for_selector(selector, timeout=wait_timeout_ms)
                await page.wait_for_timeout(ready_wait_ms)
                final_url = page.url
                links = await page.locator(selector).evaluate_all(
                    """
                    els => els.map((el, index) => {
                      const href = el.href || '';
                      const parent = el.parentElement || el.closest('div') || document.body;
                      const img = parent.querySelector('img');
                      return {
                        index,
                        href,
                        preview_url: img ? (img.currentSrc || img.src || '') : '',
                      };
                    }).filter(item => item.href)
                    """
                )
            finally:
                await browser.close()
    except PlaywrightTimeoutError as error:
        raise map_fastdl_error(error) from error
    except Exception as error:
        raise map_fastdl_error(error) from error

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in links:
        href = str(item.get("href") or "")
        if not href or href in seen:
            continue
        seen.add(href)
        deduped.append(item)

    return final_url, deduped


async def download_fastdl_assets(download_dir: Path, download_links: list[dict[str, Any]]) -> list[DownloadedFile]:
    timeout = httpx.Timeout(60.0, connect=20.0, read=60.0, write=60.0, pool=60.0)
    files: list[DownloadedFile] = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        for index, item in enumerate(download_links):
            href = str(item.get("href") or "")
            if not href:
                continue
            response = await client.get(href)
            if not response.is_success:
                raise InstagramDownloaderError(f"FastDL asset download failed with status {response.status_code}.", 502)
            content_type = response.headers.get("content-type", "")
            filename = derive_fastdl_filename(href, index, content_type)
            file_path = download_dir / filename
            file_path.write_bytes(response.content)
            files.append(
                DownloadedFile(
                    filename=file_path.name,
                    filepath=str(file_path.resolve()),
                    type=detect_file_type(file_path),
                )
            )
            item["filename"] = file_path.name
            item["filepath"] = str(file_path.resolve())
            item["type"] = detect_file_type(file_path)
            item["source_url"] = item.get("preview_url") or unquote(parse_qs(urlparse(href).query).get("uri", [""])[0] or "")
    return files


def infer_fastdl_media_type(request: DownloadRequest, download_links: list[dict[str, Any]]) -> str:
    url = str(request.url or "").lower()
    if "/reel/" in url:
        return "reel"
    if len(download_links) > 1:
        return "carousel"
    if "/p/" in url or "/tv/" in url:
        return "post"
    return "unknown"


def build_fastdl_metadata(
    request: DownloadRequest,
    download_links: list[dict[str, Any]],
    *,
    fallback_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    info = fallback_info or {}
    creator_handle = normalize_creator_handle(info) if info else ""
    caption = normalize_whitespace(info.get("description") or "") if info else ""
    published_at = normalize_published_at(info) if info else ""
    media_type = infer_fastdl_media_type(request, download_links)
    result = build_metadata_result(
        media_type=media_type,
        creator_handle=creator_handle,
        caption=caption,
        published_at=published_at,
        extractor="fastdl",
        media_items=build_fastdl_media_items(download_links),
    )
    result["thumbnail_url"] = normalize_whitespace(
        next((str(item.get("preview_url") or "").strip() for item in download_links if str(item.get("preview_url") or "").strip()), "")
        or info.get("thumbnail")
        or ""
    )
    return result


async def fetch_instagram_page_html(url: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            response = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
            if response.is_success:
                return response.text
    except Exception:
        return ""
    return ""


def validate_browser_fallback_download(url: str, info: dict[str, Any], files: list[DownloadedFile], page_html: str) -> str:
    if not should_use_instaloader(url):
        return ""
    if len(files) != 1 or files[0].type != "video":
        return ""
    if not page_html:
        return ""

    html = page_html.lower()
    has_sidecar_markers = any(marker in html for marker in ("graphsidecar", "edge_sidecar_to_children", "carousel_item"))
    has_og_video = "property=\"og:video\"" in html or "property='og:video'" in html
    has_og_image = "property=\"og:image\"" in html or "property='og:image'" in html

    entries = [entry for entry in (info.get("entries") or []) if entry]
    entry_title = normalize_whitespace((entries[0].get("title") if entries else "") or "")
    generic_entry_title = bool(re.fullmatch(r"Video\s+\d+", entry_title))

    if has_sidecar_markers or has_og_video:
        return ""

    if has_og_image and generic_entry_title:
        return (
            "Instagram exposed inconsistent browser-fallback media for this post, "
            "so LifeOS skipped the download to avoid saving the wrong asset."
        )

    return ""


def cleanup_download_dir(download_dir: Path) -> None:
    try:
        shutil.rmtree(download_dir, ignore_errors=True)
    except Exception:
        return


def inspect_with_ytdlp(url: str, *, force_browser_session: bool = False) -> dict[str, Any]:
    with YoutubeDL(build_ydl_options(Path("."), force_browser_session=force_browser_session)) as ydl:
        info = ydl.extract_info(url, download=False)
    return info if isinstance(info, dict) else {}


async def download_with_ytdlp(
    request: DownloadRequest,
    *,
    extractor: str = "yt_dlp",
    force_browser_session: bool = False,
) -> tuple[dict[str, Any], Path, list[DownloadedFile]]:
    try:
        info = inspect_with_ytdlp(request.url, force_browser_session=force_browser_session)
    except DownloadError as error:
        raise map_download_error(error) from error
    except InstagramDownloaderError:
        raise
    except Exception as error:
        raise InstagramDownloaderError(f"Failed to inspect Instagram URL: {error}", 502) from error

    metadata = build_download_metadata(request.url, info)
    metadata["extractor"] = extractor
    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    try:
        with YoutubeDL(build_ydl_options(download_dir, force_browser_session=force_browser_session)) as ydl:
            ydl.extract_info(request.url, download=True)
    except DownloadError as error:
        raise map_download_error(error) from error
    except InstagramDownloaderError:
        raise
    except Exception as error:
        raise InstagramDownloaderError(f"Download failed: {error}", 502) from error

    files = collect_downloaded_files(download_dir, metadata["normalized_title"])
    if extractor == "browser_fallback":
        rejection_reason = validate_browser_fallback_download(
            request.url,
            info,
            files,
            await fetch_instagram_page_html(request.url),
        )
        if rejection_reason:
            cleanup_download_dir(download_dir)
            raise InstagramDownloaderError(rejection_reason, 409)
    metadata["media_items"] = attach_media_filenames(metadata.get("media_items", []), files)
    metadata["thumbnail_url"] = normalize_whitespace(metadata.get("thumbnail_url") or "") or derive_thumbnail_from_media_items(metadata["media_items"])
    if not files:
        raise InstagramDownloaderError("Download completed but no files were found.", 500)

    return metadata, download_dir, files


async def download_with_instaloader(request: DownloadRequest) -> tuple[dict[str, Any], Path, list[DownloadedFile]]:
    shortcode = parse_instagram_shortcode(request.url)
    if not shortcode:
        raise InstagramDownloaderError("Unsupported Instagram post URL.", 400)

    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    loader = build_instaloader_instance(download_dir)
    try:
        auth_mode = authenticate_instaloader(loader)
    except InstagramDownloaderError as error:
        raise map_instaloader_auth_error(error) from error

    try:
        post = instaloader.Post.from_shortcode(loader.context, shortcode)
        metadata = build_instaloader_metadata(request.url, post, extractor="instaloader")
        metadata["instaloader_auth_mode"] = auth_mode
        loader.download_post(post, target="")
    except Exception as error:
        raise map_instaloader_error(error) from error

    files = collect_downloaded_files(download_dir, metadata["normalized_title"])
    metadata["media_items"] = attach_media_filenames(metadata.get("media_items", []), files)
    metadata["thumbnail_url"] = normalize_whitespace(metadata.get("thumbnail_url") or "") or derive_thumbnail_from_media_items(metadata["media_items"])
    if not files:
        raise InstagramDownloaderError("Instaloader completed but no downloadable media files were created.", 502)

    return metadata, download_dir, files


async def download_with_gallery_dl(request: DownloadRequest) -> tuple[dict[str, Any], Path, list[DownloadedFile]]:
    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    command = build_gallery_dl_command(download_dir, request.url)

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=120,
        )
    except FileNotFoundError as error:
        raise InstagramDownloaderError("gallery-dl is not installed on the local worker.", 500) from error
    except subprocess.TimeoutExpired as error:
        raise InstagramDownloaderError("gallery-dl timed out while extracting the Instagram post.", 504) from error
    except Exception as error:
        raise InstagramDownloaderError(f"gallery-dl failed to start: {error}", 502) from error

    stderr = completed.stderr.strip()
    if completed.returncode != 0:
        raise map_gallery_dl_error(
            InstagramDownloaderError("gallery-dl returned a non-zero exit code.", 502),
            stderr,
        )

    files = collect_downloaded_files(download_dir)
    if not files:
        raise InstagramDownloaderError("gallery-dl returned no downloadable media for this Instagram post.", 502)

    fallback_info: dict[str, Any] = {}
    try:
        fallback_info = inspect_with_ytdlp(request.url, force_browser_session=True)
    except Exception:
        fallback_info = {}

    metadata = build_gallery_dl_metadata(request, files, fallback_info=fallback_info)
    files = collect_downloaded_files(download_dir, metadata["normalized_title"])
    metadata["media_items"] = attach_media_filenames(metadata.get("media_items", []), files)
    metadata["thumbnail_url"] = normalize_whitespace(metadata.get("thumbnail_url") or "") or derive_thumbnail_from_media_items(metadata["media_items"])
    return metadata, download_dir, files


async def download_with_fastdl(request: DownloadRequest) -> tuple[dict[str, Any], Path, list[DownloadedFile]]:
    fastdl_result_url, download_links = await fetch_fastdl_download_links(request.url)
    if len(download_links) < 1:
        raise InstagramDownloaderError("FastDL returned no downloadable media items for this Instagram URL.", 502)

    download_dir = build_request_download_dir(request.url, request.download_base_dir)
    files = await download_fastdl_assets(download_dir, download_links)
    if len(files) < 1:
        cleanup_download_dir(download_dir)
        raise InstagramDownloaderError("FastDL returned no downloaded media files for this Instagram URL.", 502)

    fallback_info: dict[str, Any] = {}
    try:
        fallback_info = inspect_with_ytdlp(request.url, force_browser_session=True)
    except Exception:
        fallback_info = {}

    metadata = build_fastdl_metadata(request, download_links, fallback_info=fallback_info)
    metadata["fastdl_result_url"] = fastdl_result_url
    if metadata["media_type"] == "carousel":
        metadata["drive_subfolder_name"] = metadata["normalized_title"]
    files = collect_downloaded_files(download_dir, metadata["normalized_title"])
    metadata["media_items"] = attach_media_filenames(metadata.get("media_items", []), files)
    metadata["thumbnail_url"] = normalize_whitespace(metadata.get("thumbnail_url") or "") or derive_thumbnail_from_media_items(metadata["media_items"])
    return metadata, download_dir, files


async def download_instagram_media_locally(request: DownloadRequest) -> tuple[dict[str, Any], Path, list[DownloadedFile]]:
    if not is_valid_instagram_url(request.url):
        raise InstagramDownloaderError("Invalid or unsupported Instagram URL.", 400)

    if should_try_fastdl(request.url):
        try:
            return await download_with_fastdl(request)
        except InstagramDownloaderError:
            pass

    if not should_use_instaloader(request.url):
        return await download_with_ytdlp(request, extractor="yt_dlp")

    try:
        return await download_with_instaloader(request)
    except InstagramDownloaderError as error:
        if not should_attempt_browser_fallback(error):
            raise

    try:
        return await download_with_gallery_dl(request)
    except InstagramDownloaderError as error:
        if not should_attempt_browser_fallback(error):
            raise

    try:
        metadata, download_dir, files = await download_with_ytdlp(
            request,
            extractor="browser_fallback",
            force_browser_session=True,
        )
        metadata["review_state"] = "none"
        metadata["review_reason"] = ""
        return metadata, download_dir, files
    except InstagramDownloaderError as error:
        raise InstagramDownloaderError(
            "Instagram media needs review. FastDL, Instaloader, gallery-dl, and your local browser session could not fetch downloadable media for this post.",
            error.status_code,
        ) from error


async def upload_instagram_files_to_drive(
    request: DownloadRequest,
    download_dir: Path,
    files: list[DownloadedFile],
    media_type: str,
    subfolder_name: str | None = None,
    preview_file: Path | None = None,
) -> tuple[GoogleDriveFolder | None, list[GoogleDriveFile], GoogleDriveFile | None]:
    drive_folder, drive_files = await maybe_upload_to_drive(request, download_dir, files, media_type, subfolder_name=subfolder_name)
    preview_drive_file = None
    if request.google_drive and drive_folder and preview_file and preview_file.exists():
        async with httpx.AsyncClient() as client:
            try:
                preview_drive_file = await upload_file_to_drive(
                    client,
                    request.google_drive.access_token,
                    drive_folder.id,
                    preview_file,
                    preview_file.name,
                )
            except Exception:
                preview_drive_file = None
    return drive_folder, drive_files, preview_drive_file


async def download_instagram_media(request: DownloadRequest) -> DownloadResponse:
    metadata, download_dir, files = await download_instagram_media_locally(request)
    request_media_type = metadata["media_type"]
    preview_file = None
    if request_media_type == "reel":
        primary_video = find_first_file_by_type(files, "video")
        if primary_video:
            preview_file = generate_reel_preview_frame(Path(primary_video.filepath))

    drive_folder, drive_files, preview_drive_file = await upload_instagram_files_to_drive(
        request,
        download_dir,
        files,
        request_media_type,
        subfolder_name=metadata.get("drive_subfolder_name"),
        preview_file=preview_file,
    )
    metadata = apply_durable_preview_urls(metadata, files, drive_files, preview_drive_file)

    return DownloadResponse(
        success=True,
        input_url=request.url,
        media_type=request_media_type,
        media_type_label=metadata["media_type_label"],
        download_dir=str(download_dir),
        files=files,
        media_items=[InstagramMediaItem(**item) for item in metadata.get("media_items", [])],
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
