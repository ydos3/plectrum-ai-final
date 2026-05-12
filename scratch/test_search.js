async function test() {
  const query = "perfect";
  try {
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    console.log("LRCLIB Results for 'perfect':");
    console.log(JSON.stringify(data.slice(0, 5).map(d => ({title: d.trackName, artist: d.artistName, instrumental: d.instrumental})), null, 2));
  } catch(e) {
    console.error(e);
  }
}
test();
