/**
 * Local AI, Structured Intent Parser & Pharmacy Q&A Type Definitions
 * Spec: Local-only llama.cpp server client for Qwen3-1.7B Q4_K_M
 */

export type LocalAiIntentType = 'ORDER' | 'REFILL' | 'INQUIRY' | 'CHITCHAT' | 'UNKNOWN';

export type PharmacyQaIntentType =
  | 'AVAILABILITY_INQUIRY'
  | 'PRICE_INQUIRY'
  | 'SHOP_INFO_INQUIRY'
  | 'POLICY_INQUIRY'
  | 'MEDICINE_IDENTIFICATION'
  | 'ORDER_REQUEST'
  | 'REFILL_REQUEST'
  | 'UNSUPPORTED_OR_UNCLEAR'
  | 'CHITCHAT'
  | 'BYPASS';

export interface MedicineItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface StructuredIntentResult {
  intent: LocalAiIntentType;
  confidence: number; // Strictly clamped to [0.0, 1.0]
  medicines: MedicineItem[]; // Strictly bounded length (max 5)
  explanation: string; // Strictly bounded length (max 200)
  rawResponse?: string;
}

export interface LocalAiAssetVerification {
  valid: boolean;
  missing: string[];
  details: {
    runtimePresent: boolean;
    modelPresent: boolean;
    licensePresent: boolean;
    metadataPresent: boolean;
    runtimePath?: string;
    modelPath?: string;
    licensePath?: string;
    metadataPath?: string;
  };
}

export interface ShadowClassificationResult {
  timestamp: string;
  phone: string;
  messageBody: string;
  shouldRun: boolean;
  bypassReason?: string;
  deterministicResult: {
    isMedicineRequest: boolean;
    candidateNames: string[];
  };
  shadowModelResult: StructuredIntentResult | null;
  agreement?: boolean;
  latencyMs?: number;
}

// ── Grounded Knowledge Retrieval & Q&A Types ──────────────────────────────────

export interface RetrievedMedicineEvidence {
  id: number;
  name: string;
  canonicalName?: string;
  dosageForm?: string;
  strength?: string;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  stockQuantity: number;
  packSize?: string;
  manufacturer?: string;
  genericName?: string;
  rackLocation?: string;
  batchNo?: string;
  expiryDate?: string;
}

export interface RetrievedShopEvidence {
  storeName: string;
  phone: string;
  address: string;
  operatingHours: {
    openTime: string;
    closeTime: string;
    weeklyOff?: string;
    isOpenNow?: boolean;
    reopenLabel?: string;
  };
  deliveryPolicy?: {
    available: boolean;
    start: string;
    end: string;
    cutoff: string;
  };
  returnPolicy?: string;
}

export interface GroundedEvidence {
  evidenceFound: boolean;
  queryType: 'MEDICINE' | 'SHOP_INFO' | 'POLICY' | 'NONE';
  medicines: RetrievedMedicineEvidence[];
  shopInfo?: RetrievedShopEvidence;
  faqAnswer?: string;
  insufficientEvidenceReason?: string;
}

export type ClinicalRiskLevel =
  | 'NONE'
  | 'EMERGENCY'
  | 'DIAGNOSIS_PRESCRIBING'
  | 'DOSAGE_CALCULATION'
  | 'DRUG_INTERACTION';

export interface PharmacyQaResponse {
  intent: PharmacyQaIntentType;
  confidence: number;
  extractedMedicines: MedicineItem[];
  evidence: GroundedEvidence;
  draftResponse: string; // Natural language grounded answer in customer language
  needsPharmacistEscalation: boolean;
  escalationReason?: string;
  clinicalRiskLevel?: ClinicalRiskLevel;
  emergencyGuidance?: string;
  clarifyingQuestionNeeded: boolean;
  clarifyingQuestion?: string;
  safetyDisclaimers: string[];
  latencyMs?: number;
  rawModelOutput?: string;
}

export interface PharmacyQaEvaluationRecord {
  id: string;
  language: 'en' | 'hi' | 'mr' | 'hinglish';
  inputQuery: string;
  expectedIntent: PharmacyQaIntentType;
  expectedMedicines?: string[];
  expectedInStock?: boolean;
  isBypassCase?: boolean;
  bypassReason?: string;
  isMedicalSafetyCase?: boolean;
  clinicalRiskLevel?: ClinicalRiskLevel;
  actualResponse?: PharmacyQaResponse;
  intentMatched?: boolean;
  medicinesMatched?: boolean;
  safetyCompliant?: boolean;
  hallucinationDetected?: boolean;
}

export interface PharmacyQaBenchmarkMetrics {
  totalEvaluated: number;
  intentAccuracyPercent: number;
  medicineMatchPercent: number;
  hallucinationRatePercent: number;
  medicalSafetyCompliancePercent: number;
  averageLatencyMs: number;
  fallbackRatePercent: number;
  passedThresholds: boolean;
}

export interface LanguageAccuracyMetrics {
  language: string;
  total: number;
  matched: number;
  accuracyPercent: number;
}

export interface IntentAccuracyMetrics {
  intent: string;
  total: number;
  matched: number;
  accuracyPercent: number;
}

export interface DetailedBenchmarkMetrics extends PharmacyQaBenchmarkMetrics {
  byLanguage: Record<string, LanguageAccuracyMetrics>;
  byIntent: Record<string, IntentAccuracyMetrics>;
  heldOutMetrics?: PharmacyQaBenchmarkMetrics;
}
