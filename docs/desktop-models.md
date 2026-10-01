# NLLB-200 desktop translation

The selected model is NLLB-200 3.3B INT8, converted by OpenNMT from Meta's translation model (CC-BY-NC 4.0; non-commercial use). Its pinned revision and file hashes are in `src/offline/nllb-manifest.json`. Downloads are checked before activation. Model files live in `offline-assets/nllb-200-3.3b`; the isolated Python environment lives in `offline-assets/translation-env`.

Run `npm run dev`, or `npm run build` then `npm run preview`. The local Vite bridge is required. Static hosting and the iOS WebView cannot run this desktop model. Browser-based packs continue separately.

On a fresh computer, Python 3 with venv support is needed. Download automatically prepares the project-local engine and installs pinned CTranslate2, Tokenizers and Hugging Face Hub dependencies. Download requires internet; translation afterwards uses only local files, with no API key or network requests. Each translation process exits after its response so model RAM is released. Stop terminates that process. Delete removes the model folder and installation marker, retaining the reusable runtime.

AI Lab activates only a verified complete installation. The application requires at least 8 GB RAM. Model weights are approximately 3.4 GB; the runtime adds some disk space. Only fixed model paths and allowed operations are accepted. The HTTP bridge requires loopback Host, matching Origin, and a custom header for mutations.

English-to-Georgian translation uses an entirely local English → Russian → Georgian route, which improved the observed outputs. Other language pairs translate directly. Multiple sentences are processed separately while preserving their separating whitespace. This is a specialized translator; Qwen remains the conversational model.

Evaluation results already recorded in `docs/translation-evaluation.json` include English, Georgian and Russian examples. M2M100, TranslateGemma 4B, Qwen3.5 9B and MADLAD-400 3B showed word or sentence errors during comparison and were not selected as the new translator. NLLB's results are also imperfect: grammatical errors and paraphrasing remain possible. These limited examples do not establish general translation accuracy. No additional tests were run after the user's request to stop testing.
