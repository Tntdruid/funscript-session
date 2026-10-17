---
name: funscript
description: "Use when developing, debugging, or extending this Funscript player, including .funscript parsing, playback synchronization, intensity mapping, video library behavior, Buttplug integration, or the Python hybrid server."
---

# Funscript Development

## Project Context

This workspace contains a small BetterPlayer-style Funscript player:

- `index.html` and `style.css` provide the browser UI.
- `app.js` handles video playback, Funscript parsing, interpolation, visualization, and device state.
- `index-hybrid.html` and `app-hybrid.js` provide the hybrid/server-oriented variant.
- `server.py` serves the app and exposes the library and session endpoints.
- `sample.funscript` is the reference data file.

## Jellyfin Media Matching

When Jellyfin is used as the media library, match a video with its companion script by basename:

- `Example.mp4` -> `Example.funscript`
- `Example.mkv` -> `Example.funscript`

Do not expose a Jellyfin filesystem path directly to the browser. Use a Jellyfin media URL or a server-side endpoint for the video, and use an authenticated/API-backed endpoint for the companion `.funscript` when the browser cannot access the shared folder itself.

## Funscript Rules

- Treat `.funscript` files as JSON objects with an `actions` array.
- Each action uses `at` in milliseconds and `pos` as a percentage from 0 to 100.
- Validate numeric values, clamp `pos` to 0-100, remove invalid actions, and sort actions by `at`.
- Preserve the existing `version` and `actions` shape when generating or exporting data.
- Keep interpolation and time conversion consistent with the video element's `currentTime` in seconds and action timestamps in milliseconds.

## Implementation Workflow

1. Read the nearby code path before changing behavior.
2. Preserve the existing vanilla JavaScript, HTML, CSS, and Python structure.
3. Keep browser-only behavior in the browser files and server/API behavior in `server.py`.
4. Reuse existing helpers such as clamping, parsing, session generation, and state-update functions.
5. Handle missing DOM elements, empty scripts, invalid files, unavailable devices, and failed media metadata gracefully.
6. Avoid adding dependencies unless the existing browser or Python APIs cannot support the feature.
7. Keep UI state, playback state, and device state synchronized after every relevant user action.

## Validation

For frontend changes, run the local server with:

```text
python -m http.server 8000
```

Then verify the affected flow in a browser, including loading a video, loading a `.funscript` file, seeking, changing range/offset/amplitude, and handling empty or invalid data.

For hybrid/server changes, run:

```text
python server.py
```

Check `/api/health`, `/api/library`, and `/api/session` when the change touches those endpoints. Keep API responses valid JSON and preserve the existing response shapes.

For JavaScript changes, inspect the browser console for errors and test both the demo script and a user-loaded script. For Python changes, run a syntax check with:

```text
python -m py_compile server.py
```

## Change Boundaries

- Do not rewrite the player architecture for a localized feature.
- Do not change action units or API response formats without updating all consumers.
- Do not assume a Buttplug device is connected; the demo and disconnected states must continue to work.
- Do not commit generated media, temporary files, or local video paths.
