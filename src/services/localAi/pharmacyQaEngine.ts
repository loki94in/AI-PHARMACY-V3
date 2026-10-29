/**
 * Pharmacy Q&A Engine
 * Combines local Qwen3-1.7B conversational understanding with authoritative SQLite knowledge retrieval.
 *
 * Safety & Ethics Standard:
 * - Strictly grounded in database facts: stock, prices, and hours are NEVER hallucinated.
 * - Medical Safety Gate: Diagnoses and prescription advice are strictly blocked with pharmacist escalation.
 * - Non-blocking: Deterministic workflows remain authoritative. Zero business state mutations.
 */

import { queryLocalAiIntent, queryLocalAssistantReply, getLocalAiConfig, isLocalAiEnabled, checkLlamaServerHealth, type LocalAssistantConversationTurn } from './llamaServerClient.js';
import { pharmacyKnowledgeRetriever } from './pharmacyKnowledgeRetriever.js';
import {
  parseStructuredIntent,
  isNonMedicineCondition,
  sanitizeString,
  normalizeMedicineItem,
  MAX_QUANTITY,
  MIN_QUANTITY
} from './structuredIntentParser.js';
import type {
  PharmacyQaIntentType,
  PharmacyQaResponse,
  GroundedEvidence,
  MedicineItem,
  ClinicalRiskLevel
} from './types.js';

export interface ClinicalRiskClassification {
  level: ClinicalRiskLevel;
  reason?: string;
  emergencyGuidance?: string;
  disclaimer: string;
}

/**
 * Structured Clinical Risk Classifier
 * Multi-layer clinical safety gate detecting:
 *   - Level 1: EMERGENCY (chest pain, cardiac arrest, stroke, poisoning, unconsciousness, severe bleeding)
 *   - Level 2: DIAGNOSIS_PRESCRIBING (symptom diagnosis, which antibiotic/drug to take)
 *   - Level 3: DOSAGE_CALCULATION (pediatric drops/ml, infant doses, pregnancy adjustments, doubling doses)
 *   - Level 4: DRUG_INTERACTION (dangerous drug combinations, mixing sedatives/alcohol, blood thinners)
 */
