// downloader.js — robust YouTube search + mp3/mp4 with multiple working backends
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const e = s => encodeURIComponent(String(s || ''));
const TMP = path.join(__dirname, 'tmp');
fs.ensureDirSync(TMP);

async function get(url, opts = {}) {
  return axios.get(url, {
    timeout: opts.timeout || 55000,
    validateStatus: () => true,
    responseType: opts.responseType || 'json',
    maxContentLength: opts.maxContentLength || 200 * 1024 * 1024,
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(opts.headers || {})
    },
    ...(opts.extra || {})
  });
}

async function post(url, body, opts = {}) {
  return axios.post(url, body, {
    timeout: opts.timeout || 55000,
    validateStatus: () => true,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

async function fetchBuffer(url, t = 180000) {
  const r = await get(url, {
    responseType: 'arraybuffer',
    timeout: t,
    maxContentLength: 250 * 1024 * 1024
  });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return Buffer.from(r.data);
}

function sniffUrl(obj, keys = [
  'dl', 'download', 'url', 'link', 'result', 'data', 'audio', 'video',
  'mp3', 'mp4', 'medialink', 'download_url', 'file', 'media', 'src'
]) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.startsWith('http') ? obj : null;
  if (Array.isArray(obj)) {
    for (const i of obj) {
      const u = sniffUrl(i, keys);
      if (u) return u;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of keys) {
      if (typeof obj[k] === 'string' && obj[k].startsWith('http')) return obj[k];
    }
    for (const v of Object.values(obj)) {
      const u = sniffUrl(v, keys);
      if (u) return u;
    }
  }
  return null;
}

const isYtUrl = q => /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i.test(String(q || ''));

// ============ SEARCH ============
async function ytSearch(query) {
  // 1) yt-search package (most reliable when installed)
  try {
    const yts = require('yt-search');
    const r = await yts(query);
    const v = r?.videos?.[0];
    if (v?.url) return { url: v.url, title: v.title, thumbnail: v.thumbnail, duration: v.timestamp };
  } catch {}

  // 2) siputzx
  try {
    const r = await get(`https://api.siputzx.my.id/api/s/youtube?query=${e(query)}`, { timeout: 20000 });
    const arr = r.data?.data || r.data?.result || [];
    const v = Array.isArray(arr) ? arr[0] : null;
    if (v) {
      const url = v.url || v.link || (v.videoId || v.id ? `https://www.youtube.com/watch?v=${v.videoId || v.id}` : null);
      if (url) return { url, title: v.title || v.name || query, thumbnail: v.thumbnail || v.thumb };
    }
  } catch {}

  // 3) yanzbotz
  try {
    const r = await get(`https://api.yanzbotz.my.id/api/search/ytsearch?q=${e(query)}`, { timeout: 20000 });
    const items = r.data?.result || r.data?.data || [];
    const list = Array.isArray(items) ? items : (items?.result || items?.data || []);
    if (Array.isArray(list) && list.length) {
      const v = list[0];
      const url = v.url || v.link || (v.id || v.videoId ? `https://www.youtube.com/watch?v=${v.id || v.videoId}` : null);
      if (url) return { url, title: v.title || query };
    }
  } catch {}

  // 4) gifted
  try {
    const r = await get(`https://api.giftedtech.my.id/api/search/yts?apikey=gifted&query=${e(query)}`, { timeout: 20000 });
    const arr = r.data?.results || r.data?.result || r.data?.data || [];
    const v = Array.isArray(arr) ? arr[0] : null;
    if (v) {
      const url = v.url || v.link || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null);
      if (url) return { url, title: v.title || query };
    }
  } catch {}

  return null;
}

// ============ DOWNLOAD BACKENDS ============

// Cobalt (very reliable public instances)
const COBALT = [
  'https://api.cobalt.tools/api/json',
  'https://cobalt-api.kwiatekmiki.com/api/json',
  'https://capi.oak.li/api/json',
  'https://co.otomir23.me/api/json'
];

async function viaCobalt(url, audioOnly) {
  for (const inst of COBALT) {
    try {
      const r = await post(inst, {
        url,
        isAudioOnly: !!audioOnly,
        aFormat: 'mp3',
        vCodec: 'h264',
        filenamePattern: 'basic',
        downloadMode: 'auto'
      }, { timeout: 50000 });
      const d = r.data;
      if ((d?.status === 'stream' || d?.status === 'redirect' || d?.url) && d?.url) {
        const buf = await fetchBuffer(d.url, 180000);
        if (buf?.length > 8000) return { buffer: buf, title: d.filename || 'media', url: d.url };
      }
    } catch {}
  }
  return null;
}

// siputzx
async function viaSiputzx(url, audioOnly) {
  const endpoints = audioOnly
    ? [
        `https://api.siputzx.my.id/api/d/ytmp3?url=${e(url)}`,
        `https://api.siputzx.my.id/api/d/ytmp3v2?url=${e(url)}`
      ]
    : [
        `https://api.siputzx.my.id/api/d/ytmp4?url=${e(url)}`,
        `https://api.siputzx.my.id/api/d/ytmp4v2?url=${e(url)}`
      ];
  for (const ep of endpoints) {
    try {
      const r = await get(ep, { timeout: 55000 });
      const d = r.data?.data || r.data?.result || r.data;
      const mediaUrl = sniffUrl(d);
      const title = d?.title || d?.name || 'YouTube';
      if (mediaUrl) {
        const buf = await fetchBuffer(mediaUrl, 180000);
        if (buf && buf.length > 8000) return { buffer: buf, title, url: mediaUrl };
      }
    } catch {}
  }
  return null;
}

// yanzbotz / gifted style
async function viaYanzGifted(url, audioOnly) {
  const endpoints = audioOnly
    ? [
        `https://api.yanzbotz.my.id/api/download/ytmp3?url=${e(url)}`,
        `https://api.giftedtech.my.id/api/download/ytmp3?apikey=gifted&url=${e(url)}`
      ]
    : [
        `https://api.yanzbotz.my.id/api/download/ytmp4?url=${e(url)}`,
        `https://api.giftedtech.my.id/api/download/ytmp4?apikey=gifted&url=${e(url)}`
      ];
  for (const ep of endpoints) {
    try {
      const r = await get(ep, { timeout: 55000 });
      const mediaUrl = sniffUrl(r.data);
      const title = r.data?.result?.title || r.data?.title || r.data?.data?.title || 'YouTube';
      if (mediaUrl) {
        const buf = await fetchBuffer(mediaUrl, 180000);
        if (buf && buf.length > 8000) return { buffer: buf, title, url: mediaUrl };
      }
    } catch {}
  }
  return null;
}

// ytdl-core / @distube/ytdl-core (if installed)
async function viaYtdl(url, audioOnly) {
  try {
    let ytdl;
    try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = require('ytdl-core'); }
    const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': UA } } });
    const title = info?.videoDetails?.title || 'YouTube';
    const format = audioOnly
      ? ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' })
      : (ytdl.chooseFormat(info.formats, { quality: '18' }) || ytdl.chooseFormat(info.formats, { quality: 'lowest' }));
    if (!format?.url) return null;
    const buf = await fetchBuffer(format.url, 180000);
    if (buf && buf.length > 8000) return { buffer: buf, title, url: format.url };
  } catch {}
  return null;
}

