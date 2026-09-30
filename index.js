/**
 * DEADPOOL V7.5 — full bot (single file)
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidNormalizedUser,
  getContentType,
  Browsers,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const config = require('./config');
const { downloadYouTube, sendAsMp3, sendAsVideo } = require('./downloader');
const { askAI, getLyrics, generateTextImage } = require('./apis');

// ==================== SUPPRESS NOISE ====================
const _SUPPRESS = ['Closing session','Closing open session','Failed to decrypt','Session error:','Bad MAC','Decrypted message with closed session','[LID]'];
const _match = (s) => typeof s === 'string' && _SUPPRESS.some(p => s.includes(p));
const _log = console.log.bind(console);
console.log = (...a) => { if (_match(a[0])) return; _log(...a); };
const _warn = console.warn.bind(console);
console.warn = (...a) => { if (_match(a[0])) return; _warn(...a); };

// ==================== UA POOL ====================
const _uaList = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
];
function nextUA() { return _uaList[Math.floor(Math.random() * _uaList.length)]; }

async function dlGet(url, extra = {}) {
  return axios.get(url, {
    timeout: extra.timeout || 45000,
    validateStatus: () => true,
    headers: { 'User-Agent': nextUA(), Accept: '*/*', ...(extra.headers || {}) },
    ...extra
  });
}

// ==================== PATHS ====================
const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const msgCache = new NodeCache({ stdTTL: 60 * 60 * 8, checkperiod: 120 });
let sock = null;

// ==================== LID → PHONE ====================
const _lidMap = new Map();
function cacheLidMapping(key, msg) {
  try {
    const p = key?.participant || msg?.key?.participant;
    const alt = key?.participantAlt || msg?.key?.participantAlt || msg?.key?.remoteJidAlt;
    if (p && String(p).includes('@lid') && alt && !String(alt).includes('@lid')) {
      const lidId = String(p).split('@')[0];
      const phone = String(alt).split('@')[0].split(':')[0];
      if (/^\d{6,15}$/.test(phone)) _lidMap.set(lidId, phone);
    }
    const rj = key?.remoteJid || msg?.key?.remoteJid;
    const rjAlt = key?.remoteJidAlt || msg?.key?.remoteJidAlt;
    if (rj && String(rj).includes('@lid') && rjAlt && !String(rjAlt).includes('@lid')) {
      const lidId = String(rj).split('@')[0];
      const phone = String(rjAlt).split('@')[0].split(':')[0];
      if (/^\d{6,15}$/.test(phone)) _lidMap.set(lidId, phone);
    }
  } catch {}
}

function jidToPhone(jid, msg) {
  if (!jid) return 'hidden';
  const raw = String(jid);
  const alt = msg?.key?.participantAlt || msg?.key?.remoteJidAlt || msg?.participantAlt || msg?.remoteJidAlt;
  if (alt && !String(alt).includes('@lid')) {
    const n = String(alt).split('@')[0].split(':')[0];
    if (/^\d{6,15}$/.test(n)) return n;
  }
  if (raw.includes('@lid')) {
    const mapped = _lidMap.get(raw.split('@')[0]);
    return mapped || 'hidden';
  }
  const n = raw.split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(n) ? n : 'hidden';
}

// ==================== DATA ====================
async function ensureData() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(USERS_FILE))) await fs.writeJson(USERS_FILE, []);
  if (!(await fs.pathExists(GROUPS_FILE))) await fs.writeJson(GROUPS_FILE, {});
}
async function loadUsers() { try { return await fs.readJson(USERS_FILE); } catch { return []; } }
async function saveUser(jid) {
  try {
    const users = await loadUsers();
    const id = jidNormalizedUser(jid);
    if (!users.includes(id)) { users.push(id); await fs.writeJson(USERS_FILE, users, { spaces: 2 }); }
  } catch {}
}
async function loadGroupSettings() { try { return await fs.readJson(GROUPS_FILE); } catch { return {}; } }
async function saveGroupSetting(gid, key, value) {
  const data = await loadGroupSettings();
  if (!data[gid]) data[gid] = {};
  data[gid][key] = value;
  await fs.writeJson(GROUPS_FILE, data, { spaces: 2 });
}
async function getGroupSetting(gid, key, def = false) {
  const data = await loadGroupSettings();
  return data?.[gid]?.[key] ?? def;
}

// ==================== EXPIRY ====================
const ACTIVATED_FILE = path.join(DATA_DIR, 'activated.json');
async function getActivatedAt() {
  if (config.BOT_ACTIVATED_AT) { const t = Date.parse(config.BOT_ACTIVATED_AT); if (!isNaN(t)) return t; }
  try { if (await fs.pathExists(ACTIVATED_FILE)) { const d = await fs.readJson(ACTIVATED_FILE); if (d.activatedAt) return d.activatedAt; } } catch {}
  const now = Date.now();
  await fs.ensureDir(DATA_DIR);
  await fs.writeJson(ACTIVATED_FILE, { activatedAt: now }, { spaces: 2 });
  return now;
}
async function isBotExpired() {
  if (config.BOT_EXPIRY_DATE) {
    const end = Date.parse(config.BOT_EXPIRY_DATE + 'T23:59:59');
    if (!isNaN(end) && Date.now() > end) return { expired: true, reason: 'date' };
  }
  if (config.BOT_EXPIRY_DAYS && config.BOT_EXPIRY_DAYS > 0) {
    const activated = await getActivatedAt();
    const end = activated + config.BOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > end) return { expired: true, reason: 'days', endsAt: end };
    return { expired: false, endsAt: end, activatedAt: activated };
  }
  return { expired: false };
}

// ==================== MENU BOX BUILDER ====================
function buildBox(emoji, title, lines, width = 24) {
  const titleText = emoji + '  ' + title;
  const titleLen = titleText.length;
  const dashTotal = Math.max(4, width - titleLen - 4);
  const leftD = Math.floor(dashTotal / 2);
  const rightD = dashTotal - leftD;
  const top = '┏' + '━'.repeat(leftD) + ' *' + titleText + '* ' + '━'.repeat(rightD) + '┓';
  const bottom = '┗' + '━'.repeat(width) + '┛';
  let out = top + '\n';
  for (const l of lines) out += '┃ ' + l + '\n';
  out += bottom;
  return out;
}

function buildMainMenu(pushName, userCount) {
  const name = pushName || 'User';
  const expInfo = (config.BOT_EXPIRY_DAYS > 0) ? (config.BOT_EXPIRY_DAYS + ' days') : (config.BOT_EXPIRY_DATE || 'Unlimited');
  const p = config.PREFIX;

  let menu = '';
  menu += '▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n';
  menu += '   💀 *' + config.BOT_NAME + '*\n';
  menu += '   👋 Hi *' + name + '*\n';
  menu += '   👥 Users: *' + (userCount || 0) + '*\n';
  menu += '   🎉 Active: *' + expInfo + '*\n';
  menu += '▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n\n';

  menu += buildBox('📥', 'DOWNLOADS', [
    p + 'play / song / video / yt',
    p + 'tiktok / ig / fb / twitter',
    p + 'lyrics <song>'
  ]) + '\n\n';

  menu += buildBox('🎨', 'STICKER', [
    p + 'sticker / s / toimg',
    p + 'attp <text> / tts <text>'
  ]) + '\n\n';

  menu += buildBox('🤖', 'AI', [
    p + 'gpt / ai / ask'
  ]) + '\n\n';

  menu += buildBox('👥', 'ADMIN', [
    p + 'promote / demote / kick',
    p + 'warn / mute / unmute',
    p + 'tagall / hidetag / tagadmins',
    p + 'antilink / antistatusmention',
    p + 'welcome / goodbye / grouplink',
    p + 'groupinfo / approve / left'
  ]) + '\n\n';

  menu += buildBox('👑', 'OWNER', [
    p + 'settings / mode / prefix',
    p + 'block / unblock / broadcast',
    p + 'setbotname / startmsg',
    p + 'autoview / autolike / autoreact',
    p + 'anticall / antidelete / antiviewonce'
  ]) + '\n\n';

  menu += buildBox('👾', 'ANIME', [
    p + 'waifu / neko / megumin'
  ]) + '\n\n';

  menu += buildBox('🖋️', 'TEXTMAKER', [
    p + 'neon / fire / glitch / ice',
    p + 'matrix / thunder / devil / sand',
    p + 'blackpink / metallic / light'
  ]) + '\n\n';

  menu += buildBox('🎭', 'FUN', [
    p + 'joke / meme / quote / fact',
    p + 'dice / slot / coinflip / 8ball'
  ]) + '\n\n';

  menu += buildBox('🔧', 'UTILITY', [
    p + 'translate / calc / weather',
    p + 'ping / uptime / owner'
  ]) + '\n\n';

  menu += '〽️  Powered by *Confronter* ©' + new Date().getFullYear();
  return menu;
}

