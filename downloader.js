const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;

async function ytSearch(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (/youtube\.com|youtu\.be|music\.youtube/i.test(q)) return q;
  try {
    const r = await YouTube.search(q, { limit: 1, type: 'video', safeSearch: false });
    const first = Array.isArray(r) ? r[0] : (r?.results?.[0] || r?.[0]);
    if (first?.url) return first.url;
    if (first?.id) return `https://www.youtube.com/watch?v=${first.id}`;
  } catch (e) { console.log('youtube-sr:', e.message); }
  try {
    const info = await ytdl.getBasicInfo('ytsearch1:' + q);
    const vid = info?.videoDetails?.videoId;
    if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  } catch (e) { console.log('ytsearch:', e.message); }
  return null;
}

async function _getInfo(url) {
  const tries = [{ playerClients: ['WEB','TV'] }, { playerClients: ['IOS'] }, { playerClients: ['ANDROID'] }, {}];
  for (const opts of tries) {
    try {
      const info = await Promise.race([
        ytdl.getInfo(url, opts),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 40000))
      ]);
      if (info?.formats?.length) return info;
    } catch (e) { console.log('getInfo:', e.message); }
  }
  return null;
}

function _streamToBuffer(stream, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error('stream timeout')), timeoutMs);
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    stream.on('error', e => { clearTimeout(t); reject(e); });
  });
}

async function downloadYouTube(query, audioOnly = false) {
  const url = await ytSearch(query);
  if (!url) return null;
  const info = await _getInfo(url);
  if (!info) return null;
  const title = info.videoDetails?.title || 'media';

  if (audioOnly) {
    let fmt = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    if (!fmt) fmt = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    if (!fmt) return null;
    let buffer;
    try { buffer = await _streamToBuffer(ytdl.downloadFromInfo(info, { format: fmt })); }
    catch (e) { console.log('audio stream:', e.message); return null; }
    if (!buffer || buffer.length < 5000) return null;
    return { buffer, title, audioOnly: true, mimetype: fmt.mimeType || 'audio/mp4', ext: (fmt.container || 'mp4').toLowerCase() };
  }

  let fmt = ytdl.chooseFormat(info.formats, {
    quality: 'highest',
    filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' && (f.height || 0) <= 720
  });
  if (!fmt) fmt = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' });
  if (!fmt) fmt = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });
  if (!fmt) return null;

  let buffer;
  try { buffer = await _streamToBuffer(ytdl.downloadFromInfo(info, { format: fmt }), 180000); }
  catch (e) { console.log('video stream:', e.message); return null; }
  if (!buffer || buffer.length < 20000) return null;
  return { buffer, title, audioOnly: false, mimetype: fmt.mimeType || 'video/mp4', ext: 'mp4' };
}

function _safeName(t) { return String(t || 'media').replace(/[^\w\s\-]/g, '').slice(0, 50).trim() || 'media'; }

async function sendAsMp3(sock, jid, data) {
  if (!data?.buffer) return false;
  const safeName = _safeName(data.title);
  const ext = data.ext === 'webm' ? 'webm' : 'm4a';
  try {
    await sock.sendMessage(jid, { audio: data.buffer, mimetype: data.mimetype || 'audio/mp4', fileName: safeName + '.' + ext, ptt: false });
    return true;
  } catch (e) { console.log('audio inline:', e.message); }
  try {
    await sock.sendMessage(jid, { document: data.buffer, mimetype: data.mimetype || 'audio/mp4', fileName: safeName + '.' + ext, caption: '🎵 *' + (data.title || 'Audio') + '*' });
    return true;
  } catch (e) { console.log('audio doc:', e.message); return false; }
}

async function sendAsVideo(sock, jid, data) {
  if (!data?.buffer) return false;
  const cap = '🎬 *' + (data.title || 'Video') + '*';
  try { await sock.sendMessage(jid, { video: data.buffer, caption: cap, mimetype: data.mimetype || 'video/mp4' }); return true; }
  catch (e) { console.log('video inline:', e.message); }
  try { await sock.sendMessage(jid, { document: data.buffer, mimetype: data.mimetype || 'video/mp4', fileName: _safeName(data.title) + '.mp4', caption: cap }); return true; }
  catch (e) { console.log('video doc:', e.message); return false; }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
