const axios = require('axios');
const RcSpotLR = require('rcspotlr');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';
const lyricsClient = new RcSpotLR();

async function getLyrics(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  let track = q, artist = null;
  const dash = q.split(/\s*[-–—]\s*/);
  if (dash.length === 2) { track = dash[0].trim(); artist = dash[1].trim(); }
  try {
    let res = await lyricsClient.getLyrics(track, artist);
    if (!res) res = await lyricsClient.getLyrics(q);
    if (res?.plainLyrics) {
      return {
        title: res.trackName || track,
        artist: res.artistName || artist || '',
        lyrics: res.plainLyrics
      };
    }
  } catch (e) { console.log('rcspotlr:', e.message); }
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
  } catch (e) { console.log('pollinations text:', e.message); }
  try {
    const r = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions',
      { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
        messages: [{ role: 'user', content: q }], max_tokens: 800 },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) { console.log('deepinfra:', e.message); }
  try {
    const r = await axios.post('https://text.pollinations.ai/openai',
      { model: 'openai',
        messages: [
          { role: 'system', content: 'You are a helpful WhatsApp assistant. Keep replies short and clear.' },
          { role: 'user', content: q }
        ] },
      { timeout: 30000, headers: { 'Content-Type': 'application/json', 'User-Agent': UA } });
    const t = r.data?.choices?.[0]?.message?.content;
    if (t && t.trim()) return t.trim();
  } catch (e) { console.log('pollinations openai:', e.message); }
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
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(fn(t))}?width=1000&height=500&nologo=true&seed=${Date.now()}`;
}

async function searchSong(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const r = await axios.get(
      `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=DeadpoolV7`,
      { timeout: 20000, headers: { 'User-Agent': UA } });
    const tracks = r.data?.data;
    if (Array.isArray(tracks) && tracks.length) {
      const t = tracks[0];
      return {
        id: t.id, title: t.title, artist: t.user?.name || '',
        streamUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=DeadpoolV7`,
        artwork: t.artwork?.['480x480'] || null
      };
    }
  } catch (e) { console.log('audius search:', e.message); }
  return null;
}

module.exports = { askAI, getLyrics, textMakerUrl, searchSong, EFFECT_PROMPTS };
