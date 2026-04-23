# iPhone Shortcut Capture

This guide covers the new async resource capture flow for iPhone.

## What Changed

- LifeOS now supports `POST /api/resources/capture` for generic URL capture.
- LifeOS also supports `POST /api/resources/shortcut-capture` for direct iOS Shortcut capture without opening the browser.
- The web app now has a dedicated `/capture?url=...` entrypoint.
- Submitting a URL creates a placeholder resource immediately and finishes analysis in the background.
- The Resources page shows queued, processing, and failed capture states directly on the card.
- Shortcut-driven captures can now stay on a short success screen while the Shortcut reopens a supported source app or falls back to Resources.
- Instagram links shared through the shortcut are automatically handed off to the Instagram downloader queue instead of staying in the generic analyzer path.

## Required Backend Setup

1. Apply the new Supabase migration for `resource_capture_jobs`.
2. Make sure your existing local Python worker is configured and running when you want queued captures to process.
3. If the worker is offline, captures still succeed immediately and stay queued until the worker comes back online.
4. For direct Shortcut capture, configure `LIFEOS_SHORTCUT_CAPTURE_TOKEN` and `LIFEOS_SHORTCUT_CAPTURE_USER_ID` on the backend.

Generate a strong token locally:

```bash
openssl rand -base64 32
```

Use your Supabase auth user id for `LIFEOS_SHORTCUT_CAPTURE_USER_ID`. The token only grants permission to queue resource captures for that user.

## iPhone Shortcut Setup

### Preferred: Direct Background Capture

This version sends the shared URL directly to the API from Shortcuts. It does not need to open the LifeOS browser/PWA capture page.

1. Open the `Shortcuts` app on iPhone.
2. Tap `+` to create a new shortcut.
3. Name it `LifeOS Capture`.
4. Add the `Receive URLs from Share Sheet` action.
5. Add `Get Text from Shortcut Input`.
6. Add `Get Contents of URL`.
7. Set the URL to:

```text
https://YOUR-LIFEOS-DOMAIN/api/resources/shortcut-capture
```

8. Expand the request options:
   - Method: `POST`
   - Headers:
     - `Content-Type`: `application/json`
     - `x-lifeos-shortcut-token`: your `LIFEOS_SHORTCUT_CAPTURE_TOKEN`
   - Request Body: `JSON`
   - JSON fields:
     - `url`: the text from Shortcut Input
     - `source`: `ios_share_shortcut`
9. Add `Show Notification` with:

```text
Saved to LifeOS
```

10. Optional: add `Open App` actions for source apps such as Instagram, YouTube, GitHub, X, or TikTok.
11. Open the shortcut settings.
12. Enable `Show in Share Sheet`.
13. Set accepted input types to `URLs`.

If the request fails, Shortcuts will show an error. A successful response means the link was durably accepted by LifeOS and queued for background processing.

### Fallback: Browser Capture Page

This version uses the Shortcut itself to send you back to a supported source app after LifeOS confirms the link was queued.

1. Open the `Shortcuts` app on iPhone.
2. Tap `+` to create a new shortcut.
3. Name it `LifeOS Capture`.
4. Add the `Receive URLs from Share Sheet` action.
5. Add `Get Text from Shortcut Input`.
6. Add `URL Encode` using the text from the previous step.
7. Add a `Text` action with:

```text
https://YOUR-LIFEOS-DOMAIN/capture?source=ios_share_shortcut&return_mode=shortcut&url=[URL Encoded Text]
```

8. Add the `Open URLs` action and pass the previous text action into it.
9. Add `Wait` for about `2` seconds.
10. Add `If` branches based on the original shared URL text:
   - if it contains `instagram.com`, use `Open App` -> `Instagram`
   - if it contains `youtube.com` or `youtu.be`, use `Open App` -> `YouTube`
   - if it contains `github.com`, use `Open App` -> `GitHub`
   - if it contains `x.com` or `twitter.com`, use `Open App` -> `X`
   - if it contains `tiktok.com`, use `Open App` -> `TikTok`
11. In the final `Otherwise` branch, add `Open URLs` with:

```text
https://lifeos-self-hosted.vercel.app/Resources
```

12. Open the shortcut settings.
13. Enable `Show in Share Sheet`.
14. Set accepted input types to `URLs`.

## Supported Return Targets

- `instagram.com` -> Instagram
- `youtube.com` / `youtu.be` -> YouTube
- `github.com` -> GitHub
- `x.com` / `twitter.com` -> X
- `tiktok.com` -> TikTok

If no supported app matches, the shortcut falls back to `Resources`.

## Real Usage

1. In Instagram, tap `Share`.
2. Choose `LifeOS Capture`.
3. LifeOS opens the capture page.
4. The URL is queued immediately.
5. LifeOS shows a short success state such as:
   - `Saved. Worker is processing this now.`
   - `Saved. Waiting for local worker.`
   - `Already queued.`
6. The shortcut then reopens the matched source app.
7. If no supported app is matched, the shortcut opens `Resources`.
8. The placeholder resource card is already created either way.
9. If your local worker is online, processing starts automatically.
10. If your local worker is offline, the card waits in queue and resumes later when the worker is running again.

For Instagram links specifically:

- LifeOS first accepts the share through `/capture`
- then the worker hands that job off to the dedicated Instagram downloader queue
- the same resource card is upgraded in place instead of creating a second Instagram card

## Notes

- iOS does not reliably support fully automatic “copy a link and run in the background” from the clipboard with no trigger.
- The supported v1 path is Share Sheet first.
- iOS does not reliably support “return to the exact previous app” from the webpage itself, so the Shortcut handles source-app return explicitly.
- If a capture fails, open the resource card and use `Retry capture`.
- No cron setup is required for generic capture; the existing local worker is the background consumer.