function buildStartMessage() {
  const p = config.PREFIX || '.';
  let s = '';
  s += '┏━━━━━━━━━━━━━━━━━━━━━┓\n';
  s += '┃  💀  *DEADPOOL V7*\n';
  s += '┣━━━━━━━━━━━━━━━━━━━━━┫\n';
  s += '┃  ⚡ Prefix : ' + p + '\n';
  s += '┃  🌐 Mode   : ' + config.MODE + '\n';
  s += '┃  👑 By     : Confronter\n';
  s += '┗━━━━━━━━━━━━━━━━━━━━━┛\n\n';
  s += '✨ Bot is online. Type *' + p + 'menu*';
  return s;
}

// ==================== AUTH ====================
async function loadAuthState() {
  if (config.SESSION && config.SESSION.length > 10) {
    try {
      let raw = config.SESSION.trim();
      if (raw.toLowerCase().startsWith('deadpool~')) raw = raw.slice(raw.indexOf('~') + 1).trim();
      const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      await fs.ensureDir(AUTH_DIR);
      await fs.writeJson(path.join(AUTH_DIR, 'creds.json'), creds, { spaces: 2 });
      console.log('✅ Session loaded');
    } catch (e) { console.error('❌ Invalid SESSION:', e.message); }
  }
  return useMultiFileAuthState(AUTH_DIR);
}

