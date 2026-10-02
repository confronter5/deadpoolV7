// apis.js — AI, lyrics, text-maker (multi-source fallbacks, shape-sniffing)
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';
const e = s => encodeURIComponent(String(s || ''));

async function get(url, opts = {}) {
  return axios.get(url, {
    timeout: opts.timeout || 60000,
    validateStatus: () => true,
    responseType: opts.responseType || 'json',
    headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
    ...(opts.extra || {})
  });
}
async function fetchBuffer(url, t = 90000) {
  const r = await get(url, { responseType: 'arraybuffer', timeout: t, extra: { maxContentLength: 100 * 1024 * 1024 } });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return Buffer.from(r.data);
}

// Deep-sniff a downloadable media URL from any JSON shape
function sniffUrl(obj, keys = ['dl', 'download', 'url', 'link', 'result', 'data', 'audio', 'video', 'mp3', 'mp4']) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.startsWith('http') ? obj : null;
  if (Array.isArray(obj)) { for (const i of obj) { const u = sniffUrl(i, keys); if (u) return u; } return null; }
  if (typeof obj === 'object') {
    for (const k of keys) if (typeof obj[k] === 'string' && obj[k].startsWith('http')) return obj[k];
    for (const v of Object.values(obj)) { const u = sniffUrl(v, keys); if (u) return u; }
  }
  return null;
}
// Deep-sniff a text answer from any JSON shape
function sniffText(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.trim().length > 1 ? obj.trim() : null;
  if (Array.isArray(obj)) { for (const i of obj) { const t = sniffText(i); if (t) return t; } return null; }
  if (typeof obj === 'object') {
    for (const k of ['result', 'response', 'answer', 'text', 'content', 'data', 'message'])
      if (typeof obj[k] === 'string' && obj[k].trim().length > 1) return obj[k].trim();
    for (const v of Object.values(obj)) { const t = sniffText(v); if (t) return t; }
  }
  return null;
}

// ============ AI ============
async function askAI(prompt) {
  // 1) Pollinations (plain text, no key) — most reliable free option
  try {
    const r = await get(`https://text.pollinations.ai/${e(prompt)}`, { responseType: 'text', timeout: 60000 });
    if (r.status === 200 && typeof r.data === 'string') {
      const t = r.data.trim();
      if (t.length > 1 && !/error|rate.?limit|too many/i.test(t)) return t;
    }
  } catch {}
  // 2) siputzx AI shapes
  try {
    const r = await get(`https://api.siputzx.my.id/api/ai/gpt3?prompt=${e(prompt)}`);
    const t = sniffText(r.data);
    if (t && t.length > 1) return t;
  } catch {}
  try {
    const r = await get(`https://api.siputzx.my.id/api/ai/gpt3.5-turbo?prompt=${e(prompt)}`);
    const t = sniffText(r.data);
    if (t && t.length > 1) return t;
  } catch {}
  return null;
}

// ============ LYRICS ============
async function getLyrics(query) {
  // 1) siputzx lirik
  try {
    const r = await get(`https://api.siputzx.my.id/api/lirik?judul=${e(query)}`);
    const s = r.data?.result?.lirik || r.data?.data?.lirik || r.data?.lirik
      || (typeof r.data?.result === 'string' ? r.data.result : null);
    if (typeof s === 'string' && s.trim().length > 20) return { lyrics: s.trim(), title: query, artist: '' };
  } catch {}
  // 2) LRCLIB (very reliable)
  try {
    const r = await get(`https://lrclib.net/api/search?q=${e(query)}`, { timeout: 45000 });
    const t = Array.isArray(r.data) ? r.data[0] : null;
    if (t && (t.plainLyrics || t.syncedLyrics)) {
      return { lyrics: (t.plainLyrics || t.syncedLyrics).trim(), title: t.trackName, artist: t.artistName };
    }
  } catch {}
  // 3) lyrics.ovh via suggest -> v1
  try {
    const s = await get(`https://api.lyrics.ovh/suggest/${e(query)}`, { timeout: 45000 });
    const t = s.data?.data?.[0];
    if (t?.artist?.name && t?.title) {
      const l = await get(`https://api.lyrics.ovh/v1/${e(t.artist.name)}/${e(t.title)}`, { timeout: 45000 });
      if (l.data?.lyrics) return { lyrics: String(l.data.lyrics).trim(), title: t.title, artist: t.artist.name };
    }
  } catch {}
  return null;
}

// ============ TEXT MAKER ============
const FX_ALIAS = {
  fire2: 'fire', glow: 'neon', gold: 'luxury', rainbow: 'neon',
  paper: 'sand', light: 'neon', ice: 'ice', metallic: 'steel'
};
async function generateTextImage(effect, text) {
  let fx = String(effect || 'neon').toLowerCase();
  const bases = [
    f => `https://api.siputzx.my.id/api/maker/${f}?text=${e(text)}`,
    f => `https://api.popcat.xyz/${f}?text=${e(text)}`,
    f => `https://api.erdwpe.com/api/maker/${f}?text=${e(text)}`
  ];
  const tryFx = async f => {
    for (const b of bases) {
      try {
        // JSON shape first (result/dl/url)
        const r = await get(b(f), { timeout: 40000 });
        const u = sniffUrl(r.data);
        if (u) { const buf = await fetchBuffer(u, 60000); if (buf.length > 500) return buf; }
      } catch {}
      try {
        // direct image
        const r = await get(b(f), { responseType: 'arraybuffer', timeout: 40000 });
        if (r.status === 200 && Buffer.isBuffer(r.data)) {
          const buf = Buffer.from(r.data);
          const isPng = buf[0] === 0x89 && buf[1] === 0x50;
          const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
          if ((isPng || isJpg) && buf.length > 500) return buf;
        }
      } catch {}
    }
    return null;
  };
  let buf = await tryFx(fx);
  if (!buf && FX_ALIAS[fx]) buf = await tryFx(FX_ALIAS[fx]);
  if (!buf) buf = await tryFx('neon');
  return buf;
}

module.exports = { askAI, getLyrics, generateTextImage };