export function classifyClinicalRisk(text: string): ClinicalRiskClassification {
  if (!text) return { level: 'NONE', disclaimer: '' };
  const t = text.toLowerCase();

  // 1. EMERGENCY LEVEL
  if (
    /chest pain|chest tightness|crushing chest|heart attack|cardiac arrest|stroke|breathing difficulty|shortness of breath|anaphylaxis|poisoning|poison|overdose|unconscious|heavy bleeding|bleeding profusely|seizure|convulsions|heart fail/i.test(t) ||
    /हार्ट अटैक|दिल का दौरा|छाती में दर्द|सीने में|बेहोश|जहर|विष|दौरा|सांस नहीं आ रही|खून बह रहा|रक्तस्राव|दम घुट|कीटनाशक/i.test(t) ||
    /हार्ट अटॅक|हृदयविकार|छातीत दुखणे|छातीत तीव्र वेदना|छातीत प्रचंड|डावा हात.*दुखतोय|डावा हात.*सुन्न|बेशुद्ध|विषबाधा|विषारी|आकडी|श्वास घेण्यास त्रास|रक्तस्त्राव/i.test(t) ||
    /chest me bahut|saans ful|zeher|chakkar aa rahe/i.test(t)
  ) {
    return {
      level: 'EMERGENCY',
      reason: 'Acute life-threatening medical emergency detected.',
      emergencyGuidance:
        '🚨 *MEDICAL EMERGENCY DIRECTIVE:*\n\n' +
        'The symptoms described require **IMMEDIATE EMERGENCY MEDICAL ATTENTION**.\n\n' +
        '🚑 **Call 108 or 112 immediately** for emergency ambulance services or proceed to the nearest casualty / ICU hospital without delay.\n\n' +
        '📞 We have alerted our licensed on-duty pharmacist.',
      disclaimer: '⚠️ *Emergency Notice:* Automated pharmacy systems cannot treat acute life-threatening emergencies. Seek professional emergency care immediately.'
    };
  }

  // 2. DIAGNOSIS & PRESCRIBING LEVEL (Including symptom and condition requests)
  if (
    /what (?:medicine|dawa|tablet|cure|treatment) (?:should|can) i (?:take|have|use)/i.test(t) ||
    /which (?:medicine|tablet|antibiotic|drug) (?:is best|to take|to use)/i.test(t) ||
    /suggest (?:a |an )?(?:medicine|tablet|antibiotic|treatment|cure|dawai)/i.test(t) ||
    /prescribe|cure my|diagnose my|antidepressant|depression|डिप्रेशन|नैराश्य|anxiety|चिंतेवर/i.test(t) ||
    /(?:which|what|suggest|konsi|konsa|strong|heavy|कौन सा|कौनसा|कौनसी|कोणता|कोणती|कोणते).*(?:antibiotic|एंटीबायोटिक|अँटिबायोटिक)/i.test(t) ||
    /(?:antibiotic|एंटीबायोटिक|अँटिबायोटिक).*(?:throat|infection|dental|take|cure|best|likh|लिख|सुचवा|सांगा|खाना|घेऊ|घ्यावा|घ्यावी)/i.test(t) ||
    /(?:doctor ki jagah|डॉक्टर की जगह|डॉक्टरांकडे न जाता|without prescription|तुम्हीच).*(?:likh|लिख|लिहून|prescribe|गोळ्या|dawai|dawa)/i.test(t) ||
    /(?:medicine|medication|tablet|pill|drug|dawai|dawa|goli|औषध|गोळी|गोली|दवा|दवाई|something|anything).*(?:for|के लिए|साठी|ची|चा|ki|ke liye).*(?:fever|bp|blood pressure|sugar|diabetes|headache|pain|cough|cold|allergy|loose motion|diarrhea|vomiting|infection|rash|asthma|बुखार|ताप|डोकेदुखी|सिरदर्द|पेट दर्द|पोटदुखी|दस्त|उल्टी|मधुमेह|खोकला|सर्दी|बीपी|शुगर)/i.test(t) ||
    /(?:fever|bp|blood pressure|sugar|diabetes|headache|pain|body pain|sar dard|pet dard|bukhar|cough|cold|allergy|loose motion|diarrhea|vomiting|infection|rash|asthma|बुखार|ताप|डोकेदुखी|सिरदर्द|पेट दर्द|पोटदुखी|दस्त|उल्टी|मधुमेह|खोकला|सर्दी|अंगदुखी|बीपी|शुगर).*(?:medicine|medication|tablet|pill|drug|dawai|dawa|goli|औषध|गोळी|गोली|दवा|दवाई)/i.test(t) ||
    /(?:दवा|दवाई|गोली|इलाज|उपचार).*(?:बताओ|बताएं|लूं|लेनी चाहिए|खानी चाहिए)/i.test(t) ||
    /(?:कौनसी|कौन सी).*(?:दवा|दवाई|गोली|एंटीबायोटिक|इलाज)/i.test(t) ||
    /बुखार की (?:दवा|दवाई)|सिरदर्द की (?:दवा|दवाई)|पेट दर्द की (?:दवा|दवाई)|बदन दर्द|खांसी जुकाम|दर्द की गोली/i.test(t) ||
    /(?:कोणते|कोणती|काय).*(?:औषध|गोळी).*(?:घ्यावे|घेऊ|सांगा)/i.test(t) ||
    /(?:औषध|गोळी).*(?:सांगा|सुचवा|लिहून द्या)/i.test(t) ||
    /(?:डोकेदुखी|ताप|पोटदुखी|खोकला|अंगदुखी|जुलाब).*(?:औषध|गोळी)/i.test(t) ||
    /(?:bp|sugar|शुगर|बीपी).*(?:की|के लिए|ची|साठी)?.*(?:दवा|दवाई|गोली|गोळी|औषध|goli|tablet)/i.test(t) ||
    /konsi antibiotic|doctor ki jagah|prescribe kar do|dawai lu|dawa bhejo|dawa likh kar do/i.test(t)
  ) {
    return {
      level: 'DIAGNOSIS_PRESCRIBING',
      reason: 'Customer requested autonomous medical diagnosis or prescription advice.',
      emergencyGuidance: undefined,
      disclaimer: '⚠️ *Medical Notice:* We are an automated pharmacy assistant and cannot diagnose conditions or prescribe medications. Please consult a registered medical practitioner.'
    };
  }

  // 3. DOSAGE CALCULATION LEVEL
  if (
    /(?:child|infant|baby|kid|pregnancy|pregnant|toddler|month|महीने|महिन्यांच्या|बच्चे|बच्चा|शिशु|लहान मूल|बाळ|गरोदर|गरोदरपणात).*(?:dose|dosage|dosing|antibiotic|how many ml|how many drops|drops|fever syrup|खुराक|डोज़|कितना एमएल|कितनी बूंद|थेंब|प्रमाण|किती औषध|किती डोस|किती गोळ्या|किती घ्यावी)/i.test(t) ||
    /(?:how many drops|drops|how much dose|what dose|what is the correct.*dosage|kitna ml|कितना एमएल|कितनी बूंद|किती थेंब).*(?:child|infant|baby|kid|pregnancy|toddler|month|बच्चे|बच्चा|बाळ)/i.test(t) ||
    /(?:how much|what) (?:dose|dosage) for (?:child|infant|baby|kid|pregnancy)/i.test(t) ||
    /double dose|missed dose can i take two/i.test(t) ||
    /(?:बच्चे|बच्चा|शिशु|गर्भवती).*(?:खुराक|डोज़|कितना एमएल|कितनी बूंद|दवा)/i.test(t) ||
    /बच्चे को कितनी (?:दवा|खुराक) दें|गर्भावस्था में खुराक/i.test(t) ||
    /(?:लहान मूल|बाळ|गरोदर).*(?:डोस|प्रमाण|किती औषध|थेंब)/i.test(t) ||
    /बाळाला किती डोस द्यावा|baby ko kitna ml/i.test(t)
  ) {
    return {
      level: 'DOSAGE_CALCULATION',
      reason: 'Customer requested pediatric, pregnancy, or custom dosage calculation.',
      emergencyGuidance: undefined,
      disclaimer: '⚠️ *Dosage Safety Notice:* Pediatric, pregnancy, and specialized dosages depend strictly on age, weight, and a doctor\'s written prescription. Automated dose calculation is strictly blocked.'
    };
  }

  // 4. DRUG INTERACTION LEVEL
  if (
    /(?:can i take|safe to take|dangerous to consume|mix|combining).*(?:together|with|and|while taking).*(?:viagra|sildenafil|nitrate|sorbitrate|warfarin|aspirin|alcohol|sedative|sleeping)/i.test(t) ||
    /drug interaction|interact with each other|side effect of taking.*together/i.test(t) ||
    /(?:दोनों दवाएं|साथ में|एक साथ|नींद की गोली के साथ शराब).*(?:ले सकते हैं|खा सकते हैं|रिएक्शन|खतरा)/i.test(t) ||
    /(?:दोन्ही औषधे|झोपेच्या गोळ्या आणि दारू|हृदयाचे औषध आणि इतर गोळ्या|एकत्र).*(?:घेऊ शकतो का|रिएक्शन|दुष्परिणाम|चालतात का)/i.test(t) ||
    /dono medicine sath me|alcohol lene se koi reaction|alcohol while taking/i.test(t)
  ) {
    return {
      level: 'DRUG_INTERACTION',
      reason: 'Potential dangerous drug-drug interaction inquiry.',
      emergencyGuidance: undefined,
      disclaimer: '⚠️ *Medication Interaction Notice:* Combining certain prescription medications or substances can cause severe adverse interactions. Do not combine drugs without a licensed pharmacist consultation.'
    };
  }

  return { level: 'NONE', disclaimer: '' };
}

