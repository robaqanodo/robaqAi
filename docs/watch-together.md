# Moviesync 1.0

Open **AI Lab → Online Skills → Moviesync 1.0**. This is an online synchronized player, not screen sharing. No AI API key or Supabase project is required by this first version.

## Host
1. Enter your display name.
2. Paste a YouTube or Vimeo video URL, or a public direct HTTPS `.mp4` or `.webm` URL, or select **Use a short sample video**.
3. Choose a code of 6–64 characters and select **Create room**.
4. Select **Copy invite link**. Send the URL and your code separately.
5. Use Play/Pause and the seek slider. Change video is under the player.
6. **End room** closes it for everyone.

## Guest
Open the invite URL, enter a display name and the code, then select **Join room**. If the browser blocks automatic playback, press **Enable playback**. The host controls the timeline; volume is personal. **Hide chat** collapses the translucent chat overlay; **Show chat** restores it. The centered player sits above the glass chat composer. New messages briefly appear in large, translucent text over the video and then fade. Full text remains in the room chat; Chat history beside the composer opens the full conversation; it is hidden by default. The composer remains visible directly below the player controls. Fullscreen expands the video and keeps the transient messages.

## Local preview and remote access
Run `npm run dev` in the Smartass folder and open http://127.0.0.1:8787/?watch. Two browser windows can join the same local room. The short sample is an MDN CC0 flower video.

A localhost invite is only reachable on that computer. For distant friends, the UI and `/api/watch/*` endpoints must be served together on a shared HTTPS origin with a continuously running Node process. Static-only hosting does not include the room server. The Vite plugin supports local development and preview. Public production hosting is not provisioned by this change; do not publish a development server as a production service. A production deployment should extract the middleware into a dedicated server, add deployment-level rate limiting, and restrict trusted origins/proxies. Both host and guests must open the public site before creating/joining a remote room.

Video is fetched independently by each participant directly from its source. The room server handles codes, playback state, and messages; it does not download or retransmit the movie. YouTube and Vimeo are controlled using their official embedded player APIs and do not require an AI API key. Videos must permit embedding; private, region-restricted or protected videos may fail. Other website pages, subscription services, local file paths and unsupported codecs are not supported. The video URL is visible to all room members: do not use links containing private credentials.

## Behavior and limits
- Eight participants per room, at most 50 rooms per server process.
- Polling once per second; playback drift over 1.2 seconds is corrected. Exact frame synchronization is not promised.
- Room codes are salted and hashed; room-member tokens remain in memory in the open page, never in invitation URLs.
- Joining/creating is rate-limited by server-observed IP. A shared reverse proxy may make guests share this limit.
- Messages are limited to 1,000 characters, held in server memory until the room ends. The room accepts up to 10,000 messages; existing history is never silently truncated.
- No persistent room/history storage. Refreshing the host page loses its host token. Guests can rejoin with the invite/code.
- Rooms expire after 12 hours or two minutes without host contact, and disappear on server restart. Closing the room explicitly removes it immediately.
- Browser autoplay and network buffering can delay playback. The host can pause until everyone is ready.

The production bundle was compiled. No additional tests or multi-device playback checks were run, as requested.

The Moviesync 1.0 view uses the main chat bounds while keeping the navigation visible. On desktop, video width is up to 500 px and centered; small screens use the available width. Embedded services keep a minimum 200 px player height. Provider playback has been compiled but not live-tested in this change.

When a connected client receives a room-closed response, its displayed room history is cleared. Transient video messages last 3.6 seconds; old history is not replayed when joining. Long messages are abbreviated only on the video overlay.

## Activation and profile
AI Lab uses one-click automatic setup: Download plays a three-second setup animation while preparing the included implementation, activates it and opens Moviesync. The Active card shows Delete only; reopen the skill from MovieSync in the main navigation. Closing AI Lab during the animation cancels activation. No extra package is transferred because the skill is bundled with Smartass. Active is saved on this device and adds MovieSync below AI Lab in the navigation. Delete resets this preference and removes the shortcut and its eight video icons. Invitations can still be joined without installing a shortcut.

The main logo uses small colored spheres in place of birds, preserving the existing installed-model and translator color rules. An active MovieSync skill adds exactly eight independently orbiting video icons. Reduced-motion preferences pause their movement.

A signed-in user's saved first and last name prefill Your name (up to the room's 32-character limit). Guests still enter their names. The player is up to 580 px wide. Chat history expands across the workspace, keeps the playing video behind translucent glass, and includes its own message composer. Close or Escape returns to the compact view. History remains temporary and is deleted with the room.

## Updated controls and appearance
MovieSync now appears above AI Lab. The compact video surface ignores pointer and keyboard interaction; use the controls below it. In fullscreen, the host can click the video once to toggle play/pause; guests cannot control the room timeline. The fullscreen exit button remains available. Change video sits above Chat history beside the composer. Connection/share guidance lives in the corner question-mark panel. MovieSync labels and main errors follow the English, Georgian and Russian locale setting. White-theme surfaces use dark neutral controls and stronger text contrast, with clipped rounded panel corners. Offline AI no longer exposes manual file submission.

## Guests, voice reactions and host moderation
Guests receive the first available Guest1–Guest8 label on the room server. Signed-in users send their saved profile display name. These are local-account display names, not globally verified identities.

The microphone button starts a recording capped at 10 seconds. Press it again to send early, or Cancel to discard. The microphone stops when recording ends, when muted, or when leaving the room. Voice reactions are delivered after recording, not as a live call. No AI API keys are sent or shared. Browser microphone permission and HTTPS (or localhost) are required. Incoming room audio is enabled initially; browsers may require tapping a reaction before sound can play. Voice reactions use the same local volume slider as the movie. The separate room-audio toggle has been removed; microphone moderation is still host-only. Reactions expire after 60 seconds, and are removed with the room; they are never written to disk.

Hosts can mute an individual guest, mute all guests, remove a participant, or lock/unlock new joins. Restrictions are enforced by the room server. Removing a participant revokes their current room token; locking prevents rejoining with the room code. Granting microphone access does not start anyone's microphone automatically.

## Participants and hearts
The Participants button opens a collapsible glass overlay containing connection status, invitation controls, the vertical member list and host moderation. The drawer does not reserve a sidebar column, so the video and composer stay centered whether it is open or closed. Narrow or short screens retain scrolling instead of clipping controls.

Each current member receives one of eight unique server-assigned colors. Their message colors and heart bursts use that color. Double-click or double-tap the player to send one like, shown to all connected participants as a seven-heart animation fading into the sender's color. A heart button also provides keyboard-accessible liking. The session counter counts one like per accepted action, not each decorative heart. Reactions are rate limited and count only while the room exists. Fullscreen host single-click playback waits briefly to distinguish a double-click like. The changes were compiled; no multi-device interaction tests were run.

The participant drawer is collapsed initially. Escape or its collapse arrow closes it. Changing player volume also updates any currently playing voice reaction. Muting a participant disables their recording permission without preventing them from hearing the room.
