/**
 * Deadpool V7 - Web Pair Dashboard
 * Start: node server.js  (or npm run pair:web)
 * Deploy as WEB dyno on Heroku / Web Service on Render
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
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;
const DEV_LINK = process.env.DEV_LINK || config.DEV_LINK || 'https://wa.me/254796283064';
const PAIR_CODE = config.PAIRING_CODE || 'DEADPOOL';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory pair jobs: id -> { status, code, session, error, phone }
const jobs = new Map();

function jobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    `📋 Long-press to copy, or use the buttons below.\n` +
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
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: '📤 Share',
                id: 'share_session'
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
      text: `📋 *Copy Session*\n\`\`\`${sessionId}\`\`\`\n\n👨‍💻 Developer\n${DEV_LINK}`
    }).catch(() => {});
  }

  sock.ev.on('messages.upsert', async (upsert) => {
    try {
      const m = upsert.messages?.[0];
      if (!m?.message || m.key.remoteJid !== jid) return;
      const text = String(
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        ''
      ).toLowerCase();
      if (text.includes('share')) {
        await sock.sendMessage(jid, {
          text: `📤 Forward the session message, or copy:\n\`\`\`${sessionId}\`\`\``
        });
      }
      if (text.includes('copy')) {
        await sock.sendMessage(jid, {
          text: `📋 *SESSION*\n\n\`\`\`${sessionId}\`\`\``
        });
      }
    } catch {}
  });

  return true;
}

async function startPairJob(phone) {
  const id = jobId();
  const cleanPhone = String(phone).replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) {
    throw new Error('Invalid phone number');
  }

  const AUTH_DIR = path.join(__dirname, 'auth_pair_web', id);
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

  (async () => {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['DeadpoolV7', 'Chrome', '120.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          job.status = 'connected';
          try {
            await new Promise((r) => setTimeout(r, 2000));
            const credsPath = path.join(AUTH_DIR, 'creds.json');
            const creds = await fs.readJson(credsPath);
            const sessionData = Buffer.from(JSON.stringify(creds)).toString('base64');
            const sessionId = `deadpool~${sessionData}`;
            job.session = sessionId;
            job.status = 'done';

            await sendSessionToPM(sock, sessionId).catch(() => {});

            // cleanup auth folder after a while
            setTimeout(() => fs.remove(AUTH_DIR).catch(() => {}), 60000);
            setTimeout(() => {
              try { sock.end(undefined); } catch {}
            }, 90000);
          } catch (e) {
            job.status = 'error';
            job.error = e.message;
          }
        }

        if (connection === 'close') {
          const code =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output?.statusCode
              : 0;
          if (job.status !== 'done') {
            if (code === DisconnectReason.loggedOut) {
              job.status = 'error';
              job.error = 'Logged out';
            }
          }
        }
      });

      if (!sock.authState.creds.registered) {
        job.status = 'code';
        const code = await sock.requestPairingCode(cleanPhone, PAIR_CODE);
        job.code = code;
      }
    } catch (e) {
      job.status = 'error';
      job.error = e.message || 'Pair failed';
    }
  })();

  return job;
}

// ---------- Routes ----------
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
      message: 'Pairing started. Enter the code on your phone.'
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
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
  res.json({ ok: true, bot: config.BOT_NAME || 'Deadpool V7' });
});

app.listen(PORT, () => {
  console.log(`\n💀 Deadpool V7 Pair Dashboard`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📱 Pair code: ${PAIR_CODE}\n`);
});
