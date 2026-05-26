import { AppLanguage } from '../types';

const SCRIPT_MAPS: Partial<Record<AppLanguage, Record<string, string>>> = {
  Hindi: {
    a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', u: 'उ', oo: 'ऊ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ',
    b: 'ब', bh: 'भ', c: 'क', ch: 'च', d: 'द', dh: 'ध', f: 'फ', g: 'ग', gh: 'घ', h: 'ह',
    j: 'ज', jh: 'झ', k: 'क', kh: 'ख', l: 'ल', m: 'म', n: 'न', p: 'प', ph: 'फ',
    q: 'क', r: 'र', s: 'स', sh: 'श', t: 'त', th: 'थ', v: 'व', w: 'व', x: 'क्स', y: 'य', z: 'ज'
  },
  Gujarati: {
    a: 'અ', aa: 'આ', i: 'ઇ', ee: 'ઈ', u: 'ઉ', oo: 'ઊ', e: 'એ', ai: 'ઐ', o: 'ઓ', au: 'ઔ',
    b: 'બ', bh: 'ભ', c: 'ક', ch: 'ચ', d: 'દ', dh: 'ધ', f: 'ફ', g: 'ગ', gh: 'ઘ', h: 'હ',
    j: 'જ', jh: 'ઝ', k: 'ક', kh: 'ખ', l: 'લ', m: 'મ', n: 'ન', p: 'પ', ph: 'ફ',
    q: 'ક', r: 'ર', s: 'સ', sh: 'શ', t: 'ત', th: 'થ', v: 'વ', w: 'વ', x: 'ક્સ', y: 'ય', z: 'ઝ'
  },
  Punjabi: {
    a: 'ਅ', aa: 'ਆ', i: 'ਇ', ee: 'ਈ', u: 'ਉ', oo: 'ਊ', e: 'ਏ', ai: 'ਐ', o: 'ਓ', au: 'ਔ',
    b: 'ਬ', bh: 'ਭ', c: 'ਕ', ch: 'ਚ', d: 'ਦ', dh: 'ਧ', f: 'ਫ', g: 'ਗ', gh: 'ਘ', h: 'ਹ',
    j: 'ਜ', jh: 'ਝ', k: 'ਕ', kh: 'ਖ', l: 'ਲ', m: 'ਮ', n: 'ਨ', p: 'ਪ', ph: 'ਫ',
    q: 'ਕ', r: 'ਰ', s: 'ਸ', sh: 'ਸ਼', t: 'ਤ', th: 'ਥ', v: 'ਵ', w: 'ਵ', x: 'ਕਸ', y: 'ਯ', z: 'ਜ਼'
  },
  Bengali: {
    a: 'অ', aa: 'আ', i: 'ই', ee: 'ঈ', u: 'উ', oo: 'ঊ', e: 'এ', ai: 'ঐ', o: 'ও', au: 'ঔ',
    b: 'ব', bh: 'ভ', c: 'ক', ch: 'চ', d: 'দ', dh: 'ধ', f: 'ফ', g: 'গ', gh: 'ঘ', h: 'হ',
    j: 'জ', jh: 'ঝ', k: 'ক', kh: 'খ', l: 'ল', m: 'ম', n: 'ন', p: 'প', ph: 'ফ',
    q: 'ক', r: 'র', s: 'স', sh: 'শ', t: 'ত', th: 'থ', v: 'ভ', w: 'ও', x: 'ক্স', y: 'য', z: 'জ'
  },
  Tamil: {
    a: 'அ', aa: 'ஆ', i: 'இ', ee: 'ஈ', u: 'உ', oo: 'ஊ', e: 'எ', ai: 'ஐ', o: 'ஒ', au: 'ஔ',
    b: 'ப', bh: 'ப', c: 'க', ch: 'ச', d: 'த', dh: 'த', f: 'ஃப', g: 'க', gh: 'க', h: 'ஹ',
    j: 'ஜ', jh: 'ஜ', k: 'க', kh: 'க', l: 'ல', m: 'ம', n: 'ந', p: 'ப', ph: 'ஃப',
    q: 'க', r: 'ர', s: 'ஸ', sh: 'ஷ', t: 'ட', th: 'த', v: 'வ', w: 'வ', x: 'க்ஸ்', y: 'ய', z: 'ஜ'
  },
  Telugu: {
    a: 'అ', aa: 'ఆ', i: 'ఇ', ee: 'ఈ', u: 'ఉ', oo: 'ఊ', e: 'ఎ', ai: 'ఐ', o: 'ఒ', au: 'ఔ',
    b: 'బ', bh: 'భ', c: 'క', ch: 'చ', d: 'ద', dh: 'ధ', f: 'ఫ', g: 'గ', gh: 'ఘ', h: 'హ',
    j: 'జ', jh: 'ఝ', k: 'క', kh: 'ఖ', l: 'ల', m: 'మ', n: 'న', p: 'ప', ph: 'ఫ',
    q: 'క', r: 'ర', s: 'స', sh: 'శ', t: 'త', th: 'థ', v: 'వ', w: 'వ', x: 'క్స్', y: 'య', z: 'జ'
  },
  Kannada: {
    a: 'ಅ', aa: 'ಆ', i: 'ಇ', ee: 'ಈ', u: 'ಉ', oo: 'ಊ', e: 'ಎ', ai: 'ಐ', o: 'ಒ', au: 'ಔ',
    b: 'ಬ', bh: 'ಭ', c: 'ಕ', ch: 'ಚ', d: 'ದ', dh: 'ಧ', f: 'ಫ', g: 'ಗ', gh: 'ಘ', h: 'ಹ',
    j: 'ಜ', jh: 'ಝ', k: 'ಕ', kh: 'ಖ', l: 'ಲ', m: 'ಮ', n: 'ನ', p: 'ಪ', ph: 'ಫ',
    q: 'ಕ', r: 'ರ', s: 'ಸ', sh: 'ಶ', t: 'ತ', th: 'ಥ', v: 'ವ', w: 'ವ', x: 'ಕ್ಸ್', y: 'ಯ', z: 'ಜ'
  },
  Malayalam: {
    a: 'അ', aa: 'ആ', i: 'ഇ', ee: 'ഈ', u: 'ഉ', oo: 'ഊ', e: 'എ', ai: 'ഐ', o: 'ഒ', au: 'ഔ',
    b: 'ബ', bh: 'ഭ', c: 'ക', ch: 'ച', d: 'ദ', dh: 'ധ', f: 'ഫ', g: 'ഗ', gh: 'ഘ', h: 'ഹ',
    j: 'ജ', jh: 'ഝ', k: 'ക', kh: 'ഖ', l: 'ല', m: 'മ', n: 'ന', p: 'പ', ph: 'ഫ',
    q: 'ക', r: 'ര', s: 'സ', sh: 'ശ', t: 'ത', th: 'ഥ', v: 'വ', w: 'വ', x: 'ക്സ്', y: 'യ', z: 'ജ'
  },
  Odia: {
    a: 'ଅ', aa: 'ଆ', i: 'ଇ', ee: 'ଈ', u: 'ଉ', oo: 'ଊ', e: 'ଏ', ai: 'ଐ', o: 'ଓ', au: 'ଔ',
    b: 'ବ', bh: 'ଭ', c: 'କ', ch: 'ଚ', d: 'ଦ', dh: 'ଧ', f: 'ଫ', g: 'ଗ', gh: 'ଘ', h: 'ହ',
    j: 'ଜ', jh: 'ଝ', k: 'କ', kh: 'ଖ', l: 'ଲ', m: 'ମ', n: 'ନ', p: 'ପ', ph: 'ଫ',
    q: 'କ', r: 'ର', s: 'ସ', sh: 'ଶ', t: 'ତ', th: 'ଥ', v: 'ଭ', w: 'ୱ', x: 'କ୍ସ', y: 'ୟ', z: 'ଜ'
  },
  Urdu: {
    a: 'ا', aa: 'آ', i: 'اِ', ee: 'ای', u: 'اُ', oo: 'او', e: 'ے', ai: 'اے', o: 'و', au: 'او',
    b: 'ب', bh: 'بھ', c: 'ک', ch: 'چ', d: 'د', dh: 'دھ', f: 'ف', g: 'گ', gh: 'غ', h: 'ہ',
    j: 'ج', jh: 'جھ', k: 'ک', kh: 'خ', l: 'ل', m: 'م', n: 'ن', p: 'پ', ph: 'پھ',
    q: 'ق', r: 'ر', s: 'س', sh: 'ش', t: 'ت', th: 'تھ', v: 'و', w: 'و', x: 'کس', y: 'ی', z: 'ز'
  }
};

