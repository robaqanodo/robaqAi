# Offline translators

Store → OFFLINE TRANSLATORS opens EN / KA / RU. The three entries share one 611 MiB M2M100 quantized model, not three independent downloads. Source: https://huggingface.co/Xenova/m2m100_418M at revision 9c374f0b7aca709787cea97b047bfbbd1559d177. Base model: Meta M2M100, MIT license included in the pack. Translation quality varies, especially for Georgian; this is not Google Translate.

Download the .raipack file, then select it with Manual Submit. Download & Install is an alternative on both browser and iPhone. The importer verifies file lengths and SHA-256 hashes against the bundled manifest, stores the files in IndexedDB, and runs a real translation before marking all three skills installed. Failed installation never marks a pack ready. The worker uses locally bundled WASM, stored weights, and no remote model fallback or translation API.

Open an installed language, select source and target, enter text, and press Translate Offline. The current input limit is 500 characters. Keep the installation screen open; enough free storage and memory are necessary. Browser site-data deletion removes installed models. Production builds include a service worker for offline reopening; development previews still require the local Vite server. Capacitor bundles the shell and pack locally.

Assets remain in this project:
- `offline-assets/translation-model`: source files and MIT license.
- `public/translator/rai-translator-en-ka-ru.raipack`: import/download package.
- `public/translation-runtime`: locally served ONNX WASM runtime.
- `scripts/build-translation-pack.py`: rebuild the package and trusted manifest.

The iOS web assets are synced with `npm run ios:sync`. Real iPhone compilation and device performance must be tested using Xcode; no native iPhone build has been verified in this workspace.

Verification in this workspace: Manual Submit and chunked Download & Install both completed in the browser and ran the translation smoke test. EN→KA returned text (with imperfect quality). Browser reload with the local preview server stopped could not be confirmed in the in-app browser; test offline reopening in the target browser before release. No physical iPhone run was available.

## Chat integration
After installation, open chat with no API key connected. Offline Translator is enabled by default; choose From and To, then send up to 500 characters. The model response appears as a normal chat message. Turn off Offline Translator to return to ordinary offline chat. The installation status is rechecked when leaving the Library or opening chat. Model translation is local and does not use provider APIs.

Browser verification: the installed production model completed a translation from the chat composer without a provider key. The short EN→KA example was inaccurate, so model execution is verified but translation quality must not be presented as guaranteed.

The Library translator page now only installs and reports the language pack. Translation input and replies are available exclusively in chat.
