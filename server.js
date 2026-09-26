/**
 * Deadpool V7 - Web Pair Dashboard
 * QR scan + Pairing code (DEADPOOL)
 * Start: node server.js
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
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const DEV_LINK = process.env.DEV_LINK || config.DEV_LINK || 'https://wa.me/254796283064';
const PAIR_CODE = (config.PAIRING_CODE || 'DEADPOOL').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();

function jobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function reasonText(statusCode) {
  const map = {
    [DisconnectReason.connectionClosed]: 'Connection closed — try again',
    [DisconnectReason.connectionLost]: 'Connection lost — try again',
    [DisconnectReason.connectionReplaced]: 'Connected on another device',
    [DisconnectReason.timedOut]: 'Timed out — scan QR again',
    [DisconnectReason.loggedOut]: 'Logged out — start a new pair',
    [DisconnectReason.badSession]: 'Bad session — try again',
    [DisconnectReason.restartRequired]: 'Restart required — try again',
    [DisconnectReason.multideviceMismatch]: 'Multi-device mismatch',
    405: 'Pairing blocked — wait 1–2 min and retry',
    408: 'Timed out — try again',
    428: 'Connection closed — try again',
    440: 'Session conflict — try again',
    500: 'WhatsApp error — try again',
    515: 'Restart required — try again'
  };
  return map[statusCode] || `Disconnected (${statusCode || '?'}) — try again`;
}

async function sendSessionToPM(sock, sessionId) {
  const me = sock.user?.id;
  if (!me) return false;
  const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : me;

  const site = config.SITE_URL || process.env.SITE_URL || 'https://deadpoolv7.onrender.com';
  const channel = config.CHANNEL_URL || process.env.CHANNEL_URL || '';
  const dev = DEV_LINK;

  // Main session text (easy long-press copy) — style like Keith example
  const body =
    `*${sessionId}*\n\n` +
    `✅ *Deadpool V7* linked successfully!\n` +
    `📋 Tap *Copy Session* below or long-press the text.\n` +
    `⚠️ _Do not share this with anyone._`;

  await sock.sendMessage(jid, { text: body });

  // Interactive buttons: Copy Session | Visit site | Join channel
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
          url: dev,
          merchant_url: dev
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
          text: (config.POWERED_BY || 'Powered by Confronter')
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
  } catch (e) {
    // Fallback plain links
    let fb = `📋 *Copy Session*\n\`\`\`${sessionId}\`\`\`\n\n🔗 Site: ${site}\n👨‍💻 Dev: ${dev}`;
    if (channel) fb += `\n📢 Channel: ${channel}`;
    await sock.sendMessage(jid, { text: fb }).catch(() => {});
  }
  return true;
}

async function startPairJob(phone, mode = 'qr') {
  const id = jobId();
  const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '') : '';

  if (mode === 'code' && (cleanPhone.length < 10 || cleanPhone.length > 15)) {
    throw new Error('Invalid phone number (e.g. 254712345678)');
  }

  const AUTH_DIR = path.join(__dirname, 'auth_pair_web', id);
  await fs.remove(AUTH_DIR).catch(() => {});
  await fs.ensureDir(AUTH_DIR);

  const job = {
    id,
    phone: cleanPhone || null,
    mode,
    status: 'starting',
    code: null,
    qrDataUrl: null,
    session: null,
    error: null
  };
  jobs.set(id, job);

  setTimeout(() => {
    jobs.delete(id);
    fs.remove(AUTH_DIR).catch(() => {});
  }, 12 * 60 * 1000);

  (async () => {
    let sock;
    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR path
        if (qr && job.status !== 'done') {
          try {
            job.qrDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 320,
              color: { dark: '#000000', light: '#ffffff' }
            });
            job.status = 'qr';
            job.error = null;
          } catch (e) {
            job.error = 'Could not generate QR';
          }
        }

        if (connection === 'open') {
          job.status = 'connected';
          job.error = null;
          job.qrDataUrl = null;
          try {
            await new Promise((r) => setTimeout(r, 2000));
            const credsPath = path.join(AUTH_DIR, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
              job.status = 'error';
              job.error = 'Creds missing — try again';
              return;
            }
            const creds = await fs.readJson(credsPath);
            const sessionData = Buffer.from(JSON.stringify(creds)).toString('base64');
            const sessionId = `deadpool~${sessionData}`;
            job.session = sessionId;
            job.status = 'done';

            await sendSessionToPM(sock, sessionId).catch(() => {});

            setTimeout(() => fs.remove(AUTH_DIR).catch(() => {}), 60_000);
            setTimeout(() => {
              try { sock.end(undefined); } catch {}
            }, 90_000);
          } catch (e) {
            job.status = 'error';
            job.error = e.message || 'Failed to build session';
          }
          return;
        }

        if (connection === 'close') {
          if (job.status === 'done') return;
          const statusCode =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output?.statusCode
              : lastDisconnect?.error?.output?.statusCode || 0;

          // Allow QR refresh on restartRequired / timeout — Baileys often re-emits qr
          if (
            statusCode === DisconnectReason.restartRequired ||
            statusCode === 515
          ) {
            // keep waiting for new qr
            job.status = job.mode === 'code' ? 'code' : 'starting';
            return;
          }

          job.status = 'error';
          job.error = reasonText(statusCode);
        }
      });

      // Pairing CODE path
      if (mode === 'code' && !sock.authState.creds.registered) {
        await new Promise((r) => setTimeout(r, 1200));
        try {
          let code;
          try {
            code = await sock.requestPairingCode(cleanPhone, PAIR_CODE);
          } catch {
            code = await sock.requestPairingCode(cleanPhone);
          }
          job.code = String(code || PAIR_CODE).toUpperCase();
          job.status = 'code';
          job.error = null;
        } catch (e) {
          job.status = 'error';
          job.error = e.message || 'Could not get pairing code. Use QR instead.';
        }
      }
    } catch (e) {
      job.status = 'error';
      job.error = e.message || 'Pair failed';
      try { sock?.end(undefined); } catch {}
    }
  })();

  return job;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// QR pair (no phone needed) — recommended
app.post('/api/pair/qr', async (req, res) => {
  try {
    const job = await startPairJob(null, 'qr');
    res.json({ id: job.id, status: job.status, mode: 'qr' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Code pair (DEADPOOL)
app.post('/api/pair', async (req, res) => {
  try {
    const phone = req.body.phone || req.body.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required for code pair' });
    const job = await startPairJob(phone, 'code');
    res.json({ id: job.id, status: job.status, mode: 'code' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job expired — start again' });
  res.json({
    id: job.id,
    status: job.status,
    mode: job.mode,
    code: job.code,
    qr: job.qrDataUrl,
    session: job.status === 'done' ? job.session : null,
    error: job.error,
    phone: job.phone
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, bot: config.BOT_NAME || 'Deadpool V7', code: PAIR_CODE });
});

app.listen(PORT, () => {
  console.log(`\n💀 Deadpool V7 Pair Dashboard`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📱 Code: ${PAIR_CODE} | QR supported\n`);
});
