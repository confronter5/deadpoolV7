// apis.js — AI, Lyrics, TextMaker, Song search
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const e = s => encodeURIComponent(String(s || ''));

function isBadText(s) {
  if (!s || typeof s !== 'string') return true;
  const t = s.trim();
  if (t.length < 2) return true;
  const low = t.slice(0, 80).toLowerCase();
  if (low.includes('<!doctype') || low.includes('<html') || low.includes('<pre>') || low.includes('cannot post')) return true;
  if (low.startsWith('{') && low.includes('"error"')) return true;
  return false;
}

async function get(url, opts = {}) {
  return axios.get(url, {
    timeout: opts.timeout || 45000,
    validateStatus: () => true,
    responseType: opts.responseType || 'json',
    headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) }
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

async function askAI(text) {
  if (!text || !String(text).trim()) return null;
  const q = String(text).trim().slice(0, 2500);

  const backends = [
    // Pollinations OpenAI-compatible (POST body — NOT path)
    async () => {
      const r = await post(
        'https://text.pollinations.ai/openai',
        {
          model: 'openai',
          messages: [
            { role: 'system', content: 'You are a helpful assistant. Answer clearly and briefly.' },
            { role: 'user', content: q }
          ]
        },
        { timeout: 60000 }
      );
      const a = r?.data?.choices?.[0]?.message?.content || r?.data?.content || r?.data;
      if (typeof a === 'string' && !isBadText(a)) return a.trim();
      return null;
    },
    // Pollinations GET (query in path is OK for GET)
    async () => {
      const r = await axios.get('https://text.pollinations.ai/' + e(q), {
        timeout: 60000,
        headers: { 'User-Agent': UA, Accept: 'text/plain' },
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [d => d]
      });
      if (typeof r?.data === 'string' && !isBadText(r.data)) return r.data.trim();
      return null;
    },
    async () => {
      const r = await post('https://api.siputzx.my.id/api/ai/gpt', { content: q, model: 'gpt-4o-mini' }, { timeout: 55000 });
      const a = r?.data?.data || r?.data?.result || r?.data?.message || r?.data?.response || r?.data;
      if (typeof a === 'string' && !isBadText(a)) return a.trim();
      if (a?.content && !isBadText(String(a.content))) return String(a.content).trim();
      if (a?.text && !isBadText(String(a.text))) return String(a.text).trim();
      return null;
    },
    async () => {
      const r = await post('https://api.siputzx.my.id/api/ai/blackboxai', { content: q }, { timeout: 55000 });
      const a = r?.data?.data || r?.data?.result || r?.data?.response;
      return typeof a === 'string' && !isBadText(a) ? a.trim() : null;
    },
    async () => {
      const r = await get(`https://api.ryzendesu.vip/api/ai/gpt?text=${e(q)}`, { timeout: 45000 });
      const a = r?.data?.result || r?.data?.answer || r?.data?.response || r?.data?.data;
      return typeof a === 'string' && !isBadText(a) ? a.trim() : null;
    },
    async () => {
      const r = await get(`https://api.giftedtech.my.id/api/ai/gpt?apikey=gifted&q=${e(q)}`, { timeout: 45000 });
      const a = r?.data?.result || r?.data?.response || r?.data?.data;
      return typeof a === 'string' && !isBadText(a) ? a.trim() : null;
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

async function getLyrics(query) {
  if (!query) return null;
  const q = String(query).trim();

  // 1) siputzx
  try {
    const r = await get(`https://api.siputzx.my.id/api/s/lyrics?query=${e(q)}`, { timeout: 30000 });
    const d = r?.data?.data || r?.data?.result || r?.data;
    const lyr = d?.lyrics || d?.lyric || d?.text;
    if (lyr && String(lyr).trim().length > 20) {
      return { title: d.title || d.song || q, artist: d.artist || d.author || d.singer || '', lyrics: String(lyr).trim() };
    }
  } catch {}

  // 2) lyrics.ovh (full text)
  try {
    const parts = q.split(/[-–—]| by /i).map(s => s.trim()).filter(Boolean);
    let artist = parts[0] || q;
    let title = parts[1] || parts[0] || q;
    if (parts.length === 1) {
      const sr = await get(`https://api.lyrics.ovh/suggest/${e(q)}`, { timeout: 15000 });
      const hit = sr?.data?.data?.[0];
      if (hit) {
        artist = hit.artist?.name || artist;
        title = hit.title || title;
      }
    }
    const r = await get(`https://api.lyrics.ovh/v1/${e(artist)}/${e(title)}`, { timeout: 25000 });
    if (r?.data?.lyrics && String(r.data.lyrics).trim().length > 20) {
      return { title, artist, lyrics: String(r.data.lyrics).trim() };
    }
  } catch {}

  // 3) gifted
  try {
    const r = await get(`https://api.giftedtech.my.id/api/search/lyrics?apikey=gifted&query=${e(q)}`, { timeout: 25000 });
    const d = r?.data?.result || r?.data?.data || r?.data;
    const lyr = d?.lyrics || d?.lyric;
    if (lyr && String(lyr).trim().length > 20) {
      return { title: d.title || q, artist: d.artist || d.author || '', lyrics: String(lyr).trim() };
    }
  } catch {}

  // 4) some-random-api
  try {
    const r = await get(`https://some-random-api.com/lyrics?title=${e(q)}`, { timeout: 20000 });
    if (r?.data?.lyrics && String(r.data.lyrics).trim().length > 20) {
      return {
        title: r.data.title || q,
        artist: r.data.author || r.data.artist || '',
        lyrics: String(r.data.lyrics).trim()
      };
    }
  } catch {}

  // 5) lrclib search + get
  try {
    const sr = await get(`https://lrclib.net/api/search?q=${e(q)}`, { timeout: 20000 });
    const hit = Array.isArray(sr?.data) ? sr.data[0] : null;
    if (hit?.id) {
      const r = await get(`https://lrclib.net/api/get/${hit.id}`, { timeout: 20000 });
      const lyr = r?.data?.plainLyrics || r?.data?.syncedLyrics || hit.plainLyrics;
      if (lyr && String(lyr).trim().length > 20) {
        return {
          title: hit.trackName || r?.data?.trackName || q,
          artist: hit.artistName || r?.data?.artistName || '',
          lyrics: String(lyr).replace(/\[\d+:\d+[^\]]*\]/g, '').trim()
        };
      }
    }
  } catch {}

  return null;
}

async function generateTextImage(effect, text) {
  const q = String(text || '').slice(0, 40);
  const style = String(effect || 'neon').toLowerCase().replace(/\s+/g, '');
  if (!q) return null;

  const candidates = [
    `https://api.siputzx.my.id/api/canvas/textpro?text=${e(q)}&style=${e(style)}`,
    `https://api.siputzx.my.id/api/ephoto/${e(style)}?text=${e(q)}`,
    `https://api.siputzx.my.id/api/photooxy/${e(style)}?text=${e(q)}`,
    `https://api.ryzendesu.vip/api/ephoto/${e(style)}?text=${e(q)}`,
    `https://api.giftedtech.my.id/api/ephoto360/${e(style)}?apikey=gifted&text=${e(q)}`,
    `https://api.lolhuman.xyz/api/ephoto1/${e(style)}?apikey=GataDios&text=${e(q)}`,
    `https://api.lolhuman.xyz/api/textprome/${e(style)}?apikey=GataDios&text=${e(q)}`,
    // popular fixed endpoints
    `https://api.popcat.xyz/outrank?text=${e(q)}`,
    `https://api.popcat.xyz/alert?text=${e(q)}`
  ];

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

async function searchSong(query) {
  try {
    const h = await get('https://api.audius.co', { timeout: 12000 });
    const host = String(h.data?.data?.[0] || 'https://discoveryprovider.audius.co').replace(/\/$/, '');
    const r = await get(`${host}/v1/tracks/search?query=${e(query)}&app_name=deadpoolv7`, { timeout: 30000 });
    const list = r.data?.data || [];
    for (const t of list) {
      if (!t?.id || !t?.title) continue;
      if (/unknown|untitled|null/i.test(String(t.title))) continue;
      return {
        title: String(t.title).trim(),
        artist: t.user?.name || t.user?.handle || 'Artist',
        streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=deadpoolv7`,
        artwork: t.artwork?.['480x480'] || null,
        id: t.id
      };
    }
    const t = list[0];
    if (t?.id) {
      return {
        title: t.title || query,
        artist: t.user?.name || '',
        streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=deadpoolv7`
      };
    }
  } catch {}
  return null;
}

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

module.exports = { askAI, getLyrics, generateTextImage, searchSong, getWeather, getJoke, getQuote };
