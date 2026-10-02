const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason,
  fetchLatestBaileysVersion, downloadContentFromMessage, jidNormalizedUser,
  getContentType, Browsers, makeCacheableSignalKeyStore
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

// ============ NOISE SUPPRESS ============
const SUPPRESS = ['Closing session','Closing open session','Failed to decrypt','Session error:','Bad MAC','Decrypted message with closed session','[LID]'];
const _match = s => typeof s === 'string' && SUPPRESS.some(p => s.includes(p));
const _log = console.log.bind(console);
console.log = (...a) => { if (_match(a[0])) return; _log(...a); };

// ============ HELPERS ============
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36';
async function dlGet(url, e = {}) {
  return axios.get(url, { timeout: e.timeout || 45000, validateStatus: () => true,
    headers: { 'User-Agent': UA, Accept: '*/*', ...(e.headers || {}) }, ...e });
}
async function fetchBuffer(url, t = 90000) {
  const r = await dlGet(url, { responseType: 'arraybuffer', timeout: t, maxContentLength: 100 * 1024 * 1024 });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return Buffer.from(r.data);
}
const delay = ms => new Promise(r => setTimeout(r, ms));

// ============ PATHS ============
const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const msgCache = new NodeCache({ stdTTL: 60 * 60 * 8, checkperiod: 120 });
let sock = null;
const _lidMap = new Map();

// ============ LID CACHE ============
function cacheLid(key, msg) {
  try {
    const p = key?.participant || msg?.key?.participant;
    const alt = key?.participantAlt || msg?.key?.participantAlt || msg?.key?.remoteJidAlt;
    if (p && String(p).includes('@lid') && alt && !String(alt).includes('@lid')) {
      const phone = String(alt).split('@')[0].split(':')[0];
      if (/^\d{6,15}$/.test(phone)) _lidMap.set(String(p).split('@')[0], phone);
    }
  } catch {}
}
function jidToPhone(jid, msg) {
  if (!jid) return 'hidden';
  const raw = String(jid);
  const alt = msg?.key?.participantAlt || msg?.key?.remoteJidAlt;
  if (alt && !String(alt).includes('@lid')) {
    const n = String(alt).split('@')[0].split(':')[0];
    if (/^\d{6,15}$/.test(n)) return n;
  }
  if (raw.includes('@lid')) return _lidMap.get(raw.split('@')[0]) || 'hidden';
  const n = raw.split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(n) ? n : 'hidden';
}

// ============ DATA ============
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
async function loadGroups() { try { return await fs.readJson(GROUPS_FILE); } catch { return {}; } }
async function saveGroup(gid, k, v) {
  const d = await loadGroups();
  if (!d[gid]) d[gid] = {};
  d[gid][k] = v;
  await fs.writeJson(GROUPS_FILE, d, { spaces: 2 });
}
async function getGroup(gid, k, def = false) {
  const d = await loadGroups();
  return d?.[gid]?.[k] ?? def;
}

// ============ ROASTS ============
const ROASTS = {
  owner: ['🧠 *Owner only.* Confidence is not a substitute for credentials.','📜 *Owner command.* Your ego signed a cheque your rank cannot cash.','🎭 *Denied.* The audacity arrived long before the authority did.'],
  admin: ['🪪 *Admins only.* Rank is earned — not borrowed from wishful thinking.','📎 *Denied.* Your badge is imaginary and so is the authority.','🎩 *Admins only.* You arrived without a title and left without a clue.'],
  group: ['🏛️ *Group only.* Private chat is not a committee of one.','📎 *Group only.* This command lives in a room you are not standing in.']
};
const roast = k => ROASTS[k][Math.floor(Math.random() * ROASTS[k].length)];

// ============ FOOTER ============
function buildFooter() {
  const y = new Date().getFullYear();
  const p = (config.POWERED_BY || 'Powered by Confronter').replace(/©?\d{4}/g, '').trim();
  return '\n\n—\n> *' + p + ' ©' + y + '*';
}

