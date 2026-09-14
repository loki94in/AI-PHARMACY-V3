# Medicine Image Accuracy & Packaging Cross-Validation Rule

**MANDATORY PROJECT-WIDE RULE FOR ALL CATALOG HARVESTERS, SCRIPTS, AI CAMERA, AND IMAGE PIPELINES.**

Every medicine packaging image in the system must be cross-validated against the full row from `medicine.csv` / the `medicines` database table (`name`, `generic_name`, `manufacturer`, `dosage_form`, `strength`, `pack_size`).

---

## 1. Single Salt vs. Combination Conflict Gate (`generic_name`)

- **Single-salt records must NEVER attach to combination products.**
  - If the database/CSV records a single active ingredient (e.g., `TELMISARTAN (40.0 MG)`), the image must NOT contain combination salts.
  - If packaging OCR or candidate metadata contains additional active pharmaceutical ingredients (e.g., `Metoprolol`, `Cilnidipine`, `Amlodipine`, `Hydrochlorothiazide`), the image is **IMMEDIATELY REJECTED**.
- **Combination records must match all specified salts.**
  - If the database requires `TELMISARTAN + AMLODIPINE`, a single-salt `TELMISARTAN` pack is rejected.

---

## 2. Strict Brand Equality & Suffix Protection (`name`)

- **100% exact brand and suffix token equality is mandatory.**
- Suffix modifiers define completely separate chemical formulations:
  `MCL`, `AM`, `H`, `CH`, `PLUS`, `D`, `TRIO`, `CV`, `LS`, `DSR`, `SP`, `DT`, `SR`, `ER`, `PR`, `CR`, `XL`, `FORTE`, `KID`, `PAED`.
- **Loose prefix matching is strictly forbidden.**
  - `cw.startsWith(primaryBrand)` is prohibited.
  - If target is `TELISTA 40`, packaging labeled `Telista-MCL 25` or `Telista-AM` is **HARD REJECTED**.
  - Single-letter hyphen stems must bridge strictly (`D-RISE` <-> `DRISE`), but suffix letters must never bleed.

---

## 3. Strength & Power Verification (`strength`)

- **Explicit numbers must match identically.**
  - `5mg` != `10mg`, `25mg` != `50mg`, `40mg` != `80mg`.
- If packaging OCR detects an explicit strength that contradicts the target medicine's strength (or the strength parsed from `generic_name`), `brandConfidence` drops to 0 and the image is rejected.

---

## 4. Bidirectional Dosage Form Conflict Shield (`dosage_form`)

- **Cross-form mixing is strictly prohibited:**
  - `TABLET` != `CAPSULE`
  - `CAPSULE` != `TABLET`
  - Solid Oral (`TABLET`/`CAPSULE`) != Liquid Oral (`SYRUP`/`SUSPENSION`) != Topical (`GEL`/`CREAM`/`OINTMENT`) != Parenteral (`INJECTION`/`INFUSION`)
- If packaging shows capsules, it can never attach to a tablet record, even if brand and strength match.

---

## 5. Multi-Angle 3-Way Cross-Verification Protocol

Every packaging angle serves a dedicated clinical verification function:
1. **`FRONT` / `BOX-FRONT`**:
   - Validates **Brand Name** and **Visual Packaging / Dosage Form**.
2. **`BACK` / `BOX-BACK`**:
   - Validates **Constituents & Salts** from the printed `"Composition: Each tablet/capsule contains: ..."` against `generic_name`.
   - Validates exact **Strength** per constituent.
3. **`SIDE` / `BOX-SIDE`**:
   - Validates **Company Name** (`manufacturer` / `marketed_by`).
   - Validates schedule warnings (Schedule H/H1) and licensing.
4. **`COMBO`**:
   - Multi-surface confirmation providing outer carton + inner strip context.

---

## 6. Zero-Tolerance for Guessed Image Attachments

- An image is approved only if **all signals agree**.
- If any signal conflicts (extra salt, conflicting suffix, different strength, different form), the image must be dropped or moved to `catalog_image_rejections`.
- Never guess, fallback, or force an unverified image onto a medicine.
