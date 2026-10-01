# MovieSync website broadcasting

YouTube, Vimeo and MP4/WebM keep synchronized playback. Other HTTPS URLs are loaded directly in a sandboxed iframe on the host device (no server proxy). Website embedding restrictions, browser cookie rules, DRM and verification still apply.

Host: desktop Chrome/Edge supporting Region Capture. Align the website, Lock frame, Play, select the current robaqAI tab and enable tab audio. Guests receive a WebRTC stream cropped to `.watch-browser-window`. The app never sends video before cropTo succeeds and never falls back to full-screen capture. Audio comes from the selected tab, not from a cropped rectangle. Pause stops all capture tracks. Unlocking or changing the URL ends the broadcast.

For reliable connections across restrictive networks configure a TURN relay in the hosting environment:

- MOVIESYNC_TURN_URL: comma-separated turn:/turns: URLs
- MOVIESYNC_TURN_USERNAME
- MOVIESYNC_TURN_CREDENTIAL

These must not use a VITE_ prefix. Authenticated room participants obtain RTC connection configuration from /api/watch/ice. Use restricted relay credentials and rotate them; production-scale deployments should issue short-lived credentials. Without a configured TURN relay only STUN/direct connections are available, which do not work on all networks. No relay is provisioned by this change.

Guest Safari/iPhone can receive WebRTC video but may require Enable broadcast playback to permit sound. Host Safari/iPhone cannot provide this cropped capture mode. Broadcasts are live peer streams, not server recordings. Browser permission and actual two-device/network testing are required before claiming end-to-end deployment verification.
