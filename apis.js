const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';

async function getLyrics(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const r = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
      { timeout: 20000, headers: { 'User-Agent': UA } });
    const arr = Array.isArray(r.data) ? r.data : [];
    const hit = arr.find(x => x.plainLyrics && x.plainLyrics.length > 20);
    if (hit) return { title: hit.trackName || q, artist: hit.artistName || '', lyrics: hit.plainLyrics };
  } catch (e) { console.log('lrclib:', e.message); }
  try {
    let artist = '', title = q;
    const dash = q.split(/\s*[-–—]\s*/);
    if (dash.length === 2) { title = dash[0].trim(); artist = dash[1].trim(); }
    const url = artist
      ? `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`
      : `https://api.lyrics.ovh/v1/${encodeURIComponent(title)}/${encodeURIComponent(title)}`;
    const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
    if (r.data?.lyrics) return { title, artist, lyrics: r.data.lyrics.replace(/\r/g, '').trim() };
  } catch (e) { console.log('lyrics.ovh:', e.message); }
  return null;
}

async function askAI(prompt) {
  const q = String(prompt || '').slice(0, 1500);
  if (!q) return null;
  try {
    const r = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(q)}`,
      { timeout: 30000, headers: { 'User-Agent': UA } });
    if (typeof r.data === 'string' && r.data.trim().length > 1) return r.data.trim();
    if (r.data?.choices?.[0]?.message?.content) return r.data.choices[0].message.content.trim();
  } catch (e) { console.log('poll1:', e.message); }
  try {
    const r = await axios.post('https://text.pollinations.ai/openai',
      { model: 'openai', messages: [
        { role: 'system', content: 'You are a helpful WhatsApp assistant. Keep replies short.' },
        { role: 'user', content: q }
      ] },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) { console.log('poll2:', e.message); }
  try {
    const r = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions',
      { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
        messages: [{ role: 'user', content: q }], max_tokens: 800 },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) { console.log('deepinfra:', e.message); }
  return null;
}

const EFFECT_PROMPTS = {
  neon:      (t) => `neon glowing sign on black wall with the words "${t}", purple pink cyan glow, high detail, 4k`,
  fire:      (t) => `the text "${t}" burning in realistic fire flames, dark background, cinematic`,
  glitch:    (t) => `the text "${t}" with digital glitch effect, RGB chromatic aberration, cyberpunk`,
  ice:       (t) => `the text "${t}" frozen in ice, frost crystals, cold blue lighting, high detail`,
  matrix:    (t) => `the text "${t}" in green matrix code rain, black background, terminal style`,
  thunder:   (t) => `the text "${t}" with lightning bolts and thunder, dark storm, electric blue`,
  devil:     (t) => `the text "${t}" with devil horns, red neon glow, dark satanic background`,
  sand:      (t) => `the text "${t}" written in sand on a beach, top-down view, sunny`,
  blackpink: (t) => `the text "${t}" in Blackpink logo style, pink and black, k-pop aesthetic`,
  metallic:  (t) => `the text "${t}" in shiny chrome metallic gold, 3D letters, studio lighting`,
  light:     (t) => `the text "${t}" made of glowing light bulbs, dark background, warm glow`,
  hacker:    (t) => `the text "${t}" in hacker terminal font, green on black, code screen`,
  neon2:     (t) => `the text "${t}" in blue neon tubes, dark alley wall, rain`,
  paper:     (t) => `the text "${t}" cut out of paper, 3D papercraft, soft shadows`,
  luxury:    (t) => `the text "${t}" in gold letters on marble, luxury gold and white`
};

function textMakerUrl(effect, text) {
  const t = String(text || '').slice(0, 40).replace(/"/g, '');
  const fn = EFFECT_PROMPTS[effect] || EFFECT_PROMPTS.neon;
  const seed = Math.floor(Math.random() * 999999);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(fn(t))}?width=1024&height=512&nologo=true&seed=${seed}`;
}

async function generateTextImage(effect, text) {
  const url = textMakerUrl(effect, text);
  for (let i = 0; i < 3; i++) {
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

async function searchSong(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const nodes = ['https://discoveryprovider.audius.co', 'https://audius-discovery-1.cultur3stake.com'];
  for (const base of nodes) {
    try {
      const r = await axios.get(
        `${base}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=DeadpoolV7`,
        { timeout: 20000, headers: { 'User-Agent': UA } }
      );
      const tracks = r.data?.data;
      if (Array.isArray(tracks) && tracks.length) {
        const t = tracks[0];
        return {
          id: t.id, title: t.title, artist: t.user?.name || '',
          streamUrl: `${base}/v1/tracks/${t.id}/stream?app_name=DeadpoolV7`,
          artwork: t.artwork?.['480x480'] || null
        };
      }
    } catch (e) { console.log('audius', base, e.message); }
  }
  return null;
}

module.exports = { askAI, getLyrics, textMakerUrl, generateTextImage, searchSong, EFFECT_PROMPTS };
