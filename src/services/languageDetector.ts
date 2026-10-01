/**
 * Language Detector for AI Pharmacy WhatsApp Chatbot.
 * Supports auto-detection between English (en), Hindi (hi), and Marathi (mr).
 * Accurately analyzes Devanagari script, Marathi-specific phonemes (ळ),
 * language-specific particles/vocabulary, and Romanized/Hinglish/Marathinglish text.
 */

export type SupportedLanguage = 'en' | 'hi' | 'mr';

// Unique Marathi Devanagari markers & characteristic words
const MR_DEV_WORDS = new Set([
  'नमस्कार', 'सस्नेह', 'औषध', 'औषधे', 'औषधांची', 'औषधांचे', 'औषधांचा', 'गोळ्या', 'गोळी',
  'पाहिजे', 'पाहिजेल', 'हवे', 'हवं', 'हव्या', 'आहे', 'आहेत', 'नाही', 'नाहीत',
  'द्या', 'द्यावे', 'पाठवा', 'पाठवून', 'पाठवणे', 'किती', 'कधी', 'मिळेल', 'मिळतील',
  'भेटेल', 'कसे', 'करा', 'करावे', 'धन्यवाद', 'पत्ता', 'ऑर्डर', 'होय', 'नको',
  'सांगा', 'बोला', 'कृपया', 'तास', 'दुकान', 'आमच्या', 'तुमच्या', 'माझे', 'माझ्या',
  'आपले', 'आपल्या', 'उद्या', 'परवा', 'सकाळी', 'संध्याकाळी', 'दुपारी', 'रात्री',
  'नियमित', 'पुन्हा', 'रिफिल', 'तात्काळ', 'लवकर', 'घ्या'
]);

// Unique Hindi Devanagari markers & characteristic words
const HI_DEV_WORDS = new Set([
  'नमस्ते', 'प्रणाम', 'दवा', 'दवाई', 'दवाएं', 'दवाइयों', 'गोलियां', 'गोली',
  'चाहिए', 'है', 'हैं', 'नहीं', 'दीजिए', 'दीजिये', 'दो', 'भेजो', 'भेजिए',
  'कितना', 'कितने', 'कितनी', 'कब', 'मिलेगा', 'मिलेंगे', 'कैसे', 'करो',
  'धन्यवाद', 'शुक्रिया', 'आर्डर', 'हाँ', 'हां', 'बताओ', 'बताइए', 'कृपया',
  'दुकान', 'हमारे', 'आपके', 'मेरा', 'मेरी', 'मेरे', 'अपना', 'अपनी',
  'कल', 'परसों', 'सुबह', 'शाम', 'दोपहर', 'रात', 'नियमित', 'दोबारा',
  'रिफिल', 'तुरंत', 'जल्दी', 'लो', 'लीजिए', 'लेना'
]);

// Romanized Marathi keywords & expressions
const MR_ROMAN_WORDS = new Set([
  'namaskar', 'namaskara', 'aushadh', 'aushadhi', 'aushadhe', 'pahije', 'pahijey',
  'kiti', 'pathva', 'pathav', 'pathava', 'dya', 'kasa', 'kashi', 'kase', 'aahe',
  'ahe', 'ahet', 'aahet', 'nahi', 'nahit', 'goli', 'golya', 'havay', 'have',
  'havat', 'kadhi', 'milel', 'bhetel', 'sanga', 'bola', 'dhanyawad', 'dhanyavad',
  'chya', 'sathi', 'mala', 'tula', 'amhi', 'majhe', 'mazi', 'mazya', 'kaka', 'dada',
  'tai', 'bhau', 'khup', 'parva', 'udya', 'chalel', 'thike', 'barobar', 'hoy'
]);

// Romanized Hindi keywords & expressions
const HI_ROMAN_WORDS = new Set([
  'namaste', 'pranam', 'dawa', 'dawai', 'dawain', 'chahiye', 'chahie', 'kitna',
  'kitne', 'kitni', 'bhej', 'bhejo', 'bhejiye', 'dena', 'dedo', 'dijiye', 'kya',
  'kab', 'kaise', 'hai', 'hain', 'nahi', 'shukriya', 'batao', 'bataiye', 'mangwao',
  'lao', 'mujhe', 'humko', 'mera', 'meri', 'mere', 'apka', 'aapka', 'kal', 'parson',
  'jaldi', 'turant', 'theek', 'acha', 'accha', 'haan'
]);

