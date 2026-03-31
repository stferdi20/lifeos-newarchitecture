# Instagram Downloader Service

Local-first Python backend for:

- downloading Instagram reels, posts, and carousels with `yt-dlp`
- extracting YouTube transcripts with `yt-dlp` for the main LifeOS backend
- polling the LifeOS backend queue so local-worker jobs can complete when your machine is online

## What It Does

- accepts `POST /download` with an Instagram URL
- validates the URL
- downloads media to a unique local folder
- optionally uploads downloaded files to Google Drive
- returns structured JSON for the downloaded files
- accepts `POST /youtube-transcript` with a YouTube URL
- inspects subtitle tracks, downloads the best subtitle file, and returns normalized transcript text

## Files

- `app/main.py`
- `app/routes/download.py`
- `app/services/instagram_downloader.py`
- `app/schemas/download.py`
- `app/utils/validators.py`

## Install

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/instagram-downloader-service"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

For Instagram reel preview images, the local worker also expects `ffmpeg` to be installed and available on your machine.

## Run Locally

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/instagram-downloader-service"
uvicorn app.main:app --reload --host 127.0.0.1 --port 9001
```

Optional environment variables:

```bash
INSTAGRAM_DOWNLOADER_DOWNLOAD_ROOT=./downloads
INSTAGRAM_DOWNLOADER_SHARED_SECRET=
INSTAGRAM_COOKIES_FROM_BROWSER=
INSTAGRAM_COOKIEFILE=
INSTALOADER_USERNAME=
INSTALOADER_SESSION_FILE=
INSTALOADER_COOKIEFILE=
LIFEOS_API_BASE_URL=
INSTAGRAM_DOWNLOADER_POLL_INTERVAL_SECONDS=10
INSTAGRAM_DOWNLOADER_WORKER_ID=
INSTAGRAM_DOWNLOADER_WORKER_LABEL=
```

On macOS, the worker now defaults to Safari browser cookies for Instagram extraction unless you override it.
`INSTAGRAM_COOKIES_FROM_BROWSER` can be set to a browser like `safari` or `chrome` so the worker uses live browser cookies for Instagram extraction.
`INSTAGRAM_COOKIEFILE` is useful when public extraction is blocked and you need a logged-in browser-exported cookie file for Instagram.
For Instagram `p/...` posts and carousels, the worker now prefers a stronger Instaloader auth path in this order:
1. `INSTALOADER_SESSION_FILE` + `INSTALOADER_USERNAME`
2. `INSTALOADER_COOKIEFILE`
3. live browser cookies from `INSTAGRAM_COOKIES_FROM_BROWSER`

### Create a Stronger Instaloader Session

If Instagram keeps blocking protected posts or carousels, create a saved Instaloader session once:

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/instagram-downloader-service"
source .venv/bin/activate
python scripts/create_instaloader_session.py
```

The script will prompt for:
- Instagram username
- Instagram password
- 2FA code if your account uses it
- where to save the session file

After that, set these env vars when you run the worker:

```bash
INSTALOADER_USERNAME=your_instagram_username
INSTALOADER_SESSION_FILE=/absolute/path/to/instaloader.session
```

The session file should stay private and must not be committed to Git.
`YOUTUBE_COOKIEFILE` or `YTDLP_COOKIEFILE` can help when YouTube subtitle extraction needs a valid cookie file in the worker runtime.

## Sample curl

```bash
curl -X POST http://127.0.0.1:9001/download \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.instagram.com/reel/abc123/"
  }'
```

```bash
curl -X POST http://127.0.0.1:9001/youtube-transcript \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }'
```

## Sample Success Response

```json
{
  "success": true,
  "input_url": "https://www.instagram.com/reel/abc123/",
  "media_type": "reel",
  "download_dir": "/absolute/path/downloads/instagram-4b6d3a2f7f44",
  "files": [
    {
      "filename": "01_my_clip_Cx123.mp4",
      "filepath": "/absolute/path/downloads/instagram-4b6d3a2f7f44/01_my_clip_Cx123.mp4",
      "type": "video"
    }
  ],
  "drive_folder": null,
  "drive_files": [],
  "error": null
}
```

## Sample Failure Response

```json
{
  "success": false,
  "error": "Instagram content is private or requires login."
}
```

## Notes

- The actual `yt-dlp` extraction and download logic lives in `app/services/instagram_downloader.py`.
- If you want to change where files are stored, edit `build_request_download_dir()` in `app/services/instagram_downloader.py`.
- Your existing web app should call the current Node backend route, not this service directly. The app-facing route is `POST /api/resources/instagram-download`.
- The main backend now uses the same worker for queued Instagram downloads and queued YouTube transcript jobs.
- If `LIFEOS_API_BASE_URL` and `INSTAGRAM_DOWNLOADER_SHARED_SECRET` are set, the worker polls the backend queue and processes both job types automatically.