// Medical diagnostic / prescribing inquiry detection helper
export function isUnsafeMedicalAdviceQuery(text: string): boolean {
  return classifyClinicalRisk(text).level !== 'NONE';
}

// Inquiries about shop hours, location, contact, and return policies
const SHOP_INFO_REGEX = /(?:\b(?:time|timing|open|close|hours|open now|kab khula|kab band|khula hai|band hai|store open|shop open|store close|shop close|address|location|where is|pharmacy location|contact number|phone number|call|return policy|refund policy|exchange policy|delivery slot|home delivery|din me wapas)\b|दुकान.*(?:चालू|उघडी|बंद|खुली|पत्ता|वेळ|कधी|खुलती|आहे)|दुकानचा पत्ता|दुकान का पता|पत्ता काय|पत्ता सांगा|पत्ता कुठे|पता बताइये|पता क्या है|फोन नंबर|कॉल|संपर्क|वेळ काय|कधी उघडते|कधी बंद|नियम|वापस|परत|डिलिव्हरी.*(?:वेळ|slot|वेळ काय)|डिलिवरी|डिलीवरी|होम डिलिव्हरी|पोहोचवण्याची सेवा|पहुंचाने की सुविधा|समय क्या है|समय)/i;

// Price inquiries
const PRICE_REGEX = /(?:\b(?:price|rate|mrp|cost|how much for|how much is|discount|offer|selling price|bhav|dam|kimat)\b|kitne (?:rupaye|me|mein|rupees|ka|ki)|kitna (?:rupaye|kharcha|bhav|dam|cost)|kitne ka|kitne ki|kitna hai|दाम|किंमत|कीमत|भाव|मूल्य|रेट|रुपये|रुपयांना|रुपयाला|कितीला|किती रुपयांना|किती रुपयाला|किती पडेल|कितने रुपये|कितने में|(?:\s|^)दर(?:\s|$|चे|काय|सांगा))/i;