/**
 * Check if the customer explicitly requested to change the chat language.
 */
export function detectExplicitLanguageSwitch(text: string): SupportedLanguage | null {
  const clean = text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '');

  // Marathi commands
  if (
    /^(मराठी|marathi|marathit|मराठीत बोला|marathi madhe bola|marathi madhe sanga|marathi bhasha|change to marathi|speak in marathi)$/i.test(clean)
  ) {
    return 'mr';
  }

  // Hindi commands
  if (
    /^(हिंदी|हिन्दी|hindi|hindi me|हिंदी में|hindi me bolo|hindi me baat karo|hindi me batao|change to hindi|speak in hindi)$/i.test(clean)
  ) {
    return 'hi';
  }

  // English commands
  if (
    /^(english|ingraji|angrezi|इंग्रजी|अंग्रेजी|change to english|speak in english|talk in english|in english)$/i.test(clean)
  ) {
    return 'en';
  }

  return null;
}

/**
 * Main detection logic:
 * 1. Checks explicit language switch request first.
 * 2. If message contains Devanagari script ([\u0900-\u097F]):
 *    - Looks for 'ळ' (\u0933) which is uniquely Marathi in modern Indian languages.
 *    - Scores against Marathi vs Hindi word sets.
 * 3. If Roman script:
 *    - Scores against Romanized Marathi and Hindi dictionaries.
 *    - If purely neutral (numbers, medicine names, short yes/no, image), retains current language.
 */
export function detectLanguage(text: string, currentLang: SupportedLanguage = 'en'): SupportedLanguage {
  if (!text || typeof text !== 'string') return currentLang;
  const trimmed = text.trim();
  if (!trimmed) return currentLang;

  // 1. Explicit request
  const explicit = detectExplicitLanguageSwitch(trimmed);
  if (explicit) return explicit;

  // 2. Check for Devanagari characters
  const devanagariMatches = trimmed.match(/[\u0900-\u097F]/g);
  const totalDevChars = devanagariMatches ? devanagariMatches.length : 0;

  if (totalDevChars >= 2) {
    // If the letter 'ळ' (\u0933) exists, it is decisively Marathi
    if (trimmed.includes('ळ') || trimmed.includes('\u0933')) {
      return 'mr';
    }

    // Split into tokens (Devanagari and alphanumeric)
    const tokens = trimmed.split(/[\s,।!?.]+/).map(t => t.trim()).filter(Boolean);

    let mrScore = 0;
    let hiScore = 0;

    for (const token of tokens) {
      if (MR_DEV_WORDS.has(token)) mrScore += 3;
      if (HI_DEV_WORDS.has(token)) hiScore += 3;

      // Common Marathi suffixes
      if (/(ची|चे|च्या|ला|ना|मध्ये|वरून|कडून|साठी)$/.test(token)) mrScore += 1;
      // Common Hindi suffixes / particles
      if (/(का|की|के|को|में|पर|से|था|थी|थे|रहा|रही|रहे)$/.test(token)) hiScore += 1;
    }

    if (mrScore > hiScore) return 'mr';
    if (hiScore > mrScore) return 'hi';

    // Ambiguous Devanagari: if previously set to 'mr' or 'hi', keep it; otherwise default to 'mr' for Maharashtra local context
    if (currentLang === 'hi' || currentLang === 'mr') return currentLang;
    return 'mr';
  }

  // 3. Romanized text evaluation
  const romanTokens = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let mrRomanScore = 0;
  let hiRomanScore = 0;

  for (const token of romanTokens) {
    if (MR_ROMAN_WORDS.has(token)) mrRomanScore += 2;
    if (HI_ROMAN_WORDS.has(token)) hiRomanScore += 2;
  }

  if (mrRomanScore >= 2 && mrRomanScore > hiRomanScore) return 'mr';
  if (hiRomanScore >= 2 && hiRomanScore > mrRomanScore) return 'hi';

  // 4. Default to current conversation language if neutral or ambiguous
  return currentLang;
}

/**
 * Returns human-friendly name of the language
 */
export function getLanguageDisplayName(lang: SupportedLanguage): string {
  switch (lang) {
    case 'mr': return 'मराठी (Marathi)';
    case 'hi': return 'हिंदी (Hindi)';
    case 'en': default: return 'English';
  }
}
