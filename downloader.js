// downloader.js — YouTube search + mp3/mp4 using ONLY ytdl (@distube/ytdl-core / ytdl-core)
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TMP = path.join(__dirname, 'tmp');
fs.ensureDirSync(TMP);

const isYtUrl = q => /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i.test(String(q || ''));

function getYtdl() {
  try { return require('@distube/ytdl-core'); }
  catch { return require('ytdl-core'); }
}

async function fetchBuffer(url, timeout = 180000) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout,
    maxContentLength: 250 * 1024 * 1024,
    validateStatus: () => true,
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.youtube.com/'
    }
  });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return Buffer.from(r.data);
}

async function ytSearch(query) {
  try {
    const yts = require('yt-search');
    const r = await yts(query);
    const v = r?.videos?.[0];
    if (v?.url) return { url: v.url, title: v.title, thumbnail: v.thumbnail, duration: v.timestamp };
  } catch (e) {
    console.log('ytSearch:', e.message);
  }
  // fallback youtube-sr if present
  try {
    const { default: YouTube } = require('youtube-sr');
    const r = await YouTube.search(query, { limit: 1, type: 'video' });
    const v = r?.[0];
    if (v?.url || v?.id) {
      return {
        url: v.url || `https://www.youtube.com/watch?v=${v.id}`,
        title: v.title || query,
        thumbnail: v.thumbnail?.displayThumbnailURL?.('max') || v.thumbnail?.url
      };
    }
  } catch {}
  return null;
}

async function viaYtdl(url, audioOnly) {
  const ytdl = getYtdl();
  const info = await ytdl.getInfo(url, {
    requestOptions: { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }
  });
  const title = info?.videoDetails?.title || 'YouTube';
  let format;
  if (audioOnly) {
    format =
      ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' }) ||
      ytdl.chooseFormat(info.formats, { quality: 'lowest' });
  } else {
    format =
      ytdl.chooseFormat(info.formats, { quality: '18' }) ||
      ytdl.chooseFormat(info.formats, { quality: 'lowest' }) ||
      ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
  }
  if (!format?.url) throw new Error('No suitable format');
  const buf = await fetchBuffer(format.url, 180000);
  if (!buf || buf.length < 8000) throw new Error('Empty or too small media');
  return { buffer: buf, title, url: format.url };
}

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
    const data = await viaYtdl(videoUrl, isAudio);
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

async function sendAsMp3(sock, from, data) {
  try {
    const { buffer, title } = data || {};
    if (!buffer) return false;
    const name = String(title || 'audio').replace(/[^\w\s\-]/g, '').trim().slice(0, 60) || 'audio';
    if (buffer.length > 15 * 1024 * 1024) {
      await sock.sendMessage(from, { document: buffer, mimetype: 'audio/mpeg', fileName: name + '.mp3' });
    } else {
      await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mpeg', ptt: false, fileName: name + '.mp3' });
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
    const { buffer, title } = data || {};
    if (!buffer) return false;
    const name = String(title || 'video').replace(/[^\w\s\-]/g, '').trim().slice(0, 60) || 'video';
    if (buffer.length > 15 * 1024 * 1024) {
      await sock.sendMessage(from, { document: buffer, mimetype: 'video/mp4', fileName: name + '.mp4' });
    } else {
      await sock.sendMessage(from, { video: buffer, mimetype: 'video/mp4', caption: `🎬 *${name}*` });
    }
    return true;
  } catch (e) {
    console.log('sendAsVideo:', e.message);
    return false;
  }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
