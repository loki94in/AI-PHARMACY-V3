const BRAND_EXPANSIONS = {
  'HIM': ['HIMALAYA', 'HIM'],
  'BAID': ['BAIDYANATH', 'BAID'],
  'DAB': ['DABUR', 'DAB'],
  'ZAN': ['ZANDU', 'ZAN'],
  'PAT': ['PATANJALI', 'PAT'],
  'PANDG': ['PAMPERS', 'WHISPER', 'VICKS', 'PROCTER', 'GILLETTE'],
  'PAMPES': ['PAMPERS'],
  'PAMPERSM': ['PAMPERS'],
  'PXL': ['PAMPERS'],
  'WISPER': ['WHISPER'],
  'LISTRIN': ['LISTERINE'],
  'ORALB': ['ORAL B', 'ORAL-B', 'ORALB'],
  'K.S': ['KAMASUTRA'],
  'HMD': ['DISPOVAN', 'HMD']
};

const medBrand = 'HIM';
const cleanCandStr = 'HIMALAYA GENTLE BABY WIPES EXTRA SOFT PACKET 72 WIPES';

const variants = BRAND_EXPANSIONS[medBrand] || [medBrand];
const matched = variants.some(v => new RegExp(`\\b${v}\\b`, 'i').test(cleanCandStr));
console.log('Brand matched with expansion?', matched);
