# robaq AI for macOS — online edition

Build: `bash macos/build.sh`

Outputs:
- `release/robaq AI.app`
- `release/robaq-AI-macOS.zip`

Default build: Apple Silicon (M1 or newer), macOS 12 or later. Intel is not included: the installed compiler lacks Intel compatibility libraries. With a compatible Xcode toolchain, use `ROBAQ_ARCHS="arm64 x86_64" bash macos/build.sh` for a universal build. Move the app to Applications and open it. No Node, terminal, or local development server is required. The app opens https://www.robaq.app in a persistent native WebKit window. Website updates appear when reloaded (Command-R).

This is an online website edition, not a bundled offline server. MovieSync and presence require working production backend endpoints. WebKit feature support, especially screen capture, differs from desktop Safari/Chrome. Use View > Open in Browser if a feature is unavailable. Safari's locally stored accounts and chats are not automatically imported into this separate WebKit data store.

The build uses a local ad-hoc signature. It is NOT Developer ID signed or Apple notarized. Gatekeeper may block downloaded copies on other Macs; public distribution requires Developer ID signing and notarization. No signing credentials are embedded.

Compilation, bundle metadata and signature integrity are checked by the build script. No interactive or cross-device runtime testing was performed.