const DIGRAPHS = ['kh', 'gh', 'ch', 'jh', 'th', 'dh', 'ph', 'bh', 'sh', 'aa', 'ee', 'oo', 'ai', 'au'];

type ScriptRule = {
  consonants: Record<string, string>;
  independentVowels: Record<string, string>;
  vowelSigns: Record<string, string>;
  virama: string;
};

const CONSONANT_BASE = {
  b: 0, bh: 1, c: 2, ch: 3, d: 4, dh: 5, f: 6, g: 7, gh: 8, h: 9,
  j: 10, jh: 11, k: 12, kh: 13, l: 14, m: 15, n: 16, p: 17, ph: 18,
  q: 19, r: 20, s: 21, sh: 22, t: 23, th: 24, v: 25, w: 26, y: 27, z: 28
} as const;

const makeConsonants = (values: string[]) => (
  Object.fromEntries(Object.entries(CONSONANT_BASE).map(([key, index]) => [key, values[index]]))
);

const SCRIPT_RULES: Partial<Record<AppLanguage, ScriptRule>> = {
  Hindi: {
    consonants: makeConsonants(['ब', 'भ', 'क', 'च', 'द', 'ध', 'फ', 'ग', 'घ', 'ह', 'ज', 'झ', 'क', 'ख', 'ल', 'म', 'न', 'प', 'फ', 'क', 'र', 'स', 'श', 'त', 'थ', 'व', 'व', 'य', 'ज']),
    independentVowels: { a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', u: 'उ', oo: 'ऊ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ' },
    vowelSigns: { a: '', aa: 'ा', i: 'ि', ee: 'ी', u: 'ु', oo: 'ू', e: 'े', ai: 'ै', o: 'ो', au: 'ौ' },
    virama: '्'
  },
  Gujarati: {
    consonants: makeConsonants(['બ', 'ભ', 'ક', 'ચ', 'દ', 'ધ', 'ફ', 'ગ', 'ઘ', 'હ', 'જ', 'ઝ', 'ક', 'ખ', 'લ', 'મ', 'ન', 'પ', 'ફ', 'ક', 'ર', 'સ', 'શ', 'ત', 'થ', 'વ', 'વ', 'ય', 'ઝ']),
    independentVowels: { a: 'અ', aa: 'આ', i: 'ઇ', ee: 'ઈ', u: 'ઉ', oo: 'ઊ', e: 'એ', ai: 'ઐ', o: 'ઓ', au: 'ઔ' },
    vowelSigns: { a: '', aa: 'ા', i: 'િ', ee: 'ી', u: 'ુ', oo: 'ૂ', e: 'ે', ai: 'ૈ', o: 'ો', au: 'ૌ' },
    virama: '્'
  },
  Punjabi: {
    consonants: makeConsonants(['ਬ', 'ਭ', 'ਕ', 'ਚ', 'ਦ', 'ਧ', 'ਫ', 'ਗ', 'ਘ', 'ਹ', 'ਜ', 'ਝ', 'ਕ', 'ਖ', 'ਲ', 'ਮ', 'ਨ', 'ਪ', 'ਫ', 'ਕ', 'ਰ', 'ਸ', 'ਸ਼', 'ਤ', 'ਥ', 'ਵ', 'ਵ', 'ਯ', 'ਜ਼']),
    independentVowels: { a: 'ਅ', aa: 'ਆ', i: 'ਇ', ee: 'ਈ', u: 'ਉ', oo: 'ਊ', e: 'ਏ', ai: 'ਐ', o: 'ਓ', au: 'ਔ' },
    vowelSigns: { a: '', aa: 'ਾ', i: 'ਿ', ee: 'ੀ', u: 'ੁ', oo: 'ੂ', e: 'ੇ', ai: 'ੈ', o: 'ੋ', au: 'ੌ' },
    virama: '੍'
  },
  Bengali: {
    consonants: makeConsonants(['ব', 'ভ', 'ক', 'চ', 'দ', 'ধ', 'ফ', 'গ', 'ঘ', 'হ', 'জ', 'ঝ', 'ক', 'খ', 'ল', 'ম', 'ন', 'প', 'ফ', 'ক', 'র', 'স', 'শ', 'ত', 'থ', 'ভ', 'ও', 'য', 'জ']),
    independentVowels: { a: 'অ', aa: 'আ', i: 'ই', ee: 'ঈ', u: 'উ', oo: 'ঊ', e: 'এ', ai: 'ঐ', o: 'ও', au: 'ঔ' },
    vowelSigns: { a: '', aa: 'া', i: 'ি', ee: 'ী', u: 'ু', oo: 'ূ', e: 'ে', ai: 'ৈ', o: 'ো', au: 'ৌ' },
    virama: '্'
  },
  Telugu: {
    consonants: makeConsonants(['బ', 'భ', 'క', 'చ', 'ద', 'ధ', 'ఫ', 'గ', 'ఘ', 'హ', 'జ', 'ఝ', 'క', 'ఖ', 'ల', 'మ', 'న', 'ప', 'ఫ', 'క', 'ర', 'స', 'శ', 'త', 'థ', 'వ', 'వ', 'య', 'జ']),
    independentVowels: { a: 'అ', aa: 'ఆ', i: 'ఇ', ee: 'ఈ', u: 'ఉ', oo: 'ఊ', e: 'ఎ', ai: 'ఐ', o: 'ఒ', au: 'ఔ' },
    vowelSigns: { a: '', aa: 'ా', i: 'ి', ee: 'ీ', u: 'ు', oo: 'ూ', e: 'ె', ai: 'ై', o: 'ొ', au: 'ౌ' },
    virama: '్'
  },
  Kannada: {
    consonants: makeConsonants(['ಬ', 'ಭ', 'ಕ', 'ಚ', 'ದ', 'ಧ', 'ಫ', 'ಗ', 'ಘ', 'ಹ', 'ಜ', 'ಝ', 'ಕ', 'ಖ', 'ಲ', 'ಮ', 'ನ', 'ಪ', 'ಫ', 'ಕ', 'ರ', 'ಸ', 'ಶ', 'ತ', 'ಥ', 'ವ', 'ವ', 'ಯ', 'ಜ']),
    independentVowels: { a: 'ಅ', aa: 'ಆ', i: 'ಇ', ee: 'ಈ', u: 'ಉ', oo: 'ಊ', e: 'ಎ', ai: 'ಐ', o: 'ಒ', au: 'ಔ' },
    vowelSigns: { a: '', aa: 'ಾ', i: 'ಿ', ee: 'ೀ', u: 'ು', oo: 'ೂ', e: 'ೆ', ai: 'ೈ', o: 'ೊ', au: 'ೌ' },
    virama: '್'
  }
};

const VOWELS = new Set(['a', 'aa', 'i', 'ee', 'u', 'oo', 'e', 'ai', 'o', 'au']);
const TOKEN_ORDER = ['kh', 'gh', 'ch', 'jh', 'th', 'dh', 'ph', 'bh', 'sh', 'aa', 'ee', 'oo', 'ai', 'au'];

const DEVANAGARI_INDEPENDENT_VOWELS: Record<string, string> = {
  '\u0905': 'a',
  '\u0906': 'aa',
  '\u0907': 'i',
  '\u0908': 'ee',
  '\u0909': 'u',
  '\u090A': 'oo',
  '\u090B': 'ri',
  '\u090F': 'e',
  '\u0910': 'ai',
  '\u0913': 'o',
  '\u0914': 'au',
};

const DEVANAGARI_VOWEL_SIGNS: Record<string, string> = {
  '\u093E': 'aa',
  '\u093F': 'i',
  '\u0940': 'ee',
  '\u0941': 'u',
  '\u0942': 'oo',
  '\u0943': 'ri',
  '\u0947': 'e',
  '\u0948': 'ai',
  '\u094B': 'o',
  '\u094C': 'au',
};

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  '\u0915': 'k',
  '\u0916': 'kh',
  '\u0917': 'g',
  '\u0918': 'gh',
  '\u0919': 'ng',
  '\u091A': 'ch',
  '\u091B': 'chh',
  '\u091C': 'j',
  '\u091D': 'jh',
  '\u091E': 'ny',
  '\u091F': 't',
  '\u0920': 'th',
  '\u0921': 'd',
  '\u0922': 'dh',
  '\u0923': 'n',
  '\u0924': 't',
  '\u0925': 'th',
  '\u0926': 'd',
  '\u0927': 'dh',
  '\u0928': 'n',
  '\u092A': 'p',
  '\u092B': 'ph',
  '\u092C': 'b',
  '\u092D': 'bh',
  '\u092E': 'm',
  '\u092F': 'y',
  '\u0930': 'r',
  '\u0932': 'l',
  '\u0935': 'v',
  '\u0936': 'sh',
  '\u0937': 'sh',
  '\u0938': 's',
  '\u0939': 'h',
  '\u0958': 'q',
  '\u0959': 'kh',
  '\u095A': 'gh',
  '\u095B': 'z',
  '\u095C': 'r',
  '\u095D': 'rh',
  '\u095E': 'f',
  '\u095F': 'y',
};

