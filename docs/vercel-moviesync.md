# MovieSync on Vercel

The web build alone does not provide `/api/watch/*`. This project now includes Vercel Node functions in `api/watch/[action].ts` and `api/presence.ts`.

## Connect storage

1. Vercel → robaq project → Storage → Create Database → Upstash Redis.
2. Connect the database to the robaq project and select Production (Preview too if needed).
3. Settings → Environment Variables must contain one complete pair:
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Use the normal read/write REST token, not a read-only token. Do not add a `VITE_` prefix, put tokens in Git, or paste them into chat.
5. Commit and push these source changes to GitHub. Vercel should deploy the new commit. If variables were added after deployment, redeploy the latest commit.
6. Reload www.robaq.app and create a fresh room. Older in-memory local rooms cannot be recovered on the public server.

Rooms, participant tokens, messages, voice clips and WebRTC signaling are shared in Redis. Optimistic version checks prevent concurrent requests from overwriting one another. Rooms expire at 12 hours; closing a room deletes its record. Host inactivity is detected on room requests. Presence expires after 35 seconds without a heartbeat. Counts deduplicate browser IDs.

Screen broadcasting still depends on browser capture support and network connectivity. STUN is configured; restrictive networks may need a separate TURN relay. Connecting Redis does not bypass external websites' embed restrictions or DRM.

`npm run build` typechecks the API functions as well as the app. No live Redis or production session has been verified as part of this change: the database must first be connected by the project owner.