// ==================== HELPERS ====================
function getOwnerJid() {
  if (!config.OWNER_NUMBER) return null;
  return jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net');
}
function digitsOnly(v) { return String(v || '').replace(/\D/g, ''); }
function isOwner(jid) {
  if (!jid) return false;
  const num = digitsOnly(jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  if (!num) return false;
  const owners = [];
  if (config.OWNER_NUMBER) owners.push(digitsOnly(config.OWNER_NUMBER));
  for (const d of (config.DEVELOPERS || [])) owners.push(digitsOnly(d));
  return owners.filter(Boolean).some(o => num === o || num.endsWith(o) || o.endsWith(num));
}
function isDeveloper(jid) {
  if (!jid) return false;
  const num = digitsOnly(jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  const list = (config.DEVELOPERS || []).map(digitsOnly).filter(Boolean);
  if (list.some(o => num === o || num.endsWith(o) || o.endsWith(num))) return true;
  if (config.OWNER_NUMBER) { const o = digitsOnly(config.OWNER_NUMBER); if (o && (num === o || num.endsWith(o) || o.endsWith(num))) return true; }
  return false;
}
function roastOwnerOnly() {
  const l = ['😂👉 *Owner only.* Crawl back under your rock.','🤣 *Not for you.* This is owner territory, clown.','💀 Nice try. *Owner only.* Stay in your lane.','💀 *Owner command.* You are not him. Sit down.','😹 *Denied.* Only the owner runs this.'];
  return l[Math.floor(Math.random() * l.length)];
}
function roastAdminOnly() {
  const l = ['😂 *Admin only.* You are not admin. Point and laugh 👉','🤣 Who gave *you* admin rights? Nobody. Sit.','💀 *Admins only.* Regular users stay quiet.','😹 Denied. Ask an admin… or dream about it.','💀 Not admin = not allowed. Simple.'];
  return l[Math.floor(Math.random() * l.length)];
}
function roastGroupOnly() { return '😂 *Group only.* This is not your DMs, lonely one.'; }
function isGroup(jid) { return jid?.endsWith('@g.us'); }

async function unwrapMessage(message) {
  if (!message) return null;
  let msg = message;
  for (let i = 0; i < 5; i++) {
    if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
    else if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
    else if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
    else if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
    else if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;
    else break;
  }
  return msg;
}

async function downloadMediaMsg(message) {
  try {
    let msg = await unwrapMessage(message);
    if (!msg) return null;
    let type = getContentType(msg);
    if (!type) { for (const t of ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage']) { if (msg[t]) { type = t; break; } } }
    if (!type) return null;
    const media = msg[type];
    if (!media) return null;
    let mediaType = type.replace('Message', '');
    const stream = await downloadContentFromMessage(media, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) return null;
    return { buffer, type, media, msg };
  } catch (e) { console.log('downloadMediaMsg:', e.message); return null; }
}

function randomEmoji(pool, fallback) {
  const f = fallback || ['👍','❤️','🔥','😂','🙏','💯','😍','🫡','🎉','✨','👏','🤝','😊','💪','✅','🤩'];
  const list = (pool && pool.length) ? pool : f;
  return list[Math.floor(Math.random() * list.length)] || '👍';
}
function statusLikeEmoji() { return randomEmoji(config.STATUS_LIKES); }
function msgReactEmoji() { return randomEmoji(config.REACT_EMOJIS); }
function cmdReactEmoji() { return randomEmoji(null, ['✅','⚡','🔥','💫','✨','🎯','👍','🤖','💜','🚀','⭐','👏','💯','🤩','🙌','😊']); }

async function reactToMessage(jid, key, emoji) {
  try { await sock.sendMessage(jid, { react: { text: emoji, key } }); return true; } catch { return false; }
}
function getMentioned(m) { return m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []; }
function getQuotedParticipant(m) { return m.message?.extendedTextMessage?.contextInfo?.participant || null; }
async function getGroupMeta(jid) { try { return await sock.groupMetadata(jid); } catch { return null; } }
async function isGroupAdmin(jid, participant) {
  const meta = await getGroupMeta(jid);
  if (!meta) return false;
  const p = meta.participants.find(x => x.id === participant || x.id.split('@')[0] === participant.split('@')[0]);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}
async function isBotAdmin(jid) {
  const botId = sock.user?.id;
  if (!botId) return false;
  return isGroupAdmin(jid, jidNormalizedUser(botId));
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function hasLink(text) {
  return /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi.test(text || '');
}
async function fetchBuffer(url, timeout = 90000) {
  const res = await dlGet(url, { responseType: 'arraybuffer', timeout, maxContentLength: 100 * 1024 * 1024 });
  if (res.status >= 400) throw new Error('HTTP ' + res.status);
  return Buffer.from(res.data);
}

// ==================== MAIN ====================
async function startBot() {
  await ensureData();
  console.log('\n╔══════════════════════════════════════╗');
  console.log(`║     ${config.BOT_NAME.padEnd(28)} ║`);
  console.log('╚══════════════════════════════════════╝\n');

  const { state, saveCreds } = await loadAuthState();
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: !config.SESSION,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    fireInitQueries: true,
    msgRetryCounterCache: new NodeCache(),
    getMessage: async (key) => {
      const c = msgCache.get(key.id);
      if (c?.message) return c.message;
      return undefined;
    }
  });

  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const result = await _origSend(jid, content, options);
    try {
      if (result?.key?.id && result?.message) {
        msgCache.set(result.key.id, { key: result.key, message: result.message, timestamp: Date.now() });
      }
    } catch {}
    return result;
  };

  sock.ev.on('creds.update', saveCreds);

  process.on('unhandledRejection', (err) => {
    const msg = String(err && err.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt') || msg.includes('No session')) return;
    console.log('unhandledRejection:', msg.slice(0, 200));
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      console.log(`✅ ${config.BOT_NAME} ONLINE`);
      console.log(`👤 Owner     : ${config.OWNER_NUMBER || 'not set'}`);
      console.log(`👁  AutoView  : ${config.AUTO_VIEW_STATUS}`);
      console.log(`❤️  AutoLike  : ${config.AUTO_LIKE_STATUS}`);
      console.log(`🗑  AntiDelete: ${config.ANTI_DELETE}`);
      console.log(`🔓 ViewOnce  : ${config.ANTI_VIEW_ONCE}`);
      console.log(`🌐 Mode      : ${config.MODE}`);
      console.log(`📞 AntiCall  : ${config.ANTI_CALL}`);
      console.log(`🔗 Antilink  : ${config.ANTILINK}\n`);
      try {
        if (config.PRESENCE === 'available') await sock.sendPresenceUpdate('available');
        else if (config.PRESENCE === 'composing') await sock.sendPresenceUpdate('composing');
        else if (config.PRESENCE === 'recording') await sock.sendPresenceUpdate('recording');
        else await sock.sendPresenceUpdate('unavailable');
      } catch {}
      try {
        const me = sock.user?.id;
        if (me) {
          const linkedJid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);
          await sock.sendMessage(linkedJid, { text: buildStartMessage() });
          console.log('📩 Start message sent', linkedJid);
        }
      } catch (e) { console.log('Start msg error:', e.message); }
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : 0;
      console.log(`Connection closed (${code})`);
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logged out.');
        await fs.remove(AUTH_DIR).catch(() => {});
        process.exit(1);
      }
      console.log('🔄 Reconnecting in 5s...');
      setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('call', async (calls) => {
    if (!config.ANTI_CALL) return;
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from);
          const callMsg = config.ANTI_CALL_MSG || 'Calls not allowed now.';
          try { await sock.sendMessage(call.from, { text: `📞 *${config.BOT_NAME}*\n\n${callMsg}` }); } catch {}
          const ownerJid = getOwnerJid();
          if (ownerJid) await sock.sendMessage(ownerJid, { text: `📞 *Anti-Call*\nRejected: ${call.from.split('@')[0]}` }).catch(() => {});
        } catch (e) { console.log('anticall:', e.message); }
      }
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update;
      const meta = await getGroupMeta(id);
      const groupName = meta?.subject || 'Group';
      for (const p of participants) {
        const mention = `@${p.split('@')[0]}`;
        if (action === 'add' && config.WELCOME) {
          let text = config.WELCOME_MSG.replace(/@user/gi, mention).replace(/@group/gi, groupName);
          await sock.sendMessage(id, { text, mentions: [p] });
        }
        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          let text = config.GOODBYE_MSG.replace(/@user/gi, mention).replace(/@group/gi, groupName);
          await sock.sendMessage(id, { text, mentions: [p] });
        }
      }
    } catch (e) { console.log('Welcome/Goodbye:', e.message); }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type && type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      handleMessage(m).catch(e => console.log('msg err:', e.message));
    }
  });

  async function handleMessage(m) {
    try {
      if (!m.message) return;
      if (m.key?.id) {
        cacheLidMapping(m.key, m);
        msgCache.set(m.key.id, {
          key: m.key,
          message: JSON.parse(JSON.stringify(m.message)),
          pushName: m.pushName,
          participant: m.key.participant || m.key.remoteJid,
          participantAlt: m.key.participantAlt || m.key.remoteJidAlt || null,
          remoteJid: m.key.remoteJid,
          timestamp: Date.now()
        });
      }

      const from = m.key.remoteJid;
      const sender = m.key.participant || m.key.remoteJid;
      const isMe = m.key.fromMe;

      if (!isMe && from && from !== 'status@broadcast') {
        try { await sock.readMessages([m.key]); } catch (e) {}
      }

      // ===== ANTI-DELETE (revoke) =====
      const proto = m.message?.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE' || proto.type === 1)) {
        try {
          if (config.ANTI_DELETE !== 'off' || config.ANTI_DELETE_STATUS) {
            const key = proto.key || m.key;
            const cached = key?.id ? msgCache.get(key.id) : null;
            if (cached?.message) {
              const fromJ = key.remoteJid || cached.remoteJid || m.key.remoteJid;
              const isStatus = fromJ === 'status@broadcast';
              if (isStatus && !config.ANTI_DELETE_STATUS) {}
              else if (!isStatus && config.ANTI_DELETE === 'off') {}
              else {
                const target = isStatus || config.ANTI_DELETE === 'pm' || config.ANTI_DELETE === 'private' ? getOwnerJid() : fromJ;
                if (target) {
                  let msg = cached.message;
                  if (msg?.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
                  if (msg?.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
                  if (msg?.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
                  const phone = jidToPhone(key.participant || cached.participant, { key: { participantAlt: cached.participantAlt } });
                  let bodyText = msg?.conversation || msg?.extendedTextMessage?.text || msg?.imageMessage?.caption || msg?.videoMessage?.caption || '';
                  const head = `✅ *${config.BOT_NAME} antiDelete*\n` +
                    `• Deleted by: +${String(phone).replace(/\D/g, '') || phone}\n` +
                    `• Chat: ${isStatus ? 'Status' : (String(fromJ).endsWith('@g.us') ? 'Group' : 'Private')}` +
                    (bodyText ? `\n\n📝 *Deleted Text:*\n${bodyText}` : '');
                  const dl = await downloadMediaMsg(msg);
                  if (dl?.buffer) {
                    if (dl.type === 'imageMessage' || msg.imageMessage) await sock.sendMessage(target, { image: dl.buffer, caption: head });
                    else if (dl.type === 'videoMessage' || msg.videoMessage) await sock.sendMessage(target, { video: dl.buffer, caption: head, mimetype: 'video/mp4' });
                    else if (dl.type === 'audioMessage' || msg.audioMessage) {
                      await sock.sendMessage(target, { audio: dl.buffer, mimetype: msg.audioMessage?.mimetype || 'audio/ogg; codecs=opus', ptt: !!msg.audioMessage?.ptt });
                      await sock.sendMessage(target, { text: head });
                    } else if (dl.type === 'stickerMessage' || msg.stickerMessage) {
                      await sock.sendMessage(target, { sticker: dl.buffer });
                      await sock.sendMessage(target, { text: head });
                    } else await sock.sendMessage(target, { text: head });
                  } else await sock.sendMessage(target, { text: head || '🗑 Message deleted' });
                }
              }
            }
          }
        } catch (e) { console.log('revoke:', e.message); }
        return;
      }

      if (!isMe && from && !from.endsWith('@g.us') && !from.includes('status')) await saveUser(sender);
      if (!isMe && from?.endsWith('@g.us')) await saveUser(sender);

      // ===== STATUS auto-view + auto-like =====
      if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
        if (isMe) return;
        const rawP = m.key.participant || m.participant || m.key.participantAlt || '';
        let poster = rawP;
        if (String(rawP).includes('@lid')) {
          const phone = jidToPhone(rawP, m);
          if (phone && phone !== 'hidden') poster = phone + '@s.whatsapp.net';
        }
        const statusKey = { remoteJid: 'status@broadcast', id: m.key.id, participant: poster || m.key.participant, fromMe: false };
        if (config.AUTO_VIEW_STATUS) sock.readMessages([statusKey]).catch(() => { sock.readMessages([m.key]).catch(() => {}); });
        if (config.AUTO_LIKE_STATUS) {
          const emoji = statusLikeEmoji();
          if (emoji) {
            const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const list = [...new Set([poster, rawP, botJid].filter(Boolean))];
            sock.sendMessage('status@broadcast', { react: { text: emoji, key: statusKey } }, { statusJidList: list })
              .catch(() => sock.sendMessage('status@broadcast', { react: { text: emoji, key: m.key } }, { statusJidList: list }).catch(() => {}));
          }
        }
        return;
      }

      // ===== ANTI VIEW-ONCE =====
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const contentType = getContentType(m.message);
        const isVO = ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension'].includes(contentType) ||
          !!m.message?.viewOnceMessage || !!m.message?.viewOnceMessageV2 || !!m.message?.viewOnceMessageV2Extension;
        if (isVO && !isMe) {
          try {
            const voMsg = m.message.viewOnceMessage?.message || m.message.viewOnceMessageV2?.message || m.message.viewOnceMessageV2Extension?.message || m.message;
            const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const target = (mode === 'pm' || mode === 'private') ? (getOwnerJid() || me || from) : from;
            let dl = await downloadMediaMsg(voMsg);
            if (!dl) dl = await downloadMediaMsg(m.message);
            const phone = jidToPhone(sender, m);
            const head = '🔓 *antiViewOnce*\n• From: +' + phone + '\n• Chat: ' + (isGroup(from) ? 'Group' : 'Private');
            if (dl?.buffer) {
              if (dl.type === 'imageMessage' || voMsg.imageMessage) await sock.sendMessage(target, { image: dl.buffer, caption: head });
              else if (dl.type === 'videoMessage' || voMsg.videoMessage) await sock.sendMessage(target, { video: dl.buffer, caption: head, mimetype: 'video/mp4' });
              else if (dl.type === 'audioMessage' || voMsg.audioMessage) {
                await sock.sendMessage(target, { audio: dl.buffer, mimetype: voMsg.audioMessage?.mimetype || 'audio/ogg; codecs=opus', ptt: !!voMsg.audioMessage?.ptt });
                await sock.sendMessage(target, { text: head });
              } else await sock.sendMessage(target, { document: dl.buffer, fileName: 'viewonce.bin', mimetype: 'application/octet-stream', caption: head });
            }
          } catch (e) { console.log('antiviewonce:', e.message); }
        }
      }

      const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';

      // ===== ANTI-STATUS-MENTION =====
      if (isGroup(from) && !isMe) {
        const ctx = m.message?.extendedTextMessage?.contextInfo || m.message?.imageMessage?.contextInfo || m.message?.videoMessage?.contextInfo;
        const isStatusReply = ctx?.remoteJid === 'status@broadcast';
        if (isStatusReply) {
          const enabled = await getGroupSetting(from, 'antistatusmention', false);
          if (enabled && !isOwner(sender)) {
            try {
              const amAdmin = await isGroupAdmin(from, sender);
              if (!amAdmin && await isBotAdmin(from)) {
                const action = await getGroupSetting(from, 'antistatusmention_action', 'remove');
                await sock.sendMessage(from, { delete: m.key }).catch(() => {});
                if (action === 'remove') {
                  await sock.groupParticipantsUpdate(from, [sender], 'remove');
                  await sock.sendMessage(from, { text: `👋 @${sender.split('@')[0]} removed for mentioning status.`, mentions: [sender] });
                } else {
                  await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} mentioning status is not allowed.`, mentions: [sender] });
                }
                return;
              }
            } catch (e) { console.log('antistatusmention:', e.message); }
          }
        }
      }

      // ===== AUTO-REACT =====
      if (config.AUTO_REACT && !isMe) {
        const isCmd = body && body.startsWith(config.PREFIX || '.');
        if (!isCmd) await reactToMessage(from, m.key, msgReactEmoji());
      }

      // ===== ANTILINK =====
      if (isGroup(from) && !isMe && (config.ANTILINK || (await getGroupSetting(from, 'antilink')))) {
        if (hasLink(body) && !(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
          try {
            if (await isBotAdmin(from)) {
              await sock.sendMessage(from, { delete: m.key }).catch(() => {});
              const action = config.ANTILINK_ACTION || 'delete';
              if (action === 'kick') {
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                await sock.sendMessage(from, { text: `🔗 Antilink: @${sender.split('@')[0]} removed.`, mentions: [sender] });
              } else {
                await sock.sendMessage(from, { text: `🔗 Antilink: @${sender.split('@')[0]} links not allowed.`, mentions: [sender] });
              }
            }
          } catch {}
          return;
        }
      }

      // ===== EXPIRY =====
      if (body && (body.startsWith(config.PREFIX) || /^[0-9]{1,2}$/.test(body.trim()))) {
        const exp = await isBotExpired();
        if (exp.expired) {
          const low = body.toLowerCase();
          const isExpiryCmd = low.includes('expiry') || low.includes('expire');
          if (!(isOwner(sender) && isExpiryCmd)) {
            const msg = isOwner(sender) ? ('⛔ *Bot expired*\n\nSet BOT_EXPIRY_DAYS and restart.') : (config.EXPIRY_MSG || '⛔ *Bot expired*');
            await sock.sendMessage(from, { text: msg });
            return;
          }
        }
      }

      const cleanBody = (body || '').trim();
      const prefix = config.PREFIX || '.';
      if (!cleanBody.startsWith(prefix)) return;
      if (config.MODE === 'private' && !isOwner(sender) && !isMe) return;

      const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
      const cmd = (args.shift() || '').toLowerCase();
      const text = args.join(' ');
      console.log('CMD:', cmd, 'from:', (sender || '').split('@')[0], 'chat:', from);
      reactToMessage(from, m.key, cmdReactEmoji()).catch(() => {});

      const reply = async (content) => {
        try {
          const foot = '\n\n—\n> *Powered by Confronter* ©' + new Date().getFullYear();
          if (typeof content === 'string') {
            const b = String(content).trim();
            if (!b) return;
            return await sock.sendMessage(from, { text: b + foot });
          }
          const payload = { ...content };
          if (payload.text != null && !String(payload.text).trim()) delete payload.text;
          if (payload.caption != null && !String(payload.caption).includes('Powered')) payload.caption = String(payload.caption) + foot;
          if (!payload.text && !payload.image && !payload.video && !payload.audio && !payload.document && !payload.sticker && !payload.react) return;
          return await sock.sendMessage(from, payload);
        } catch (e) { console.log('reply:', e.message); }
      };

      if (config.PRESENCE === 'composing') sock.sendPresenceUpdate('composing', from).catch(() => {});
      else if (config.PRESENCE === 'recording') sock.sendPresenceUpdate('recording', from).catch(() => {});
      else if (config.PRESENCE === 'available') sock.sendPresenceUpdate('available', from).catch(() => {});

      // ====== COMMANDS ======
      if (['menu', 'help', 'list'].includes(cmd)) {
        let userCount = 0;
        try { userCount = (await loadUsers()).length; } catch {}
        await reply(buildMainMenu(m.pushName, userCount));
        return;
      }

      if (cmd === 'ping') {
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const speed = Date.now() - t0;
        await reply(`⚡ *Pong!*\n> Speed: *${speed}ms*`);
        return;
      }

      if (cmd === 'alive') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), min = Math.floor((up % 3600) / 60), s = up % 60;
        await reply(`✅ *${config.BOT_NAME}* is alive\n⏱ ${h}h ${min}m ${s}s\n🌐 Mode: ${config.MODE}`);
        return;
      }

      if (cmd === 'uptime') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), min = Math.floor((up % 3600) / 60), s = up % 60;
        await reply(`⏱️ Uptime: *${h}h ${min}m ${s}s*`);
        return;
      }

      if (cmd === 'owner') {
        const o = config.OWNER_NUMBER || 'not set';
        await reply(`👑 *Owner*\nwa.me/${o}\n${config.DEV_LINK || ''}`);
        return;
      }

      if (['gpt', 'ai', 'ask', 'chatgpt', 'bot'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${config.PREFIX}gpt <question>`); return; }
        await reply('🤖 Thinking…');
        const answer = await askAI(text);
        if (answer) {
          const trimmed = answer.length > 3500 ? answer.slice(0, 3500) + '…' : answer;
          await reply(`🤖 *${config.BOT_NAME} AI*\n\n${trimmed}`);
        } else await reply('❌ AI is busy. Try again.');
        return;
      }

      if (cmd === 'lyrics' || cmd === 'lyric') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'lyrics <song>'); return; }
        await reply('⏳ Searching lyrics…');
        const data = await getLyrics(text);
        if (data?.lyrics) {
          let lyr = data.lyrics;
          if (lyr.length > 3500) lyr = lyr.slice(0, 3500) + '…';
          const head = `🎵 *${data.title}*` + (data.artist ? ` — ${data.artist}` : '');
          await reply(`${head}\n\n${lyr}`);
        } else await reply('❌ No lyrics found. Try "song name - artist".');
        return;
      }

      if (['play', 'song', 'ytmp3', 'music'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${config.PREFIX}play <song name>`); return; }
        await reply('⏳ Searching & downloading...');
        const data = await downloadYouTube(text, true);
        if (!data?.buffer) { await reply('❌ Could not find/download that track.'); return; }
        const ok = await sendAsMp3(sock, from, data);
        if (!ok) await reply('❌ Failed to send audio.');
        return;
      }

      if (['yt', 'youtube', 'ytmp4', 'video', 'ytv'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${config.PREFIX}video <url or search>`); return; }
        await reply('⏳ Downloading video...');
        const data = await downloadYouTube(text, false);
        if (!data?.buffer) { await reply('❌ Could not download video.'); return; }
        const ok = await sendAsVideo(sock, from, data);
        if (!ok) await reply('❌ Failed to send video.');
        return;
      }

      if (['tiktok', 'tt'].includes(cmd)) {
        if (!text || !text.includes('tiktok')) { await reply(`Usage: ${config.PREFIX}tiktok <url>`); return; }
        await reply('⏳ Downloading TikTok...');
        const endpoints = [
          `https://tikwm.com/api/?url=${encodeURIComponent(text)}`,
          `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(text)}`
        ];
        let data = null;
        for (const ep of endpoints) {
          try {
            const r = await dlGet(ep, { timeout: 40000 });
            const d = r?.data?.data || r?.data;
            const u = d?.play || d?.hdplay || d?.video || d?.url;
            if (u) { data = { url: u, title: d.title || 'TikTok' }; break; }
          } catch {}
        }
        if (!data) { await reply('❌ Could not download TikTok.'); return; }
        try {
          const buf = await fetchBuffer(data.url);
          await sock.sendMessage(from, { video: buf, caption: `🎵 ${data.title}`, mimetype: 'video/mp4' });
        } catch { await reply(`✅ ${data.url}`); }
        return;
      }

      if (['ig', 'instagram', 'insta'].includes(cmd)) {
        if (!text || !text.includes('instagram')) { await reply(`Usage: ${config.PREFIX}ig <url>`); return; }
        await reply('⏳ Downloading Instagram...');
        try {
          const r = await dlGet(`https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(text)}`, { timeout: 40000 });
          const arr = r?.data?.data || r?.data?.result || [];
          const first = Array.isArray(arr) ? arr[0] : null;
          const url = first?.url || first?.download_link || first;
          if (!url) { await reply('❌ Failed'); return; }
          const isVideo = String(url).includes('.mp4') || first?.type === 'video';
          if (isVideo) await sock.sendMessage(from, { video: { url: String(url) }, caption: '📸 Instagram' });
          else await sock.sendMessage(from, { image: { url: String(url) }, caption: '📸 Instagram' });
        } catch { await reply('❌ IG failed'); }
        return;
      }

      if (['facebook', 'fb'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'fb <url>'); return; }
        await reply('⏳ Downloading FB...');
        try {
          const r = await dlGet(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(text)}`, { timeout: 40000 });
          const d = r?.data?.data || r?.data?.result || r?.data;
          const url = d?.url || d?.video || d?.hd || d?.sd;
          if (url) {
            const buf = await fetchBuffer(url);
            await sock.sendMessage(from, { video: buf, caption: '📘 Facebook' });
          } else await reply('❌ Failed');
        } catch { await reply('❌ FB failed'); }
        return;
      }

      if (['twitter', 'x', 'twdl'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'twitter <url>'); return; }
        await reply('⏳ Downloading...');
        try {
          const r = await dlGet(`https://api.siputzx.my.id/api/d/twitter?url=${encodeURIComponent(text)}`, { timeout: 40000 });
          const d = r?.data?.data || r?.data?.result || r?.data;
          const url = d?.url || d?.video || d?.media;
          if (url) {
            const buf = await fetchBuffer(String(url));
            await sock.sendMessage(from, { video: buf, caption: '🐦 Twitter/X' });
          } else await reply('❌ Failed');
        } catch { await reply('❌ Twitter failed'); }
        return;
      }

      if (['sticker', 's', 'stiker'].includes(cmd)) {
        try {
          let mediaMsg = null;
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (quoted) mediaMsg = quoted;
          else if (m.message?.imageMessage || m.message?.videoMessage) mediaMsg = m.message;
          if (!mediaMsg) { await reply(`Reply to an image/video with ${config.PREFIX}sticker`); return; }
          const type = getContentType(mediaMsg);
          if (!['imageMessage','videoMessage','stickerMessage'].includes(type)) { await reply('Reply to *image* or *video*.'); return; }
          await reply('⏳ Creating sticker...');
          const dl = await downloadMediaMsg(mediaMsg);
          if (!dl?.buffer) { await reply('❌ Failed.'); return; }
          const sticker = new Sticker(dl.buffer, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 80 });
          await sock.sendMessage(from, { sticker: await sticker.toBuffer() });
        } catch (e) { await reply('❌ Sticker failed.'); }
        return;
      }

      if (['toimg', 'toimage', 'photo'].includes(cmd)) {
        try {
          const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted?.stickerMessage) { await reply(`Reply to a sticker with ${config.PREFIX}toimg`); return; }
          await reply('⏳ Converting...');
          const dl = await downloadMediaMsg(quoted);
          if (!dl?.buffer) { await reply('❌ Failed.'); return; }
          await sock.sendMessage(from, { image: dl.buffer, caption: `🖼️ by ${config.BOT_NAME}` });
        } catch { await reply('❌ Convert failed.'); }
        return;
      }

      const textFx = ['neon','fire','glitch','ice','matrix','thunder','devil','sand','blackpink','metallic','light','hacker','neon2','paper','luxury'];
      if (textFx.includes(cmd)) {
        const q = (text || '').trim() || (m.pushName || 'Deadpool');
        await reply('🎨 Creating *' + cmd + '*…');
        const buf = await generateTextImage(cmd, q);
        if (!buf) { await reply('❌ Effect failed, try again.'); return; }
        try {
          await sock.sendMessage(from, { image: buf, caption: `✨ *${cmd.toUpperCase()}* — ${q}` });
        } catch (e) { await reply('❌ Send failed: ' + e.message); }
        return;
      }

      if (cmd === 'joke') {
        try { const r = await dlGet('https://official-joke-api.appspot.com/random_joke', { timeout: 15000 }); await reply(`😂 *${r.data.setup}*\n\n_${r.data.punchline}_`); }
        catch { await reply('😂 Why did the bot go to therapy? Too many Bad MAC errors.'); }
        return;
      }
      if (cmd === 'meme') {
        try {
          const r = await dlGet('https://meme-api.com/gimme', { timeout: 15000 });
          if (r?.data?.url) { const b = await fetchBuffer(r.data.url); await sock.sendMessage(from, { image: b, caption: r.data.title || 'Meme' }); }
          else await reply('❌ No meme');
        } catch { await reply('❌ Meme failed'); }
        return;
      }
      if (cmd === 'quote') {
        try { const r = await dlGet('https://api.quotable.io/random', { timeout: 15000 }); await reply(`💬 *"${r.data.content}"*\n— ${r.data.author}`); }
        catch { await reply('💬 Stay hungry, stay foolish.'); }
        return;
      }
      if (cmd === 'fact') {
        try { const r = await dlGet('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 15000 }); await reply(`📌 *Fact*\n${r.data.text}`); }
        catch { await reply('📌 Water is wet.'); }
        return;
      }
      if (cmd === 'dice') { await reply(`🎲 You rolled: *${Math.floor(Math.random() * 6) + 1}*`); return; }
      if (cmd === 'slot') {
        const items = ['🍒','🍋','🔔','⭐','💎','7️⃣'];
        const a = items[Math.floor(Math.random()*items.length)];
        const b = items[Math.floor(Math.random()*items.length)];
        const c = items[Math.floor(Math.random()*items.length)];
        await reply(`🎰 *SLOT*\n\n${a} | ${b} | ${c}\n\n${a===b&&b===c?'🎉 JACKPOT!':'Try again!'}`);
        return;
      }
      if (cmd === 'coinflip') { await reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!'); return; }
      if (cmd === '8ball') {
        const a = ['Yes','No','Maybe','Ask again','Definitely','Never','Sure','I doubt it'];
        await reply(`🎱 ${a[Math.floor(Math.random()*a.length)]}`);
        return;
      }
      if (['gayrate','howgay','simprate','iqrate','rizzrate','toxicrate'].includes(cmd)) {
        const n = Math.floor(Math.random()*101);
        await reply(`📊 *${cmd}*\n@${(getMentioned(m)[0]||sender).split('@')[0]} → *${n}%*`);
        return;
      }
      if (cmd === 'ship') {
        const u = getMentioned(m);
        const a = u[0] || sender, b = u[1] || getOwnerJid() || sender;
        const n = Math.floor(Math.random()*101);
        await reply(`💕 Ship rate: *${n}%*\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}`);
        return;
      }

      if (cmd === 'calc' || cmd === 'calculate') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'calc 2+2*5'); return; }
        try {
          const safe = text.replace(/[^0-9+\-*/().%\s]/g, '');
          const result = Function('"use strict"; return (' + safe + ')')();
          await reply(`🧮 *${safe}* = *${result}*`);
        } catch { await reply('❌ Invalid expression'); }
        return;
      }
      if (cmd === 'translate' || cmd === 'tr') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'tr en|sw hello'); return; }
        try {
          let lang = 'en', q = text;
          const mtr = text.match(/^([a-z]{2})\|(.+)/i) || text.match(/^([a-z]{2})\s+(.+)/i);
          if (mtr) { lang = mtr[1]; q = mtr[2]; }
          const r = await dlGet(`https://api.siputzx.my.id/api/tools/translate?text=${encodeURIComponent(q)}&target=${lang}`, { timeout: 20000 });
          const out = r?.data?.data || r?.data?.result || r?.data?.translated || r?.data;
          await reply(`🌐 *Translate → ${lang}*\n${typeof out === 'string' ? out : JSON.stringify(out)}`);
        } catch { await reply('❌ Translate failed'); }
        return;
      }
      if (cmd === 'weather') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'weather Nairobi'); return; }
        try { const r = await dlGet(`https://wttr.in/${encodeURIComponent(text)}?format=3`, { timeout: 15000 }); await reply(`🌤️ ${String(r.data).trim()}`); }
        catch { await reply('❌ Weather unavailable'); }
        return;
      }

      const animeMap = { waifu:'waifu', neko:'neko', megumin:'megumin', shinobu:'shinobu', husbu:'waifu', loli:'neko', random:'waifu' };
      if (animeMap[cmd]) {
        try {
          await reply('⏳ Loading...');
          const cat = animeMap[cmd];
          let img = null;
          try { const r = await dlGet(`https://api.waifu.pics/sfw/${cat}`, { timeout: 20000 }); img = r?.data?.url; } catch {}
          if (!img) { try { const r = await dlGet(`https://nekos.life/api/v2/img/${cat === 'megumin' ? 'neko' : cat}`, { timeout: 15000 }); img = r?.data?.url; } catch {} }
          if (img) { const b = await fetchBuffer(img); await sock.sendMessage(from, { image: b, caption: `🌸 *${cmd}*` }); }
          else await reply('❌ Failed');
        } catch { await reply('❌ Anime failed'); }
        return;
      }

      const ownerCmds = ['mode','presence','anticall','autoview','autolike','prefix','settings','antidelete','antiviewonce','antibot','broadcast','bc','users','welcome','goodbye','autoreact','startmsg','sendstart','expiry'];
      if (ownerCmds.includes(cmd) && !isOwner(sender) && !isMe) { await reply(roastOwnerOnly()); return; }

      if (cmd === 'mode') {
        if (['public','private'].includes(args[0])) { config.MODE = args[0]; await reply(`✅ Mode → *${config.MODE}*`); }
        else await reply(`Current: *${config.MODE}*\nUsage: ${config.PREFIX}mode public/private`);
        return;
      }
      if (cmd === 'prefix') {
        if (!args[0]) { await reply(`Current: *${config.PREFIX}*`); return; }
        config.PREFIX = args[0].slice(0, 3);
        await reply(`✅ Prefix → *${config.PREFIX}*`);
        return;
      }
      if (cmd === 'presence') {
        const val = (args[0] || '').toLowerCase();
        const map = { available:'available', online:'available', composing:'composing', typing:'composing', recording:'recording', offline:'unavailable' };
        if (map[val]) { config.PRESENCE = map[val]; await reply(`✅ Presence → *${val}*`); }
        else await reply(`Usage: ${config.PREFIX}presence online/typing/recording/offline`);
        return;
      }
      if (cmd === 'autoview') {
        if (args[0] === 'on') { config.AUTO_VIEW_STATUS = true; await reply('✅ AutoView ON'); }
        else if (args[0] === 'off') { config.AUTO_VIEW_STATUS = false; await reply('❌ AutoView OFF'); }
        else await reply(`AutoView: *${config.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'autolike') {
        if (args[0] === 'on') { config.AUTO_LIKE_STATUS = true; await reply('✅ AutoLike ON'); }
        else if (args[0] === 'off') { config.AUTO_LIKE_STATUS = false; await reply('❌ AutoLike OFF'); }
        else await reply(`AutoLike: *${config.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'autoreact') {
        if (args[0] === 'on') { config.AUTO_REACT = true; await reply('✅ AutoReact ON'); }
        else if (args[0] === 'off') { config.AUTO_REACT = false; await reply('❌ AutoReact OFF'); }
        else await reply(`AutoReact: *${config.AUTO_REACT ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'anticall') {
        if (args[0] === 'on') { config.ANTI_CALL = true; await reply('✅ AntiCall ON'); }
        else if (args[0] === 'off') { config.ANTI_CALL = false; await reply('❌ AntiCall OFF'); }
        else await reply(`AntiCall: *${config.ANTI_CALL ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'antidelete') {
        const v = (args[0] || '').toLowerCase();
        if (['off','pm','chat'].includes(v)) { config.ANTI_DELETE = v; await reply(`✅ AntiDelete → *${v}*`); }
        else await reply(`AntiDelete: *${config.ANTI_DELETE}*`);
        return;
      }
      if (cmd === 'antiviewonce') {
        let v = (args[0] || '').toLowerCase();
        if (v === 'private') v = 'pm';
        if (['off','pm','chat'].includes(v)) { config.ANTI_VIEW_ONCE = v; await reply(`✅ AntiViewOnce → *${v}*`); }
        else await reply(`AntiViewOnce: *${config.ANTI_VIEW_ONCE}*`);
        return;
      }
      if (cmd === 'welcome') {
        if (args[0] === 'on') { config.WELCOME = true; await reply('✅ Welcome ON'); }
        else if (args[0] === 'off') { config.WELCOME = false; await reply('❌ Welcome OFF'); }
        else await reply(`Welcome: *${config.WELCOME ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'goodbye') {
        if (args[0] === 'on') { config.GOODBYE = true; await reply('✅ Goodbye ON'); }
        else if (args[0] === 'off') { config.GOODBYE = false; await reply('❌ Goodbye OFF'); }
        else await reply(`Goodbye: *${config.GOODBYE ? 'ON' : 'OFF'}*`);
        return;
      }
      if (cmd === 'users') {
        const users = await loadUsers();
        await reply(`👥 Users: *${users.length}*`);
        return;
      }
      if (cmd === 'settings') {
        const on = v => v ? '✅' : '❌';
        await reply(
          `⚙️ *SETTINGS*\n` +
          `• Prefix: ${config.PREFIX}\n` +
          `• Mode: ${config.MODE}\n` +
          `• Presence: ${config.PRESENCE}\n` +
          `• AutoView: ${on(config.AUTO_VIEW_STATUS)}\n` +
          `• AutoLike: ${on(config.AUTO_LIKE_STATUS)}\n` +
          `• AutoReact: ${on(config.AUTO_REACT)}\n` +
          `• AntiDelete: ${config.ANTI_DELETE}\n` +
          `• AntiViewOnce: ${config.ANTI_VIEW_ONCE}\n` +
          `• AntiCall: ${on(config.ANTI_CALL)}\n` +
          `• Antilink: ${on(config.ANTILINK)}\n` +
          `• Welcome: ${on(config.WELCOME)}\n` +
          `• Goodbye: ${on(config.GOODBYE)}`
        );
        return;
      }
      if (cmd === 'expiry') {
        const exp = await isBotExpired();
        await reply(`📋 *Expiry*\nStatus: *${exp.expired ? 'EXPIRED' : 'ACTIVE'}*`);
        return;
      }
      if (['broadcast','bc'].includes(cmd)) {
        if (!isDeveloper(sender)) return;
        const users = await loadUsers();
        if (!users.length) { await reply('No users.'); return; }
        let msgText = text;
        if (!msgText) { await reply(`Usage: ${config.PREFIX}bc <text>`); return; }
        if (msgText.toLowerCase() === 'start') msgText = buildStartMessage();
        await reply(`📢 Broadcasting to ${users.length}...`);
        let ok = 0, fail = 0;
        for (const jid of users) {
          try { await sock.sendMessage(jid, { text: msgText }); ok++; await delay(900); } catch { fail++; }
        }
        await reply(`✅ Done — OK: ${ok}, Fail: ${fail}`);
        return;
      }
      if (['block','unblock'].includes(cmd)) {
        if (!isOwner(sender)) { await reply(roastOwnerOnly()); return; }
        let jid = getMentioned(m)[0] || getQuotedParticipant(m);
        if (!jid && text) jid = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        if (!jid) { await reply('Tag user or give number'); return; }
        try { await sock.updateBlockStatus(jid, cmd === 'block' ? 'block' : 'unblock'); await reply(`✅ ${cmd}ed`); }
        catch (e) { await reply('❌ ' + e.message); }
        return;
      }
      if (cmd === 'setbotname') {
        if (!isOwner(sender)) { await reply(roastOwnerOnly()); return; }
        if (!text) { await reply('Usage: ' + config.PREFIX + 'setbotname Name'); return; }
        config.BOT_NAME = text;
        try { await sock.updateProfileName(text); } catch {}
        await reply('✅ Bot name → ' + text);
        return;
      }
      if (cmd === 'startmsg') {
        if (!text) { await reply(`Current start message:\n\n${buildStartMessage()}`); return; }
        config.START_MSG = text;
        await reply('✅ Updated');
        return;
      }

      if (!isGroup(from) && ['promote','demote','kick','left','approve','hidetag','tagall','antistatusmention'].includes(cmd)) {
        await reply(roastGroupOnly()); return;
      }

      if (cmd === 'antistatusmention') {
        if (!isGroup(from)) { await reply(roastGroupOnly()); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); return; }
        const v = (args[0] || '').toLowerCase();
        if (v === 'on') { await saveGroupSetting(from, 'antistatusmention', true); await reply('✅ Anti-status-mention *ENABLED*'); }
        else if (v === 'off') { await saveGroupSetting(from, 'antistatusmention', false); await reply('❌ Anti-status-mention *DISABLED*'); }
        else if (v === 'remove') { await saveGroupSetting(from, 'antistatusmention_action', 'remove'); await reply('✅ Action set to: *REMOVE*'); }
        else if (v === 'warn') { await saveGroupSetting(from, 'antistatusmention_action', 'warn'); await reply('✅ Action set to: *WARN*'); }
        else {
          const cur = await getGroupSetting(from, 'antistatusmention', false);
          const act = await getGroupSetting(from, 'antistatusmention_action', 'remove');
          await reply(`Anti-status-mention: *${cur ? 'ON' : 'OFF'}*\nAction: *${act.toUpperCase()}*\n\nUsage:\n${config.PREFIX}antistatusmention on/off\n${config.PREFIX}antistatusmention remove/warn`);
        }
        return;
      }

      if (['promote','demote','kick'].includes(cmd)) {
        if (!(await isBotAdmin(from))) { await reply('❌ Bot needs admin.'); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); return; }
        let users = getMentioned(m);
        if (!users.length) { const q = getQuotedParticipant(m); if (q) users = [q]; }
        if (!users.length) { await reply('Tag or reply to user'); return; }
        try {
          const action = cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove';
          await sock.groupParticipantsUpdate(from, users, action);
          await reply(`✅ ${cmd} done.`);
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      if (['hidetag','tagall','htag'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); return; }
        const meta = await getGroupMeta(from);
        if (!meta) return;
        const participants = meta.participants.map(p => p.id);
        await sock.sendMessage(from, { text: text || (cmd === 'tagall' ? '📢 Attention!' : '‏'), mentions: participants });
        return;
      }

      if (['mute','unmute'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); return; }
        if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); return; }
        try {
          await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
          await reply(cmd === 'mute' ? '🔇 Muted' : '🔊 Unmuted');
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      if (['delete','del'].includes(cmd)) {
        const ctx = m.message?.extendedTextMessage?.contextInfo;
        if (!ctx?.stanzaId) { await reply('Reply to message'); return; }
        try { await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: ctx.participant ? false : true, id: ctx.stanzaId, participant: ctx.participant } }); }
        catch { await reply('❌ Cannot delete'); }
        return;
      }

      if (cmd === 'grouplink' || cmd === 'invite') {
        if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); return; }
        try { const code = await sock.groupInviteCode(from); await reply(`🔗 https://chat.whatsapp.com/${code}`); }
        catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      if (cmd === 'groupinfo') {
        try {
          const meta = await getGroupMeta(from);
          const admins = (meta.participants || []).filter(p => p.admin).length;
          await reply(`👥 *${meta.subject}*\nMembers: ${meta.participants?.length || 0}\nAdmins: ${admins}`);
        } catch { await reply('❌ Failed'); }
        return;
      }

      if (cmd === 'left' || cmd === 'leave') {
        if (!isOwner(sender) && !(await isGroupAdmin(from, sender))) { await reply(roastAdminOnly()); return; }
        await reply('👋 Leaving...');
        await delay(600);
        await sock.groupLeave(from);
        return;
      }

      if (cmd === 'warn') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); return; }
        let users = getMentioned(m);
        if (!users.length) { const q = getQuotedParticipant(m); if (q) users = [q]; }
        if (!users.length) { await reply('Tag user'); return; }
        await sock.sendMessage(from, { text: `⚠️ *WARNING*\n@${users[0].split('@')[0]} warned.\nReason: ${text || 'None'}`, mentions: users });
        return;
      }

      if (cmd === 'tagadmins') {
        const meta = await getGroupMeta(from);
        const admins = (meta?.participants || []).filter(p => p.admin).map(p => p.id);
        if (!admins.length) { await reply('No admins'); return; }
        const tags = admins.map(a => '@' + a.split('@')[0]).join(' ');
        await sock.sendMessage(from, { text: `👑 *Admins*\n${tags}`, mentions: admins });
        return;
      }

      if (cmd === 'approve') {
        if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); return; }
        try {
          const pending = await sock.groupRequestParticipantsList(from);
          if (!pending?.length) { await reply('No pending.'); return; }
          const jids = pending.map(p => p.jid || p.id);
          await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
          await reply(`✅ Approved ${jids.length}`);
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      if (cmd === 'vv' || cmd === 'viewonce') {
        try {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage)) vo = quoted;
          if (!vo) vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
          if (!vo) { await reply('Reply to a view-once with ' + config.PREFIX + 'vv'); return; }
          const dl = await downloadMediaMsg(vo);
          if (!dl?.buffer) { await reply('❌ Failed'); return; }
          if (dl.type === 'imageMessage' || vo.imageMessage) await sock.sendMessage(from, { image: dl.buffer });
          else if (dl.type === 'videoMessage' || vo.videoMessage) await sock.sendMessage(from, { video: dl.buffer });
          else await sock.sendMessage(from, { document: dl.buffer, fileName: 'revealed.bin' });
        } catch (e) { await reply('❌ VV failed'); }
        return;
      }

      if (cmd === 'pinterest' || cmd === 'pin') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'pinterest query'); return; }
        try {
          const r = await dlGet(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(text)}`, { timeout: 25000 });
          const list = r?.data?.data || r?.data?.result || [];
          const first = Array.isArray(list) ? list[0] : null;
          const url = first?.url || first?.image;
          if (url) { const b = await fetchBuffer(url); await sock.sendMessage(from, { image: b, caption: '📌 ' + text }); }
          else await reply('❌ No results');
        } catch { await reply('❌ Failed'); }
        return;
      }

      if (cmd === 'attp') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'attp text'); return; }
        try {
          const url = `https://api.siputzx.my.id/api/m/attp?text=${encodeURIComponent(text.slice(0, 40))}`;
          const res = await dlGet(url, { timeout: 25000, responseType: 'arraybuffer' });
          let buf = null;
          if (res.data && res.data.byteLength > 100) buf = Buffer.from(res.data);
          if (buf) {
            const sticker = new Sticker(buf, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 80 });
            await sock.sendMessage(from, { sticker: await sticker.toBuffer() });
          } else await reply('❌ ATTP failed');
        } catch { await reply('❌ ATTP failed'); }
        return;
      }

      if (cmd === 'tts') {
        if (!text) { await reply('Usage: ' + config.PREFIX + 'tts hello'); return; }
        try {
          const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(text.slice(0, 200))}`;
          const buf = await fetchBuffer(url);
          await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
        } catch { await reply('❌ TTS failed'); }
        return;
      }

    } catch (err) {
      console.log('Handler:', err.message);
    }
  }

  // ==================== ANTI-DELETE (messages.update) ====================
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const isDeleted = u.update?.message === null || u.update?.messageStubType === 1 || u.update?.messageStubType === 2 || u.update?.messageStubType === 68;
        if (!isDeleted) continue;
        const key = u.key;
        if (!key?.id) continue;
        const cached = msgCache.get(key.id);
        if (!cached?.message) continue;
        const from = key.remoteJid;
        const isStatus = from === 'status@broadcast';
        if (isStatus && !config.ANTI_DELETE_STATUS) continue;
        if (!isStatus && config.ANTI_DELETE === 'off') continue;
        const sender = key.participant || cached.participant || key.remoteJid;
        const target = isStatus ? getOwnerJid() : (config.ANTI_DELETE === 'chat' ? from : getOwnerJid());
        if (!target) continue;
        let msg = cached.message;
        if (msg?.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
        if (msg?.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
        if (msg?.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
        let type = getContentType(msg) || '';
        if (!type) {
          if (msg?.imageMessage) type = 'imageMessage';
          else if (msg?.videoMessage) type = 'videoMessage';
          else if (msg?.audioMessage) type = 'audioMessage';
          else if (msg?.stickerMessage) type = 'stickerMessage';
          else if (msg?.documentMessage) type = 'documentMessage';
        }
        const phone = jidToPhone(sender, { key: { participantAlt: cached.participantAlt, remoteJidAlt: cached.participantAlt } });
        let groupName = 'Private';
        if (isGroup(from)) { try { const meta = await sock.groupMetadata(from); groupName = meta?.subject || 'Group'; } catch {} }
        let deletedText = '';
        if (type === 'conversation') deletedText = msg.conversation || '';
        else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
        else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
        else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
        else if (type === 'documentMessage') deletedText = msg.documentMessage?.caption || msg.documentMessage?.fileName || '';
        else if (type === 'stickerMessage') deletedText = '[Sticker]';
        else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice note]' : '[Audio]';
        else deletedText = type ? `[${type.replace('Message','')}]` : '[Message]';
        let caption = `✅ *${config.BOT_NAME} antiDelete*\n` +
          `• Deleted by: +${phone}\n` +
          `• Chat: ${isStatus ? 'Status' : (isGroup(from) ? 'Group: ' + groupName : 'Private')}\n`;
        if (deletedText && !deletedText.startsWith('[')) caption += `\n📝 *Deleted Text:*\n${deletedText}`;
        else if (deletedText) caption += `\n${deletedText}`;
        const mediaTypes = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };
        if (mediaTypes[type]) {
          try {
            const dl = await downloadMediaMsg(msg);
            if (dl?.buffer) {
              const mk = mediaTypes[type];
              const payload = { [mk]: dl.buffer };
              if (mk === 'image' || mk === 'video') { payload.caption = caption; payload.mimetype = type === 'videoMessage' ? 'video/mp4' : undefined; }
              else if (mk === 'audio') { payload.mimetype = 'audio/ogg; codecs=opus'; payload.ptt = !!msg.audioMessage?.ptt; }
              else if (mk === 'document') { payload.mimetype = msg.documentMessage?.mimetype || 'application/octet-stream'; payload.fileName = msg.documentMessage?.fileName || 'file'; payload.caption = caption; }
              await sock.sendMessage(target, payload);
              if (mk === 'sticker' || mk === 'audio') await sock.sendMessage(target, { text: caption });
              continue;
            }
          } catch (e) { console.log('antidelete media:', e.message); }
        }
        await sock.sendMessage(target, { text: caption });
      } catch (e) { console.log('antidelete:', e.message); }
    }
  });

  // ==================== ANTI-EDIT ====================
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        const protoMsg = m.message?.protocolMessage;
        if (protoMsg && (protoMsg.type === 14 || protoMsg.type === 'MESSAGE_EDIT' || protoMsg.editedMessage)) {
          if (!config.ANTI_EDIT || config.ANTI_EDIT === 'off') continue;
          const key = protoMsg.key || m.key;
          const cached = key?.id ? msgCache.get(key.id) : null;
          const edited = protoMsg.editedMessage || {};
          const newText = edited.conversation || edited.extendedTextMessage?.text || edited.imageMessage?.caption || edited.videoMessage?.caption || '';
          const oldText = cached?.message?.conversation || cached?.message?.extendedTextMessage?.text || cached?.message?.imageMessage?.caption || '[unknown]';
          const from = key?.remoteJid || m.key.remoteJid;
          const target = config.ANTI_EDIT === 'chat' ? from : getOwnerJid();
          if (!target) continue;
          const who = jidToPhone(key.participant || from, m);
          await sock.sendMessage(target, {
            text: `✅ *${config.BOT_NAME} antiEdit*\n• Edited by: +${who}\n• Chat: ${from?.endsWith('@g.us') ? 'Group' : 'Private'}\n\n📝 *Before:*\n${oldText}\n\n✏️ *After:*\n${newText || '[media/empty]'}`
          }).catch(() => {});
        }
      } catch {}
    }
  });
}

startBot().catch(e => { console.error('Fatal:', e); process.exit(1); });
process.on('uncaughtException', e => console.log('Uncaught:', e.message));
process.on('unhandledRejection', e => console.log('Unhandled:', e?.message || e));
