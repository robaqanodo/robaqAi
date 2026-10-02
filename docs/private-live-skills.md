# SyberLive 1.0 / Crossfire 1.0

Both skills ship in AI Lab and activate through the existing three-second install flow. They add no navigation item. After installation, type `live` (or `syberlive`) or `crossfire` in the normal chat. Their room messages never enter normal chat history or account history.

## Signaling backends

Local `npm run dev` keeps an in-memory room service via the Vite plugin (no Redis required).

Production on Vercel uses `api/rooms/[action].ts` with the same Upstash Redis already connected for MovieSync. Room records are short-lived keys (`robaq:live:*`) with a TTL tied to the host heartbeat (about 20 seconds after the last poll, and at most 6 hours). Ending or leaving deletes the key. This is ephemeral signaling state only — not chat history and not a media archive.

Optionally, an owned persistent process remains supported for dedicated hosts:

```sh
ROBAQ_APP_ORIGIN=https://www.robaq.app PORT=8790 npm run rooms:serve
```

Set `VITE_ROOMS_SERVER_URL` to that HTTPS origin and rebuild only when you intentionally bypass the Vercel `/api/rooms` route. Leave it unset to use same-origin `/api/rooms/*`.

If Redis is missing in production, or the owned process is unreachable when configured, the chat says that the room cannot start, before requesting camera access.

## Lifecycle and media

Membership, capability tokens, short-lived signaling, current round state and session messages live only for the active room. A 192-bit random invite identifies a room; a separate private capability identifies each participant. Crossfire passwords are salted and hashed. The invitation is reusable only during the current room so multiple guests can join; it cannot reopen a completed session.

Media uses browser-to-browser WebRTC. The sole ICE helper is Google's public STUN endpoint for address discovery; it does not relay media. No TURN, external video service, MediaRecorder, media upload or media database is used. Some NAT/firewall combinations therefore cannot connect. The UI reports that failure rather than silently relaying.

Explicit host End/Leave deletes the room immediately. Other clients learn this on the next poll (about 1.2 seconds) and stop their tracks/connections. Tab close sends a leave beacon; if a browser crashes or loses connectivity before delivery, a 20-second heartbeat timeout removes the orphan. Browser refresh never restores membership credentials. Messages, invite UI and media are cleared on exit.

SyberLive requires camera and microphone permission before creating a room and caps membership at 2–4. The host and guests use the same stage: alone, two equal views, or one promoted view with a row of smaller tiles. A guest joins through the link without an account or prior skill installation.

Crossfire permits eight guests plus a neutral host. The host's Ask runs two opposite 60-second turns. Sender tracks and receiver elements follow the current floor. Point requests are accepted only between seconds 10 and 50. A Point lasts up to 15 seconds and is shortened if necessary to preserve the final protected 10 seconds; it never extends the original deadline. Host can stop or skip. Congested video encodings are disabled per connection and represented by an avatar while audio remains. Only host gets screen sharing controls.

## Checks

`npx vitest run` covers room capacity, capabilities, passwords, ephemeral teardown, protected time, Point deadlines, alternating speakers, downloader integrity and the one-engine model lifecycle. Synthetic-browser checks use separate host/guest contexts, fake media devices and the local owned process; they do not prove reachability across every real NAT or device.
