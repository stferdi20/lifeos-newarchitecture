# Instagram Downloader Service

Local-first Python backend for:

- downloading Instagram reels, posts, and carousels with `yt-dlp`
- extracting YouTube transcripts with the undocumented YouTube web-client caption fetcher first, with `yt-dlp` only as a rescue fallback
- polling the LifeOS backend queue so local-worker jobs can complete when your machine is online

## What It Does

- accepts `POST /download` with an Instagram URL
- validates the URL
- downloads media to a unique local folder
- optionally uploads downloaded files to Google Drive
- returns structured JSON for the downloaded files
- accepts `POST /youtube-transcript` with a YouTube URL
- inspects subtitle tracks, downloads the best subtitle file, and returns normalized transcript text
- compresses a card-sized thumbnail preview for Instagram reels and carousels, then sends it to the backend for Supabase storage

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
The thumbnail compressor uses `Pillow` and targets roughly `20-50 KB` per thumbnail after resize/compression.

## Run Locally

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture/instagram-downloader-service"
uvicorn app.main:app --reload --host 127.0.0.1 --port 9001
```

## macOS Auto-Start

For local development and personal ops on your own Mac, the repo now includes a LaunchAgent installer so the worker comes back after login or reboot:

```bash
cd "/Users/stefanusferdi/Documents/Data Penting/Antigravity Projects/LifeOS Trifecta/lifeos-new architecture"
npm run worker:install:macos
```

That command writes `~/Library/LaunchAgents/com.lifeos.instagram-downloader.plist`, starts it immediately, and keeps logs in `~/Library/Logs/LifeOS/`.

Useful commands:

```bash
npm run worker:uninstall:macos
tail -f ~/Library/Logs/LifeOS/instagram-downloader.log
tail -f ~/Library/Logs/LifeOS/instagram-downloader-error.log
```

The LaunchAgent uses [`scripts/run_worker.sh`](/Users/stefanusferdi/Documents/Data%20Penting/Antigravity%20Projects/LifeOS%20Trifecta/lifeos-new%20architecture/instagram-downloader-service/scripts/run_worker.sh), so make sure `.venv` exists and your worker `.env` / `.env.local` is already set up first.

For now, this OS-level startup path is the recommended local setup on your own machine.
For future SaaS-style distribution, prefer making the menubar app own worker startup and restart behavior so users can see, control, and uninstall that background work more safely.

Optional environment variables:

```bash
INSTAGRAM_DOWNLOADER_DOWNLOAD_ROOT=./downloads
INSTAGRAM_DOWNLOADER_SHARED_SECRET=
YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET=
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

The worker now auto-loads `./.env` and `./.env.local` from the service directory before startup, so you can keep the local API URL and worker secrets in a file instead of exporting them manually every time.

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

- The actual Instagram `yt-dlp` extraction and download logic lives in `app/services/instagram_downloader.py`.
- YouTube transcript extraction prefers the undocumented caption fetcher in the same file and only falls back to `yt-dlp` when needed.
- The worker writes thumbnails to the backend, which stores them in the public `resource-thumbnails` Supabase bucket and keeps the resulting URL in `resource.thumbnail`.
- Thumbnail uploads are content-addressed now, so reprocessing the same media reuses the same Supabase object and avoids creating a fresh URL for identical bytes.
- If you want to change where files are stored, edit `build_request_download_dir()` in `app/services/instagram_downloader.py`.
- The temporary `downloads/instagram-*` directories are expected to disappear after a job finishes. The worker cleans them up once upload completes.
- If you need to repair old Instagram rows, run the repo-level `npm run backfill:instagram-thumbnails` script from the main project root.
- Your existing web app should call the current Node backend route, not this service directly. The app-facing route is `POST /api/resources/instagram-download`.
- The main backend now uses the same worker for queued Instagram downloads and queued YouTube transcript jobs.
- If `LIFEOS_API_BASE_URL` and `YOUTUBE_TRANSCRIPT_WORKER_SHARED_SECRET` are set, the worker polls the backend queue and processes both job types automatically. The legacy `INSTAGRAM_DOWNLOADER_SHARED_SECRET` still works as a fallback.
- If a Mac sleeps or powers off mid-job, the backend now requeues stale `processing` jobs automatically after the heartbeat goes stale long enough. Late completion attempts from the old worker are rejected with a claim token check so they cannot overwrite the newer queue owner.

## Queue Recovery Runbook

- If the worker shows `stale`, the backend has stopped receiving heartbeats but will auto-requeue stuck `processing` jobs after the stale recovery threshold.
- If the worker shows `offline`, no heartbeat has been recorded recently; queued jobs stay safe and will resume after the worker returns.
- If the queue looks stuck after reboot, first check `~/Library/Logs/LifeOS/instagram-downloader-error.log`, then run `launchctl print "gui/$(id -u)/com.lifeos.instagram-downloader"` to confirm the LaunchAgent is loaded.
- If jobs are still stuck in `processing`, open the Settings status panel or call the worker claim routes again; the backend now logs stale recovery and rejected late completions to help trace ownership issues.
