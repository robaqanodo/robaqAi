# Three offline chat models

Authorized scope: add Qwen3 0.6B, Qwen3 1.7B, Qwen3.5 2B to the existing Store and offline chat. Keep all project changes here. Preserve translator, account history, API chat, and three menu languages.

Use pinned Unsloth GGUF Q4_K_M files and wllama 3.6.1 CPU WebAssembly for a common browser/Capacitor path. These replace the previously discussed ONNX formats for the first two models, reducing downloads. Bundle runtime locally; download weights only on request. Verify exact size and streaming SHA256 before marking installed. Store each model separately in IndexedDB. Offer manual file import, cancellation, removal, and persistent selection. Only one model runs at a time; unload translator before LLM and vice versa. API chat still takes precedence; translator is an explicit mode. Cap local context/output for mobile memory. Never treat a failed download or unsupported runtime as a successful reply.

Implementation checklist:
- Catalog, validation, persistent storage and cancellable downloads; corruption/cancellation tests.
- Lazy runtime and bounded local chat; cancellation and stale-response protection.
- Compact Store rows, model picker, localized labels and status.
- Run tests, lint, build, native asset sync; inspect browser UI and exercise actual inference if downloads permit.

Limitations: CPU generation can be slow. Installed files can be evicted by browser storage management. Native iPhone memory/performance must be tested on device; no claim of universal device compatibility.