// yt-dlp-exec (best quality when binary is available)
async function viaYtDlp(url, audioOnly) {
  try {
    let ytdlp;
    try { ytdlp = require('yt-dlp-exec'); } catch { return null; }
    const out = path.join(TMP, crypto.randomBytes(6).toString('hex') + (audioOnly ? '.mp3' : '.mp4'));
    await ytdlp(url, audioOnly
      ? { extractAudio: true, audioFormat: 'mp3', output: out, noPlaylist: true, quiet: true }
      : { format: 'best[height<=480]/best', output: out, noPlaylist: true, quiet: true });
    const buf = await fs.readFile(out).catch(() => null);
    await fs.remove(out).catch(() => {});
    if (buf && buf.length > 8000) return { buffer: buf, title: 'YouTube' };
  } catch {}
  return null;
}

// ============ MAIN ENTRY ============
async function downloadYouTube(query, isAudio = true) {
  try {
    query = String(query || '').trim();
    if (!query) return null;

    let videoUrl = null;
    let title = query;

    if (isYtUrl(query)) {
      videoUrl = query;
    } else {
      const s = await ytSearch(query);
      if (!s?.url) return null;
      videoUrl = s.url;
      title = s.title || query;
    }

    // Try backends in order of current reliability
    let data = await viaCobalt(videoUrl, isAudio);
    if (!data?.buffer) data = await viaSiputzx(videoUrl, isAudio);
    if (!data?.buffer) data = await viaYanzGifted(videoUrl, isAudio);
    if (!data?.buffer) data = await viaYtDlp(videoUrl, isAudio);
    if (!data?.buffer) data = await viaYtdl(videoUrl, isAudio);

    if (data?.buffer) {
      data.title = data.title || title;
      data.url = videoUrl;
      return data;
    }
    return null;
  } catch (err) {
    console.log('downloadYouTube:', err.message);
    return null;
  }
}

// ============ SENDERS (size-aware) ============
async function sendAsMp3(sock, from, data) {
  try {
    const { buffer, title } = data;
    if (!buffer) return false;
    const name = String(title || 'audio').replace(/[^\w\s\-]/g, '').trim().slice(0, 60) || 'audio';
    if (buffer.length > 15 * 1024 * 1024) {
      await sock.sendMessage(from, {
        document: buffer,
        mimetype: 'audio/mpeg',
        fileName: name + '.mp3'
      });
    } else {
      await sock.sendMessage(from, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: name + '.mp3'
      });
      await sock.sendMessage(from, { text: `🎵 *${name}*` }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.log('sendAsMp3:', e.message);
    return false;
  }
}

async function sendAsVideo(sock, from, data) {
  try {
    const { buffer, title } = data;
    if (!buffer) return false;
    const name = String(title || 'video').replace(/[^\w\s\-]/g, '').trim().slice(0, 60) || 'video';
    if (buffer.length > 15 * 1024 * 1024) {
      await sock.sendMessage(from, {
        document: buffer,
        mimetype: 'video/mp4',
        fileName: name + '.mp4'
      });
    } else {
      await sock.sendMessage(from, {
        video: buffer,
        mimetype: 'video/mp4',
        caption: `🎬 *${name}*`
      });
    }
    return true;
  } catch (e) {
    console.log('sendAsVideo:', e.message);
    return false;
  }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
