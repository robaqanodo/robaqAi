# robaqAI

React / TypeScript / Vite. Production: https://www.robaq.app

- `npm run dev`: local preview (127.0.0.1:8787)
- `npm run build`: type-check and build the offline web shell
- `npx tsc -p api/tsconfig.json`: compile server handlers for Node verification

## Production

Connect Upstash Redis to the Vercel project for Production and Preview, then redeploy.
The server accepts `KV_REST_API_URL` / `KV_REST_API_TOKEN` or
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Never use a VITE-prefixed secret.
The Node functions use the explicit ESM configuration in `api/tsconfig.json`.

## Data lifecycle

Online accounts store profile fields and salted password hashes. HttpOnly cookies identify
sessions; IP addresses are not login credentials. Remember me stores a non-extractable
local vault key in IndexedDB on the selected browser. Server sessions expire after 30 days
(or one day without Remember me); signing out clears the browser session and server token.
Existing local accounts migrate on successful password verification during online sign-in.

AI chat copies on the server are encrypted with an in-memory key. Closing chat requests
immediate deletion; after an unreported disconnect the copy expires within 60 seconds.
A content-free close marker lasts 120 seconds to reject late in-flight writes.
Authorized users retain their encrypted history locally, never in a permanent server chat archive.
MovieSync End room deletes the room, messages and voice data. Abrupt host disconnects expire
within 120 seconds. Infrastructure logs/backups follow the hosting providers' retention;
application deletion cannot guarantee removal from provider backups.

Qwen and M2M100 files are stored in browser IndexedDB and run locally after installation.
Browser storage limits and user-cleared site data still apply. NLLB's Python engine requires
the local desktop service; an ordinary hosted webpage cannot install or launch Python.
External movie sites may block embedding or screen capture; WebRTC currently uses STUN
and may require a TURN relay on restrictive networks.
