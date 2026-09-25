/**
 * Deadpool V7 - Web Pair Dashboard
 * Start: node server.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const pino = require('pino');
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
const PAIR_CODE = (config.PAIRING_CODE || 'DEADPOOL').toUpperCase().slice(0, 8);

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
    [DisconnectReason.connectionReplaced]: 'Connected elsewhere',
    [DisconnectReason.timedOut]: 'Timed out — enter code faster & try again',
    [DisconnectReason.loggedOut]: 'Session ended — click Get Pairing Code again',
    [DisconnectReason.badSession]: 'Bad session — try again',
    [DisconnectReason.restartRequired]: 'Restart required — try again',
    [DisconnectReason.multideviceMismatch]: 'Multi-device mismatch',
    405: 'Pairing not allowed — wait 1–2 min and retry',
    408: 'Timed out — try again',
    428: 'Connection closed — try again',
    440: 'Session conflict — try again',
    500: 'WhatsApp server error — try again',
    515: 'Restart required — try again'
  };
  return map[statusCode] || `Disconnected (${statusCode}) — try again`;
}

async function sendSessionToPM(sock, sessionId) {
  const me = sock.user?.id;
  if (!me) return false;
  const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : me;

  const caption =
    `╔══════════════════════╗\n` +
    `║  💀 *DEADPOOL V7 SESSION*\n` +
    `╚══════════════════════╝\n\n` +
    `✅ Pairing successful!\n\n` +
    `*Your SESSION ID:*\n` +
    `\`\`\`${sessionId}\`\`\`\n\n` +
    `📋 Long-press to copy.\n` +
    `👨‍💻 Developer: ${DEV_LINK}\n\n` +
    `_Keep this private._\n` +
    `Powered by ${config.POWERED_BY || 'Confronter'}`;

  await sock.sendMessage(jid, { text: caption });

  try {
    const buttonsMsg = {
      viewOnce: true,
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text: '🎯 *Quick actions*\n\nCopy Session • Share • Developer'
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
          text: config.BOT_NAME || 'Deadpool V7'
        }),
        header: proto.Message.InteractiveMessage.Header.create({
          title: '💀 Session Ready',
          hasMediaAttachment: false
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: [
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
                display_text: '👨‍💻 Developer',
                url: DEV_LINK,
                merchant_url: DEV_LINK
              })
            }
          ]
        })
      })
    };
    const msg = generateWAMessageFromContent(jid, buttonsMsg, { userJid: jid });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  } catch {
    await sock.sendMessage(jid, {
      text: `📋 *Copy Session*\n\`\`\`${sessionId}\`\`\`\n\n👨‍💻 ${DEV_LINK}`
    }).catch(() => {});
  }
  return true;
}

async function startPairJob(phone) {
  const id = jobId();
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10 || cleanPhone.length > 15) {
    throw new Error('Invalid phone number (use country code, e.g. 2547...)');
  }

  const AUTH_DIR = path.join(__dirname, 'auth_pair_web', id);
  await fs.remove(AUTH_DIR).catch(() => {});
  await fs.ensureDir(AUTH_DIR);

  const job = {
    id,
    phone: cleanPhone,
    status: 'starting',
    code: null,
    session: null,
    error: null
  };
  jobs.set(id, job);

  // auto cleanup job after 10 min
  setTimeout(() => {
    jobs.delete(id);
    fs.remove(AUTH_DIR).catch(() => {});
  }, 10 * 60 * 1000);

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

        // ignore QR path — we use pairing code only
        if (qr && job.status === 'starting') {
          // still waiting for requestPairingCode
        }

        if (connection === 'open') {
          job.status = 'connected';
          job.error = null;
          try {
            await new Promise((r) => setTimeout(r, 2500));
            const credsPath = path.join(AUTH_DIR, 'creds.json');
            if (!(await fs.pathExists(credsPath))) {
              job.status = 'error';
              job.error = 'Creds not saved — try again';
              return;
            }
            const creds = await fs.readJson(credsPath);
            const sessionData = Buffer.from(JSON.stringify(creds)).toString('base64');
            const sessionId = `deadpool~${sessionData}`;
            job.session = sessionId;
            job.status = 'done';
            job.error = null;

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

          // If we already showed a code, keep it visible and tell user to retry
          if (job.code && job.status === 'code') {
            // User may still be entering code — only error on hard logout after code was shown
            if (
              statusCode === DisconnectReason.loggedOut ||
              statusCode === 401 ||
              statusCode === 405
            ) {
              job.status = 'error';
              job.error = reasonText(statusCode);
            } else if (statusCode === DisconnectReason.timedOut || statusCode === 408) {
              job.status = 'error';
              job.error = 'Timed out. Open Linked Devices quickly and enter DEADPOOL, then try again.';
            } else {
              job.status = 'error';
              job.error = reasonText(statusCode);
            }
          } else if (job.status !== 'done') {
            job.status = 'error';
            job.error = reasonText(statusCode);
          }
        }
      });

      // Request pairing code
      if (!sock.authState.creds.registered) {
        // small delay helps on free hosts
        await new Promise((r) => setTimeout(r, 1500));

        let code;
        try {
          // Prefer fixed code DEADPOOL
          code = await sock.requestPairingCode(cleanPhone, PAIR_CODE);
        } catch (e1) {
          // Fallback: let WhatsApp generate code
          try {
            code = await sock.requestPairingCode(cleanPhone);
          } catch (e2) {
            job.status = 'error';
            job.error = e2.message || e1.message || 'Could not request pairing code';
            return;
          }
        }

        job.code = (code || PAIR_CODE).toUpperCase();
        job.status = 'code';
        job.error = null;
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

app.post('/api/pair', async (req, res) => {
  try {
    const phone = req.body.phone || req.body.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const job = await startPairJob(phone);
    res.json({
      id: job.id,
      status: job.status,
      message: 'Pairing started'
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job expired — click Get Pairing Code again' });
  res.json({
    id: job.id,
    status: job.status,
    code: job.code,
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
  console.log(`📱 Pair code: ${PAIR_CODE}\n`);
});