const DEVANAGARI_MARKS_TO_DROP = new Set([
  '\u0900', '\u0901', '\u0902', '\u0903', '\u093C', '\u094D', '\u0951', '\u0952',
]);

const tokenizeRomanWord = (word: string) => {
  const tokens: string[] = [];
  let i = 0;
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');

  while (i < lower.length) {
    const token = TOKEN_ORDER.find(candidate => lower.startsWith(candidate, i));
    if (token) {
      tokens.push(token);
      i += token.length;
    } else {
      tokens.push(lower[i]);
      i += 1;
    }
  }

  return tokens;
};

const transliterateWithRule = (word: string, rule: ScriptRule) => {
  const tokens = tokenizeRomanWord(word);
  let output = '';

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (rule.consonants[token]) {
      const next = tokens[i + 1];
      if (next && VOWELS.has(next)) {
        output += rule.consonants[token] + rule.vowelSigns[next];
        i += 1;
      } else if (next && rule.consonants[next]) {
        output += rule.consonants[token] + rule.virama;
      } else {
        output += rule.consonants[token];
      }
    } else if (VOWELS.has(token)) {
      output += rule.independentVowels[token];
    } else {
      output += token;
    }
  }

  return output || word;
};

const transliterateWord = (word: string, map: Record<string, string>) => {
  let result = '';
  let i = 0;
  const lower = word.toLowerCase();

  while (i < lower.length) {
    const two = lower.slice(i, i + 2);
    if (DIGRAPHS.includes(two) && map[two]) {
      result += map[two];
      i += 2;
      continue;
    }
    const one = lower[i];
    result += map[one] || word[i];
    i += 1;
  }

  return result;
};

