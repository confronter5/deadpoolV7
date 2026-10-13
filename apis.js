// apis.js — AI, Lyrics, TextMaker, Song search (multi-backend, production ready)
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const e = s => encodeURIComponent(String(s || ''));

async function get(url, opts = {}) {
  return axios.get(url, {
    timeout: opts.timeout || 45000,
    validateStatus: () => true,
    responseType: opts.responseType || 'json',
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      ...(opts.headers || {})
    }
  });
}

async function post(url, body, opts = {}) {
  return axios.post(url, body, {
    timeout: opts.timeout || 45000,
    validateStatus: () => true,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

// ============ AI (multiple free backends) ============
async function askAI(text) {
  if (!text || !String(text).trim()) return null;
  const q = String(text).trim().slice(0, 2000);

  const backends = [
    // 1) siputzx GPT
    async () => {
      const r = await post('https://api.siputzx.my.id/api/ai/gpt', {
        content: q,
        model: 'gpt-3.5-turbo'
      }, { timeout: 50000 });
      const a = r?.data?.data || r?.data?.result || r?.data?.message || r?.data?.response || r?.data;
      if (typeof a === 'string' && a.trim().length > 2) return a.trim();
      if (a?.content) return String(a.content).trim();
      if (a?.text) return String(a.text).trim();
      return null;
    },

    // 2) ryzendesu
    async () => {
      const r = await get(`https://api.ryzendesu.vip/api/ai/gpt?text=${e(q)}`, { timeout: 45000 });
      const a = r?.data?.result || r?.data?.answer || r?.data?.response || r?.data?.data;
      return typeof a === 'string' && a.trim().length > 2 ? a.trim() : null;
    },

    // 3) gifted
    async () => {
      const r = await get(`https://api.giftedtech.my.id/api/ai/gpt?apikey=gifted&q=${e(q)}`, { timeout: 45000 });
      const a = r?.data?.result || r?.data?.response || r?.data?.data;
      return typeof a === 'string' && a.trim().length > 2 ? a.trim() : null;
    },

    // 4) pollinations (very reliable free)
    async () => {
      const r = await axios.post(
        'https://text.pollinations.ai/' + e(q),
        {},
        { timeout: 60000, headers: { 'User-Agent': UA }, validateStatus: () => true }
      );
      if (typeof r?.data === 'string' && r.data.trim().length > 2) return r.data.trim();
      return null;
    },

    // 5) blackbox style fallback
    async () => {
      const r = await post('https://api.siputzx.my.id/api/ai/blackboxai', { content: q }, { timeout: 50000 });
      const a = r?.data?.data || r?.data?.result || r?.data?.response;
      return typeof a === 'string' && a.trim().length > 2 ? a.trim() : null;
    }
  ];

  for (const fn of backends) {
    try {
      const ans = await fn();
      if (ans) return ans;
    } catch {}
  }
  return null;
}

// ============ LYRICS ============
async function getLyrics(query) {
  if (!query) return null;
  const q = String(query).trim();

  // 1) siputzx
  try {
    const r = await get(`https://api.siputzx.my.id/api/s/lyrics?query=${e(q)}`, { timeout: 25000 });
    const d = r?.data?.data || r?.data?.result || r?.data;
    if (d?.lyrics || d?.lyric) {
      return {
        title: d.title || q,
        artist: d.artist || d.author || d.singer || '',
        lyrics: d.lyrics || d.lyric
      };
    }
  } catch {}

  // 2) lyrics.ovh
  try {
    const parts = q.split(/[-–—]| by /i).map(s => s.trim()).filter(Boolean);
    let artist = parts[0] || q;
    let title = parts[1] || parts[0] || q;
    if (parts.length === 1) {
      // try search first
      const sr = await get(`https://api.lyrics.ovh/suggest/${e(q)}`, { timeout: 15000 });
      const hit = sr?.data?.data?.[0];
      if (hit) {
        artist = hit.artist?.name || artist;
        title = hit.title || title;
      }
    }
    const r = await get(`https://api.lyrics.ovh/v1/${e(artist)}/${e(title)}`, { timeout: 20000 });
    if (r?.data?.lyrics) {
      return { title, artist, lyrics: r.data.lyrics };
    }
  } catch {}

  // 3) gifted
  try {
    const r = await get(`https://api.giftedtech.my.id/api/search/lyrics?apikey=gifted&query=${e(q)}`, { timeout: 20000 });
    const d = r?.data?.result || r?.data?.data;
    if (d?.lyrics || d?.lyric) {
      return {
        title: d.title || q,
        artist: d.artist || d.author || '',
        lyrics: d.lyrics || d.lyric
      };
    }
  } catch {}

  return null;
}

// ============ TEXT MAKER (neon, fire, etc.) ============
async function generateTextImage(effect, text) {
  const q = String(text || '').slice(0, 40);
  const style = String(effect || 'neon').toLowerCase();
  if (!q) return null;

  const candidates = [
    `https://api.siputzx.my.id/api/canvas/textpro?text=${e(q)}&style=${e(style)}`,
    `https://api.siputzx.my.id/api/ephoto/${e(style)}?text=${e(q)}`,
    `https://api.siputzx.my.id/api/photooxy/${e(style)}?text=${e(q)}`,
    `https://api.ryzendesu.vip/api/ephoto/${e(style)}?text=${e(q)}`,
    `https://api.giftedtech.my.id/api/ephoto360/${e(style)}?apikey=gifted&text=${e(q)}`,
    `https://api.lolhuman.xyz/api/ephoto1/${e(style)}?apikey=GataDios&text=${e(q)}`,
    `https://api.lolhuman.xyz/api/textprome/${e(style)}?apikey=GataDios&text=${e(q)}`
  ];

  // style-specific popular fallbacks
  if (style === 'neon') candidates.push(`https://api.popcat.xyz/outrank?text=${e(q)}`);
  if (style === 'matrix') candidates.push(`https://api.popcat.xyz/matrix?text=${e(q)}`);

  for (const url of candidates) {
    try {
      const r = await get(url, { responseType: 'arraybuffer', timeout: 40000 });
      if (r.status >= 400 || !r.data) continue;
      const buf = Buffer.from(r.data);
      if (buf.length < 800) continue;
      const head = buf.slice(0, 24).toString('utf8').toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html') || head.includes('{"') || head.includes('error')) continue;
      return buf;
    } catch {}
  }
  return null;
}

// ============ AUDIUS SONG SEARCH (for music player / pair site) ============
async function searchSong(query) {
  try {
    const h = await get('https://api.audius.co', { timeout: 15000 });
    const host = h.data?.data?.[0] || 'https://discoveryprovider.audius.co';
    const r = await get(`${host}/v1/tracks/search?query=${e(query)}&app_name=deadpoolv7`, { timeout: 30000 });
    const t = r.data?.data?.[0];
    if (!t) return null;
    return {
      title: t.title,
      artist: t.user?.name || '',
      streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=deadpoolv7`
    };
  } catch {
    return null;
  }
}

// ============ EXTRA: simple weather / joke helpers (optional) ============
async function getWeather(city) {
  try {
    const r = await get(`https://wttr.in/${e(city)}?format=3`, {
      timeout: 15000,
      headers: { 'User-Agent': 'curl/7.68.0', Accept: 'text/plain' }
    });
    const body = String(r.data || '').trim();
    if (body && !body.startsWith('<!') && !body.includes('<html')) return body;
  } catch {}
  return null;
}

async function getJoke() {
  try {
    const r = await get('https://official-joke-api.appspot.com/random_joke', { timeout: 10000 });
    if (r.data?.setup) return { setup: r.data.setup, punchline: r.data.punchline };
  } catch {}
  return null;
}

async function getQuote() {
  try {
    const r = await get('https://api.quotable.io/random', { timeout: 10000 });
    if (r.data?.content) return { content: r.data.content, author: r.data.author };
  } catch {}
  return null;
}

module.exports = {
  askAI,
  getLyrics,
  generateTextImage,
  searchSong,
  getWeather,
  getJoke,
  getQuote
};
