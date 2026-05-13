const baseUrl = process.argv[2] || 'http://localhost:3003';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const postJson = async (path, payload) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert(response.ok, `POST ${path} failed: ${response.status}`);
  return response.json();
};

const getJson = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  assert(response.ok, `GET ${path} failed: ${response.status}`);
  return response.json();
};

const sampleSong = {
  title: 'Local Multilingual Test',
  artist: 'Plectrum QA',
  language: 'Hindi',
  skillLevel: 'Intermediate',
  key: 'G Major',
  capo: 0,
  strummingPattern: 'D-DU-UDU',
  content: '### [Verse 1]\n[G]हेलो दिल [C]मेरे\n[D]चलो गाएँ [G]धीरे',
  source: 'test-shared-library',
  createdAt: Date.now()
};

const key = 'local multilingual test plectrum qa|Hindi|Intermediate';

await postJson('/api/song-cache', { key, data: sampleSong });

const byKey = await getJson(`/api/song-cache?key=${encodeURIComponent(key)}`);
assert(byKey.data?.title === sampleSong.title, 'Lookup by key did not return the saved song.');
assert(byKey.data?.content.includes('हेलो'), 'Saved multilingual content was not preserved.');

const bySearch = await getJson('/api/song-cache?q=Local%20Multilingual%20Test&language=Hindi&skillLevel=Intermediate');
assert(bySearch.data?.artist === sampleSong.artist, 'Search did not return the saved song.');

const wrongLanguage = await getJson('/api/song-cache?q=Local%20Multilingual%20Test&language=Gujarati&skillLevel=Intermediate');
assert(!wrongLanguage.data, 'Language filter returned the wrong multilingual record.');

console.log(JSON.stringify({
  ok: true,
  saved: sampleSong.title,
  keyLookup: byKey.data.title,
  searchLookup: bySearch.data.title,
  languageFiltered: true
}, null, 2));
