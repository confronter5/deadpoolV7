/**
 * Deadpool V7 Pair Server
 * Matches working pair sites (Keith / Toxic style):
 * - Request pairing code on QR event
 * - On 515 restartRequired after pair → reconnect with same creds (CRITICAL)
 * - QR auto-refresh support
 * - Music on pair page via Audius (no uploads needed)
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
  jidNormalizedUser,
  Browsers,
  delay
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');
const axios = require('axios');
const { searchSong } = require('./apis');

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
  while (await fs.pathExists(path.join(SESSIONS_DIR, id + '.json'))) {
    id = makeShortId(6);
  }
  const record = {
    id,
    createdAt: new Date().toISOString(),
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
          job.qrDataUrl = null;
        }
      } catch {}

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
          job.qrDataUrl = null;
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

      job.session = fullSession;
      job.status = 'done';
      log(job.id, 'SESSION READY (full base64)');

      // Save short session for /api/session/:id
      try {
        const shortId = await saveShortSession(fullSession.replace(/^deadpool~/, ''));
        log(job.id, 'short session id:', shortId);
      } catch (e) {
        log(job.id, 'short session save fail', e.message);
      }

      await sendSessionToPM(sock, fullSession).catch((e) => log('pm', e.message));

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

      if (
        statusCode === DisconnectReason.restartRequired ||
        statusCode === 515
      ) {
        log(job.id, '515 reconnect…');
        job.status = job.code ? 'code' : 'starting';
        job.codeRequested = job.mode === 'code';
        await delay(1500);
        try {
          await startSocket(job);
        } catch (e) {
          job.status = 'error';
          job.error = 'Reconnect failed — try again';
        }
        return;
      }

      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === 401
      ) {
        job.status = 'error';
        job.error = 'Logged out — generate again';
        return;
      }

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

// ---------- routes ----------
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

app.get('/api/pair', async (req, res) => {
  try {
    const phone = req.query.q || req.query.phone || req.query.number;
    if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
    const job = await startPairJob(phone, 'code');
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
      session: 'deadpool~' + record.data,
      createdAt: record.createdAt
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== MUSIC (Audius — no uploads needed) ====================
const MUSIC_TRACKS = [
  { q: 'Alan Walker Faded',        name: 'Alan Walker — Faded' },
  { q: 'Vybz Kartel Fever',        name: 'Vybz Kartel — Fever' },
  { q: 'Central Cee Doja',         name: 'Central Cee — Doja' },
  { q: 'Lil Baby Woah',            name: 'Lil Baby — Woah' },
  { q: 'Burna Boy Last Last',      name: 'Burna Boy — Last Last' },
  { q: 'Sauti Sol Suzanna',        name: 'Sauti Sol — Suzanna' },
  { q: 'Diamond Platnumz Jeje',    name: 'Diamond Platnumz — Jeje' },
  { q: 'Ed Sheeran Shape of You',  name: 'Ed Sheeran — Shape of You' },
  { q: 'The Weeknd Blinding Lights', name: 'The Weeknd — Blinding Lights' },
  { q: 'Rema Calm Down',           name: 'Rema — Calm Down' }
];

const musicCache = new Map(); // query -> { data, ts }

app.get('/api/music/playlist', (req, res) => {
  res.json({ tracks: MUSIC_TRACKS.map((t, i) => ({ i, name: t.name })) });
});

app.get('/api/music/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index) || 0;
    const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    const track = MUSIC_TRACKS[i];
    res.json({
      i,
      name: track.name,
      url: '/api/stream-song/' + encodeURIComponent(track.q),
      next: (i + 1) % MUSIC_TRACKS.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Search a song by query — returns { streamUrl, title, artist } */
app.get('/api/stream-song/:query', async (req, res) => {
  try {
    const query = String(req.params.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query required' });

    const cached = musicCache.get(query);
    if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
      return res.json(cached.data);
    }

    const data = await searchSong(query);
    if (!data?.streamUrl) {
      return res.status(404).json({ error: 'Not found' });
    }

    musicCache.set(query, { data, ts: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Proxy the Audius stream so browser plays from same origin (avoids CORS) */
app.get('/api/music/stream/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index) || 0;
    const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    const track = MUSIC_TRACKS[i];

    let data = musicCache.get(track.q)?.data;
    if (!data?.streamUrl) {
      data = await searchSong(track.q);
      if (data?.streamUrl) musicCache.set(track.q, { data, ts: Date.now() });
    }
    if (!data?.streamUrl) return res.status(404).json({ error: 'No audio found' });

    const upstream = await axios.get(data.streamUrl, {
      responseType: 'stream',
      timeout: 90000,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      maxRedirects: 5
    });
    if (upstream.status >= 400) return res.status(502).json({ error: 'Upstream failed' });

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return upstream.data.pipe(res);
  } catch (e) {
    console.log('stream error', e.message);
    res.status(500).json({ error: e.message || 'stream error' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, active: jobs.size });
});

app.listen(PORT, () => {
  log(`Deadpool V7 Pair :${PORT} | code=${PAIR_CODE}`);
});
