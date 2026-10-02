// ============ LYRICS — multi-API fallback ============
async function getLyrics(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  // Split "song - artist" if user provided it
  let trackGuess = q, artistGuess = '';
  const dash = q.split(/\s*[-–—]\s*/);
  if (dash.length === 2) { trackGuess = dash[0].trim(); artistGuess = dash[1].trim(); }

  // ---------- 1) lrclib.net (best, no key) ----------
  try {
    const r = await axios.get('https://lrclib.net/api/search?q=' + encodeURIComponent(q),
      { timeout: 20000, headers: { 'User-Agent': UA } });
    const arr = Array.isArray(r.data) ? r.data : [];
    const hit = arr.find(x => x.plainLyrics && x.plainLyrics.length > 20)
             || arr.find(x => x.syncedLyrics && x.syncedLyrics.length > 20);
    if (hit) {
      return {
        title: hit.trackName || trackGuess,
        artist: hit.artistName || artistGuess || '',
        lyrics: (hit.plainLyrics || hit.syncedLyrics || '').trim()
      };
    }
  } catch (e) { console.log('lrclib search:', e.message); }

  // ---------- 2) lrclib.net direct get (song + artist) ----------
  if (trackGuess && artistGuess) {
    try {
      const r = await axios.get('https://lrclib.net/api/get?artist_name=' + encodeURIComponent(artistGuess) + '&track_name=' + encodeURIComponent(trackGuess),
        { timeout: 20000, headers: { 'User-Agent': UA } });
      if (r.data?.plainLyrics && r.data.plainLyrics.length > 20) {
        return {
          title: r.data.trackName || trackGuess,
          artist: r.data.artistName || artistGuess,
          lyrics: r.data.plainLyrics.trim()
        };
      }
    } catch (e) { console.log('lrclib get:', e.message); }
  }

  // ---------- 3) lyrics.ovh (with artist / without) ----------
  try {
    const url = artistGuess
      ? 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artistGuess) + '/' + encodeURIComponent(trackGuess)
      : 'https://api.lyrics.ovh/v1/' + encodeURIComponent(trackGuess) + '/' + encodeURIComponent(trackGuess);
    const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
    if (r.data?.lyrics && r.data.lyrics.length > 20) {
      return {
        title: trackGuess,
        artist: artistGuess,
        lyrics: r.data.lyrics.replace(/\r/g, '').trim()
      };
    }
  } catch (e) { console.log('lyrics.ovh:', e.message); }

  // ---------- 4) some-random-api ----------
  try {
    const r = await axios.get('https://some-random-api.com/lyrics?title=' + encodeURIComponent(q),
      { timeout: 20000, headers: { 'User-Agent': UA } });
    if (r.data?.lyrics && r.data.lyrics.length > 20) {
      return {
        title: r.data.title || trackGuess,
        artist: r.data.author || artistGuess || '',
        lyrics: r.data.lyrics.trim()
      };
    }
  } catch (e) { console.log('some-random-api:', e.message); }

  // ---------- 5) popcat textpolice (fallback) ----------
  try {
    const r = await axios.get('https://api.popcat.xyz/lyrics?song=' + encodeURIComponent(q),
      { timeout: 20000, headers: { 'User-Agent': UA } });
    if (r.data?.lyrics && r.data.lyrics.length > 20) {
      return {
        title: r.data.title || trackGuess,
        artist: r.data.artist || artistGuess || '',
        lyrics: r.data.lyrics.trim()
      };
    }
  } catch (e) { console.log('popcat:', e.message); }

  return null;
}