// Availability inquiries
const AVAILABILITY_REGEX = /(?:\b(?:available|availability|in stock|stock|do you have|do you carry|can i get|do you sell|sell|hai kya|h kya|milega|milegi|mil sakti|mil jayega|ahe ka|ahet ka)\b|उपलब्ध|आहे का|मिलेगा|मिल जाएगी|मिल जाएगा|मिलेगी|स्टॉक में|है क्या|ह क्या|आहेत का|मिळेल|मिळतील|स्टॉकमध्ये|मिळेल का|मिळतील का)/i;

// Order requests
const ORDER_REGEX = /(?:\b(?:order|book|send|deliver|purchase|buy|urgent|urgently|bhej do|bhejo|bhej|bhejiye|bhej dena|de do|dena|chahiye|pack kar|pack kardo|pack kar do|rakho|lena hai)\b|पाठवा|द्या|पाठवून द्या|हवे|पाहिजे|हव्या|बुक करा|आर्डर|भेज दीजिए|भेजिए|भेजें|भेज दो|भिजवाएं|भिजवा दो|भिजवा दीजिए|पैक कर दो|स्ट्रिप चाहिए|गोली चाहिए|दे दो|द्या तातडीने)/i;

// Refill requests
const REFILL_REGEX = /(?:\b(?:refill|repeat|purani|wahi|previous|last month|pichhle|pichhli|regular|chronic|same medicine)\b|पुन्हा|तीच औषध|नियमित औषध|मागच्या|मागील|रीफिल|दोबारा|फिर से|रेगुलर पर्ची|बंधी हुई|वापस भेज)/i;

/**
 * Extracts candidate medicine name from conversational text, stripping greetings,
 * question phrases, price/stock keywords, and politeness fillers.
 */
