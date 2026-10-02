const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';

// ============ LYRICS ============
async function getLyrics(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const r = await axios.get('https://lrclib.net/api/search?q=' + encodeURIComponent(q),
      { timeout: 20000, headers: { 'User-Agent': UA } });
    const arr = Array.isArray(r.data) ? r.data : [];
    const hit = arr.find(x => x.plainLyrics && x.plainLyrics.length > 20);
    if (hit) return { title: hit.trackName || q, artist: hit.artistName || '', lyrics: hit.plainLyrics };
  } catch (e) {}
  try {
    let artist = '', title = q;
    const d = q.split(/\s*[-–—]\s*/);
    if (d.length === 2) { title = d[0].trim(); artist = d[1].trim(); }
    const url = artist
      ? 'https://api.lyrics.ovh/v1/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title)
      : 'https://api.lyrics.ovh/v1/' + encodeURIComponent(title) + '/' + encodeURIComponent(title);
    const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
    if (r.data?.lyrics) return { title, artist, lyrics: r.data.lyrics.replace(/\r/g, '').trim() };
  } catch (e) {}
  return null;
}

// ============ AI ============
async function askAI(prompt) {
  const q = String(prompt || '').slice(0, 1500);
  if (!q) return null;
  try {
    const r = await axios.get('https://text.pollinations.ai/' + encodeURIComponent(q),
      { timeout: 30000, headers: { 'User-Agent': UA } });
    if (typeof r.data === 'string' && r.data.trim().length > 1) return r.data.trim();
  } catch (e) {}
  try {
    const r = await axios.post('https://text.pollinations.ai/openai',
      { model: 'openai', messages: [
        { role: 'system', content: 'You are a helpful WhatsApp assistant. Keep replies short.' },
        { role: 'user', content: q }
      ] },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) {}
  try {
    const r = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions',
      { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', messages: [{ role: 'user', content: q }], max_tokens: 800 },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) {}
  return null;
}

// ============ TEXTMAKER (multi-API with fallback) ============
// Some public textpro/ephoto endpoints. Add your own apikey to config if you have one.
const TEXT_APIS = {
  // Direct public APIs (no key) — tried in order
  list: [
    // pollinations AI prompt (always works, fallback)
    null
  ]
};

const EFFECT_PROMPTS = {
  neon:      t => `neon glowing tube sign on dark brick wall spelling exactly "${t}", realistic purple pink cyan glow, high detail photo, 4k`,
  fire:      t => `the word "${t}" burning in realistic orange fire flames on pure black background, cinematic photograph`,
  glitch:    t => `the text "${t}" with strong RGB digital glitch effect, chromatic aberration, cyberpunk, dark background`,
  ice:       t => `the word "${t}" frozen inside a block of clear ice, frost crystals, cold blue studio lighting, photorealistic`,
  matrix:    t => `the text "${t}" rendered in green glowing matrix code rain on black background, terminal style`,
  thunder:   t => `the word "${t}" struck by lightning, dramatic storm clouds, electric blue high voltage, cinematic`,
  devil:     t => `the word "${t}" in red neon with devil horns and pentagram, dark satanic metal poster style`,
  sand:      t => `the word "${t}" written in wet sand on a beach, top-down photo, sunny golden hour`,
  blackpink: t => `the text "${t}" in official Blackpink logo font, pink and black gradient, k-pop poster`,
  metallic:  t => `the word "${t}" in polished chrome gold metal 3D letters on dark studio floor, cinematic lights`,
  light:     t => `the word "${t}" formed from glowing Edison light bulbs, warm amber glow, dark room`,
  hacker:    t => `the text "${t}" in green hacker terminal font on black CRT screen, phosphor glow, glitchy`,
  paper:     t => `the word "${t}" cut out of white paper, 3D papercraft style, soft drop shadow on pastel background`,
  luxury:    t => `the word "${t}" in shiny gold serif letters on white marble slab, luxury gold and white, studio photo`,
  // extra popular ones
  fire2:     t => `"${t}" in blue flame fire on black background, high detail cinematic`,
  glow:      t => `"${t}" in glowing green and blue aura, futuristic sci-fi font, dark background`,
  gold:      t => `"${t}" in 3D golden luxury font, black background, ray of light`,
  rainbow:   t => `"${t}" in rainbow gradient neon, dark background, colorful glow`
};

async function generateTextImage(effect, text) {
  const t = String(text || '').slice(0, 40).replace(/"/g, '');
  const fn = EFFECT_PROMPTS[effect] || EFFECT_PROMPTS.neon;
  const prompt = fn(t);
  const seed = Math.floor(Math.random() * 999999);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=512&nologo=true&model=flux&seed=${seed}`;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 75000,
        maxContentLength: 20 * 1024 * 1024,
        headers: { 'User-Agent': UA, Accept: 'image/*' }
      });
      if (r.data && r.data.byteLength > 3000) return Buffer.from(r.data);
    } catch (e) { console.log('tm try', i + 1, e.message); }
  }
  return null;
}

// ============ MUSIC (pair site only) ============
async function searchSong(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const nodes = ['https://discoveryprovider.audius.co', 'https://audius-discovery-1.cultur3stake.com'];
  for (const base of nodes) {
    try {
      const r = await axios.get(
        base + '/v1/tracks/search?query=' + encodeURIComponent(q) + '&app_name=DeadpoolV7',
        { timeout: 20000, headers: { 'User-Agent': UA } });
      const tracks = r.data?.data;
      if (Array.isArray(tracks) && tracks.length) {
        const t = tracks[0];
        return {
          id: t.id, title: t.title, artist: t.user?.name || '',
          streamUrl: base + '/v1/tracks/' + t.id + '/stream?app_name=DeadpoolV7',
          artwork: t.artwork?.['480x480'] || null
        };
      }
    } catch (e) {}
  }
  return null;
}

module.exports = { getLyrics, askAI, generateTextImage, EFFECT_PROMPTS, searchSong };
