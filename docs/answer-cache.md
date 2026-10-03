# Shared answer cache

Only exact normalized questions in the same UI locale qualify. Conversation
history always bypasses shared storage. The closed educational topic vocabulary
and arithmetic templates are in server/answer-cache.ts. No arbitrary questions,
IP addresses, personal chat or Kas secrets are stored. Definitions/arithmetic
qualify immediately; explanation templates require two signed browser identities.
Cookies are not proof of two people. Visitor metadata still expires after 30 days.

Answer records now have NO TTL. Every 30 days, the next qualifying question
triggers one model review; concurrent visitors receive the stored answer. This is
on-demand maintenance, not a scheduled job. Unused answers consume no review tokens.
The review receives the previous answer to preserve correct details and improve
it. Mechanical checks reject malformed/empty/sensitive-looking responses and
incorrect arithmetic. They are not a factual correctness guarantee. One previous
answer is retained for manual recovery. A failed API call keeps the old answer
and backs off six hours. The existing two-browser threshold is unchanged.

Reads PERSIST old expiring answer records. To migrate ALL existing records before
their old TTL expires, run `node scripts/persist-answer-cache.mjs` once with the
production Redis environment securely supplied. It targets only hashed answer
keys; visitor sets and chat/Kas session expiration are not changed. Records already
expired cannot be recovered. Deployment alone does not migrate unread records.

Requires existing KV_REST_API_URL/KV_REST_API_TOKEN or Upstash equivalents.
Redis failures fall back to Gemini. Delete a specific answer key in Redis to remove
it, or restore previousText manually. Persistent storage is subject to the Redis
provider's capacity, retention/backups and continued operation; it is not an
absolute durability guarantee. No production migration was run from development.

## Duplicate API requests

After the shared-cache lookup, identical questions from the same IP and UI language
acquire a 90-second Redis lease before any Gemini call. Success leaves a 24-hour
marker; failure releases it. Duplicates get a translated notice without another
model call. Fingerprints use HMAC; neither raw IP nor private answers are stored.
Context is deliberately not part of this abuse guard, so repeating the same question
with changed history still blocks for a day. Shared Wi-Fi users may hit this guard.
This applies to the default server chat, not user-supplied API keys. Redis outages
fail open to keep chat available, so duplicate suppression is not guaranteed then.

## Account retention

Account records are already stored without TTL. Passwords are salted scrypt hashes;
key-vault data is encrypted by the client. Login sessions expire after one day or
30 days with Remember me; this never deletes the account. Logout removes only the
session. Account Delete is authenticated and generation-checked; stale sessions
cannot access a re-created account. Automatic migration of old local copies during
login has been removed to prevent recreation after Delete. Local chat history
remains device-local and encrypted; this change does not introduce cloud chat sync.