// ============ COMPACT MENU ============
function buildMainMenu(pushName, userCount) {
  const p = config.PREFIX;
  const line = '▬▬▬▬▬▬▬▬▬▬▬▬▬';
  let m = '';
  m += line + '\n';
  m += `💀 *${config.BOT_NAME}*\n`;
  m += `👋 *${pushName || 'User'}*  •  👥 ${userCount || 0}\n`;
  m += line + '\n';

  const sec = (icon, title, cmds) => `╭─ ${icon} *${title}*\n` + cmds.map(c => '│ ' + c).join('\n') + '\n╰─────────────\n';
  m += sec('📥', 'DOWNLOADS', [
    p + 'play / song / video / yt',
    p + 'tiktok / ig / lyrics <song>'
  ]);
  m += sec('🎨', 'STICKER', [
    p + 'sticker / s / toimg / attp'
  ]);
  m += sec('🤖', 'AI', [
    p + 'gpt / ai / ask'
  ]);
  m += sec('👥', 'ADMIN', [
    p + 'promote / demote / kick / warn',
    p + 'mute / unmute / tagall / hidetag',
    p + 'antilink / antistatusmention',
    p + 'welcome / goodbye / grouplink / left'
  ]);
  m += sec('👑', 'OWNER', [
    p + 'mode / prefix / settings / users',
    p + 'broadcast / block / unblock',
    p + 'autoview / autolike / autoreact',
    p + 'antidelete / antiedit / antiviewonce',
    p + 'presence <typing|recording|online|offline>'
  ]);
  m += sec('🖋️', 'TEXTMAKER', [
    p + 'neon / fire / glitch / ice / matrix',
    p + 'thunder / devil / sand / metallic',
    p + 'blackpink / light / hacker / luxury'
  ]);
  m += sec('🎭', 'FUN', [
    p + 'joke / quote / dice / 8ball / coinflip'
  ]);
  m += sec('🔧', 'UTILITY', [
    p + 'lyrics / translate / calc / weather / ping'
  ]);
  m += '〽️ *Made by Confronter* ©' + new Date().getFullYear();
  return m;
}

// ============ COMPACT START MESSAGE ============
function buildStartMessage() {
  const p = config.PREFIX || '.';
  return `💀 *${config.BOT_NAME}* is online\n` +
         `⚡ Prefix: *${p}*  •  🌐 Mode: *${config.MODE}*\n` +
         `👑 By: *Confronter*\n\n` +
         `✨ Type *${p}menu* to begin`;
}

// ============ AUTH ============
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

