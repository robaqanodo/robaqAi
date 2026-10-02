# SyberLive 1.0 / Crossfire 1.0

Both skills ship in AI Lab and activate through the existing three-second install flow. They add no navigation item. After installation, type `live` or `crossfire` in the normal chat. Their room messages never enter normal chat history, account history, Redis, or a database.

## Owned signaling process

Local `npm run dev` includes the in-memory room service. Production must run `scripts/live-room-server.ts` on an owned, persistent Node.js 22.18+ process, behind HTTPS. It must not run as a Vercel serverless function.

Example on the owned host, using the site's exact canonical origin:

```sh
ROBAQ_APP_ORIGIN=https://www.robaq.app PORT=8790 npm run rooms:serve
```

The process binds only to `127.0.0.1`. Reverse-proxy `/api/rooms/` from an HTTPS subdomain to `127.0.0.1:8790`. Keep request-body logging disabled. Run one instance: its room state intentionally cannot be shared between workers or restored after a restart. Do not enable database persistence, request-body logging, or a media relay.

Set the frontend build variable `VITE_ROOMS_SERVER_URL` to the actual HTTPS origin of that process, then rebuild the frontend. There is deliberately no fabricated default production host. If the service is absent or unreachable, the chat says that the room cannot start, before requesting camera access.

No deployment or environment variable was changed by this implementation. A Vercel-only deployment will show the unavailable-service message until this owned process is configured.

## Lifecycle and media

The server stores room membership, capability tokens, short-lived signaling, current round state and session messages in RAM. A 192-bit random invite identifies a room; a separate private capability identifies each participant. Crossfire passwords are salted and hashed in RAM. The invitation is reusable only during the current room so multiple guests can join; it cannot reopen a completed session.

Media uses browser-to-browser WebRTC. The sole ICE helper is Google's public STUN endpoint for address discovery; it does not relay media. No TURN, external video service, MediaRecorder, media upload or media database is used. Some NAT/firewall combinations therefore cannot connect. The UI reports that failure rather than silently relaying.

Explicit host End/Leave deletes the room immediately. Other clients learn this on the next poll (about 1.2 seconds) and stop their tracks/connections. Tab close sends a leave beacon; if a browser crashes or loses connectivity before delivery, a 20-second heartbeat timeout plus the 5-second sweep removes the orphan. Browser refresh never restores membership credentials. Messages, invite UI and media are cleared on exit. Infrastructure/network logs are outside this in-memory data guarantee.

SyberLive requires camera and microphone permission before creating a room and caps membership at 2–4. The host and guests use the same stage: alone, two equal views, or one promoted view with a row of smaller tiles. A guest joins through the link without an account or prior skill installation.

Crossfire permits eight guests plus a neutral host. The host's Ask runs two opposite 60-second turns. Sender tracks and receiver elements follow the current floor. Point requests are accepted only between seconds 10 and 50. A Point lasts up to 15 seconds and is shortened if necessary to preserve the final protected 10 seconds; it never extends the original deadline. Host can stop or skip. Congested video encodings are disabled per connection and represented by an avatar while audio remains. Only host gets screen sharing controls.

## Checks

`npx vitest run` covers room capacity, capabilities, passwords, ephemeral teardown, protected time, Point deadlines, alternating speakers, downloader integrity and the one-engine model lifecycle. Synthetic-browser checks use separate host/guest contexts, fake media devices and the local owned process; they do not prove reachability across every real NAT or device.
