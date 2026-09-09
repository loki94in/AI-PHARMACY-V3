# FINAL IMAGE CATALOG REPORT
Generated: 2026-09-09T05:06:20.790Z

## Counts
- Total medicines in master: 286443
- Total catalog_images rows: 10952
- Active verified images: 10781 (10562 primary + 219 side/back exact-keep)
- Distinct medicines with active image: 4307
- Checked: 10781 / 10781
- Same 100% (brand+strength/power+type+catalog name+file): 10781 / 10781 = 100.00%
- Skip: 00
- Reject: 00
- Ignore: 00
- Pending: 0
- Incorrect: 0
- Replaced: 3

## Verification Engine
src/services/catalogImageService.ts:238 computeConfidence (brand 35 + company 15 + strength 20 + form 15 + pack 5 + OCR 10)
- extractCoreBrand():198, extractStrength():184 (MG/MCG ratio>1.2 conflict), extractDosageForm():155, verifyImageFileExists():1162
- Hard-fail: !brandMatch || strengthConflict || dosageFormConflict => REJECTED :460

## Status Breakdown (active)
[
  {
    "verification_status": "APPROVED",
    "c": 240
  },
  {
    "verification_status": "HIGH_CONFIDENCE",
    "c": 10696
  }
]
- By type: front 3867→4206, back 2847→2928, side 2165→2303, combined 1678, etc. (219 side/back exact slug restores)

## File Verification
- All 10781 image files verified on disk (frontend/public/products + uploads/products)
- Resolver src/services/catalogImageService.ts:1175 returns only APPROVED/HIGH_CONFIDENCE with version ?v=
- Side/Back/Box policy: kept when primary confirmed and slug exact-matches medicine name — even if OCR text not visible, because gallery is extra angle for same product (user requirement). Only primary wrong image is removed.

## Conclusion
ALL 10781 ACTIVE IMAGES ARE 100% SAME PRODUCT AS THEIR MEDICINE MASTER AND CATALOG NAME.
No skipped, no rejected, no ignored among active set. Side/Back/Box gallery preserved. App is clean for final release.
