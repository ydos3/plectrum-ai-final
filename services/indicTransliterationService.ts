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

export const transliterateLyricsForLanguage = (text: string, language: AppLanguage) => {
  if (language === 'English') return text;
  const map = SCRIPT_MAPS[language] || SCRIPT_MAPS.Hindi;
  if (!map) return text;

  return text.replace(/(\[[^\]]+\])|([A-Za-z']+)/g, (match, chord, word) => {
    if (chord) return chord;
    return transliterateWord(word, map);
  });
};
