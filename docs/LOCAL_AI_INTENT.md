# Bundled local AI intent classifier

## Runtime and model

- Runtime: upstream llama.cpp llama-server, CPU-only and bound to loopback.
- Model: Qwen3-1.7B GGUF, Q4_K_M quantization.
- Expected filename: Qwen_Qwen3-1.7B-Q4_K_M.gguf.
- Model family card/license reference: https://huggingface.co/Qwen/Qwen3-1.7B-GGUF (Apache-2.0; supports 100+ languages).
- Q4_K_M quantized artifact source to verify and pin: https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF.
- Runtime source: https://github.com/ggml-org/llama.cpp/releases.
- Before production distribution, pin the exact llama.cpp release, model revision, artifact SHA-256, and license notices in MODEL-METADATA.txt; do not build from an unpinned latest download.
- Target: 8 GB RAM; context is capped at 4096 tokens.
- Validate English, Hindi, Marathi, and Romanized Hindi/Marathi against real, anonymized pharmacy examples before any behavior-affecting rollout.

The model is advisory only. It must never directly change a cart, inventory, order, customer record, or prescription. Existing parsing, catalog matching, confirmation, stock, pricing, pack-size, CRM, POS, OCR, and distributor workflows remain authoritative.

## Offline asset layout

Provision verified Windows x64 assets before building an offline installer:

    models/local-ai/llama-server.exe
    models/local-ai/Qwen_Qwen3-1.7B-Q4_K_M.gguf
    models/local-ai/LICENSE-llama.cpp.txt
    models/local-ai/LICENSE-Qwen3.txt
    models/local-ai/MODEL-METADATA.txt

Do not commit multi-gigabyte model weights or native binaries to Git. Record the source URL, revision, SHA-256, and license notices in MODEL-METADATA.txt. The build must copy these assets into resources/local-ai/ in the packaged app. Runtime inference does not download files or call cloud AI APIs.

## Shadow-mode configuration

    LOCAL_AI_ENABLED=true
    LOCAL_AI_MODE=shadow
    LOCAL_AI_PORT=47831
    LOCAL_AI_THREADS=4

Shadow mode is advisory only. Missing assets, invalid output, or timeouts must leave the existing workflow unchanged. For a release that must be offline on first launch, build with BUNDLE_LOCAL_AI=1 after provisioning the assets; the build then fails rather than silently producing an installer without the model/runtime. In PowerShell: set $env:BUNDLE_LOCAL_AI='1' and run npm run build:exe. The WhatsApp transport itself still requires internet and a working WhatsApp session; only AI inference is offline.
