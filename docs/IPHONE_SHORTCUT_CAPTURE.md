# iPhone Shortcut Capture

This guide covers the new async resource capture flow for iPhone.

## What Changed

- LifeOS now supports `POST /api/resources/capture` for generic URL capture.
- The web app now has a dedicated `/capture?url=...` entrypoint.
- Submitting a URL creates a placeholder resource immediately and finishes analysis in the background.
- The Resources page shows queued, processing, and failed capture states directly on the card.

## Required Backend Setup

1. Apply the new Supabase migration for `resource_capture_jobs`.
2. Set `CRON_SECRET` in your deployed environment.
3. Configure a scheduled request to:

```text
GET /api/resources/capture/drain?limit=3
Authorization: Bearer <CRON_SECRET>
```

Recommended cadence: every minute.

The app will also try a best-effort inline drain after each capture submit, but the scheduled drain is the reliable hosted fallback.

## iPhone Shortcut Setup

1. Open the `Shortcuts` app on iPhone.
2. Tap `+` to create a new shortcut.
3. Name it `LifeOS Capture`.
4. Add the `URL` action.
5. Set the URL to:

```text
https://YOUR-LIFEOS-DOMAIN/capture?source=ios_share_shortcut&url=[Shortcut Input]
```

6. Insert `Shortcut Input` as a magic variable, not plain text.
7. Add the `Open URLs` action and pass the previous URL action into it.
8. Open the shortcut settings.
9. Enable `Show in Share Sheet`.
10. Set accepted input types to `URLs`.

## Real Usage

1. In Instagram, tap `Share`.
2. Choose `LifeOS Capture`.
3. LifeOS opens the capture page.
4. The URL is queued immediately.
5. A placeholder resource card appears in Resources.
6. Analysis finishes in the background and upgrades the same card.

## Notes

- iOS does not reliably support fully automatic “copy a link and run in the background” from the clipboard with no trigger.
- The supported v1 path is Share Sheet first.
- If a capture fails, open the resource card and use `Retry capture`.
