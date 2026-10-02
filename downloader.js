/**
 * Self-hosted yt-dlp downloader for WhatsApp bot
 * Requires: yt-dlp installed on the server + optional ffmpeg
 *
 * Install:
 *   pip install -U yt-dlp
 *   # or: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
 *   npm i youtube-dl-exec   (optional but recommended)
 *   # ffmpeg recommended for mp3 conversion:
 *   sudo apt install -y ffmpeg
 */

const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const TMP_DIR = path.join(os.tmpdir(), 'bot-ytdlp');
fs.ensureDirSync(TMP_DIR);

// Prefer youtube-dl-exec if installed, else raw yt-dlp binary
let youtubedl = null;
try {
  youtubedl = require('youtube-dl-exec');
} catch {
  youtubedl = null;
}

const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp';

function _safeName(t) {
  return String(t || 'media')
    .replace(/[^\w\s\-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60)
    .trim() || 'media';
}

function _runYtDlp(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('yt-dlp timeout'));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout).slice(-800) || `yt-dlp exit ${code}`));
    });
  });
}

async function ytSearch(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (/youtube\.com|youtu\.be|music\.youtube/i.test(q)) return q;

  try {
    const args = [
      `ytsearch1:${q}`,
      '--print', '%(webpage_url)s',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--quiet'
    ];
    if (youtubedl) {
      const out = await youtubedl(`ytsearch1:${q}`, {
        print: '%(webpage_url)s',
        noPlaylist: true,
        skipDownload: true,
        noWarnings: true,
        quiet: true
      });
      const url = String(out || '').trim().split('\n')[0];
      if (url && url.startsWith('http')) return url;
    } else {
      const { stdout } = await _runYtDlp(args, 35000);
      const url = stdout.trim().split('\n')[0];
      if (url && url.startsWith('http')) return url;
    }
  } catch (e) {
    console.log('ytSearch:', e.message);
  }
  return null;
}

async function _getTitle(url) {
  try {
    const { stdout } = await _runYtDlp(
      [url, '--print', 'title', '--skip-download', '--no-warnings', '--quiet'],
      20000
    );
    const t = stdout.trim().split('\n')[0];
    if (t) return t;
  } catch {}
  return 'media';
}

async function _findOutput(id) {
  try {
    const files = await fs.readdir(TMP_DIR);
    const match = files.find(f => f.startsWith(id));
    if (match) return path.join(TMP_DIR, match);
  } catch {}
  return null;
}

async function downloadYouTube(query, audioOnly = false) {
  const url = await ytSearch(query);
  if (!url) {
    console.log('ytSearch failed:', query);
    return null;
  }
  console.log('Resolved:', url);

  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const outTemplate = path.join(TMP_DIR, id + '.%(ext)s');

  try {
    if (audioOnly) {
      const args = [
        url,
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outTemplate,
        '--no-playlist',
        '--no-warnings',
        '--newline'
      ];

      let filepath = null;

      if (youtubedl) {
        try {
          await youtubedl(url, {
            format: 'bestaudio/best',
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
            output: outTemplate,
            noPlaylist: true,
            noWarnings: true
          });
          filepath = await _findOutput(id);
        } catch (e) {
          console.log('youtubedl audio:', e.message);
        }
      }

      if (!filepath) {
        await _runYtDlp(args, 150000);
        filepath = await _findOutput(id);
      }

      if (!filepath || !(await fs.pathExists(filepath))) {
        console.log('No audio file produced for', url);
        return null;
      }

      const title = await _getTitle(url);
      const buffer = await fs.readFile(filepath);
      await fs.remove(filepath).catch(() => {});

      if (!buffer || buffer.length < 3000) return null;

      return {
        buffer,
        title,
        audioOnly: true,
        mimetype: 'audio/mpeg',
        ext: 'mp3'
      };
    }

    // VIDEO — prefer mp4 <=720p with audio
    const args = [
      url,
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '-o', outTemplate,
      '--no-playlist',
      '--no-warnings',
      '--newline'
    ];

    let filepath = null;

    if (youtubedl) {
      try {
        await youtubedl(url, {
          format: 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/best[height<=720]/best',
          mergeOutputFormat: 'mp4',
          output: outTemplate,
          noPlaylist: true,
          noWarnings: true
        });
        filepath = await _findOutput(id);
      } catch (e) {
        console.log('youtubedl video:', e.message);
      }
    }

    if (!filepath) {
      await _runYtDlp(args, 180000);
      filepath = await _findOutput(id);
    }

    if (!filepath || !(await fs.pathExists(filepath))) {
      console.log('No video file produced for', url);
      return null;
    }

    const title = await _getTitle(url);
    const buffer = await fs.readFile(filepath);
    await fs.remove(filepath).catch(() => {});

    if (!buffer || buffer.length < 15000) return null;

    return {
      buffer,
      title,
      audioOnly: false,
      mimetype: 'video/mp4',
      ext: 'mp4'
    };
  } catch (e) {
    console.log('downloadYouTube:', e.message);
    try {
      const files = await fs.readdir(TMP_DIR);
      for (const f of files) {
        if (f.startsWith(id)) await fs.remove(path.join(TMP_DIR, f)).catch(() => {});
      }
    } catch {}
    return null;
  }
}

// ============ SEND AS MP3 ============
async function sendAsMp3(sock, jid, data) {
  if (!data?.buffer) return false;
  const name = _safeName(data.title) || 'audio';

  try {
    await sock.sendMessage(jid, {
      audio: data.buffer,
      mimetype: 'audio/mpeg',
      fileName: name + '.mp3',
      ptt: false
    });
    return true;
  } catch (e) {
    console.log('audio inline:', e.message);
  }

  try {
    await sock.sendMessage(jid, {
      document: data.buffer,
      mimetype: 'audio/mpeg',
      fileName: name + '.mp3',
      caption: '🎵 *' + (data.title || 'Audio') + '*'
    });
    return true;
  } catch (e) {
    console.log('audio document:', e.message);
  }

  return false;
}

// ============ SEND AS VIDEO ============
async function sendAsVideo(sock, jid, data) {
  if (!data?.buffer) return false;
  const cap = '🎬 *' + (data.title || 'Video') + '*';
  try {
    await sock.sendMessage(jid, {
      video: data.buffer,
      caption: cap,
      mimetype: 'video/mp4'
    });
    return true;
  } catch (e) {
    console.log('video inline:', e.message);
  }
  try {
    await sock.sendMessage(jid, {
      document: data.buffer,
      mimetype: 'video/mp4',
      fileName: _safeName(data.title) + '.mp4',
      caption: cap
    });
    return true;
  } catch (e) {
    console.log('video document:', e.message);
    return false;
  }
}

module.exports = { downloadYouTube, sendAsMp3, sendAsVideo, ytSearch };
