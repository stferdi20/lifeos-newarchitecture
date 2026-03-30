# iPhone Shortcut Capture

This guide covers the new async resource capture flow for iPhone.

## What Changed

- LifeOS now supports `POST /api/resources/capture` for generic URL capture.
- The web app now has a dedicated `/capture?url=...` entrypoint.
- Submitting a URL creates a placeholder resource immediately and finishes analysis in the background.
- The Resources page shows queued, processing, and failed capture states directly on the card.

## Required Backend Setup

1. Apply the new Supabase migration for `resource_capture_jobs`.
2. Make sure your existing local Python worker is configured and running when you want queued captures to process.
3. If the worker is offline, captures still succeed immediately and stay queued until the worker comes back online.

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
6. If your local worker is online, processing starts automatically.
7. If your local worker is offline, the card waits in queue and resumes later when the worker is running again.

## Notes

- iOS does not reliably support fully automatic “copy a link and run in the background” from the clipboard with no trigger.
- The supported v1 path is Share Sheet first.
- If a capture fails, open the resource card and use `Retry capture`.
- No cron setup is required for generic capture; the existing local worker is the background consumer.
