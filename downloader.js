const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const ytdl = require('@distube/ytdl-core');
const YouTube = require('youtube-sr').default;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

async function ytSearch(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (/youtube\.com|youtu\.be|music\.youtube/i.test(q)) return q;
  try {
    const r = await YouTube.search(q, { limit: 1, type: 'video', safeSearch: false });
    const first = Array.isArray(r) ? r[0] : (r?.results?.[0] || r?.[0]);
    if (first?.url) return first.url;
    if (first?.id) return `https://www.youtube.com/watch?v=${first.id}`;
  } catch (e) { console.log('youtube-sr search:', e.message); }
  try {
    const info = await ytdl.getBasicInfo('ytsearch1:' + q);
    const vid = info?.videoDetails?.videoId;
    if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  } catch (e) { console.log('ytsearch fallback:', e.message); }
  return null;
}

async function _getInfo(videoUrl) {
  const tries = [
    { playerClients: ['WEB', 'TV'] },
    { playerClients: ['IOS'] },
    { playerClients: ['ANDROID'] },
    {}
  ];
  for (const opts of tries) {
    try {
      const info = await Promise.race([
        ytdl.getInfo(videoUrl, opts),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000))
      ]);
      if (info?.formats?.length) return info;
    } catch (e) { console.log('getInfo try:', e.message); }
  }
  return null;
}

function _safeName(title) {
  return String(title || 'media').replace(/[^\w\s\-]/g, '').slice(0, 60).trim() || 'media';
}

function _downloadToFile(stream, outPath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    stream.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    stream.on('error', reject);
  });
}

async function downloadYouTube(query, audioOnly = false) {
  const videoUrl = await ytSearch(query);
  if (!videoUrl) return null;
  const info = await _getInfo(videoUrl);
  if (!info) return null;

  const title = info.videoDetails?.title || 'media';
  const stamp = Date.now();
  const safe = _safeName(title);

  if (audioOnly) {
    const outPath = path.join(os.tmpdir(), `${stamp}_${safe}.mp3`);
    const audioStream = ytdl.downloadFromInfo(info, {
      quality: 'highestaudio', filter: 'audioonly', highWaterMark: 1 << 25 });
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(audioStream)
          .audioBitrate(128).audioChannels(2).audioFrequency(44100).format('mp3')
          .on('end', resolve).on('error', reject).save(outPath);
      });
    } catch (e) {
      console.log('ffmpeg audio:', e.message);
      try { fs.unlinkSync(outPath); } catch {}
      return null;
    }
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 5000) return null;
    return { filePath: outPath, title, audioOnly: true };
  }

  const outPath = path.join(os.tmpdir(), `${stamp}_${safe}.mp4`);
  let fmt = ytdl.chooseFormat(info.formats, {
    quality: 'highest',
    filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' && (f.height || 0) <= 480
  });
  if (!fmt) {
    fmt = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: f => f.hasVideo && f.hasAudio && f.container === 'mp4' });
  }
  if (fmt) {
    try { await _downloadToFile(ytdl.downloadFromInfo(info, { format: fmt }), outPath); }
    catch (e) {
      console.log('video dl:', e.message);
      try { fs.unlinkSync(outPath); } catch {}
      return null;
    }
  } else {
    const vOnly = ytdl.chooseFormat(info.formats, { quality: 'highestvideo', filter: 'videoonly' });
    const aOnly = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    if (!vOnly || !aOnly) return null;
    const vTmp = path.join(os.tmpdir(), `${stamp}_v.mp4`);
    const aTmp = path.join(os.tmpdir(), `${stamp}_a.m4a`);
    try {
      await _downloadToFile(ytdl.downloadFromInfo(info, { format: vOnly }), vTmp);
      await _downloadToFile(ytdl.downloadFromInfo(info, { format: aOnly }), aTmp);
      await new Promise((resolve, reject) => {
        ffmpeg().input(vTmp).input(aTmp).videoCodec('copy').audioCodec('aac')
          .format('mp4').on('end', resolve).on('error', reject).save(outPath);
      });
    } catch (e) {
      console.log('ffmpeg mux:', e.message);
      try { fs.unlinkSync(vTmp); } catch {}
      try { fs.unlinkSync(aTmp); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
      return null;
    }
    try { fs.unlinkSync(vTmp); } catch {}
    try { fs.unlinkSync(aTmp); } catch {}
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 20000) return null;
  return { filePath: outPath, title, audioOnly: false };
}

async function sendAsMp3(sock, jid, data, quoted) {
  if (!data?.filePath || !fs.existsSync(data.filePath)) return false;
  const buffer = fs.readFileSync(data.filePath);
  const safeName = _safeName(data.title);
  try {
    await sock.sendMessage(jid, {
      audio: buffer, mimetype: 'audio/mpeg', fileName: safeName + '.mp3', ptt: false
    });
    return true;
  } catch (e) {
    console.log('sendAsMp3:', e.message);
    try {
      await sock.sendMessage(jid, {
        document: buffer, mimetype: 'audio/mpeg', fileName: safeName + '.mp3',
        caption: '🎵 *' + (data.title || 'Audio') + '*'
      });
      return true;
    } catch (e2) { return false; }
  } finally {
    try { fs.unlinkSync(data.filePath); } catch {}
  }
}

async function sendAsVideo(sock, jid, data, quoted) {
  if (!data?.filePath || !fs.existsSync(data.filePath)) return false;
  const buffer = fs.readFileSync(data.filePath);
  const cap = '🎬 *' + (data.title || 'Video') + '*';
  try {
    await sock.sendMessage(jid, { video: buffer, caption: cap, mimetype: 'video/mp4' });
    return true;
  } catch (e) {
    console.log('sendAsVideo:', e.message);
    try {
      await sock.sendMessage(jid, {
        document: buffer, mimetype: 'video/mp4',
        fileName: _safeName(data.title) + '.mp4', caption: cap
      });
      return true;
    } catch (e2) { return false; }
  } finally {
    try { fs.unlinkSync(data.filePath); } catch {}
  }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
