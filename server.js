/**
 * Deadpool V7 Pair Server
 * Matches working pair sites (Keith / Toxic style):
 * - Request pairing code on QR event
 * - On 515 restartRequired after pair → reconnect with same creds (CRITICAL)
 * - QR auto-refresh support
 */

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  generateWAMessageFromContent,
  Browsers,
  delay
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const DEV_LINK = process.env.DEV_LINK || config.DEV_LINK || 'https://wa.me/254796283064';

const PAIR_CODE = (config.PAIRING_CODE || 'DEADPOOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.ensureDirSync(SESSIONS_DIR);

function makeShortId(len = 5) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function saveShortSession(fullBase64Creds) {
  await fs.ensureDir(SESSIONS_DIR);
  let id = makeShortId(5);
  // avoid collision
  while (await fs.pathExists(path.join(SESSIONS_DIR, id + '.json'))) {
    id = makeShortId(6);
  }
  const record = {
    id,
    createdAt: new Date().toISOString(),
    // store raw creds object string for bot
    data: fullBase64Creds
  };
  await fs.writeJson(path.join(SESSIONS_DIR, id + '.json'), record, { spaces: 0 });
  return id;
}


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();

function jobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function sendSessionToPM(sock, sessionId) {
  const me = sock.user?.id;
  if (!me || !sessionId) return false;
  const jid = me.includes(':')
    ? me.split(':')[0] + '@s.whatsapp.net'
    : jidNormalizedUser(me);

  const site = process.env.SITE_URL || 'https://deadpoolv7.onrender.com';
  const DEV_LINK = process.env.DEV_LINK || 'https://wa.me/254796283064';

  // ONLY plain text — interactive/viewOnce often shows "Waiting for this message"
  const msg1 =
    '💀 *Deadpool V7 SESSION*\n\n' +
    'Copy everything below this line:\n' +
    '────────────────────';
  const msg2 = sessionId;
  const msg3 =
    '────────────────────\n' +
    'Paste into Heroku *SESSION* config var.\n\n' +
    '🔗 Site: ' + site + '\n' +
    '👨‍💻 Dev: ' + DEV_LINK;

  try {
    await sock.sendMessage(jid, { text: msg1 });
    await new Promise(r => setTimeout(r, 400));
    await sock.sendMessage(jid, { text: msg2 });
    await new Promise(r => setTimeout(r, 400));
    await sock.sendMessage(jid, { text: msg3 });
    log('pm', 'session sent to', jid);
    return true;
  } catch (e) {
    log('pm fail', e.message);
    try {
      await sock.sendMessage(jid, { text: sessionId });
      return true;
    } catch (e2) {
      log('pm fail2', e2.message);
      return false;
    }
  }
}

async function exportSession(AUTH_DIR) {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!(await fs.pathExists(credsPath))) return null;
  const creds = await fs.readJson(credsPath);
  if (!creds || !creds.me) return null;
  const sessionData = Buffer.from(JSON.stringify(creds)).toString('base64');
  return `deadpool~${sessionData}`;
}

/**
 * Core connector — reconnects on 515 like Keith/Toxic style bots
 */
