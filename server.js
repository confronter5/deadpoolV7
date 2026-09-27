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
  if (!me) return false;
  const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : me;
  const site = config.SITE_URL || process.env.SITE_URL || 'https://deadpoolv7.onrender.com';
  const channel = config.CHANNEL_URL || process.env.CHANNEL_URL || '';

  // Message 1: ONLY the session string (easy long-press copy, no extra text mixed)
  await sock.sendMessage(jid, { text: sessionId });

  // Message 2: instructions
  await sock.sendMessage(jid, {
    text:
      `✅ *Deadpool V7* linked successfully!\n\n` +
      `📋 *Copy Session* button below, or long-press the message above.\n` +
      `⚠️ Do not share this with anyone.`
  });

  try {
    const buttons = [
      {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: '📋 Copy Session',
          copy_code: sessionId
        })
      },
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: '🔗 Visit our site',
          url: site,
          merchant_url: site
        })
      }
    ];
    if (channel) {
      buttons.push({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: '📢 Join WaChannel',
          url: channel,
          merchant_url: channel
        })
      });
    } else {
      buttons.push({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: '👨‍💻 Developer',
          url: DEV_LINK,
          merchant_url: DEV_LINK
        })
      });
    }

    const buttonsMsg = {
      viewOnce: true,
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text: '💀 *Deadpool V7 Session*\nChoose an action:'
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
          text: config.POWERED_BY || 'Powered by Confronter'
        }),
        header: proto.Message.InteractiveMessage.Header.create({
          title: 'Session Ready',
          hasMediaAttachment: false
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons
        })
      })
    };
    const msg = generateWAMessageFromContent(jid, buttonsMsg, { userJid: jid });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  } catch {
    await sock.sendMessage(jid, {
      text: `📋 *SESSION*\n\`\`\`${sessionId}\`\`\`\n\n🔗 ${site}\n👨‍💻 ${DEV_LINK}`
    }).catch(() => {});
  }
  return true;
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
        }
        log(job.id, 'QR updated');
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

      // fullSession = deadpool~BASE64... → store base64 under short id
      const rawB64 = fullSession.startsWith('deadpool~')
        ? fullSession.slice('deadpool~'.length)
        : fullSession;
      let shortId = makeShortId(5);
      try {
        shortId = await saveShortSession(rawB64);
      } catch (e) {
        log(job.id, 'short save fail', e.message);
      }
      const shortSession = 'deadpool~' + shortId;

      job.session = shortSession;
      job.sessionFull = fullSession;
      job.status = 'done';
      log(job.id, 'SESSION READY', shortSession);

      await sendSessionToPM(sock, shortSession).catch((e) => log('pm', e.message));

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

app.get('/health', (req, res) => {
  res.json({ ok: true, active: jobs.size });
});

app.listen(PORT, () => {
  log(`Deadpool V7 Pair :${PORT} | code=${PAIR_CODE}`);
});