export function extractCandidateMedicineName(text: string): string {
  if (!text) return '';
  let cleaned = text
    .replace(/[?.,!;:_()"'`]/g, ' ')
    // English conversational prefixes
    .replace(/\b(what is the|what is|tell me the|tell me|how much for|how much is|how much|do you have|is there|is it|is|can i get|i want to order|i would like to purchase|i want|please send|send|i need|need|give me|de do|dena|chahiye|mangta|deliver|book)\b/gi, '')
    // Stock / availability / price keywords
    .replace(/\b(available|availability|in stock|stock|hai kya|h kya|milega kya|milega|milegi|mil sakti|ahe ka|ahet ka|rate|price|mrp|cost|discount|offer|kitna|kitne|bhav|dam|kimat|selling price)\b/gi, '')
    // Refill keywords
    .replace(/\b(refill|repeat|purani|wahi|previous|last month|pichhle|pichhli|regular|chronic)\b/gi, '')
    // Units and quantities
    .replace(/\b(\d+\s*(?:strips?|box(?:es)?|tablets?|tabs?|capsules?|caps?|bottles?|pack(?:s)?|vials?|mg|ml))\b/gi, '')
    .replace(/\b(strip|strips|box|boxes|tablet|tablets|capsule|capsules|bottle|bottles|packet|pack|packs|syrup|goli|golya|patti)\b/gi, '')
    // Devanagari conversational fillers
    .replace(/(?:क्या|आहे का|उपलब्ध|आहेत का|मिलेगा|मिळेल|मिळतील|दाम|किंमत|भाव|दर|पत्ता|वेळ|दुकान|फोन|नंबर|मला|द्या|पाठवा|हवे|आहे|पाहिजे|हव्या|गोळी|गोळ्या|पट्टी|पत्ते|डिब्बी|शीशी|बाटली|स्टॉकमध्ये)/gi, '')
    // Fillers & politeness
    .replace(/\b(bhai|bhaiya|sir|madam|please|plz|urgent|urgently|fast|shop|store|pe|par|for|of|the|a|an|in|on|at|ka|ki|ke|ko|se|me|mein|bhejo|patva|dya|aur|and|or|bhi|toh|batao|sanga|kya|hai|h|your|you|aapka|aapki|apka|apki|tumcha|tumchi|tumchya)\b/gi, '')
    // Numbers 1-10
    .replace(/\b(?:[1-9]|10)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length >= 2 && !isNonMedicineCondition(cleaned)) {
    return cleaned;
  }
  return '';
}

export class PharmacyQaEngine {
  /**
   * Evaluates incoming message, classifies intent, retrieves authoritative facts,
   * and generates a grounded response.
   */
  public async processQuery(
    messageText: string,
    options: {
      phone?: string;
      customerName?: string;
      language?: 'en' | 'hi' | 'mr' | 'hinglish';
      dbInstance?: any;
      conversationHistory?: LocalAssistantConversationTurn[];
      assistantScope?: 'customer' | 'staff';
    } = {}
  ): Promise<PharmacyQaResponse> {
    const startTime = performance.now();
    const text = (messageText || '').trim();
    const lang = options.language || 'en';

    // 1. Initial fast heuristics for intent and query type
    const isUnsafeMedical = isUnsafeMedicalAdviceQuery(text);
    const isRefill = REFILL_REGEX.test(text) && !isUnsafeMedical;
    const isShopInfo = SHOP_INFO_REGEX.test(text) && !isUnsafeMedical;
    const isPrice = PRICE_REGEX.test(text) && !isUnsafeMedical && !isShopInfo;
    const isOrder = ORDER_REGEX.test(text) && !isUnsafeMedical;
    const isAvailability = AVAILABILITY_REGEX.test(text) && !isUnsafeMedical;

    // 2. Structured entity extraction via local model / parser
    let extractedMedicines: MedicineItem[] = [];
    let modelIntent: PharmacyQaIntentType = 'UNSUPPORTED_OR_UNCLEAR';
    let rawModelOutput: string | undefined;

    // If unsafe medical advice query, strictly mark as UNSUPPORTED and avoid medicine extraction
    if (isUnsafeMedical) {
      modelIntent = 'UNSUPPORTED_OR_UNCLEAR';
    } else {
      // Use local model if enabled and healthy
      const localAiActive = isLocalAiEnabled() && (await checkLlamaServerHealth());
      if (localAiActive && text.length > 2) {
        try {
          const modelResult = await queryLocalAiIntent(text);
          rawModelOutput = modelResult.rawResponse;

          // Map model result
          if (modelResult.medicines && modelResult.medicines.length > 0) {
            extractedMedicines = modelResult.medicines.filter(m => !isNonMedicineCondition(m.name));
          }

          if (modelResult.intent === 'ORDER') {
            modelIntent = 'ORDER_REQUEST';
          } else if (modelResult.intent === 'REFILL') {
            modelIntent = 'REFILL_REQUEST';
          } else if (modelResult.intent === 'CHITCHAT') {
            modelIntent = 'CHITCHAT';
          } else if (isShopInfo) {
            modelIntent = 'SHOP_INFO_INQUIRY';
          } else if (isPrice) {
            modelIntent = 'PRICE_INQUIRY';
          } else if (isAvailability) {
            modelIntent = 'AVAILABILITY_INQUIRY';
          }
        } catch (err) {
          console.warn('[Pharmacy QA Engine] Model query fallback:', err);
        }
      }

      // Heuristic fallbacks if model was inactive or returned UNKNOWN
      if (modelIntent === 'UNSUPPORTED_OR_UNCLEAR') {
        if (isRefill) {
          modelIntent = 'REFILL_REQUEST';
        } else if (isShopInfo) {
          modelIntent = 'SHOP_INFO_INQUIRY';
        } else if (isPrice) {
          modelIntent = 'PRICE_INQUIRY';
        } else if (isOrder) {
          modelIntent = 'ORDER_REQUEST';
        } else if (isAvailability) {
          modelIntent = 'AVAILABILITY_INQUIRY';
        }
      }

      // 3. Fallback entity extraction if model missed it
      if (extractedMedicines.length === 0 && !isShopInfo) {
        const candidate = extractCandidateMedicineName(text);
        if (candidate && !isNonMedicineCondition(candidate)) {
          extractedMedicines.push({
            name: candidate,
            quantity: 1,
            unit: 'strip'
          });
        }
      }
    }

    // 4. Knowledge Retrieval from authoritative database
    const candidateName = extractedMedicines[0]?.name;
    const evidence: GroundedEvidence = await pharmacyKnowledgeRetriever.buildGroundedEvidence(
      candidateName,
      isShopInfo,
      options.dbInstance
    );

    // 5. Medical Safety Guardrail
    const clinicalRisk = classifyClinicalRisk(text);
    const safetyDisclaimers: string[] = [];
    let needsPharmacistEscalation = false;
    let escalationReason: string | undefined;

    if (clinicalRisk.level !== 'NONE') {
      needsPharmacistEscalation = true;
      escalationReason = clinicalRisk.reason;
      safetyDisclaimers.push(clinicalRisk.disclaimer);
    }

    // 6. Draft Grounded Natural Language Response
    let draftResponse = '';
    let clarifyingQuestionNeeded = false;
    let clarifyingQuestion: string | undefined;

    if (clinicalRisk.level === 'EMERGENCY') {
      draftResponse = clinicalRisk.emergencyGuidance ||
        `🚨 *MEDICAL EMERGENCY DIRECTIVE:*\n\nPlease call 108 or 112 immediately for emergency medical assistance.`;
    } else if (clinicalRisk.level !== 'NONE') {
      draftResponse =
        `🙏 *Health & Safety Notice:*\n\n` +
        `For your safety, prescription decisions and symptom diagnoses require consultation with a qualified doctor.\n\n` +
        `📞 We have notified our licensed pharmacist to call you if you need immediate assistance.`;
    } else if (isShopInfo && evidence.shopInfo) {
      const s = evidence.shopInfo;
      const timing = s.operatingHours;
      draftResponse =
        `🕐 *${s.storeName} — Store Information*\n\n` +
        `⏰ *Hours:* ${timing.openTime} to ${timing.closeTime}` +
        (timing.weeklyOff ? ` (Closed: ${timing.weeklyOff})` : '') + `\n` +
        (s.address ? `📍 *Address:* ${s.address}\n` : '') +
        (s.phone ? `📱 *Phone:* ${s.phone}\n` : '') +
        `\n_You can send medicine orders or prescriptions 📸 anytime!_`;
    } else if (evidence.medicines && evidence.medicines.length > 0) {
      const med = evidence.medicines[0];
      const stockStatus = med.inStock ? `✅ *In Stock*` : `⏳ *Currently Out of Stock* (Can be procured)`;
      const priceText = `MRP: ₹${med.mrp.toFixed(2)} | Our Price: *₹${med.sellingPrice.toFixed(2)}*`;

      if (modelIntent === 'PRICE_INQUIRY') {
        draftResponse =
          `💊 *${med.name}*\n` +
          `💰 ${priceText}\n` +
          `📦 Status: ${stockStatus}\n\n` +
          `_Reply with quantity (e.g. "1 strip") if you would like to order._`;
      } else if (modelIntent === 'AVAILABILITY_INQUIRY') {
        draftResponse =
          `💊 *${med.name}*\n` +
          `📦 ${stockStatus}\n` +
          `💰 ${priceText}\n\n` +
          (med.inStock
            ? `_Would you like us to prepare this for you?_`
            : `_Would you like our pharmacist to check for an alternative?_`);
      } else {
        // Order or general identification
        draftResponse =
          `💊 *${med.name}*\n` +
          `💰 ${priceText}\n` +
          `📦 ${stockStatus}`;
      }
    } else if (candidateName) {
      // Medicine searched but not found in database
      clarifyingQuestionNeeded = true;
      clarifyingQuestion = `Could you please verify the spelling of "${candidateName}" or share a photo of your prescription?`;
      draftResponse =
        `🔍 We could not find a match for *"${candidateName}"* in our current catalog.\n\n` +
        `📸 Please share a photo of the strip or prescription, or check the spelling so our team can check immediately.`;
    } else {
      // Generate a natural conversational answer when the grounded structured
      // response has no matching medicine, shop fact, or policy. The model sees
      // only verified evidence and recent conversation; it cannot execute tools.
      if (localAiActive) {
        const conversationalReply = await queryLocalAssistantReply(text, {
          language: lang,
          conversationHistory: options.conversationHistory,
          verifiedEvidence: evidence,
          assistantScope: options.assistantScope || 'customer'
        });
        if (conversationalReply) {
          draftResponse = conversationalReply;
        }
      }

      // Reliable fallback if local inference is unavailable or returns nothing.
      if (!draftResponse) {
        draftResponse =
          `👋 Welcome to AI Pharmacy!\n\n` +
          `You can ask me naturally about medicine availability, MRP, store hours, refill requests, or help from our pharmacist. Just describe what you need in your own words — no special keywords or menu numbers are required.\n\n` +
          `If I need more information, I will ask a short follow-up question.`;
      }
    }

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      intent: modelIntent,
      confidence: 0.90,
      extractedMedicines,
      evidence,
      draftResponse,
      needsPharmacistEscalation,
      escalationReason,
      clinicalRiskLevel: clinicalRisk.level,
      emergencyGuidance: clinicalRisk.emergencyGuidance,
      clarifyingQuestionNeeded,
      clarifyingQuestion,
      safetyDisclaimers,
      latencyMs,
      rawModelOutput
    };
  }
}

export const pharmacyQaEngine = new PharmacyQaEngine();