async function startSocket(job) {
  const AUTH_DIR = job.authDir;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    getMessage: async () => undefined
  });

  job.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ---- QR for scan mode ----
    if (qr && job.status !== 'done') {
      try {
        job.qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' }
        });
        if (job.mode === 'qr') {
          job.status = 'qr';
          job.error = null;
          log(job.id, 'QR updated');
        } else {
          // code mode: ignore QR image
          job.qrDataUrl = null;
        }
      } catch {}

      // ---- Pairing CODE: request when QR event fires (Baileys recommended) ----
      if (
        job.mode === 'code' &&
        job.phone &&
        !job.codeRequested &&
        !sock.authState.creds.registered
      ) {
        job.codeRequested = true;
        try {
          await delay(1000);
          let code;
          try {
            code = await sock.requestPairingCode(job.phone, PAIR_CODE);
          } catch {
            code = await sock.requestPairingCode(job.phone);
          }
          job.code = String(code || '').toUpperCase();
          job.status = 'code';
          job.qrDataUrl = null; // pair-code mode: never show QR
          job.error = null;
          log(job.id, 'PAIR CODE', job.code, '- user can leave browser, session will still complete');
        } catch (e) {
          job.status = 'error';
          job.error = e.message || 'Failed to get pairing code';
          log(job.id, 'code fail', e.message);
        }
      }
    }

    if (connection === 'open') {
      log(job.id, 'OPEN', sock.user?.id);
      job.status = 'connected';
      job.error = null;
      job.qrDataUrl = null;

      // Wait for creds to fully settle
      await delay(2500);
      let fullSession = await exportSession(AUTH_DIR);
      if (!fullSession) {
        await delay(2000);
        fullSession = await exportSession(AUTH_DIR);
      }
      if (!fullSession) {
        job.status = 'error';
        job.error = 'Session file incomplete — try again';
        return;
      }

      // Full base64 session only: deadpool~LONGTEXT
      job.session = fullSession;
      job.status = 'done';
      log(job.id, 'SESSION READY (full base64)');

      await sendSessionToPM(sock, fullSession).catch((e) => log('pm', e.message));

      // keep alive for PM delivery then cleanup
      setTimeout(() => {
        try { sock.end(undefined); } catch {}
        job.sock = null;
        setTimeout(() => fs.remove(AUTH_DIR).catch(() => {}), 30_000);
      }, 120_000);
      return;
    }

    if (connection === 'close') {
      if (job.status === 'done') return;

      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : lastDisconnect?.error?.output?.statusCode || 0;

      log(job.id, 'CLOSE', statusCode);

      // *** CRITICAL: after successful pair WA sends 515 — reconnect with same creds ***
      if (
        statusCode === DisconnectReason.restartRequired ||
        statusCode === 515
      ) {
        log(job.id, '515 reconnect…');
        job.status = job.code ? 'code' : 'starting';
        job.codeRequested = job.mode === 'code'; // don't re-request code
        await delay(1500);
        try {
          await startSocket(job);
        } catch (e) {
          job.status = 'error';
          job.error = 'Reconnect failed — try again';
        }
        return;
      }

      // logged out / bad session
      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === 401
      ) {
        job.status = 'error';
        job.error = 'Logged out — generate again';
        return;
      }

      // connection lost while waiting — allow one soft retry
      if (
        !job.retried &&
        (statusCode === DisconnectReason.connectionClosed ||
          statusCode === DisconnectReason.connectionLost ||
          statusCode === 428 ||
          statusCode === 408)
      ) {
        job.retried = true;
        log(job.id, 'soft retry…');
        await delay(2000);
        try {
          await startSocket(job);
        } catch {
          job.status = 'error';
          job.error = 'Connection lost — generate again';
        }
        return;
      }

      job.status = 'error';
      job.error =
        statusCode === 405
          ? 'Rate limited — wait 2 minutes and try again'
          : `Disconnected (${statusCode}) — generate again`;
    }
  });

  return sock;
}

async function startPairJob(phone, mode) {
  const id = jobId();
  const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '') : '';
  if (mode === 'code' && (cleanPhone.length < 10 || cleanPhone.length > 15)) {
    throw new Error('Invalid number. Use country code e.g. 254712345678');
  }

  const authDir = path.join(__dirname, 'auth_pair_web', id);
  await fs.remove(authDir).catch(() => {});
  await fs.ensureDir(authDir);

  const job = {
    id,
    phone: cleanPhone || null,
    mode,
    status: 'starting',
    code: null,
    qrDataUrl: null,
    session: null,
    error: null,
    authDir,
    codeRequested: false,
    retried: false,
    sock: null
  };
  jobs.set(id, job);

  // expire job after 12 min
  setTimeout(() => {
    const j = jobs.get(id);
    if (j && j.status !== 'done') {
      try { j.sock?.end(undefined); } catch {}
      jobs.delete(id);
      fs.remove(authDir).catch(() => {});
    }
  }, 20 * 60 * 1000);

  startSocket(job).catch((e) => {
    job.status = 'error';
    job.error = e.message || 'Start failed';
  });

  return job;
}

