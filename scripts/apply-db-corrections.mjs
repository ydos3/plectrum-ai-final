import fs from 'node:fs';

const path = 'data/acoustic_setlist_db.min.json';
const db = JSON.parse(fs.readFileSync(path, 'utf8'));
const songs = new Map(db.songs.map(song => [song.id, song]));
const get = id => {
  const song = songs.get(id);
  if (!song) throw new Error(`Missing ${id}`);
  return song;
};

db._meta.total_songs = db.songs.length;
db._meta.last_updated = '2026-05-16';
db._meta.notes = {
  ...(db._meta.notes || {}),
  chord_correction_mast_magan: 'Corrected to G, no capo, G-D-Am-C; added Chinmayi Sripada.',
  chord_correction_barbaad: 'Corrected to F# minor, no capo, F#m-E-Bm-D; BPM 94.',
  chord_correction_kaise_hua: 'Corrected to D major / Bm, 3/4 time, Bm-F#m-G-A-D; lyricist Manoj Muntashir.',
  chord_correction_husn: 'Corrected to F major, Bb-F-A/A7-Dm-C, no capo.',
  artist_correction_jaan_se_guzarte: 'Corrected to Khan Saab + Shashwat Sachdev, Dhurandhar The Revenge (2026), Eb/Cm base.',
  disambiguation_humsafar: 'S030 = Saiyaara (2025); S039 = Badrinath Ki Dulhania (2017).',
};

Object.assign(get('S026'), {
  singers: ['Arijit Singh', 'Chinmayi Sripada'],
  composer: 'Shankar-Ehsaan-Loy',
  lyricist: 'Amitabh Bhattacharya',
  bpm: 167,
  verified_key: 'G',
  capo: 0,
  chords_no_capo: ['G', 'D', 'Am', 'C', 'Em'],
  chords_with_capo_alt: undefined,
  easy_shape: 'G-D-Am-C (no capo)',
  strumming_pattern: 'D - D U - U D U',
  verification_notes: 'Corrected from Capo 3/Bb to verified G with no capo. Added Chinmayi Sripada.',
});

Object.assign(get('S029'), {
  verified_key: 'F# minor',
  capo: 0,
  chords_no_capo: ['F#m', 'E', 'Bm', 'D'],
  capo_alt: 2,
  chords_with_capo_alt: ['Em', 'D', 'Am', 'C'],
  easy_shape: 'F#m-E-Bm-D (no capo)',
  strumming_pattern: 'D D U U D U D U',
  bpm: 94,
  lyrics: {
    verse1: ['[F#m] Tujhse door main [E] ek hi wajah ke liye hoon', '[Bm] Kamzor ho jaata hoon main [D]', '[F#m] Tujhse door main [E] ek hi wajah ke liye hoon', '[Bm] Aawara ban jaata hoon main [D]'],
    pre_chorus: ['[F#m] Tujhe chhu loon toh kuch [E] mujhe ho jaayega', '[Bm] Jo main chahta na ho [D] mujhko', '[F#m] Tujhe mil ke ye dil [E] mera beh jaayega', '[Bm] Isi baat ka darr hai [D] mujhko'],
    chorus: ['Ke ho na jaaye [F#m] pyaar tumse mujhe [E]', 'Kar dega [Bm] barbaad ishq mujhe [D]', 'Ho na jaaye [F#m] pyaar tumse mujhe [E]', '[Bm] Behad-beshumaar tumse [D]'],
    bridge: ['[E] In ghamon ko khatam kar rahe ho tum [D]', '[E] Haan, haan, in ghamon ko khatam kar rahe ho tum [F#m]', '[E] Zakhmon ka marham ban rahe ho tum [A]', '[D] Mehsoos mujhe aisa kyun ho raha [E]', '[Bm] Ke meri duniya ban rahe ho tum [A] ban rahe ho tum [E]'],
    verse2: ['[F#m] Tere bin kya ye dil ab [E] dhadak paayega', '[Bm] Puchhta hoon main ye khud ko [D]', '[F#m] Tere aane se dard [E] chala jaayega', '[Bm] Isi baat ka dare hai mujhko [D]'],
  },
  verification_notes: 'Corrected from Am-F-C-G Capo 1 to F# minor with F#m-E-Bm-D. BPM 94.',
});

Object.assign(get('S033'), {
  title: 'Jaan Se Guzarte Hain',
  album: 'Dhurandhar The Revenge (OST)',
  film_show: 'Dhurandhar The Revenge (2026)',
  singers: ['Khan Saab', 'Shashwat Sachdev'],
  composer: 'Shashwat Sachdev',
  lyricist: 'Irshad Kamil',
  release_year: 2026,
  release_date: '2026-03-17',
  bpm: 107,
  duration_sec: 332,
  verified_key: 'Eb major (Cm base)',
  capo: 3,
  chords_no_capo: ['Cm', 'Ab', 'Bb', 'Eb'],
  chords_with_capo_alt: ['Am', 'F', 'G', 'C'],
  easy_shape: 'Am-F-G-C (Capo 3)',
  lyrics: {
    intro_refrain: ['[Am] Dil pe zakhm khaate hain, [F] jaan se guzarte hain [G] [C]', '[Am] Dil pe zakhm khaate hain, [F] jaan se guzarte hain [G] [C]', '[Am] Jurm sirf itna hai, [F] unko pyaar karte hain [G] [C]'],
    verse1: ['[Am] Aitbaar badhta hai [F] aur bhi mohabbat ka', '[G] Aitbaar badhta hai [C] aur bhi mohabbat ka', '[Am] Jab woh ajnabi bankar [F] paas se guzarte hain [G] [C]'],
    chorus: ['[Am] Dil pe zakhm khaate hain, [F] jaan se guzarte hain [G] [C]', '[Am] Dil pe zakhm khaate hain, [F] jaan se guzarte hain [G] [C]', '[Am] Jurm sirf itna hai, [F] unko pyaar karte hain [G] [C]'],
    verse2: ['[Am] Woh jo pher kar nazrein, [F] paas se guzarte hain [G] [C]', '[Am] Woh jo pher kar nazrein, [F] paas se guzarte hain [G] [C]', '[Am] Ae gham-e-zamaana, [F] hum tujhko yaad karte hain [G] [C]'],
  },
  verification_notes: 'Corrected artist and lyrics to Khan Saab + Shashwat Sachdev from Dhurandhar The Revenge (2026). Key Eb/Cm, BPM 107.',
});

