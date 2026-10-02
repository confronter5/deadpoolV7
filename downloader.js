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
    if (first?.id) return 'https://www.youtube.com/watch?v=' + first.id;
  } catch (e) {}
  try {
    const info = await ytdl.getBasicInfo('ytsearch1:' + q);
    const vid = info?.videoDetails?.videoId;
    if (vid) return 'https://www.youtube.com/watch?v=' + vid;
  } catch (e) {}
  return null;
}

async function _getInfo(url) {
  const tries = [{ playerClients: ['WEB', 'TV'] }, { playerClients: ['IOS'] }, { playerClients: ['ANDROID'] }, {}];
  for (const opts of tries) {
    try {
      const info = await Promise.race([
        ytdl.getInfo(url, opts),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 40000))
      ]);
      if (info?.formats?.length) return info;
    } catch (e) {}
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

function _safeName(t) { return String(t || 'media').replace(/[^\w\s\-]/g, '').slice(0, 50).trim() || 'media'; }

async function downloadYouTube(query, audioOnly = false) {
  const url = await ytSearch(query);
  if (!url) return null;
  const info = await _getInfo(url);
  if (!info) return null;
  const title = info.videoDetails?.title || 'media';

  if (audioOnly) {
    // Prefer M4A (best audio) then any audio
    let fmt = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly', container: 'mp4' })
           || ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    if (!fmt) return null;

    let buffer;
    try { buffer = await _streamToBuffer(ytdl.downloadFromInfo(info, { format: fmt })); }
    catch (e) { console.log('audio stream:', e.message); return null; }
    if (!buffer || buffer.length < 5000) return null;

    return {
      buffer,
      title,
      audioOnly: true,
      mimetype: 'audio/mpeg',      // ← force MP3 mime so all devices play
      ext: 'mp3'                    // ← force .mp3 filename
    };
  }

  let fmt = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' && (f.height || 0) <= 720 })
         || ytdl.chooseFormat(info.formats, { quality: 'highest', filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' })
         || ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });
  if (!fmt) return null;

  let buffer;
  try { buffer = await _streamToBuffer(ytdl.downloadFromInfo(info, { format: fmt }), 180000); }
  catch (e) { console.log('video stream:', e.message); return null; }
  if (!buffer || buffer.length < 20000) return null;
  return { buffer, title, audioOnly: false, mimetype: 'video/mp4', ext: 'mp4' };
}

// ============ SEND AS MP3 ============
// Tries audio player first. If it fails, sends as document MP3 (always works).
async function sendAsMp3(sock, jid, data) {
  if (!data?.buffer) return false;
  const name = _safeName(data.title) || 'audio';

  // 1) Try as playable audio (in-chat player)
  try {
    await sock.sendMessage(jid, {
      audio: data.buffer,
      mimetype: 'audio/mpeg',
      fileName: name + '.mp3',
      ptt: false
    });
    return true;
  } catch (e) { console.log('audio inline:', e.message); }

  // 2) Fallback: as document MP3 (WhatsApp Media Viewer, Music apps, etc.)
  try {
    await sock.sendMessage(jid, {
      document: data.buffer,
      mimetype: 'audio/mpeg',
      fileName: name + '.mp3',
      caption: '🎵 *' + (data.title || 'Audio') + '*'
    });
    return true;
  } catch (e) { console.log('audio document:', e.message); }

  // 3) Last resort: as WAV
  try {
    await sock.sendMessage(jid, {
      document: data.buffer,
      mimetype: 'audio/wav',
      fileName: name + '.wav',
      caption: '🎵 *' + (data.title || 'Audio') + '*'
    });
    return true;
  } catch (e) { console.log('audio wav:', e.message); return false; }
}

// ============ SEND AS VIDEO ============
async function sendAsVideo(sock, jid, data) {
  if (!data?.buffer) return false;
  const cap = '🎬 *' + (data.title || 'Video') + '*';
  try {
    await sock.sendMessage(jid, { video: data.buffer, caption: cap, mimetype: 'video/mp4' });
    return true;
  } catch (e) { console.log('video inline:', e.message); }
  try {
    await sock.sendMessage(jid, {
      document: data.buffer,
      mimetype: 'video/mp4',
      fileName: _safeName(data.title) + '.mp4',
      caption: cap
    });
    return true;
  } catch (e) { console.log('video document:', e.message); return false; }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