// ---------- routes (Keith-style friendly) ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/pair/qr', async (req, res) => {
  try {
    const job = await startPairJob(null, 'qr');
    res.json({ id: job.id, status: job.status, mode: 'qr' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/pair', async (req, res) => {
  try {
    const phone = req.body.phone || req.body.number || req.query.q;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const job = await startPairJob(phone, 'code');
    res.json({ id: job.id, status: job.status, mode: 'code' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Keith-style GET: /api/pair?q=2547...
app.get('/api/pair', async (req, res) => {
  try {
    const phone = req.query.q || req.query.phone || req.query.number;
    if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
    const job = await startPairJob(phone, 'code');
    // wait briefly for code
    const started = Date.now();
    while (Date.now() - started < 20000) {
      if (job.code) {
        return res.json({ status: true, result: job.code, id: job.id });
      }
      if (job.status === 'error') {
        return res.status(500).json({ status: false, error: job.error });
      }
      await delay(500);
    }
    res.json({ status: true, result: job.code || PAIR_CODE, id: job.id, pending: !job.code });
  } catch (e) {
    res.status(400).json({ status: false, error: e.message });
  }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Expired — generate again' });
  res.json({
    id: job.id,
    status: job.status,
    mode: job.mode,
    code: job.code,
    qr: job.qrDataUrl,
    session: job.status === 'done' ? job.session : null,
    error: job.error
  });
});


// Fetch full session by short id (bot uses this)
app.get('/api/session/:id', async (req, res) => {
  try {
    let id = String(req.params.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!id) return res.status(400).json({ error: 'id required' });
    const file = path.join(SESSIONS_DIR, id + '.json');
    if (!(await fs.pathExists(file))) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }
    const record = await fs.readJson(file);
    res.json({
      status: true,
      id: record.id,
      session: 'deadpool~' + record.data, // full form for bot
      createdAt: record.createdAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ==================== MUSIC via y2mate (pair page) ====================
let y2mateDl = null;
try { y2mateDl = require('y2mate-dl'); } catch (_) {}

const MUSIC_DIR = path.join(__dirname, 'public', 'music');

const MUSIC_TRACKS = [
  { q: 'Alan Walker Faded official audio', name: 'Alan Walker — Faded', local: 'track1.mp3' },
  { q: 'Vybz Kartel Fever official audio', name: 'Vybz Kartel — Fever', local: 'track2.mp3' },
  { q: 'Central Cee Doja official audio', name: 'Central Cee — Doja', local: 'track3.mp3' },
  { q: 'Lil Baby Woah official audio', name: 'Lil Baby — Woah', local: 'track4.mp3' },
  { q: 'Burna Boy Last Last official audio', name: 'Burna Boy — Last Last', local: 'track5.mp3' },
  { q: 'Sauti Sol Suzanna official', name: 'Sauti Sol — Suzanna', local: 'track1.mp3' },
  { q: 'Diamond Platnumz Jeje official', name: 'Diamond Platnumz — Jeje', local: 'track2.mp3' },
  { q: 'Ed Sheeran Shape of You official', name: 'Ed Sheeran — Shape of You', local: 'track3.mp3' },
  { q: 'The Weeknd Blinding Lights official', name: 'The Weeknd — Blinding Lights', local: 'track4.mp3' },
  { q: 'Rema Calm Down official', name: 'Rema — Calm Down', local: 'track5.mp3' }
];

const musicCache = new Map(); // name -> { url, ts, source }

async function ytSearchFirst(query) {
  const apis = [
    `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(query)}`,
    `https://api.agatz.xyz/api/ytsearch?message=${encodeURIComponent(query)}`
  ];
  for (const ep of apis) {
    try {
      const res = await axios.get(ep, { timeout: 20000, validateStatus: () => true });
      const raw = res?.data?.data || res?.data?.result || res?.data?.videos || res?.data || [];
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
      const first = arr.find(x => x && (x.url || x.videoId || x.id || x.link));
      if (!first) continue;
      const url = first.url || first.link ||
        (first.videoId ? `https://www.youtube.com/watch?v=${first.videoId}` : null) ||
        (first.id && String(first.id).length >= 10 ? `https://www.youtube.com/watch?v=${first.id}` : null);
      if (url) return { url, title: first.title || query };
    } catch {}
  }
  // fallback: treat query as search URL
  return { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, title: query };
}

/** y2mate.com analyze + convert → direct mp3 link */
async function y2mateMp3(videoUrl) {
  try {
    const an = await axios.post(
      'https://www.y2mate.com/mates/analyzeV2/ajax',
      new URLSearchParams({ k_query: videoUrl, k_page: 'home', hl: 'en', q_auto: '0' }).toString(),
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: 'https://www.y2mate.com',
          Referer: 'https://www.y2mate.com/en68'
        },
        validateStatus: () => true
      }
    );
    if (!an.data || an.data.status !== 'ok') return null;
    const links = an.data.links || {};
    const mp3map = links.mp3 || {};
    // pick highest quality mp3 key
    let pick = null;
    for (const k of Object.keys(mp3map)) {
      const item = mp3map[k];
      if (item && item.k) { pick = item; break; }
    }
    if (!pick || !an.data.vid) return null;

    const conv = await axios.post(
      'https://www.y2mate.com/mates/convertV2/index',
      new URLSearchParams({ vid: an.data.vid, k: pick.k }).toString(),
      {
        timeout: 60000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: 'https://www.y2mate.com',
          Referer: 'https://www.y2mate.com/'
        },
        validateStatus: () => true
      }
    );
    const dlink = conv.data?.dlink || conv.data?.url;
    if (dlink && String(dlink).startsWith('http')) {
      return { url: String(dlink), title: an.data.title || '' };
    }
  } catch (e) {
    console.log('y2mate.com fail:', e.message);
  }
  return null;
}

/** npm y2mate-dl package */
async function y2mateDlMp3(videoUrl) {
  if (!y2mateDl) return null;
  try {
    const fn = y2mateDl.default || y2mateDl.y2mate || y2mateDl.download || y2mateDl;
    if (typeof fn !== 'function') return null;
    const r = await Promise.race([
      fn(videoUrl, 'mp3'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000))
    ]);
    const link = r?.url || r?.dl || r?.link || r?.download || r?.result?.url || r?.medias?.[0]?.url;
    if (link && String(link).startsWith('http')) {
      return { url: String(link), title: r?.title || r?.result?.title || '' };
    }
  } catch (e) {
    console.log('y2mate-dl fail:', e.message);
  }
  return null;
}

async function resolveTrackAudio(track) {
  const key = track.name;
  const hit = musicCache.get(key);
  if (hit && Date.now() - hit.ts < 25 * 60 * 1000 && hit.url) return hit;

  // 1) search YT
  let videoUrl = null;
  try {
    const found = await ytSearchFirst(track.q);
    // prefer real watch URL
    if (found?.url && found.url.includes('watch')) videoUrl = found.url;
  } catch {}

  // 2) y2mate.com
  if (videoUrl) {
    const r1 = await y2mateMp3(videoUrl);
    if (r1?.url) {
      const entry = { url: r1.url, ts: Date.now(), source: 'y2mate.com', title: r1.title || track.name };
      musicCache.set(key, entry);
      return entry;
    }
  }

  // 3) y2mate-dl npm
  if (videoUrl) {
    const r2 = await y2mateDlMp3(videoUrl);
    if (r2?.url) {
      const entry = { url: r2.url, ts: Date.now(), source: 'y2mate-dl', title: r2.title || track.name };
      musicCache.set(key, entry);
      return entry;
    }
  }

  // 4) local file fallback (always works if public/music exists)
  if (track.local) {
    const fp = path.join(MUSIC_DIR, track.local);
    if (fs.existsSync(fp)) {
      const entry = { url: '/api/music/stream/' + MUSIC_TRACKS.indexOf(track), ts: Date.now(), source: 'local', title: track.name, localFile: fp };
      musicCache.set(key, entry);
      return entry;
    }
  }

  return null;
}

app.get('/api/music/playlist', (req, res) => {
  res.json({ tracks: MUSIC_TRACKS.map((t, i) => ({ i, name: t.name })) });
});

app.get('/api/music/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index) || 0;
    const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    const track = MUSIC_TRACKS[i];
    // Always expose same-origin stream path (server resolves y2mate behind the scenes)
    res.json({
      i,
      name: track.name,
      url: '/api/music/stream/' + i,
      next: (i + 1) % MUSIC_TRACKS.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/music/stream/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index) || 0;
    const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    const track = MUSIC_TRACKS[i];

    const resolved = await resolveTrackAudio(track);

    // Local file
    if (resolved?.localFile && fs.existsSync(resolved.localFile)) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return fs.createReadStream(resolved.localFile).pipe(res);
    }

    // Local by name
    if (track.local) {
      const fp = path.join(MUSIC_DIR, track.local);
      if (fs.existsSync(fp) && (!resolved || resolved.source === 'local')) {
        res.setHeader('Content-Type', 'audio/mpeg');
        return fs.createReadStream(fp).pipe(res);
      }
    }

    // Proxy y2mate / remote URL (same-origin so browser can play)
    if (resolved?.url && String(resolved.url).startsWith('http')) {
      const upstream = await axios.get(resolved.url, {
        responseType: 'stream',
        timeout: 90000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://www.y2mate.com/'
        },
        maxRedirects: 5
      });
      if (upstream.status >= 400) {
        // last resort local
        if (track.local && fs.existsSync(path.join(MUSIC_DIR, track.local))) {
          res.setHeader('Content-Type', 'audio/mpeg');
          return fs.createReadStream(path.join(MUSIC_DIR, track.local)).pipe(res);
        }
        return res.status(502).json({ error: 'y2mate upstream failed' });
      }
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return upstream.data.pipe(res);
    }

    // pure local fallback
    if (track.local && fs.existsSync(path.join(MUSIC_DIR, track.local))) {
      res.setHeader('Content-Type', 'audio/mpeg');
      return fs.createReadStream(path.join(MUSIC_DIR, track.local)).pipe(res);
    }

    res.status(404).json({ error: 'No audio from y2mate' });
  } catch (e) {
    console.log('stream error', e.message);
    // try local on any error
    try {
      const idx = Number(req.params.index) || 0;
      const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
      const track = MUSIC_TRACKS[i];
      if (track.local && fs.existsSync(path.join(MUSIC_DIR, track.local))) {
        res.setHeader('Content-Type', 'audio/mpeg');
        return fs.createReadStream(path.join(MUSIC_DIR, track.local)).pipe(res);
      }
    } catch {}
    res.status(500).json({ error: e.message || 'stream error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, active: jobs.size });
});

app.listen(PORT, () => {
  log(`Deadpool V7 Pair :${PORT} | code=${PAIR_CODE}`);
});