// ============ HELPERS ============
const dig = v => String(v || '').replace(/\D/g, '');
const isGroup = j => j?.endsWith('@g.us');
function getOwnerJid() { return config.OWNER_NUMBER ? jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net') : null; }
function isOwner(jid) {
  if (!jid) return false;
  const num = dig(jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  if (!num) return false;
  const list = [config.OWNER_NUMBER, ...(config.DEVELOPERS || [])].map(dig).filter(Boolean);
  return list.some(o => num === o || num.endsWith(o) || o.endsWith(num));
}
const isDeveloper = isOwner;
function randEmoji(pool, fb) {
  const list = (pool && pool.length) ? pool : (fb || ['👍','❤️','🔥','😂','🙏','💯','😍']);
  return list[Math.floor(Math.random() * list.length)] || '👍';
}
const statusLikeEmoji = () => randEmoji(config.STATUS_LIKES);
const msgReactEmoji = () => randEmoji(config.REACT_EMOJIS);
const cmdReactEmoji = () => randEmoji(null, ['✅','⚡','🔥','💫','✨','🎯','👍','🤖','💜','🚀','⭐']);
async function react(jid, key, emoji) { try { await sock.sendMessage(jid, { react: { text: emoji, key } }); } catch {} }
function getMentioned(m) { return m.message?.extendedTextMessage?.contextInfo?.mentionedJid || []; }
function getQuoted(m) { return m.message?.extendedTextMessage?.contextInfo?.participant || null; }
async function getMeta(jid) { try { return await sock.groupMetadata(jid); } catch { return null; } }
async function isGroupAdmin(jid, p) {
  const meta = await getMeta(jid);
  if (!meta) return false;
  const x = meta.participants.find(y => y.id === p || y.id.split('@')[0] === p.split('@')[0]);
  return x?.admin === 'admin' || x?.admin === 'superadmin';
}
async function isBotAdmin(jid) {
  const b = sock.user?.id; if (!b) return false;
  return isGroupAdmin(jid, jidNormalizedUser(b));
}
function hasLink(t) { return /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi.test(t || ''); }

// ============ MEDIA DOWN ============
async function downloadMediaMsg(message) {
  try {
    let msg = message;
    for (let i = 0; i < 5; i++) {
      if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
      else if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
      else if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
      else if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
      else break;
    }
    let type = getContentType(msg);
    if (!type) for (const t of ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage']) if (msg[t]) { type = t; break; }
    if (!type) return null;
    const stream = await downloadContentFromMessage(msg[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) return null;
    return { buffer, type, msg };
  } catch (e) { return null; }
}

// ============ PRESENCE MAP ============
function presenceMap(v) {
  v = String(v || '').toLowerCase();
  if (v === 'typing' || v === 'composing' || v === 'type') return 'composing';
  if (v === 'recording' || v === 'record' || v === 'rec') return 'recording';
  if (v === 'online' || v === 'available' || v === 'on') return 'available';
  if (v === 'offline' || v === 'unavailable' || v === 'off') return 'unavailable';
  return null;
}

// ============ ANTI-DELETE FORWARD ============
async function forwardDelete(key, cached) {
  try {
    const from = key.remoteJid;
    const isStatus = from === 'status@broadcast';
    if (isStatus && !config.ANTI_DELETE_STATUS) return;
    if (!isStatus && config.ANTI_DELETE === 'off') return;
    const target = isStatus ? getOwnerJid() : (config.ANTI_DELETE === 'chat' ? from : getOwnerJid());
    if (!target) return;

    let msg = cached.message;
    if (msg?.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
    if (msg?.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
    if (msg?.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
    let type = getContentType(msg) || '';
    if (!type) for (const t of ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage']) if (msg[t]) { type = t; break; }

    const phone = jidToPhone(key.participant || cached.participant, cached);
    let deletedText = '';
    if (type === 'conversation') deletedText = msg.conversation || '';
    else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
    else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
    else if (type === 'documentMessage') deletedText = msg.documentMessage?.fileName || '';
    else if (type === 'stickerMessage') deletedText = '[Sticker]';
    else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice]' : '[Audio]';

    let groupName = 'Private';
    if (isGroup(from)) { try { groupName = (await sock.groupMetadata(from))?.subject || 'Group'; } catch {} }

    let cap = `✅ *${config.BOT_NAME} antiDelete*\n`;
    cap += `• Deleted by: +${phone}\n`;
    cap += `• Chat: ${isStatus ? 'Status' : (isGroup(from) ? 'Group: ' + groupName : 'Private')}\n`;
    if (deletedText && !deletedText.startsWith('[')) cap += `\n📝 *Deleted Text:*\n${deletedText}`;
    else if (deletedText) cap += `\n${deletedText}`;

    const media = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };
    if (media[type]) {
      const dl = await downloadMediaMsg(msg);
      if (dl?.buffer) {
        const mk = media[type];
        const payload = { [mk]: dl.buffer };
        if (mk === 'image' || mk === 'video') { payload.caption = cap; payload.mimetype = type === 'videoMessage' ? 'video/mp4' : undefined; }
        else if (mk === 'audio') { payload.mimetype = 'audio/ogg; codecs=opus'; payload.ptt = !!msg.audioMessage?.ptt; }
        else if (mk === 'document') { payload.mimetype = msg.documentMessage?.mimetype || 'application/octet-stream'; payload.fileName = msg.documentMessage?.fileName || 'file'; payload.caption = cap; }
        await sock.sendMessage(target, payload);
        if (mk === 'sticker' || mk === 'audio') await sock.sendMessage(target, { text: cap });
        return;
      }
    }
    await sock.sendMessage(target, { text: cap });
  } catch (e) { console.log('antiDelete:', e.message); }
}

// ============ MAIN BOT ============
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
    getMessage: async (key) => { const c = msgCache.get(key.id); return c?.message; }
  });

  // Cache outgoing to prevent "Waiting for this message"
  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const r = await _origSend(jid, content, options);
    try {
      if (r?.key?.id && r?.message) msgCache.set(r.key.id, { key: r.key, message: r.message, timestamp: Date.now() });
    } catch {}
    return r;
  };

  sock.ev.on('creds.update', saveCreds);
  process.on('unhandledRejection', err => {
    const m = String(err?.message || err || '');
    if (_match(m)) return;
    console.log('unhandledRejection:', m.slice(0, 200));
  });

  // ============ CONNECTION ============
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      console.log(`✅ ${config.BOT_NAME} ONLINE`);
      console.log(`👤 Owner     : ${config.OWNER_NUMBER}`);
      console.log(`👁  AutoView  : ${config.AUTO_VIEW_STATUS}`);
      console.log(`❤️  AutoLike  : ${config.AUTO_LIKE_STATUS}`);
      console.log(`🗑  AntiDelete: ${config.ANTI_DELETE}`);
      console.log(`✏️  AntiEdit  : ${config.ANTI_EDIT}`);
      console.log(`🔓 ViewOnce  : ${config.ANTI_VIEW_ONCE}`);
      console.log(`🌐 Mode      : ${config.MODE}\n`);
      try {
        const pm = presenceMap(config.PRESENCE);
        if (pm) await sock.sendPresenceUpdate(pm);
      } catch {}
      try {
        const me = sock.user?.id;
        if (me) {
          const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);
          await sock.sendMessage(jid, { text: buildStartMessage() });
          console.log('📩 Start message sent');
        }
      } catch (e) { console.log('Start msg error:', e.message); }
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : 0;
      console.log(`Connection closed (${code})`);
      if (code === DisconnectReason.loggedOut) {
        await fs.remove(AUTH_DIR).catch(() => {});
        process.exit(1);
      }
      console.log('🔄 Reconnecting in 5s...');
      setTimeout(startBot, 5000);
    }
  });

  // ============ ANTICALL ============
  sock.ev.on('call', async (calls) => {
    if (!config.ANTI_CALL) return;
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, { text: `📞 *${config.BOT_NAME}*\n\n${config.ANTI_CALL_MSG || 'Calls not allowed now.'}` }).catch(() => {});
        } catch {}
      }
    }
  });

  // ============ WELCOME / GOODBYE ============
  sock.ev.on('group-participants.update', async (u) => {
    try {
      const { id, participants, action } = u;
      const meta = await getMeta(id);
      const gname = meta?.subject || 'Group';
      for (const p of participants) {
        const mention = '@' + p.split('@')[0];
        if (action === 'add' && config.WELCOME) {
          await sock.sendMessage(id, { text: config.WELCOME_MSG.replace(/@user/gi, mention).replace(/@group/gi, gname), mentions: [p] });
        }
        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          await sock.sendMessage(id, { text: config.GOODBYE_MSG.replace(/@user/gi, mention).replace(/@group/gi, gname), mentions: [p] });
        }
      }
    } catch {}
  });

  // ============ MESSAGES ============
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type && type !== 'notify' && type !== 'append') return;
    for (const m of messages) handleMessage(m).catch(e => console.log('msg err:', e.message));
  });

  async function handleMessage(m) {
    try {
      if (!m.message) return;
      if (m.key?.id) {
        cacheLid(m.key, m);
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

      // Blue ticks
      if (!isMe && from && from !== 'status@broadcast') { try { await sock.readMessages([m.key]); } catch {} }

      // ===== ANTI-DELETE =====
      const proto = m.message?.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE' || proto.type === 1)) {
        const key = proto.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) await forwardDelete(key, cached);
        return;
      }

      // ===== ANTI-EDIT =====
      if (proto && (proto.type === 14 || proto.type === 'MESSAGE_EDIT' || proto.editedMessage)) {
        if (config.ANTI_EDIT && config.ANTI_EDIT !== 'off') {
          try {
            const key = proto.key || m.key;
            const cached = key?.id ? msgCache.get(key.id) : null;
            const edited = proto.editedMessage || {};
            const newText = edited.conversation || edited.extendedTextMessage?.text || '';
            const oldText = cached?.message?.conversation || cached?.message?.extendedTextMessage?.text || '[unknown]';
            const target = config.ANTI_EDIT === 'chat' ? from : getOwnerJid();
            if (target) {
              const who = jidToPhone(key.participant || from, m);
              await sock.sendMessage(target, {
                text: `✅ *${config.BOT_NAME} antiEdit*\n• Edited by: +${who}\n• Chat: ${isGroup(from) ? 'Group' : 'Private'}\n\n📝 *Before:*\n${oldText}\n\n✏️ *After:*\n${newText || '[media]'}`
              }).catch(() => {});
            }
          } catch {}
        }
        return;
      }

      if (!isMe && from && !from.includes('status')) await saveUser(sender).catch(() => {});

      // ===== STATUS =====
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

      // ===== ANTI-VIEW-ONCE =====
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const ct = getContentType(m.message);
        const isVO = ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension'].includes(ct)
          || !!m.message?.viewOnceMessage || !!m.message?.viewOnceMessageV2;
        if (isVO && !isMe) {
          try {
            const voMsg = m.message.viewOnceMessage?.message || m.message.viewOnceMessageV2?.message || m.message.viewOnceMessageV2Extension?.message || m.message;
            const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const target = (mode === 'pm' || mode === 'private') ? (getOwnerJid() || me || from) : from;
            let dl = await downloadMediaMsg(voMsg);
            if (!dl) dl = await downloadMediaMsg(m.message);
            const phone = jidToPhone(sender, m);
            const head = `🔓 *antiViewOnce*\n• From: +${phone}\n• Chat: ${isGroup(from) ? 'Group' : 'Private'}`;
            if (dl?.buffer) {
              if (dl.type === 'imageMessage') await sock.sendMessage(target, { image: dl.buffer, caption: head });
              else if (dl.type === 'videoMessage') await sock.sendMessage(target, { video: dl.buffer, caption: head, mimetype: 'video/mp4' });
              else if (dl.type === 'audioMessage') {
                await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                await sock.sendMessage(target, { text: head });
              } else await sock.sendMessage(target, { document: dl.buffer, fileName: 'vo.bin', caption: head });
            }
          } catch {}
        }
      }

      const body = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';

      // ===== AUTO-REACT =====
      if (config.AUTO_REACT && !isMe) {
        const isCmd = body && body.startsWith(config.PREFIX || '.');
        if (!isCmd) react(from, m.key, msgReactEmoji());
      }

      // ===== ANTILINK =====
      if (isGroup(from) && !isMe && (config.ANTILINK || (await getGroup(from, 'antilink')))) {
        if (hasLink(body) && !(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
          try {
            if (await isBotAdmin(from)) {
              await sock.sendMessage(from, { delete: m.key }).catch(() => {});
              await sock.sendMessage(from, { text: `🔗 Antilink: @${sender.split('@')[0]} links not allowed.`, mentions: [sender] });
            }
          } catch {}
          return;
        }
      }

      const cleanBody = (body || '').trim();
      const prefix = config.PREFIX || '.';
      if (!cleanBody.startsWith(prefix)) return;
      if (config.MODE === 'private' && !isOwner(sender) && !isMe) return;

      const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
      const cmd = (args.shift() || '').toLowerCase();
      const text = args.join(' ');
      console.log('CMD:', cmd, 'from:', (sender || '').split('@')[0]);
      react(from, m.key, cmdReactEmoji());

      const reply = async (content) => {
        try {
          const foot = buildFooter();
          if (typeof content === 'string') {
            const b = String(content).trim();
            if (!b) return;
            return await sock.sendMessage(from, { text: b + foot });
          }
          const payload = { ...content };
          if (payload.text != null && !String(payload.text).trim()) delete payload.text;
          if (payload.caption != null && foot && !String(payload.caption).includes('Powered')) payload.caption = String(payload.caption) + foot;
          if (!payload.text && !payload.image && !payload.video && !payload.audio && !payload.document && !payload.sticker && !payload.react) return;
          return await sock.sendMessage(from, payload);
        } catch (e) { console.log('reply:', e.message); }
      };

      const pm = presenceMap(config.PRESENCE);
      if (pm) sock.sendPresenceUpdate(pm, from).catch(() => {});

      // ========== MENU ==========
      if (['menu', 'help', 'list'].includes(cmd)) {
        let userCount = 0;
        try { userCount = (await loadUsers()).length; } catch {}
        await reply(buildMainMenu(m.pushName, userCount));
        return;
      }

      // ========== PING ==========
      if (cmd === 'ping') {
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        await reply(`⚡ *Pong!*\n> Speed: *${Date.now() - t0}ms*`);
        return;
      }

      // ========== ALIVE / UPTIME ==========
      if (cmd === 'alive' || cmd === 'uptime') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), mn = Math.floor((up % 3600) / 60), s = up % 60;
        await reply(`✅ *${config.BOT_NAME}* is alive\n⏱ ${h}h ${mn}m ${s}s\n🌐 Mode: ${config.MODE}`);
        return;
      }

      // ========== OWNER ==========
      if (cmd === 'owner') { await reply(`👑 *Owner*\nwa.me/${config.OWNER_NUMBER}\n${config.DEV_LINK || ''}`); return; }

      // ========== GPT ==========
      if (['gpt', 'ai', 'ask', 'chatgpt'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}gpt <question>`); return; }
        await reply('🤖 Thinking…');
        const ans = await askAI(text);
        if (ans) {
          const t = ans.length > 3500 ? ans.slice(0, 3500) + '…' : ans;
          await reply(`🤖 *${config.BOT_NAME} AI*\n\n${t}`);
        } else await reply('❌ AI is busy. Try again.');
        return;
      }

      // ========== LYRICS ==========
      if (['lyrics', 'lyric', 'lirik'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}lyrics <song>`); return; }
        await reply('⏳ Searching lyrics…');
        const data = await getLyrics(text);
        if (data?.lyrics) {
          let lyr = data.lyrics.length > 3500 ? data.lyrics.slice(0, 3500) + '…' : data.lyrics;
          await reply(`🎵 *${data.title}*${data.artist ? ' — ' + data.artist : ''}\n\n${lyr}`);
        } else await reply('❌ No lyrics found.');
        return;
      }

      // ========== PLAY ==========
      if (['play', 'song', 'ytmp3', 'music'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}play <song>`); return; }
        await reply('⏳ Searching & downloading…');
        const data = await downloadYouTube(text, true);
        if (!data?.buffer) { await reply('❌ Could not find that track.'); return; }
        const ok = await sendAsMp3(sock, from, data);
        if (!ok) await reply('❌ Failed to send audio.');
        return;
      }

      // ========== VIDEO ==========
      if (['yt', 'youtube', 'ytmp4', 'video', 'ytv'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}video <url or search>`); return; }
        await reply('⏳ Downloading video…');
        const data = await downloadYouTube(text, false);
        if (!data?.buffer) { await reply('❌ Could not download video.'); return; }
        const ok = await sendAsVideo(sock, from, data);
        if (!ok) await reply('❌ Failed to send video.');
        return;
      }

      // ========== TIKTOK ==========
      if (['tiktok', 'tt'].includes(cmd)) {
        if (!text || !text.includes('tiktok')) { await reply(`Usage: ${prefix}tiktok <url>`); return; }
        await reply('⏳ Downloading TikTok…');
        let data = null;
        try {
          const r = await dlGet('https://tikwm.com/api/?url=' + encodeURIComponent(text));
          const d = r?.data?.data;
          if (d?.play) data = { url: d.play, title: d.title || 'TikTok' };
        } catch {}
        if (!data) { await reply('❌ Failed'); return; }
        try { const buf = await fetchBuffer(data.url); await sock.sendMessage(from, { video: buf, caption: '🎵 ' + data.title, mimetype: 'video/mp4' }); }
        catch { await reply(`✅ ${data.url}`); }
        return;
      }

      // ========== INSTAGRAM ==========
      if (['ig', 'instagram', 'insta'].includes(cmd)) {
        if (!text || !text.includes('instagram')) { await reply(`Usage: ${prefix}ig <url>`); return; }
        await reply('⏳ Downloading Instagram…');
        try {
          const r = await dlGet('https://api.siputzx.my.id/api/d/igdl?url=' + encodeURIComponent(text));
          const arr = r?.data?.data || r?.data?.result || [];
          const first = Array.isArray(arr) ? arr[0] : null;
          const url = first?.url || first?.download_link || first;
          if (!url) { await reply('❌ Failed'); return; }
          const isV = String(url).includes('.mp4') || first?.type === 'video';
          if (isV) await sock.sendMessage(from, { video: { url: String(url) }, caption: '📸 Instagram' });
          else await sock.sendMessage(from, { image: { url: String(url) }, caption: '📸 Instagram' });
        } catch { await reply('❌ IG failed'); }
        return;
      }

      // ========== TEXTMAKER ==========
      const fx = ['neon','fire','glitch','ice','matrix','thunder','devil','sand','blackpink','metallic','light','hacker','paper','luxury','fire2','glow','gold','rainbow'];
      if (fx.includes(cmd)) {
        const q = text || m.pushName || 'Deadpool V7';
        await reply(`🎨 Creating *${cmd}*…`);
        const buf = await generateTextImage(cmd, q);
        if (!buf) { await reply('❌ Effect failed, try again.'); return; }
        try { await sock.sendMessage(from, { image: buf, caption: `✨ *${cmd.toUpperCase()}* — ${q}` }); }
        catch { await reply('❌ Send failed.'); }
        return;
      }

      // ========== STICKER ==========
      if (['sticker', 's', 'stiker'].includes(cmd)) {
        try {
          const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const media = q || (m.message?.imageMessage ? m.message : null) || (m.message?.videoMessage ? m.message : null);
          if (!media) { await reply(`Reply to an image/video with ${prefix}sticker`); return; }
          await reply('⏳ Creating sticker…');
          const dl = await downloadMediaMsg(media);
          if (!dl?.buffer) { await reply('❌ Download failed.'); return; }
          const st = new Sticker(dl.buffer, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 80 });
          await sock.sendMessage(from, { sticker: await st.toBuffer() });
        } catch { await reply('❌ Sticker failed.'); }
        return;
      }

      if (['toimg', 'toimage', 'photo'].includes(cmd)) {
        try {
          const q = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!q?.stickerMessage) { await reply(`Reply to a sticker with ${prefix}toimg`); return; }
          const dl = await downloadMediaMsg(q);
          if (!dl?.buffer) { await reply('❌ Failed.'); return; }
          await sock.sendMessage(from, { image: dl.buffer, caption: `🖼️ by ${config.BOT_NAME}` });
        } catch { await reply('❌ Convert failed.'); }
        return;
      }

      // ========== .vv (viewonce reveal → PM) ==========
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo') {
        try {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) vo = quoted;
          if (!vo) vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
          if (!vo) { await reply(`Reply to a view-once with ${prefix}vv`); return; }

          // Send to user's PM (or owner PM)
          const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const target = isOwner(sender) ? (me || from) : sender;

          const dl = await downloadMediaMsg(vo);
          if (!dl?.buffer) { await reply('❌ Could not download view-once.'); return; }
          if (dl.type === 'imageMessage') await sock.sendMessage(target, { image: dl.buffer });
          else if (dl.type === 'videoMessage') await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4' });
          else if (dl.type === 'audioMessage') await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: !!vo.audioMessage?.ptt });
          else await sock.sendMessage(target, { document: dl.buffer, fileName: 'vo.bin' });

          if (target !== from) await reply('✅ Sent to your PM');
        } catch (e) { await reply('❌ VV failed: ' + e.message); }
        return;
      }

      // ========== FUN ==========
      if (cmd === 'joke') {
        try { const r = await dlGet('https://official-joke-api.appspot.com/random_joke'); await reply(`😂 *${r.data.setup}*\n\n_${r.data.punchline}_`); }
        catch { await reply('😂 Why did the bot go to therapy? Too many Bad MAC errors.'); }
        return;
      }
      if (cmd === 'quote') {
        try { const r = await dlGet('https://api.quotable.io/random'); await reply(`💬 *"${r.data.content}"*\n— ${r.data.author}`); }
        catch { await reply('💬 Stay hungry, stay foolish.'); }
        return;
      }
      if (cmd === 'dice') { await reply(`🎲 You rolled: *${Math.floor(Math.random() * 6) + 1}*`); return; }
      if (cmd === 'coinflip') { await reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!'); return; }
      if (cmd === '8ball') {
        const a = ['Yes','No','Maybe','Ask again','Definitely','Never','Sure','I doubt it'];
        await reply('🎱 ' + a[Math.floor(Math.random() * a.length)]);
        return;
      }

      // ========== CALC / WEATHER ==========
      if (cmd === 'calc') {
        if (!text) { await reply(`Usage: ${prefix}calc 2+2*5`); return; }
        try {
          const safe = text.replace(/[^0-9+\-*/().%\s]/g, '');
          const result = Function('"use strict"; return (' + safe + ')')();
          await reply(`🧮 *${safe}* = *${result}*`);
        } catch { await reply('❌ Invalid expression'); }
        return;
      }
      if (cmd === 'weather') {
        if (!text) { await reply(`Usage: ${prefix}weather Nairobi`); return; }
        try { const r = await dlGet('https://wttr.in/' + encodeURIComponent(text) + '?format=3'); await reply(`🌤️ ${String(r.data).trim()}`); }
        catch { await reply('❌ Weather unavailable'); }
        return;
      }

      // ========== PRESENCE (owner only) ==========
      if (cmd === 'presence') {
        if (!isOwner(sender) && !isMe) { await reply(roast('owner')); return; }
        const v = String(args[0] || '').toLowerCase();
        const pm2 = presenceMap(v);
        if (pm2) {
          config.PRESENCE = pm2;
          try { await sock.sendPresenceUpdate(pm2, from); } catch {}
          await reply(`✅ Presence → *${v}* (${pm2})`);
        } else {
          await reply(`Usage: ${prefix}presence <typing|recording|online|offline|unavailable>\nCurrent: *${config.PRESENCE}*`);
        }
        return;
      }

      // ========== OWNER CMDS ==========
      const ownerCmds = ['mode','prefix','settings','autoview','autolike','autoreact','anticall',
                         'antidelete','antiedit','antiviewonce','broadcast','bc','users',
                         'welcome','goodbye','setbotname','startmsg'];
      if (ownerCmds.includes(cmd) && !isOwner(sender) && !isMe) { await reply(roast('owner')); return; }

      if (cmd === 'mode') {
        if (['public','private'].includes(args[0])) { config.MODE = args[0]; await reply(`✅ Mode → *${config.MODE}*`); }
        else await reply(`Current: *${config.MODE}*\nUsage: ${prefix}mode public/private`);
        return;
      }
      if (cmd === 'prefix') {
        if (!args[0]) { await reply(`Current: *${config.PREFIX}*`); return; }
        config.PREFIX = args[0].slice(0, 3);
        await reply(`✅ Prefix → *${config.PREFIX}*`);
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
      if (cmd === 'antiedit') {
        const v = (args[0] || '').toLowerCase();
        if (['off','pm','chat'].includes(v)) { config.ANTI_EDIT = v; await reply(`✅ AntiEdit → *${v}*`); }
        else await reply(`AntiEdit: *${config.ANTI_EDIT}*`);
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
      if (cmd === 'users') { await reply(`👥 Users stored: *${(await loadUsers()).length}*`); return; }
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
          `• AntiEdit: ${config.ANTI_EDIT}\n` +
          `• AntiViewOnce: ${config.ANTI_VIEW_ONCE}\n` +
          `• AntiCall: ${on(config.ANTI_CALL)}\n` +
          `• Welcome: ${on(config.WELCOME)}\n` +
          `• Goodbye: ${on(config.GOODBYE)}`
        );
        return;
      }
      if (cmd === 'setbotname') {
        if (!text) { await reply(`Usage: ${prefix}setbotname Name`); return; }
        config.BOT_NAME = text;
        await reply('✅ Bot name → ' + text);
        return;
      }
      if (cmd === 'startmsg') { await reply(buildStartMessage()); return; }

      // ========== GROUP ==========
      if (!isGroup(from) && ['promote','demote','kick','left','approve','hidetag','tagall','mute','unmute','antilink','antistatusmention','grouplink','groupinfo','warn','tagadmins'].includes(cmd)) {
        await reply(roast('group'));
        return;
      }

      if (cmd === 'antilink') {
        if (args[0] === 'on') { await saveGroup(from, 'antilink', true); await reply('✅ Antilink ON'); }
        else if (args[0] === 'off') { await saveGroup(from, 'antilink', false); await reply('❌ Antilink OFF'); }
        else await reply(`Usage: ${prefix}antilink on/off`);
        return;
      }

      if (cmd === 'antistatusmention') {
        const v = (args[0] || '').toLowerCase();
        if (v === 'on') { await saveGroup(from, 'antistatusmention', true); await reply('✅ Anti-status-mention ENABLED'); }
        else if (v === 'off') { await saveGroup(from, 'antistatusmention', false); await reply('❌ Anti-status-mention DISABLED'); }
        else if (v === 'remove') { await saveGroup(from, 'antistatusmention_action', 'remove'); await reply('✅ Action: REMOVE'); }
        else if (v === 'warn') { await saveGroup(from, 'antistatusmention_action', 'warn'); await reply('✅ Action: WARN'); }
        else await reply(`Usage: ${prefix}antistatusmention on/off/remove/warn`);
        return;
      }

      if (['promote','demote','kick'].includes(cmd)) {
        if (!(await isBotAdmin(from))) { await reply('❌ Bot needs admin.'); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roast('admin')); return; }
        let users = getMentioned(m);
        if (!users.length) { const q = getQuoted(m); if (q) users = [q]; }
        if (!users.length) { await reply('Tag or reply to a user.'); return; }
        const action = cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove';
        await sock.groupParticipantsUpdate(from, users, action);
        await reply(`✅ ${cmd} done.`);
        return;
      }

      if (['hidetag','tagall','htag'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roast('admin')); return; }
        const meta = await getMeta(from);
        if (!meta) return;
        const parts = meta.participants.map(p => p.id);
        await sock.sendMessage(from, { text: text || '📢 Attention!', mentions: parts });
        return;
      }

      if (['mute','unmute'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); return; }
        await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
        await reply(cmd === 'mute' ? '🔇 Muted' : '🔊 Unmuted');
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
          const meta = await getMeta(from);
          const admins = (meta.participants || []).filter(p => p.admin).length;
          await reply(`👥 *${meta.subject}*\nMembers: ${meta.participants?.length || 0}\nAdmins: ${admins}`);
        } catch { await reply('❌ Failed'); }
        return;
      }

      if (cmd === 'left' || cmd === 'leave') {
        if (!isOwner(sender) && !(await isGroupAdmin(from, sender))) { await reply(roast('admin')); return; }
        await reply('👋 Leaving…');
        await delay(600);
        await sock.groupLeave(from);
        return;
      }

      if (cmd === 'warn') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roast('admin')); return; }
        let users = getMentioned(m);
        if (!users.length) { const q = getQuoted(m); if (q) users = [q]; }
        if (!users.length) { await reply('Tag user'); return; }
        await sock.sendMessage(from, { text: `⚠️ *WARNING*\n@${users[0].split('@')[0]} warned.\nReason: ${text || 'None'}`, mentions: users });
        return;
      }

      if (cmd === 'tagadmins') {
        const meta = await getMeta(from);
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

      if (cmd === 'broadcast' || cmd === 'bc') {
        if (!isOwner(sender) && !isDeveloper(sender)) return;
        const users = await loadUsers();
        if (!users.length) { await reply('No users.'); return; }
        if (!text) { await reply(`Usage: ${prefix}bc <text>`); return; }
        await reply(`📢 Broadcasting to ${users.length}…`);
        let ok = 0, fail = 0;
        for (const jid of users) {
          try { await sock.sendMessage(jid, { text }); ok++; await delay(800); } catch { fail++; }
        }
        await reply(`✅ Done — OK: ${ok}, Fail: ${fail}`);
        return;
      }

      if (['block','unblock'].includes(cmd)) {
        if (!isOwner(sender)) { await reply(roast('owner')); return; }
        let jid = getMentioned(m)[0] || getQuoted(m) || (text ? text.replace(/\D/g, '') + '@s.whatsapp.net' : null);
        if (!jid) { await reply('Tag user or give number'); return; }
        try { await sock.updateBlockStatus(jid, cmd === 'block' ? 'block' : 'unblock'); await reply(`✅ ${cmd}ed`); }
        catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      // Unknown → silent
    } catch (err) { console.log('Handler:', err.message); }
  }

  // ============ ANTI-DELETE (messages.update) ============
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const isDel = u.update?.message === null || u.update?.messageStubType === 1 || u.update?.messageStubType === 2 || u.update?.messageStubType === 68;
        if (!isDel) continue;
        const key = u.key;
        if (!key?.id) continue;
        const cached = msgCache.get(key.id);
        if (cached?.message) await forwardDelete(key, cached);
      } catch {}
    }
  });
}

startBot().catch(e => { console.error('Fatal:', e); process.exit(1); });
process.on('uncaughtException', e => console.log('Uncaught:', e.message));
