/**
 * Local AI & Structured Intent Parser Type Definitions
 * Spec: Local-only llama.cpp server client for Qwen3-1.7B Q4_K_M
 */

export type LocalAiIntentType = 'ORDER' | 'REFILL' | 'INQUIRY' | 'CHITCHAT' | 'UNKNOWN';

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

