# Offline Local AI Assets Directory

This directory holds the offline local inference runtime and quantized model assets for **Qwen3-1.7B Q4_K_M** powered by **llama.cpp server (`llama-server.exe`)**.

---

## Important Release Limitation

> [!WARNING]
> The large GGUF model (~1.1 GB) and `llama-server.exe` (~18 MB) are **NOT** stored in Git.
> They must be provisioned and verified under `models/local-ai/` before an offline installer can be built.
> This release does **NOT** claim a fully offline installer until those assets are present.
> The AI is **disabled by default** and only runs when explicitly enabled in shadow mode.

---

## Required Asset Layout

Before building an offline installer with `BUNDLE_LOCAL_AI=1`, ensure the following four assets exist in this folder:

```text
models/local-ai/
├── llama-server.exe          # llama.cpp HTTP server Windows x64 binary
├── qwen3-1.7b-q4_k_m.gguf    # Quantized Qwen3-1.7B model (Q4_K_M)
├── LICENSE.txt               # Apache 2.0 / MIT license notices
└── metadata.json             # Manifest with model, runtime, and license specs
```

### 1. Runtime (`llama-server.exe`)
Download the official release build of llama.cpp server for Windows x64 (CPU / OpenBLAS or MSVC build) from the official llama.cpp releases repository. Place `llama-server.exe` into this directory.

### 2. Model (`qwen3-1.7b-q4_k_m.gguf`)
Download the official GGUF quantization `qwen3-1.7b-q4_k_m.gguf` (or place your verified `.gguf` file here).

### 3. License Notices (`LICENSE.txt`)
Contains the Apache 2.0 license for Qwen and MIT license for llama.cpp.

### 4. Metadata Manifest (`metadata.json`)
Copy `manifest.example.json` to `metadata.json`:
```bash
cp manifest.example.json metadata.json
```

---

## Verification

To verify that all required assets are present and ready for offline bundling:

```bash
# Informative check
node scripts/verify-local-ai-assets.mjs

# Strict check (exits with code 1 if missing)
node scripts/verify-local-ai-assets.mjs --strict
```

---

## Building with Local AI Bundling

To compile a standalone installer package that bundles the Local AI offline assets:

```bash
# In Windows PowerShell:
$env:BUNDLE_LOCAL_AI = "1"
npm run build:exe
```

If any of the 4 assets is missing, the build will strictly abort with exit code `1`.

