# Offline Local AI Asset Layout & Rollout Guide
**Component**: Local-only llama.cpp Server Client & Structured Intent Parser for Qwen3-1.7B Q4_K_M  
**Governing Documents**: `AGENTS.md`, `AGENT_DATA_FLOW_TREE.md`, `BACKEND SCHEMA SAFETY.md`

---

## 1. Architectural Overview

AI Pharmacy OS integrates an optional, local-only AI inference engine powered by **`llama.cpp` server** (`llama-server.exe`) and the **Qwen3-1.7B Q4_K_M** GGUF model.

### Core Architectural Guarantees:
1. **Strictly Localhost Only**: Connects solely to `http://127.0.0.1:8080` (or configured local port). Never transmits queries over external networks or third-party APIs.
2. **CPU-Only / No-GPU Contract**: In compliance with the project's **No-GPU Desktop Rendering Contract** in `AGENTS.md`, the model runtime executes on CPU threads (`-ngl 0`, `-t 4`, `-c 2048`). It does not require or attempt to access dedicated graphics cards.
3. **Passive Shadow Mode Only**: Runs strictly as an asynchronous, non-blocking shadow observer on ambiguous text messages.
4. **Deterministic Authoritative Rule**: The existing deterministic parser, rule-based workflows, and human pharmacist confirmation flows remain 100% authoritative.
5. **Zero Business Impact**:
   > [!IMPORTANT]
   > **No order, cart, inventory, pricing, CRM, POS, OCR, or distributor action is driven by model output.**
   > The model output is strictly captured for shadow evaluation and accuracy telemetry.

---

## 2. Important Release Limitation

> [!WARNING]
> **Git Tracking Limitation**: The large quantized model file (~1.1 GB GGUF) and `llama-server.exe` (~18 MB) are **NOT stored in Git** to prevent repository bloat and maintain lightweight clones.
> They must be provisioned and verified under `models/local-ai/` before an offline installer bundling local AI can be built.
> **This build does not claim a fully offline installer until those assets are manually provisioned.**
> The local AI capability is **disabled by default** and only executes when explicitly enabled via `LOCAL_AI_ENABLED=true`.

---

## 3. Required Offline Asset Layout

Before bundling local AI assets into the desktop installer, provision the files into `models/local-ai/`:

```text
AI PHARMACY v2/
└── models/
    └── local-ai/
        ├── llama-server.exe          # llama.cpp Windows x64 HTTP server binary
        ├── qwen3-1.7b-q4_k_m.gguf    # Quantized Qwen3-1.7B GGUF weights (Q4_K_M)
        ├── LICENSE.txt               # Applicable license notices (Apache 2.0 / MIT)
        └── metadata.json             # Manifest with model parameters and runtime specifications
```

### Manifest Format (`metadata.json`)
```json
{
  "name": "qwen3-1.7b-q4_k_m",
  "model_family": "Qwen3",
  "parameter_size": "1.7B",
  "quantization": "Q4_K_M",
  "context_length": 2048,
  "model_filename": "qwen3-1.7b-q4_k_m.gguf",
  "runtime_binary": "llama-server.exe",
  "license": "Apache-2.0",
  "created_at": "2026-10-29T00:00:00Z",
  "intended_use": "Shadow classifier for ambiguous WhatsApp medicine inquiries",
  "hardware_requirements": {
    "gpu_required": false,
    "cpu_threads": 4,
    "ram_mb": 1500
  }
}
```

---

## 4. Verification & Validation Steps

### Step 1: Run the Asset Validator
Run the automated validator to confirm that all 4 required assets exist and are structured correctly:

```bash
# Informative check (normal development without AI)
node scripts/verify-local-ai-assets.mjs

# Strict verification (simulates BUNDLE_LOCAL_AI=1 build check)
node scripts/verify-local-ai-assets.mjs --strict
```

### Step 2: Run Automated Regression Tests
Verify parsing resilience, bounded field enforcement, bypasses, and missing-asset fallbacks:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/localAiStructuredIntent.test.ts
```

All 24 test suites verify:
- Safe handling of invalid, malformed, non-JSON, and markdown-wrapped outputs.
- Field bounds (clamping quantity to `[1, 100]`, confidence to `[0.0, 1.0]`, capping medicines to 5 items, sanitizing text).
- Confirmation bypass (`YES`, `haan`, `cancel`, `1`, `2`).
- Media bypass (images, prescriptions, documents).
- Repeat bypass (`same`, `wahi`, `refill`).
- Graceful missing-asset fallback (returns safe empty structure without throwing).

---

## 5. Building the Offline Installer

### Default Build (Standard, Without Local AI Assets)
By default, building the application or installer does not require model weights:
```bash
npm run build:exe
```
This packages the standard production application.

### Bundled Offline Build (`BUNDLE_LOCAL_AI=1`)
When preparing a fully self-contained offline installer with local AI capabilities:

```powershell
# Set BUNDLE_LOCAL_AI environment variable and run the build:
$env:BUNDLE_LOCAL_AI = "1"
npm run build:exe
```

#### Build Gate Enforcement:
If `BUNDLE_LOCAL_AI=1` is set and ANY of the four required assets (`llama-server.exe`, `.gguf` model, `LICENSE.txt`, or `metadata.json`) is missing, `scripts/buildSea.cjs` will **strictly fail the build with exit code 1**.

When all assets are present:
1. `scripts/buildSea.cjs` stages assets into `dist/resources/local-ai/`.
2. `installer.iss` compiles them into `{app}\resources\local-ai` and `{app}\models\local-ai`.

---

## 6. Runtime Rollout & Shadow Mode Configuration

To activate shadow mode on a deployed instance:

1. Configure `.env` in the application root:
   ```env
   # Enable Local AI in passive shadow mode
   LOCAL_AI_ENABLED=true
   LOCAL_AI_SHADOW_MODE=true
   LOCAL_AI_PORT=8080
   LOCAL_AI_TIMEOUT_MS=4000
   ```

2. Operational Behavior:
   - When inbound WhatsApp messages arrive, confirmations, media photos, and repeat requests bypass the model completely.
   - For ambiguous text, the shadow classifier runs in the background (`triggerShadowClassificationNonBlocking`).
   - Results are appended to `data/shadow_intent.log` and stored in an in-memory 50-item circular buffer for real-time observability.
   - **Zero customer replies, orders, carts, or inventory records are modified by the shadow model.**

