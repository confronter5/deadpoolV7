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
  const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : me;

  const site = process.env.SITE_URL || config.SITE_URL || 'https://deadpoolv7.onrender.com';
  const channel = process.env.CHANNEL_URL || config.CHANNEL_URL || '';
  const dev = process.env.DEV_LINK || DEV_LINK;

  await sock.sendMessage(jid, {
    text:
      `*${sessionId}*\n\n` +
      `✅ *Deadpool V7* linked successfully!\n` +
      `📋 Tap *Copy Session* or long-press the text.\n` +
      `⚠️ _Do not share this with anyone._`
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
      text: `📋 *SESSION*\n\`\`\`${sessionId}\`\`\`\n\n🔗 ${site}\n👨‍💻 ${dev}`
    }).catch(() => {});
  }
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
