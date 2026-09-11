// AI Camera Service for OCR processing using Tesseract.js (offline capable)
import { createWorker, PSM } from 'tesseract.js';
import { Jimp } from 'jimp';
import {
  productNameFilterService,
  extractDrugStrength,
  extractVolumeOrWeight,
  extractFormulationModifiers,
  hasFormulationModifierConflict
} from './productNameFilterService.js';
import { isPlausibleMedicineName } from './intentKeywords.js';
import { onnxOcrService } from './onnxOcrService.js';
import { onlineDataEnricher } from './onlineDataEnricher.js';
import { visualIndexService } from './visualIndexService.js';
import { dbManager } from '../database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
  }>;
}

class AICameraService {
  private worker: any = null;
  private initialized: boolean = false;
  private ignoreListLoaded: boolean = false;

  private async preprocess(buffer: Buffer): Promise<Buffer> {
    try {
      const image = await Jimp.read(buffer);
      let width = image.bitmap.width;
      let height = image.bitmap.height;
      const maxDim = 1200;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        image.resize({ w: width, h: height });
      }
      image.greyscale().contrast(0.25);
      return await image.getBuffer('image/jpeg');
    } catch (err) {
      console.error('Preprocessing failed, using original:', err);
      return buffer;
    }
  }

  /**
   * Load all API composition and drug generic words from the database
   * dynamically to ignore them during OCR fuzzy matching.
   */
  public readonly KNOWN_APIS = new Set<string>();

  /** Company names extracted from medicines.manufacturer + catalog_images.company_name */
  public readonly KNOWN_COMPANIES = new Set<string>();
  private companyAliasMap = new Map<string, string>(); // core -> full
  private companyNamesLoaded = false;

  /**
   * Load all API composition and drug generic words from the database
   * dynamically to track known active ingredients.
   */
  public async loadDatabaseIgnoreList(): Promise<void> {
    if (this.ignoreListLoaded) return;
    try {
      const db = await dbManager.getConnection();
      
      // 1. Fetch api_reference from medicines into KNOWN_APIS
      const medicineApis = await db.all('SELECT DISTINCT api_reference FROM medicines WHERE api_reference IS NOT NULL AND api_reference <> ""');
      for (const row of medicineApis) {
        if (row.api_reference) {
          const words = row.api_reference.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
          for (const word of words) {
            const cleanWord = word.trim().toLowerCase();
            if (cleanWord.length > 2) {
              this.KNOWN_APIS.add(cleanWord);
            }
          }
        }
      }

      // 2. Fetch compositions from medicine_reference into KNOWN_APIS
      try {
        const refApis = await db.all('SELECT DISTINCT composition1, composition2 FROM medicine_reference');
        for (const row of refApis) {
          if (row.composition1) {
            const words = row.composition1.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
            for (const word of words) {
              const cleanWord = word.trim().toLowerCase();
              if (cleanWord.length > 2) {
                this.KNOWN_APIS.add(cleanWord);
              }
            }
          }
          if (row.composition2) {
            const words = row.composition2.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
            for (const word of words) {
              const cleanWord = word.trim().toLowerCase();
              if (cleanWord.length > 2) {
                this.KNOWN_APIS.add(cleanWord);
              }
            }
          }
        }
      } catch (refErr) {
        console.warn('[AiCamera] Could not load from medicine_reference table:', refErr);
      }

      // 3. Fetch user permanently ignored words into STOP_WORDS
      try {
        const userIgnored = await db.all('SELECT word FROM permanently_ignored_words');
        for (const row of userIgnored) {
          if (row.word) {
            const clean = row.word.trim().toLowerCase();
            if (clean) this.STOP_WORDS.add(clean);
          }
        }
      } catch (piwErr) {
        console.warn('[AiCamera] Could not load permanently_ignored_words:', piwErr);
      }

      // 4. Load company names (manufacturer) — core tokens for brand vs company disambiguation
      try {
        // Prefer catalog-verified companies (727) + frequent medicines manufacturers (not all 10k noisy)
        const catMans = await db.all("SELECT DISTINCT company_name FROM catalog_images WHERE company_name IS NOT NULL AND company_name != ''");
        const freqMans = await db.all("SELECT manufacturer as name, COUNT(*) as cnt FROM medicines WHERE manufacturer IS NOT NULL AND manufacturer != '' GROUP BY manufacturer HAVING cnt >= 5 ORDER BY cnt DESC LIMIT 500");
        const allMans = [...catMans.map((r:any)=>r.company_name), ...freqMans.map((r:any)=>r.name)];
        const GENERIC_COMPANY_WORDS = new Set(['pvt','ltd','private','limited','pharmaceutical','pharmaceuticals','pharma','laboratories','labs','laboratory','healthcare','health','care','india','inc','corp','corporation','enterprises','remedies','formulations','formulation','lifesciences','lifescience','sciences','science','pty','llc','industries','industry','works','product','products','pharmaceutic','pharmaceutics']);
        const CITY_DENY = new Set(['mumbai','delhi','kolkata','chennai','bangalore','bengaluru','hyderabad','pune','ahmedabad','jaipur','lucknow','kanpur','nagpur','indore','thane','bhopal','visakhapatnam','patna','vadodara','ghaziabad','ludhiana','agra','nashik','faridabad','meerut','rajkot','kalyan','vasai','varanasi','srinagar','aurangabad','dhanbad','amritsar','navi','allahabad','ranchi','howrah','coimbatore','jabalpur','gwalior','vijayawada','jodhpur','madurai','raipur','kota','guwahati','chandigarh','solapur','hubli','dharwad','bareilly','moradabad','mysore','gurgaon','aligarh','jalandhar','bhubaneswar','salem','warangal','guntur','bhiwandi','saharanpur','gorakhpur','bikaner','amravati','noida','jamshedpur','bhilai','cuttack','firozabad','kochi','bhavnagar','dehradun','durgapur','asansol','nanded','kolhapur','ajmer','gulbarga','jamnagar','ujjain','loni','siliguri','jhansi','ulhasnagar','nellore','jammu','sangli','belgaum','mangalore','ambattur','tirunelveli','malegaon','gaya','jalgaon','udaipur','maheshtala']);
        for(const raw of allMans){
          if(!raw) continue;
          const full = String(raw).trim();
          const tokens = full.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>=3 && !GENERIC_COMPANY_WORDS.has(t) && !CITY_DENY.has(t) && !/^\d+$/.test(t));
          if(tokens.length===0) continue;
          const core = tokens.slice(0,2).join(' ');
          const single = tokens[0];
          if(single.length>=3){
            this.KNOWN_COMPANIES.add(single);
            this.companyAliasMap.set(single, full);
          }
          if(core.length>=5 && core!==single){
            this.KNOWN_COMPANIES.add(core);
            this.companyAliasMap.set(core, full);
          }
        }
      } catch(compErr){
        console.warn('[AiCamera] Could not load company names:', compErr);
      }

      this.ignoreListLoaded = true;
      console.log(`[AiCamera] Loaded DB ignore list. Total stop words: ${this.STOP_WORDS.size}, Known APIs: ${this.KNOWN_APIS.size}, Companies: ${this.KNOWN_COMPANIES.size}`);
    } catch (err) {
      console.error('[AiCamera] Failed to load database ignore list:', err);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.worker = await createWorker('eng', 1, {
        langPath: process.cwd(), // Load local eng.traineddata from root folder
        gzip: false             // Use uncompressed local traineddata file
      });
      await this.worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT, // Sparse text. Find as much text as possible in no particular order.
        preserve_interword_spaces: '1',

        // Medicine label specific optimizations for offline OCR
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-/:, ()+₹mgμ%', // Expected medicine label chars including Rupee symbol
        user_defined_dictionary: './data/medicine_dict.txt', // Custom medicine dictionary
        user_patterns_file: './data/medicine_patterns.txt',  // Patterns like "\\d+mg", "\\d+ tablet"
      });
      
      await this.loadDatabaseIgnoreList();
      
      this.initialized = true;
      console.log('AI Camera Service initialized with local Tesseract.js config and medicine dictionary');
    } catch (error) {
      console.error('Failed to initialize AI Camera Service:', error);
      throw error;
    }
  }

  /**
   * Stop words and common pharma label words that should NOT be passed to
   * the fuzzy product-name matcher. These are high-frequency words that appear
   * on every medicine label but are NOT part of the product name.
   * Covers: English function words, pharma label keywords, dosage units.
   */
  private readonly STOP_WORDS = new Set([
    // English function / filler words
    'the','of','is','a','an','and','or','for','in','on','at','to','by','with',
    'be','are','was','not','this','that','from','as','it','its',
    // Pharma label noise & dosage forms
    'tab','tabs','tb','th','tablet','tablets','cap','caps','capsule','capsules',
    'syp','syr','syrup','sus','susp','suspension','inj','injection','inf','infusion',
    'drops','drop','drp','drps','cream','crm','gel','ointment','oint','lotion','powder',
    'spray','inhaler','sachet','solution','vati','bhasma','churna','kwath','taila',
    'asav','arishta','ras','guggulu','avaleha','respules','rotacap','rotacaps',
    'mg','ml','mcg','g','iu','gm','kg','mm','cm',
    'mrp','mfg','exp','batch','lot','no','nos','each','qty',
    'manufactured','marketed','distributed','by','pvt','ltd','inc',
    'pharma','pharmaceuticals','laboratories','lab','labs','care',
    // Pharmacopoeia standards & Rx markers (often read with dots or OCR misread as 1.p., etc.)
    'ip', 'bp', 'usp', '1p', 'ep', 'nf', 'rx',
    // Package, commercial promo, and storage filler words
    'flavour', 'flavor', 'flav', 'taste', 'sugar', 'free', 'contains', 'composition',
    'keep', 'out', 'reach', 'children', 'store', 'cool', 'dry', 'place', 'protect',
    'light', 'storage', 'warning', 'caution', 'schedule', 'prescription',
    'physician', 'directed', 'dosage', 'shake', 'well', 'before', 'use', 'external', 'only',
    'net', 'weight', 'vol', 'volume', 'bottle', 'carton', 'box', 'pack', 'packings',
    'offer', 'bogo', 'combo', 'promo', 'extra', 'worth', 'save', 'special',
    // Route / administration descriptors (NOT brand names)
    'ophthalmic','oral','topical','intravenous','subcutaneous','nasal','rectal',
    'vaginal','otic','dermal','buccal','sublingual','inhaled','iv','im',
    // Verbal/chat words that may appear due to OCR misreads
    'api','chat','verbal','call','text','message','send','please','note',
  ]);

  /**
   * Checks if an OCR line is a chemical composition declaration, pharmacopoeia reference,
   * regulatory warning, storage direction, or batch/manufacturing line.
   * Such lines must NEVER be used as the brand name search query.
   */
  public isPackagingOrCompositionLine(line: string): boolean {
    const l = line.toLowerCase();
    // 1. Pharmacopoeia standards & chemical salt markers (I.P., B.P., U.S.P.)
    if (/\b(i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?|1\.?p\.?)\b/i.test(l)) return true;
    
    // 2. Composition declarations & chemical formulations
    if (/^(each\s+|composition|contains|active\s+ingredient|contents?|formulation)/i.test(l)) return true;
    if (/\b(equivalent\s*to|anhydrous|trihydrate|hydrochloride|hcl|maleate|succinate|potassium|sodium|fumarate|mesylate|sulphate|sulfate|acetate|phosphate|nitrate|citrate|lactate|tartrate)\b/i.test(l)) return true;
    
    // 3. Regulatory & Warning text
    if (/\b(schedule\s+[a-z]|prescription\s+drug|warning|caution|for\s+retail|not\s+to\s+be\s+sold|for\s+external\s+use|for\s+oral\s+use|keep\s+out\s+of\s+reach|children)\b/i.test(l)) return true;
    
    // 4. Storage & Directions
    if (/\b(store\s+in|cool\s*dry|protect\s+from|temperature|exceeding|as\s+directed\s+by|physician|dosage)\b/i.test(l)) return true;
    
    // 5. Manufacturing & Batch details
    if (/\b(mfg\.?\s*lic|batch\s*no|b\.?\s*no|exp\.?\s*date|m\.?r\.?p|inclusive\s+of|marketed\s+by|manufactured\s+by|mkt\.?\s*by|mfd\.?\s*by)\b/i.test(l)) return true;

    return false;
  }

  /**
   * Returns candidate search tokens from an OCR text line by:
   * 1. Splitting into words
   * 2. Stripping leading/trailing punctuation and non-alphanumeric noise (e.g. 3%% -> 3, (baclof) -> baclof)
   * 3. Removing stop words, single-char tokens, pure-numeric tokens, pharmacopoeia markers, and active chemical ingredients (KNOWN_APIS)
   * Only the remaining "uncertain" / brand words are worth fuzzy-matching.
   */
  private extractCandidateTokens(line: string): string[] {
    return line
      .split(/[\s,;:|()\[\]{}\/\\]+/)
      .map(w => w.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
      .filter(w => {
        if (w.length < 3) return false;
        if (this.STOP_WORDS.has(w)) return false;
        if (this.KNOWN_COMPANIES.has(w)) return false; // company name is not a product name
        if (this.KNOWN_APIS.has(w)) return false;     // active pharmaceutical ingredient (chemical salt) is NOT a brand name!
        if (/^\d+[%a-z]*$/i.test(w)) return false;
        if (/^(ip|bp|usp|1p|i\.p|b\.p|u\.s\.p|1\.p)$/i.test(w)) return false;
        // filter pure company alias singletons (e.g. cipla, sun) even if not in KNOWN_COMPANIES due to casing
        if (this.companyAliasMap.has(w)) return false;
        return true;
      });
  }

  /**
   * If the OCR text already contains a recognizable API / composition pattern
   * (e.g. "Paracetamol 500mg", "Amoxicillin+Clavulanic") we can skip the
   * expensive fuzzy DB scan — the composition already identifies the medicine.
   * Returns the matched API string, or null if none detected.
   */
  private async detectKnownApi(text: string): Promise<string | null> {
    await this.ensureApiMap();
    // Pattern: a multi-character word followed by a strength (e.g. 500mg, 0.5%, 5ml)
    const apiPattern = /\b([A-Za-z]{5,})(?:\s*\+\s*[A-Za-z]{4,})*\s+\d+\s*(?:mg|ml|mcg|g|iu|%)/i;
    const m = text.match(apiPattern);
    if (!m) return null;
    const word = m[1].toLowerCase();
    
    // Check if the extracted word is a known API or stem
    if (this.apiGenericMap && (this.apiGenericMap.has(word) || this.apiStemIndex.some(s => s.api.includes(word)))) {
      return m[0].trim();
    }
    return null;
  }

  // ─── API / stem → generic tablet-name resolver ───────────────────────
  // Many OCR scans read only the API stem (e.g. "ithromycin") or a brand
  // fragment, not the canonical generic tablet name (e.g. "Azithromycin").
  // Backed by the medicine_reference table (composition1 → name).
  private apiGenericMap: Map<string, string> | null = null;
  private apiStemIndex: { api: string; name: string }[] = [];

  private async ensureApiMap(): Promise<void> {
    if (this.apiGenericMap) return;
    const map = new Map<string, string>();
    const stems: { api: string; name: string }[] = [];
    try {
      const db = await dbManager.getConnection();
      const rows = await db.all(
        'SELECT name, composition1 FROM medicine_reference WHERE name IS NOT NULL AND name <> ""'
      );
      for (const r of rows) {
        const name = (r.name || '').toString().trim();
        const api = (r.composition1 || '').toString().trim().toLowerCase();
        if (!name) continue;
        map.set(name.toLowerCase(), name);
        if (api && api !== name.toLowerCase()) {
          map.set(api, name);
          if (api.length >= 5) stems.push({ api, name });
        }
      }

      // Also load unique API substances to resolve stems to proper substances
      try {
        const apiRows = await db.all('SELECT api FROM api_substances');
        for (const ar of apiRows) {
          const api = (ar.api || '').toString().trim().toLowerCase();
          if (api && api.length >= 5) {
            if (!map.has(api)) {
              map.set(api, ar.api);
            }
            stems.push({ api, name: ar.api });
          }
        }
      } catch (err) {
        console.warn('[AiCamera] Failed to load from api_substances:', err);
      }
    } catch {
      /* DB unavailable — fall back to the raw OCR token */
    }
    this.apiGenericMap = map;
    this.apiStemIndex = stems;
  }

  private resolveGenericName(candidate: string): string | null {
    if (!candidate || !this.apiGenericMap) return null;
    const stripped = candidate
      .replace(/\s*\d+\s*(?:mg|g|ml|mcg|iu|%)/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const tries = [candidate.trim().toLowerCase(), stripped].filter(Boolean);
    for (const t of tries) {
      if (!t) continue;
      if (this.apiGenericMap.has(t)) return this.apiGenericMap.get(t)!;
      // stem match: OCR fragment is contained in a known API (e.g. "ithromycin" → Azithromycin)
      const hits = this.apiStemIndex.filter((s) => s.api.includes(t) && t.length >= 5);
      if (hits.length > 0) return hits[0].name;
    }
    return null;
  }

  /**
   * Detect dosage form from OCR text (Tab/Cap/Syp/Drops/Inj/Gel/Cream/etc.)
   */
  detectDosageForm(text: string): string | null {
    if (!text) return null;
    const patterns: [RegExp, string][] = [
      [/\b(?:tab(?:let)?s?|caplets?)\b/i, 'Tablet'],
      [/\b(?:cap(?:sule)?s?)\b/i, 'Capsule'],
      [/\b(?:liquid|oral\s*solution|solution|syrup|syp|elixir)\b/i, 'Syrup'],
      [/\b(?:susp(?:ension)?|oral\s*suspension)\b/i, 'Suspension'],
      [/\b(?:inj(?:ection)?|infusion)\b/i, 'Injection'],
      [/\b(?:gel)\b/i, 'Gel'],
      [/\b(?:cream)\b/i, 'Cream'],
      [/\b(?:drops?|eye\s*drops?|ear\s*drops?|ophthalmic(?:\s*solution)?)\b/i, 'Drops'],
      [/\b(?:oint(?:ment)?)\b/i, 'Ointment'],
      [/\b(?:lotion)\b/i, 'Lotion'],
      [/\b(?:powder|dusting\s*powder)\b/i, 'Powder'],
      [/\b(?:spray)\b/i, 'Spray'],
      [/\b(?:inh(?:aler)?|respules?|rotacaps?)\b/i, 'Inhaler'],
      [/\b(?:sachet|granules)\b/i, 'Sachet'],
      [/\b(?:balm|vaporub|rub)\b/i, 'Balm'],
      [/\b(?:soap|bar|facewash|bodywash)\b/i, 'Soap'],
      [/\b(?:oil|tail|taila)\b/i, 'Oil'],
      [/\b(?:shampoo)\b/i, 'Shampoo'],
      [/\b(?:serum)\b/i, 'Serum'],
    ];
    for (const [regex, form] of patterns) {
      if (regex.test(text)) return form;
    }
    return null;
  }

  /**
   * Detect company name from OCR text using the 10k+ known manufacturers.
   * Returns the full company name (e.g. "Cipla Ltd") if its core token
   * (e.g. "cipla") appears in the text. Uses word boundaries so
   * "CIPLADINE" does not trigger "cipla".
   */
  detectCompanyName(text: string): string | null {
    if (!text || this.KNOWN_COMPANIES.size === 0) return null;
    const lower = text.toLowerCase();
    // Prefer longest match first (e.g. "sun pharma" before "sun")
    const sorted = Array.from(this.KNOWN_COMPANIES).sort((a, b) => b.length - a.length);
    for (const c of sorted) {
      if (c.length < 3) continue;
      // Escape regex
      const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}\\b`, 'i');
      if (re.test(lower)) {
        return this.companyAliasMap.get(c) || c;
      }
    }
    return null;
  }

  async processImage(imageData: string | Buffer, skipEnrichment: boolean = false): Promise<any> {
    let buffer: Buffer;
    if (typeof imageData === 'string') {
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = Buffer.from(imageData, 'base64');
      }
    } else {
      buffer = imageData;
    }

    // Apply preprocessing
    const processedBuffer = await this.preprocess(buffer);

    let localOcrResult: OCRResult = { text: '', confidence: 0, words: [] };
    let fallbackUsed = false;

    const isONNXAvailable = await onnxOcrService.checkAvailability();
    if (isONNXAvailable) {
      try {
        const ocrResult = await onnxOcrService.scanImage(processedBuffer);
        if (ocrResult && ocrResult.success && ocrResult.text && ocrResult.text.trim().length > 0) {
          localOcrResult = {
            text: ocrResult.text || '',
            confidence: ocrResult.confidence || 0,
            words: ocrResult.words || []
          };
          fallbackUsed = false;
        } else {
          console.warn('ONNX OCR returned empty or failed result:', ocrResult?.error);
          fallbackUsed = true;
        }
      } catch (err) {
        console.error('Error executing ONNX OCR:', err);
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    if (fallbackUsed) {
      if (!this.initialized) {
        await this.initialize();
      }

      try {
        // 1. Run local Tesseract OCR
        const { data } = await this.worker.recognize(processedBuffer);
        const words = data.words ? data.words.map((word: any) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          }
        })) : [];

        localOcrResult = {
          text: data.text || '',
          confidence: Math.round(data.confidence),
          words: words
        };
      } catch (ocrError: any) {
        console.error('Local Tesseract OCR failed:', ocrError);
      }
    }

    // Visual pre-check against the 11,661 verified catalog images (pHash Hamming <= 10)
    let visualHitName: string | null = null;
    try {
      const queryPhash = await visualIndexService.computePhashFromBuffer(processedBuffer);
      if (queryPhash) {
        const visualHits = await visualIndexService.searchByPhash(queryPhash, 1, 10);
        if (visualHits.length > 0) {
          visualHitName = visualHits[0].product_name;
          console.log(`[AiCamera] Direct visual match found in verified gallery: "${visualHitName}" (Hamming distance: ${visualHits[0].distance})`);
        }
      }
    } catch (visErr) {
      console.warn('[AiCamera] Visual index pre-check failed (non-blocking):', visErr);
    }

    // --- Step 1: Detect known API/composition for medical intelligence (NOT as the search query!) ---
    let matches: string[] = [];
    const detectedApiText = await this.detectKnownApi(localOcrResult.text);
    if (detectedApiText) {
      console.log(`[AiCamera] Active ingredient detected in OCR ("${detectedApiText}") — saved as composition metadata.`);
    }

    if (visualHitName) {
      // Visual match directly provides the unique verified brand name from catalog!
      matches.push(visualHitName);
    }

    // --- Step 2: Fuzzy match — only on brand candidate tokens, NOT chemical salts or packaging noise ---
    // Split text into lines, strip stop words, composition text & packaging noise from each line, then try against DB.
    try {
      await this.loadDatabaseIgnoreList();
      
      await productNameFilterService.initialize();

      // Filter lines down to only those containing actual candidate (brand name) tokens.
      // Exclude composition lines, pharmacopoeia lines, storage/warnings, and promo lines.
      const candidateLines = localOcrResult.text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 2 && l.length < 100)
        .filter(l => !/\b(free\b|buy\s+\d+\s+get|special\s+offer|promo\s+pack|extra\s+\d+|save\s+rs)/i.test(l))
        .filter(l => !this.isPackagingOrCompositionLine(l))
        .map(line => ({ original: line, tokens: this.extractCandidateTokens(line) }))
        .filter(item => item.tokens.length > 0);

      const detectedDosageForm = this.detectDosageForm(localOcrResult.text);
      let bestLineMatches: string[] = [];
      let bestLineScore = 0;

      for (const item of candidateLines) {
        const cleanedLine = item.tokens.join(' ');
        // Try the full cleaned line first (best for multi-word names)
        const filterResult = await productNameFilterService.filterProductNames(cleanedLine, {
          minConfidenceThreshold: 0.65,
          dosageForm: detectedDosageForm || undefined,
          rawOcrText: localOcrResult.text
        });

        const lineScore = filterResult.topScore ?? 0;
        if (filterResult.matches.length > 0 && lineScore > bestLineScore) {
          bestLineScore = lineScore;
          bestLineMatches = filterResult.matches;
          if (bestLineScore >= 0.88) {
            break;
          }
        }
      }

      if (bestLineMatches.length > 0) {
        if (!visualHitName) matches = bestLineMatches;
      } else if (!visualHitName) {
        // If the line-level query found nothing, try top individual uncertain tokens
        // Guard with max 3 token lookups to prevent CPU freezes on 286k medicine fuzzy scans
        let tokenChecks = 0;
        for (const item of candidateLines) {
          for (const token of item.tokens) {
            if (token.length < 5) continue; // skip very short or common noise tokens
            if (tokenChecks >= 3) break;
            tokenChecks++;
            const tokenResult = await productNameFilterService.filterProductNames(token, {
              minConfidenceThreshold: 0.7,
              dosageForm: detectedDosageForm || undefined,
              rawOcrText: localOcrResult.text
            });
            const tokenScore = tokenResult.topScore ?? 0;
            if (tokenResult.matches.length > 0 && tokenScore > bestLineScore) {
              bestLineScore = tokenScore;
              bestLineMatches = tokenResult.matches;
              if (bestLineScore >= 0.88) break;
            }
          }
          if (bestLineMatches.length > 0 || tokenChecks >= 3) break;
        }
        matches = bestLineMatches;
      }
    } catch (err: any) {
      console.error('[AiCamera] Fuzzy match failed:', err);
    }

    // 3. Save unrecognized images for pharmacist audit
    // An image is unrecognized if it doesn't match any medicine in our database (matches is empty)
    if (matches.length === 0) {
      try {
        await this.saveToAuditQueue(imageData, localOcrResult.text, null);
      } catch (auditError) {
        console.error('Failed to log to audit queue:', auditError);
      }
    }

    // Construct final medicineInfo structure for the routes
    const finalInfo: any = {};
    // Use OCR extraction matching
    const lines = localOcrResult.text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Brand-name selection. If a DB match exists, use its canonical name.
    // Otherwise pick the most brand-like OCR line INSTEAD of the first line
    // (which is often a barcode/batch/garbage). Candidate lines are filtered
    // through extractCandidateTokens (which strips API words, dosage units,
    // company/function stop words), so only a real medicine name survives.
    let brandName = '';
    if (matches.length === 0) {
      const cands = lines
        .map(line => {
          const toks = this.extractCandidateTokens(line);
          return { line, joined: toks.join(' ') };
        })
        .filter(c => c.joined.length > 0 && isPlausibleMedicineName(c.joined))
        .filter(c => !this.isPackagingOrCompositionLine(c.line))
        .filter(c => !/\b(free\b|offer\b|bogo|combo|promo|extra\s+\d+|save\s+rs|special\s+offer)/i.test(c.line));
      if (cands.length > 0) {
        // Score each candidate line. A real brand name is usually a single
        // coherent capitalized word. OCR noise tends to be short fragments
        // (<=3 chars), generic/API words (end in -fenac/-statin/…), or several
        // broken tokens. Penalize those so the brand wins.
        const isGeneric = (t: string) =>
          /(fenac|cin|mycin|olol|statin|prazole|sartan|dine|pine|pram|xacin|azole|gest|dron|vir|phen|mab|tide|oxacin)$/i.test(t) ||
          t.length > 11;
        const scoreOf = (c: { line: string; joined: string }) => {
          const tokens = c.joined.split(' ');
          let s = /[A-Z]/.test(c.line) ? 2 : 0;
          if (tokens.some(t => t.length <= 3)) s -= 1;   // likely OCR fragment
          if (tokens.some(isGeneric)) s -= 1;             // generic / API word
          s -= (tokens.length - 1) * 0.5;                 // prefer one coherent word
          return s;
        };
        cands.sort((a, b) => scoreOf(b) - scoreOf(a));
        brandName = cands[0].joined;
      }
    }
    // Packaging cross-check and confirmation gate
    const detectedDrugStrength = extractDrugStrength(localOcrResult.text);
    const detectedVolume = extractVolumeOrWeight(localOcrResult.text);

    if (matches.length > 0) {
      // Re-sort matches to ensure exact packaging strength match AND formulation alignment is #1
      matches.sort((a, b) => {
        const aStr = extractDrugStrength(a);
        const bStr = extractDrugStrength(b);
        const aStrengthMatch = detectedDrugStrength.strength && aStr.strength === detectedDrugStrength.strength ? 1 : 0;
        const bStrengthMatch = detectedDrugStrength.strength && bStr.strength === detectedDrugStrength.strength ? 1 : 0;
        if (aStrengthMatch !== bStrengthMatch) {
          return bStrengthMatch - aStrengthMatch;
        }

        const aModConflict = hasFormulationModifierConflict(localOcrResult.text, a) ? 1 : 0;
        const bModConflict = hasFormulationModifierConflict(localOcrResult.text, b) ? 1 : 0;
        if (aModConflict !== bModConflict) {
          return aModConflict - bModConflict; // non-conflicting comes first
        }

        const aVol = extractVolumeOrWeight(a);
        const bVol = extractVolumeOrWeight(b);
        const aVolMatch = detectedVolume.amount && aVol.amount === detectedVolume.amount ? 1 : 0;
        const bVolMatch = detectedVolume.amount && bVol.amount === detectedVolume.amount ? 1 : 0;
        return bVolMatch - aVolMatch;
      });

      const topMed = matches[0];
      const topMedStrength = extractDrugStrength(topMed);
      const topMedModConflict = hasFormulationModifierConflict(localOcrResult.text, topMed);

      if (detectedDrugStrength.strength) {
        if (topMedStrength.strength === detectedDrugStrength.strength && !topMedModConflict) {
          finalInfo.strengthConfirmed = true;
          finalInfo.confirmationNote = `Verified: packaging strength (${detectedDrugStrength.strength}) confirmed.`;
        } else if (topMedStrength.strength !== detectedDrugStrength.strength) {
          finalInfo.strengthConfirmed = false;
          finalInfo.strengthConflict = true;
          finalInfo.confirmationNote = `Packaging shows ${detectedDrugStrength.strength}, candidate is ${topMedStrength.strength || 'unspecified'}.`;
        } else if (topMedModConflict) {
          finalInfo.strengthConfirmed = false;
          finalInfo.modifierConflict = true;
          finalInfo.confirmationNote = `Formulation conflict: Packaging modifier does not match candidate.`;
        }
      } else if (detectedVolume.amount) {
        const topVol = extractVolumeOrWeight(topMed);
        if (topVol.amount === detectedVolume.amount) {
          finalInfo.volumeConfirmed = true;
          finalInfo.confirmationNote = `Verified: packaging volume (${detectedVolume.amount}) confirmed.`;
        }
      }

      if (topMedModConflict) {
        finalInfo.modifierConflict = true;
      }
    }

    const rawName = visualHitName || (matches.length > 0 ? matches[0] : brandName);
    // Resolve chemical API/salt for composition intelligence while keeping potentialName as the UNIQUE BRAND NAME
    await this.ensureApiMap();
    const resolvedGeneric = rawName ? this.resolveGenericName(rawName) : null;
    if (detectedApiText) {
      finalInfo.composition = detectedApiText;
    }
    finalInfo.apiName = detectedApiText || resolvedGeneric || undefined;
    finalInfo.genericName = resolvedGeneric || detectedApiText || undefined;
    finalInfo.brandName = rawName;
    // potentialName MUST BE THE UNIQUE BRAND NAME for Pharmarack and Inventory search!
    finalInfo.potentialName = rawName;

    if (detectedDrugStrength.strength) {
      finalInfo.strength = detectedDrugStrength.strength;
    } else {
      const strengthMatch = localOcrResult.text.match(/\d+\s*(?:mg|g|ml|μg|iu)/i);
      if (strengthMatch) finalInfo.strength = strengthMatch[0];
    }

    const batchMatch = localOcrResult.text.match(/(?:batch|b\.?no\.?|lot|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    if (batchMatch) finalInfo.batchNumber = batchMatch[1];

    const expiryMatch = localOcrResult.text.match(/(?:exp|expiry|exp\.?date)\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2})/i);
    if (expiryMatch) finalInfo.expiryDate = expiryMatch[1];

    // Enhanced MRP regex matching M.R.P., MAX RETAIL PRICE, Rupee symbol, Rs., 1-3 decimals or 120/- format
    const mrpRegex = /(?:m\.?r\.?p\.?|max\.?\s*retail\s*price|price|mrp|₹|rs\.?|rupees?)\s*[:\-=]?\s*(?:rs\.?|₹)?\s*(\d+(?:[\.,]\d{1,3})?|\d+[\/\-]\s*)/i;
    const priceMatch = localOcrResult.text.match(mrpRegex);
    if (priceMatch && priceMatch[1]) {
      const cleanedVal = priceMatch[1].replace(/[\/\-]/, '').replace(',', '.');
      const parsedMrp = parseFloat(cleanedVal);
      if (!isNaN(parsedMrp) && parsedMrp >= 1 && parsedMrp <= 100000) {
        finalInfo.mrp = parsedMrp;
      }
    }
    if (!finalInfo.mrp) {
      const standaloneMatch = localOcrResult.text.match(/(?:₹|rs\.?)\s*(\d+(?:\.\d{1,2})?)/i);
      if (standaloneMatch) {
        const val = parseFloat(standaloneMatch[1]);
        if (!isNaN(val) && val >= 1 && val <= 100000) {
          finalInfo.mrp = val;
        }
      }
    }

    // Manufacturer extraction — first try explicit "Mfd/Mfg by X", else detect any of 10k+ known companies
    const mfrMatch = localOcrResult.text.match(/(?:mfd|mfg|manufactured|mfr)\.?\s*(?:by|in)?\s*[:\-]?\s*([A-Za-z0-9\s\.,&]{3,40})/i);
    if (mfrMatch) {
      finalInfo.manufacturer = mfrMatch[1].trim();
    } else {
      // Dynamic company list (10,618 manufacturers) — Cipla in image => "Cipla Ltd" detected, not confused with product name
      const detectedCompany = this.detectCompanyName(localOcrResult.text);
      if (detectedCompany) {
        finalInfo.manufacturer = detectedCompany;
        finalInfo.companyDetected = detectedCompany;
      }
    }
    // Expose company for downstream fusion (whatsapp/visual search can narrow to this company's products)
    if (!finalInfo.companyDetected) {
      const comp = this.detectCompanyName(localOcrResult.text);
      if (comp) finalInfo.companyDetected = comp;
    }

    // Packaging extraction (10x1x10, 15 TABS, 30 CAPS, 100ml, 15's)
    const packMatch = localOcrResult.text.match(/(?:\d+\s*[xX]\s*\d+(?:\s*[xX]\s*\d+)?|\d+\s*(?:tabs?|tablets?|caps?|capsules?|strips?|ml|g|gm|s|'s|blisters?))\b/i);
    if (packMatch) {
      finalInfo.packaging = packMatch[0].trim();
    }

    // Detect dosage form from OCR text
    const detectedForm = this.detectDosageForm(localOcrResult.text);
    if (detectedForm) finalInfo.dosageForm = detectedForm;

    // Query scispaCy sidecar if enabled
    try {
      const { queryScispacy } = await import('./scispacyClient.js');
      const nlpData = await queryScispacy(localOcrResult.text);
      if (nlpData) {
        finalInfo.nlp = nlpData;
      }
    } catch (nlpErr) {
      console.warn('[AiCamera] scispaCy query failed:', nlpErr);
    }

    const ocrResult = {
      text: localOcrResult.text,
      confidence: localOcrResult.confidence,
      words: localOcrResult.words,
      medicineInfo: finalInfo,
      matches,
      fallbackUsed: fallbackUsed,
      auditLogged: matches.length === 0
    };

    if (skipEnrichment) {
      return ocrResult;
    }

    try {
      const enrichedResult = await onlineDataEnricher.enrichMedicineData(ocrResult);
      return enrichedResult;
    } catch (enrichError) {
      console.error('Enrichment failed:', enrichError);
      return ocrResult;
    }
  }

  private async saveToAuditQueue(imageData: string | Buffer, rawOcrText: string, cloudResult: any): Promise<void> {
    const timestamp = Date.now();
    const id = `audit_${timestamp}`;
    const filename = `${id}.jpg`;

    const rootDir = process.cwd();
    const auditImagesDir = path.resolve(rootDir, 'data', 'audit_images');
    const auditQueuePath = path.resolve(rootDir, 'data', 'audit_queue.json');
    const imagePath = path.join('data', 'audit_images', filename);
    const absoluteImagePath = path.join(auditImagesDir, filename);

    if (!fs.existsSync(auditImagesDir)) {
      fs.mkdirSync(auditImagesDir, { recursive: true });
    }

    let buffer: Buffer;
    if (typeof imageData === 'string') {
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = Buffer.from(imageData, 'base64');
      }
    } else {
      buffer = imageData;
    }

    try {
      const image = await Jimp.read(buffer);
      let width = image.bitmap.width;
      let height = image.bitmap.height;
      if (width > 800 || height > 800) {
        if (width > height) {
          height = Math.round((height * 800) / width);
          width = 800;
        } else {
          width = Math.round((width * 800) / height);
          height = 800;
        }
        image.resize({ w: width, h: height });
      }
      const compressedBuffer = await image.getBuffer('image/jpeg');
      await fs.promises.writeFile(absoluteImagePath, compressedBuffer);
    } catch (compressErr) {
      console.error('Failed to compress audit image with Jimp, saving original:', compressErr);
      await fs.promises.writeFile(absoluteImagePath, buffer);
    }

    let queue: any[] = [];
    if (fs.existsSync(auditQueuePath)) {
      try {
        const data = await fs.promises.readFile(auditQueuePath, 'utf8');
        queue = JSON.parse(data || '[]');
      } catch (e) {
        console.error('Failed to read audit queue json:', e);
        queue = [];
      }
    }

    const newEntry = {
      id,
      imagePath,
      rawOcrText,
      cloudSuggestedText: cloudResult ? JSON.stringify(cloudResult) : '',
      cloudDetails: cloudResult || null,
      status: 'pending_human_review',
      createdAt: new Date().toISOString()
    };

    queue.push(newEntry);
    
    // Save JSON atomically
    try {
      const tempQueuePath = auditQueuePath + '.tmp';
      await fs.promises.writeFile(tempQueuePath, JSON.stringify(queue, null, 2));
      await fs.promises.rename(tempQueuePath, auditQueuePath);
    } catch (writeErr) {
      console.error('Failed to write audit queue atomically:', writeErr);
      await fs.promises.writeFile(auditQueuePath, JSON.stringify(queue, null, 2));
    }

    // Save to SQLite database
    try {
      const activeDbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'app.db');
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT OR REPLACE INTO ocr_audit_queue (id, image_path, raw_ocr_text, cloud_suggested_text, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newEntry.id,
          newEntry.imagePath,
          newEntry.rawOcrText,
          newEntry.cloudSuggestedText,
          newEntry.status,
          newEntry.createdAt
        ]
      );
            console.log(`Saved unrecognized scan to SQLite audit queue table: ${id}`);
    } catch (dbErr) {
      console.error('Failed to save audit item to SQLite database:', dbErr);
    }

    console.log(`Added unrecognized scan to audit queue: ${id}`);
  }

  /**
   * Extract text only from an image buffer using ONNX/Tesseract OCR.
   * Does NOT do medicine matching, audit logging, or online enrichment.
   * Designed for batch use (e.g., PDF page OCR in catalog worker).
   */
  async extractTextFromImage(imageBuffer: Buffer): Promise<{ text: string; confidence: number }> {
    const processedBuffer = await this.preprocess(imageBuffer);

    const isONNXAvailable = await onnxOcrService.checkAvailability();
    if (isONNXAvailable) {
      try {
        const result = await onnxOcrService.scanImage(processedBuffer);
        if (result?.success) {
          return { text: result.text || '', confidence: result.confidence || 0 };
        }
      } catch (err) {
        console.error('[AI Camera] ONNX OCR failed for image, falling back to Tesseract:', err);
      }
    }

    // Tesseract fallback
    if (!this.initialized) {
      await this.initialize();
    }
    try {
      const { data } = await this.worker.recognize(processedBuffer);
      return { text: data.text || '', confidence: Math.round(data.confidence) };
    } catch (ocrError: any) {
      console.error('[AI Camera] Tesseract OCR also failed:', ocrError);
      return { text: '', confidence: 0 };
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }
}

export const aiCameraService = new AICameraService();
export default aiCameraService;