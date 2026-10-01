# Navigation and device accounts

The left glass rail stays alongside expanded chat. Home, Library (Store), Settings, About R.AI and the account control are available to guests. Library contains the update checker. Settings contains API management.

## Device-only authentication

Register with an email identifier and a password of at least 10 characters, then sign in using the same credentials. The explicitly requested local test login is `admin` / `admin`. It is initialized on its first successful sign-in and has no administrative privileges. Existing test-account history is preserved. Regular registration still requires a valid email and a password of at least 10 characters. Emails are normalized to lowercase; duplicates on the same origin are rejected. This is local authentication, not verified email ownership or a server identity. No email verification, email password recovery, remote sign-in, or cross-device synchronization is provided.

PBKDF2-SHA256 with 600,000 iterations and a random 16-byte salt derives a non-exportable AES-256-GCM key. Conversation data is encrypted with a fresh 12-byte IV per save. Passwords and session keys are not persisted. The app asks for sign-in after reload. The local record contains the email, salt, IV, and encrypted history. Saves are serialized per account; failures appear in the interface. Clearing site data removes accounts and history. Forgotten passwords cannot recover the encrypted data. Device accounts do not defend against a compromised browser or malicious code running while the account is unlocked.

Guests keep messages only in memory. Signing in starts a separate blank conversation and does not silently import guest messages. Signing out clears visible conversation state, active voice/typing, and account references. Provider API credentials retain their existing device-wide behavior and are managed in Settings.

Signed-in users get History and an expand/collapse arrow. History supports New chat, search, rename, pin/unpin, archive/unarchive and Trash/Restore. Deletion is recoverable. Switching conversations cancels pending response display and voice sessions. Desktop chat shares width with the history panel; small screens use a history overlay while the left rail remains available. No claim is made to reproduce every Codex tool or integration.

## Validation

Storage tests cover encrypted persistence, wrong passwords, duplicate prevention, account isolation, input validation and serialized writes. UI integration tests cover registration, sending a chat, signing out, signing in, restoring a conversation, creating another chat, and guest non-persistence. iOS assets are synchronized; native execution still requires validation on an iPhone/Xcode setup.

Guest continuation in the authorization dialog displays a temporary-conversation warning with Agree and Cancel. Agree opens guest chat; Cancel returns to sign-in. API management is available only through Settings, not the composer.

## Interface language and voice navigation

Settings has a device-wide English / ქართული / Русский language selector. English is the default; the selected language persists in `rai-language`. Menu labels, dialogs, history actions, translator installation UI, accessibility labels and known UI errors use `src/i18n/translations.json`. Conversation content is not rewritten when switching interface language.

History is visible only while chat is open. Opening chat while signed in restores the last expanded/collapsed history preference; closing or minimizing chat hides both without changing that preference. The preference persists on this device in `rai-history-expanded`. Expanded history has one collapse arrow. The menu expansion arrow appears only when chat is open and history is collapsed.

The API-enabled microphone lives in the menu's top slot with the animated rainbow border. There are no landing or composer microphone buttons. Starting voice from Home opens chat; removing the API key hides the microphone and stops voice.

Settings sits below Library in the main rail. Georgian navigation uses საწყობი for Library and Settings for Settings.
