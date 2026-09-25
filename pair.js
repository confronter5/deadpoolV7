/**
 * Deadpool V7 - Session Pairing
 * Run: npm run pair
 * Code: DEADPOOL
 * On success → session is sent to user's WhatsApp PM with buttons
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const { Boom } = require('@hapi/boom');
const config = require('./config');

const AUTH_DIR = path.join(__dirname, 'auth_info_pair');
const DEV_LINK = process.env.DEV_LINK || 'https://wa.me/254796283064';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((resolve) => rl.question(q, resolve));

async function sendSessionToPM(sock, sessionId) {
  const me = sock.user?.id;
  if (!me) return false;

  const jid = me.includes(':')
    ? me.split(':')[0] + '@s.whatsapp.net'
    : me;

  const caption =
    `╔══════════════════════╗\n` +
    `║  💀 *DEADPOOL V7 SESSION*\n` +
    `╚══════════════════════╝\n\n` +
    `✅ Pairing successful!\n\n` +
    `*Your SESSION ID:*\n` +
    `\`\`\`${sessionId}\`\`\`\n\n` +
    `📋 Tap *Copy Session* below or long-press the code to copy.\n` +
    `📤 Use *Share* to forward to your deploy chat.\n` +
    `👨‍💻 *Developer* for support.\n\n` +
    `_Keep this private. Anyone with this session can access your WhatsApp._\n\n` +
    `Powered by ${config.POWERED_BY || 'Confronter'}`;

  // 1) Main text with session (easy to long-press copy)
  await sock.sendMessage(jid, { text: caption });

  // 2) Interactive buttons (Android / some clients)
  try {
    const buttonsMsg = {
      viewOnce: true,
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text:
            '🎯 *Quick actions*\n\n' +
            '• Copy Session – get session again\n' +
            '• Share – share tips\n' +
            '• Developer – contact support'
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

    const msg = generateWAMessageFromContent(jid, buttonsMsg, {
      userJid: jid
    });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  } catch (e) {
    // Fallback classic buttons / plain links
    try {
      await sock.sendMessage(jid, {
        text:
          `📋 *Copy Session*\nReply: *.copy*\n\n` +
          `📤 *Share*\nForward the message above.\n\n` +
          `👨‍💻 *Developer*\n${DEV_LINK}`,
        footer: config.BOT_NAME || 'Deadpool V7'
      });
    } catch {}
  }

  // Listen once for quick replies
  const onMsg = async (upsert) => {
    try {
      const m = upsert.messages?.[0];
      if (!m?.message || m.key.remoteJid !== jid) return;
      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message?.buttonsResponseMessage?.selectedButtonId ||
        m.message?.templateButtonReplyMessage?.selectedId ||
        m.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        '';
      const t = String(text).toLowerCase();
      if (t.includes('share_session') || t === 'share' || t.includes('share')) {
        await sock.sendMessage(jid, {
          text:
            `📤 *Share your session*\n\n` +
            `1. Long-press the session message\n` +
            `2. Forward to your saved notes / deploy chat\n\n` +
            `Or copy this:\n\`\`\`${sessionId}\`\`\``
        });
      }
      if (t.includes('copy') || t === '.copy') {
        await sock.sendMessage(jid, {
          text: `📋 *SESSION (copy all)*\n\n\`\`\`${sessionId}\`\`\``
        });
      }
    } catch {}
  };
  sock.ev.on('messages.upsert', onMsg);

  return true;
}

async function startPairing() {
  console.log('\n========================================');
  console.log('   DEADPOOL V7 - SESSION GENERATOR');
  console.log('========================================\n');
  console.log('Pairing code: DEADPOOL');
  console.log('Session will be sent to your WhatsApp PM\n');

  if (fs.existsSync(AUTH_DIR)) {
    await fs.remove(AUTH_DIR);
  }

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

  let phoneNumber = '';

  if (!sock.authState.creds.registered) {
    const phone = await question('Enter WhatsApp number (country code, no +): ');
    phoneNumber = phone.replace(/[^0-9]/g, '');
    console.log('\n⏳ Requesting pairing code...');
    const code = await sock.requestPairingCode(phoneNumber, config.PAIRING_CODE || 'DEADPOOL');
    console.log('\n========================================');
    console.log(`📱 PAIRING CODE: ${code}`);
    console.log('========================================');
    console.log('\nPhone → Linked Devices → Link with phone number');
    console.log(`Enter: ${code}\n`);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log('\n✅ Connected! Building session & sending to your PM...\n');
      await new Promise((r) => setTimeout(r, 2500));

      try {
        const credsPath = path.join(AUTH_DIR, 'creds.json');
        if (!fs.existsSync(credsPath)) {
          console.log('❌ creds.json not found');
          process.exit(1);
        }
        const creds = await fs.readJson(credsPath);
        const sessionData = Buffer.from(JSON.stringify(creds)).toString('base64');
        const sessionId = `deadpool~${sessionData}`;

        await fs.writeFile(path.join(__dirname, 'session.txt'), sessionId);

        const ok = await sendSessionToPM(sock, sessionId);
        if (ok) {
          console.log('✅ Session sent to your WhatsApp PM');
          console.log('   Open WhatsApp → check message from yourself');
          console.log('   Buttons: Copy Session | Share | Developer\n');
        } else {
          console.log('⚠️ Could not send PM. Session saved to session.txt\n');
        }

        console.log('SESSION (also in session.txt):');
        console.log(sessionId.slice(0, 60) + '...\n');
        console.log('You can close this window after copying from WhatsApp.\n');

        // Keep alive briefly so button replies work
        setTimeout(() => process.exit(0), 120000);
      } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
      }
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : 0;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Try again.');
        process.exit(1);
      }
    }
  });
}

startPairing().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