Object.assign(get('S044'), {
  lyricist: 'Manoj Muntashir',
  bpm: 136,
  verified_key: 'D major / Bm',
  capo: 2,
  chords_no_capo: ['Bm', 'F#m', 'G', 'A', 'D'],
  chords_with_capo_alt: ['Am', 'Em', 'F', 'G', 'C'],
  easy_shape: 'Am-Em-F-G-C (Capo 2)',
  time_signature: '3/4',
  verification_notes: 'Corrected key/chords/time signature: D major/Bm, 3/4 waltz, Bm-F#m-G-A. Lyricist Manoj Muntashir.',
});

Object.assign(get('S048'), {
  verified_key: 'F major',
  capo: 0,
  chords_no_capo: ['Bb', 'F', 'A', 'Dm', 'C'],
  capo_alt: 1,
  chords_with_capo_alt: ['F', 'C', 'E7', 'Am', 'G'],
  easy_shape: 'Bb-F-A-Dm-C (no capo) OR F-C-E7-Am-G (Capo 1)',
  strumming_pattern: 'D U - D U D - D U',
  bpm: 76,
  release_date: '2023-12-01',
  cover_difficulty: 'Intermediate',
  lyrics: {
    intro: ['[Bb] [F] [A] [Dm] [C] (Aaaa...)'],
    verse1: ['[Bb] Dekho, dekho, kaisi baatein [F] yahan ki', '[A] Hain saath par hain saath [Dm] na bhi [C]', '[Bb] Dekho, dekho, jaise mere [F] iraade', '[A] Waise kahaan tere yahan [Dm] the [C]', '[Bb] Haan, kitni naadan [Dm] main [C]'],
    chorus: ['[Bb] Mere husn ke ilaawa [F] kabhi dil bhi maang lo [C] na', '[Bb] Haaye pal mein main pighal [C] jaaun haan', '[Bb] Ab aisa na karo ke [F] dil jud na paaye waapis [C]', '[Bb] Teri baaton se bikhar [C] jaaun haan'],
    verse2: ['[Bb] Maana zamana hai diwaana [F]', '[A] Isliye tune naa jaana [Dm] [C]', '[Bb] Tere liye main kaafi [Dm] hun [C]', '[Bb] Dekho, dekho, yeh zamane se thak kar [F]', '[A] Aate ho kyun maasoom ban kar? [Dm] [C]', '[Bb] Tere liye main kya hi [Dm] hun [C]'],
    bridge: ['[Bb] Haan ek din kabhi koi [Am]', 'Jab bhi [Bb] padhe kahaani teri [C]', '[F] Lagta mujhe mere naam ka [Am]', 'Zikr [Bb] kahin bhi hoga [C] nahin', '[C] Haan main yahin [Am] Meri yeh aankhon mein [F] aankhon mein toh [G] dekho', '[C] Dekho yeh dil ka haal kya [Am]', '[F] Hothon se hota na bayan [G]', 'Meri yeh [C] aankhon mein aankhon mein toh [Am] dekho [F] [G]'],
  },
  verification_notes: 'Corrected from C-G-Am-F/Capo 5 to F major with Bb-F-A/A7-Dm-C. BPM 76 and release date added.',
});

const addToIndex = (index, key, id) => {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(id);
};

const decade = year => year ? `${Math.floor(year / 10) * 10}s` : null;
const easyKey = value => String(value || '').split('(')[0].trim();
db.indexes = {
  by_easy_shape: {},
  by_language: {},
  by_decade: {},
  by_reel_potential: {},
  by_capo: {},
  verified_status: {},
};

for (const item of db.songs) {
  addToIndex(db.indexes.by_easy_shape, easyKey(item.easy_shape), item.id);
  for (const language of item.language || []) addToIndex(db.indexes.by_language, language, item.id);
  addToIndex(db.indexes.by_decade, decade(item.release_year), item.id);
  addToIndex(db.indexes.by_reel_potential, item.reel_potential, item.id);
  addToIndex(db.indexes.by_capo, String(typeof item.capo === 'number' ? item.capo : 0), item.id);
  addToIndex(db.indexes.verified_status, item.verification_flag || 'UNKNOWN', item.id);
}

fs.writeFileSync(path, `${JSON.stringify(db, null, 2)}\n`);
console.log(`Updated ${path}: ${db.songs.length} songs`);