const romanizeDevanagariText = (text: string) => {
  let result = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (DEVANAGARI_CONSONANTS[char]) {
      const vowel = DEVANAGARI_VOWEL_SIGNS[next];
      const viramaNext = next === '\u094D';
      result += DEVANAGARI_CONSONANTS[char];
      if (vowel) {
        result += vowel;
        i += 1;
      } else if (!viramaNext) {
        result += 'a';
      } else {
        i += 1;
      }
      continue;
    }

    if (DEVANAGARI_INDEPENDENT_VOWELS[char]) {
      result += DEVANAGARI_INDEPENDENT_VOWELS[char];
      continue;
    }

    if (DEVANAGARI_MARKS_TO_DROP.has(char) || DEVANAGARI_VOWEL_SIGNS[char]) {
      continue;
    }

    result += char;
  }

  return result
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
};

export const romanizeLyricsForEnglish = (text: string) => (
  text.replace(/(\[[^\]]+\])|([\u0900-\u097F][\u0900-\u097F\s.,!?;:'"-]*)/g, (match, chord, indicText) => {
    if (chord) return chord;
    return romanizeDevanagariText(indicText);
  })
);

export const normalizeLyricsForRequestedLanguage = (text: string, language: AppLanguage) => (
  language === 'English' ? romanizeLyricsForEnglish(text) : transliterateLyricsForLanguage(text, language)
);

export const transliterateLyricsForLanguage = (text: string, language: AppLanguage) => {
  if (language === 'English') return text;
  const rule = SCRIPT_RULES[language];
  if (rule) {
    return text.replace(/(\[[^\]]+\])|([A-Za-z']+)/g, (match, chord, word) => {
      if (chord) return chord;
      return transliterateWithRule(word, rule);
    });
  }

  const map = SCRIPT_MAPS[language] || SCRIPT_MAPS.Hindi;
  if (!map) return text;

  return text.replace(/(\[[^\]]+\])|([A-Za-z']+)/g, (match, chord, word) => {
    if (chord) return chord;
    return transliterateWord(word, map);
  });
};
