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
  // Compact footer — no dash line, minimal spacing
  return `\n_${p} ©${y}_`;
}

// ============ FANCY FONTS (Unicode) — auto style on every reply ============
// WhatsApp can't load real Roboto; these maps look like different fonts.
const FONT_MAPS = {
  normal: null,
  bold: {
    a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',
    n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',
    A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',
    N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭',
    '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'
  },
  mono: {
    a:'𝚊',b:'𝚋',c:'𝚌',d:'𝚍',e:'𝚎',f:'𝚏',g:'𝚐',h:'𝚑',i:'𝚒',j:'𝚓',k:'𝚔',l:'𝚕',m:'𝚖',
    n:'𝚗',o:'𝚘',p:'𝚙',q:'𝚚',r:'𝚛',s:'𝚜',t:'𝚝',u:'𝚞',v:'𝚟',w:'𝚠',x:'𝚡',y:'𝚢',z:'𝚣',
    A:'𝙰',B:'𝙱',C:'𝙲',D:'𝙳',E:'𝙴',F:'𝙵',G:'𝙶',H:'𝙷',I:'𝙸',J:'𝙹',K:'𝙺',L:'𝙻',M:'𝙼',
    N:'𝙽',O:'𝙾',P:'𝙿',Q:'𝚀',R:'𝚁',S:'𝚂',T:'𝚃',U:'𝚄',V:'𝚅',W:'𝚆',X:'𝚇',Y:'𝚈',Z:'𝚉',
    '0':'𝟶','1':'𝟷','2':'𝟸','3':'𝟹','4':'𝟺','5':'𝟻','6':'𝟼','7':'𝟽','8':'𝟾','9':'𝟿'
  },
  italic: {
    a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',
    n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧',
    A:'𝐴',B:'𝐵',C:'𝐶',D:'𝐷',E:'𝐸',F:'𝐹',G:'𝐺',H:'𝐻',I:'𝐼',J:'𝐽',K:'𝐾',L:'𝐿',M:'𝑀',
    N:'𝑁',O:'𝑂',P:'𝑃',Q:'𝑄',R:'𝑅',S:'𝑆',T:'𝑇',U:'𝑈',V:'𝑉',W:'𝑊',X:'𝑋',Y:'𝑌',Z:'𝑍'
  },
  double: {
    a:'𝕒',b:'𝕓',c:'𝕔',d:'𝕕',e:'𝕖',f:'𝕗',g:'𝕘',h:'𝕙',i:'𝕚',j:'𝕛',k:'𝕜',l:'𝕝',m:'𝕞',
    n:'𝕟',o:'𝕠',p:'𝕡',q:'𝕢',r:'𝕣',s:'𝕤',t:'𝕥',u:'𝕦',v:'𝕧',w:'𝕨',x:'𝕩',y:'𝕪',z:'𝕫',
    A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',K:'𝕂',L:'𝕃',M:'𝕄',
    N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ',
    '0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'
  },
  script: {
    a:'𝓪',b:'𝓫',c:'𝓬',d:'𝓭',e:'𝓮',f:'𝓯',g:'𝓰',h:'𝓱',i:'𝓲',j:'𝓳',k:'𝓴',l:'𝓵',m:'𝓶',
    n:'𝓷',o:'𝓸',p:'𝓹',q:'𝓺',r:'𝓻',s:'𝓼',t:'𝓽',u:'𝓾',v:'𝓿',w:'𝔀',x:'𝔁',y:'𝔂',z:'𝔃',
    A:'𝓐',B:'𝓑',C:'𝓒',D:'𝓓',E:'𝓔',F:'𝓕',G:'𝓖',H:'𝓗',I:'𝓘',J:'𝓙',K:'𝓚',L:'𝓛',M:'𝓜',
    N:'𝓝',O:'𝓞',P:'𝓟',Q:'𝓠',R:'𝓡',S:'𝓢',T:'𝓣',U:'𝓤',V:'𝓥',W:'𝓦',X:'𝓧',Y:'𝓨',Z:'𝓩'
  },
  tiny: {
    a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
    n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ',
    A:'ᴀ',B:'ʙ',C:'ᴄ',D:'ᴅ',E:'ᴇ',F:'ғ',G:'ɢ',H:'ʜ',I:'ɪ',J:'ᴊ',K:'ᴋ',L:'ʟ',M:'ᴍ',
    N:'ɴ',O:'ᴏ',P:'ᴘ',Q:'ǫ',R:'ʀ',S:'s',T:'ᴛ',U:'ᴜ',V:'ᴠ',W:'ᴡ',X:'x',Y:'ʏ',Z:'ᴢ'
  }
};
const FONT_NAMES = Object.keys(FONT_MAPS);

function applyFont(text, style) {
  if (!text || typeof text !== 'string') return text;
  const map = FONT_MAPS[style];
  if (!map) return text;
  let out = '';
  for (const ch of text) out += map[ch] || ch;
  return out;
}

function styleReplyText(text) {
  // config.FONT = normal | bold | mono | italic | double | script | tiny | random
  let style = String(config.FONT || 'bold').toLowerCase();
  if (style === 'random' || style === 'auto') {
    const pool = FONT_NAMES.filter(n => n !== 'normal');
    style = pool[Math.floor(Math.random() * pool.length)];
  }
  if (style === 'off' || style === 'normal') return text;
  return applyFont(text, style);
}

// ============ EXPIRY ============
function getExpiryInfo() {
  // config.EXPIRY = '2026-12-31' or config.BOT_EXPIRE_DAYS = 30 (from first run / now)
  const raw = config.EXPIRY || config.EXPIRE || config.BOT_EXPIRY || '';
  if (!raw) return 'Unlimited';
  try {
    const end = new Date(raw);
    if (isNaN(end.getTime())) return String(raw);
    const now = new Date();
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    if (diff < 0) return '⛔ Expired';
    if (diff === 0) return '⚠ Ends today';
    return `${diff} day${diff === 1 ? '' : 's'} left`;
  } catch {
    return String(raw);
  }
}

// ============ MENU (monospace command list, compact) ============
function buildMainMenu(pushName, userCount) {
  const p = config.PREFIX || '.';
  const exp = getExpiryInfo();

  // Header (normal + bold)
  let m = '';
  m += `💀 *${config.BOT_NAME}*\n`;
  m += `👋 ${pushName || 'User'}  ·  👥 ${userCount || 0}  ·  ⏳ ${exp}\n`;
  m += `⚡ Prefix: *${p}*\n\n`;

  // Commands in WhatsApp monospace (```) — looks like Roboto Mono / fixed-width
  const block = (title, lines) => {
    return `*${title}*\n\`\`\`\n${lines.map(c => p + c).join('\n')}\n\`\`\`\n`;
  };

  m += block('📥 DOWNLOADS', [
    'play <song>',
    'song <name>',
    'video <url/name>',
    'yt <url/name>',
    'tiktok <url>',
    'ig <url>',
    'lyrics <song>'
  ]);
  m += block('🎨 STICKER', [
    'sticker  (reply media)',
    's  (reply media)',
    'toimg  (reply sticker)',
    'vv  (viewonce → owner PM)'
  ]);
  m += block('🤖 AI', [
    'gpt <question>',
    'ai <question>',
    'ask <question>'
  ]);
  m += block('👥 ADMIN', [
    'promote @user',
    'demote @user',
    'kick @user',
    'warn @user',
    'mute',
    'unmute',
    'tagall',
    'hidetag <text>',
    'tagadmins',
    'antilink on/off',
    'antistatusmention on/off',
    'grouplink',
    'groupinfo',
    'approve',
    'left'
  ]);
  m += block('👑 OWNER', [
    'mode public/private',
    'prefix <symbol>',
    'settings',
    'users',
    'broadcast <text>',
    'block @user',
    'unblock @user',
    'autoview on/off',
    'autolike on/off',
    'autoreact on/off',
    'autoread on/off',
    'font bold|mono|italic|random',
    'antidelete off/pm/chat',
    'antiedit off/pm/chat',
    'antiviewonce off/pm/chat',
    'anticall on/off',
    'welcome on/off',
    'goodbye on/off',
    'presence typing|recording|online|offline',
    'setbotname <name>'
  ]);
  m += block('🖋️ TEXTMAKER', [
    'neon <text>',
    'fire <text>',
    'glitch <text>',
    'ice <text>',
    'matrix <text>',
    'thunder <text>',
    'devil <text>',
    'sand <text>',
    'metallic <text>',
    'blackpink <text>',
    'light <text>',
    'hacker <text>',
    'luxury <text>'
  ]);
  m += block('🎭 FUN', [
    'joke',
    'quote',
    'dice',
    '8ball',
    'coinflip'
  ]);
  m += block('🔧 UTILITY', [
    'ping',
    'alive',
    'calc <expr>',
    'weather <city>',
    'owner'
  ]);

  m += `〽️ *Made by Confronter* ©${new Date().getFullYear()}`;
  return m;
}

// ============ SEND MENU (handles image/video from any URL) ============
async function sendMenuWithMedia(jid, pushName, userCount) {
  // Menu already includes credit line — no extra footer dash/spacing
  const caption = buildMainMenu(pushName, userCount);
  const mediaUrl = config.MENU_MEDIA;

  if (!mediaUrl) {
    await sock.sendMessage(jid, { text: caption });
    return;
  }

  const url = String(mediaUrl).toLowerCase();
  const isGif = url.includes('.gif');
  const isVideo = isGif || url.includes('.mp4') || url.includes('.mkv') || url.includes('.mov') || url.includes('.webm') || url.includes('video');

  try {
    const buffer = await fetchBuffer(mediaUrl, 60000);
    if (isVideo) {
      await sock.sendMessage(jid, {
        video: buffer, caption, mimetype: 'video/mp4', gifPlayback: isGif
      });
    } else {
      await sock.sendMessage(jid, { image: buffer, caption });
    }
    return;
  } catch (e) {
    console.log('Menu media fetch failed, falling back to URL:', e.message);
  }

  try {
    if (isVideo) {
      await sock.sendMessage(jid, { video: { url: mediaUrl }, caption, mimetype: 'video/mp4', gifPlayback: isGif });
    } else {
      await sock.sendMessage(jid, { image: { url: mediaUrl }, caption });
    }
  } catch (e) {
    console.log('Menu media URL failed, sending text only:', e.message);
    await sock.sendMessage(jid, { text: caption });
  }
}

// ============ START MESSAGE ============
function buildStartMessage() {
  const p = config.PREFIX || '.';
  const on = v => (v === true || v === 'on' || v === 'pm' || v === 'chat') ? '✅' : '❌';
  const val = (v, fallback = '—') => (v === undefined || v === null || v === '') ? fallback : String(v);
  const exp = typeof getExpiryInfo === 'function' ? getExpiryInfo() : 'Unlimited';
  const line = '──────────────';

  let m = '';
  m += `╭${line}╮\n`;
  m += `│ 💀 *${config.BOT_NAME}*\n`;
  m += `│ ✅ *ONLINE*\n`;
  m += `├${line}┤\n`;
  m += `│ ⚡ Prefix    : *${p}*\n`;
  m += `│ 🌐 Mode      : *${val(config.MODE, 'public')}*\n`;
  m += `│ 👤 Owner     : *${val(config.OWNER_NUMBER)}*\n`;
  m += `│ ⏳ Expiry    : *${exp}*\n`;
  m += `├${line}┤\n`;
  m += `│ 👁 AutoView  : ${on(config.AUTO_VIEW_STATUS)}\n`;
  m += `│ ❤️ AutoLike  : ${on(config.AUTO_LIKE_STATUS)}\n`;
  m += `│ 📖 AutoRead  : ${on(config.AUTO_READ)}\n`;
  m += `│ ⚡ AutoReact : ${on(config.AUTO_REACT)}\n`;
  m += `│ 🗑 AntiDelete: *${val(config.ANTI_DELETE, 'off')}*\n`;
  m += `│ ✏️ AntiEdit  : *${val(config.ANTI_EDIT, 'off')}*\n`;
  m += `│ 🔓 ViewOnce  : *${val(config.ANTI_VIEW_ONCE, 'off')}*\n`;
  m += `│ 📞 AntiCall  : ${on(config.ANTI_CALL)}\n`;
  m += `│ 🔗 Antilink  : ${on(config.ANTILINK)}\n`;
  m += `│ 👋 Welcome   : ${on(config.WELCOME)}\n`;
  m += `│ 🚪 Goodbye   : ${on(config.GOODBYE)}\n`;
  m += `├${line}┤\n`;
  m += `│ 👑 By *Confronter*\n`;
  m += `│ 💬 Type *${p}menu* for commands\n`;
  m += `╰${line}╯`;
  return m;
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

// ============ BASIC HELPERS ============
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
function react(jid, key, emoji) { sock.sendMessage(jid, { react: { text: emoji, key } }).catch(() => {}); }
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

// ============ ANTI-DELETE ============
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
  // Ensure AUTO_READ exists (default OFF so blue ticks don't run unless you turn them on)
  if (typeof config.AUTO_READ === 'undefined') config.AUTO_READ = false;
  if (typeof config.FONT === 'undefined') config.FONT = 'bold'; // auto fancy font on replies

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
      console.log(`📖 AutoRead  : ${config.AUTO_READ}`);
      console.log(`🗑  AntiDelete: ${config.ANTI_DELETE}`);
      console.log(`✏️  AntiEdit  : ${config.ANTI_EDIT}`);
      console.log(`🔓 ViewOnce  : ${config.ANTI_VIEW_ONCE}`);
      console.log(`🌐 Mode      : ${config.MODE}\n`);

      // Presence — non-blocking
      try {
        const pm = presenceMap(config.PRESENCE);
        if (pm) sock.sendPresenceUpdate(pm).catch(() => {});
      } catch {}

      // Start status box only — no auto menu (user runs .menu when needed)
      setImmediate(async () => {
        try {
          const me = sock.user?.id;
          if (!me) return;
          const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);
          await sock.sendMessage(jid, { text: buildStartMessage() });
          console.log('📩 Start message sent');
        } catch (e) {
          console.log('start send:', e.message);
        }
      });
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

  // ============ MESSAGES (instant parallel dispatch) ============
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

      // Blue ticks — only when AUTO_READ is enabled (default OFF)
      if (config.AUTO_READ && !isMe && from && from !== 'status@broadcast') {
        sock.readMessages([m.key]).catch(() => {});
      }

      // ANTI-DELETE
      const proto = m.message?.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE' || proto.type === 1)) {
        const key = proto.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) forwardDelete(key, cached).catch(() => {});
        return;
      }

      // ANTI-EDIT
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
              sock.sendMessage(target, {
                text: `✅ *${config.BOT_NAME} antiEdit*\n• Edited by: +${who}\n• Chat: ${isGroup(from) ? 'Group' : 'Private'}\n\n📝 *Before:*\n${oldText}\n\n✏️ *After:*\n${newText || '[media]'}`
              }).catch(() => {});
            }
          } catch {}
        }
        return;
      }

      if (!isMe && from && !from.includes('status')) saveUser(sender).catch(() => {});

      // STATUS
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

      // ANTI-VIEW-ONCE
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

      // AUTO-REACT
      if (config.AUTO_REACT && !isMe) {
        const isCmd = body && body.startsWith(config.PREFIX || '.');
        if (!isCmd) react(from, m.key, msgReactEmoji());
      }

      // ANTILINK
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
            let b = String(content).trim();
            if (!b) return;
            // Auto fancy font on every text reply
            b = styleReplyText(b);
            const hasCredit = /confronter|powered by|ᴄᴏɴғʀᴏɴᴛᴇʀ/i.test(b);
            return await sock.sendMessage(from, { text: hasCredit ? b : b + foot });
          }
          const payload = { ...content };
          if (payload.text != null) {
            const t = String(payload.text).trim();
            if (!t) delete payload.text;
            else payload.text = styleReplyText(t);
          }
          if (payload.caption != null) {
            let cap = String(payload.caption);
            cap = styleReplyText(cap);
            if (foot && !/confronter|powered by/i.test(cap)) cap = cap.trimEnd() + foot;
            payload.caption = cap;
          }
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
        await sendMenuWithMedia(from, m.pushName, userCount);
        return;
      }

      // ========== PING ==========
      if (cmd === 'ping') {
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        await reply(`⚡ *Pong!*\n> Speed: *${Date.now() - t0}ms*`);
        return;
      }

      // ========== ALIVE ==========
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
        if (!text) { await reply(`Usage: ${prefix}play <song name>`); return; }
        await reply('⏳ Searching & downloading…');
        // Clean common typos / extra spaces
        const q = text.replace(/\s+/g, ' ').trim();
        let data = await downloadYouTube(q, true);
        // One retry with simplified query (drop very short words)
        if (!data?.buffer && q.split(' ').length > 2) {
          const simple = q.split(' ').filter(w => w.length > 2).join(' ');
          if (simple && simple !== q) data = await downloadYouTube(simple, true);
        }
        if (!data?.buffer) {
          await reply('❌ Could not find that track.\nTry a clearer name or paste a YouTube link.');
          return;
        }
        const ok = await sendAsMp3(sock, from, data);
        if (!ok) await reply('❌ Downloaded but failed to send audio.');
        return;
      }

      // ========== VIDEO ==========
      if (['yt', 'youtube', 'ytmp4', 'video', 'ytv'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}video <url or search>`); return; }
        await reply('⏳ Downloading video…');
        const q = text.replace(/\s+/g, ' ').trim();
        let data = await downloadYouTube(q, false);
        if (!data?.buffer && q.split(' ').length > 2) {
          const simple = q.split(' ').filter(w => w.length > 2).join(' ');
          if (simple && simple !== q) data = await downloadYouTube(simple, false);
        }
        if (!data?.buffer) {
          await reply('❌ Could not download video.\nTry a direct YouTube link.');
          return;
        }
        const ok = await sendAsVideo(sock, from, data);
        if (!ok) await reply('❌ Downloaded but failed to send video.');
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
        const q = (text || m.pushName || 'Deadpool').slice(0, 40);
        await reply(`🎨 Creating *${cmd}*…`);
        let buf = null;
        try {
          buf = await Promise.race([
            generateTextImage(cmd, q),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 45000))
          ]);
        } catch (e) {
          console.log('textmaker:', e.message);
        }
        if (!buf || !Buffer.isBuffer(buf) || buf.length < 500) {
          await reply('❌ Effect failed. Try again or shorter text.');
          return;
        }
        try {
          await sock.sendMessage(from, { image: buf, caption: `✨ *${cmd.toUpperCase()}* — ${q}` });
        } catch {
          await reply('❌ Send failed.');
        }
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

      // ========== .vv (viewonce reveal → ALWAYS owner PM only, never shown in chat) ==========
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo') {
        try {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) vo = quoted;
          if (!vo) vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
          if (!vo) { await reply(`Reply to a view-once with ${prefix}vv`); return; }

          // Always send only to owner PM — never display media in the chat where .vv was used
          const ownerJid = getOwnerJid();
          const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const target = ownerJid || me;
          if (!target) { await reply('❌ Owner not configured.'); return; }

          const dl = await downloadMediaMsg(vo);
          if (!dl?.buffer) { await reply('❌ Could not download view-once.'); return; }

          const phone = jidToPhone(sender, m);
          const head = `🔓 *ViewOnce*\n• From: +${phone}\n• Chat: ${isGroup(from) ? 'Group' : 'Private'}`;

          if (dl.type === 'imageMessage') {
            await sock.sendMessage(target, { image: dl.buffer, caption: head });
          } else if (dl.type === 'videoMessage') {
            await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4', caption: head });
          } else if (dl.type === 'audioMessage') {
            await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: !!vo.audioMessage?.ptt });
            await sock.sendMessage(target, { text: head });
          } else {
            await sock.sendMessage(target, { document: dl.buffer, fileName: 'vo.bin', caption: head });
          }

          // Only a short confirmation in the original chat — media never appears here
          await reply('✅ View-once sent to owner PM');
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
      const ownerCmds = ['mode','prefix','settings','autoview','autolike','autoreact','autoread','anticall',
                         'antidelete','antiedit','antiviewonce','broadcast','bc','users',
                         'welcome','goodbye','setbotname','startmsg','font'];
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
      // ========== FONT (auto style on all replies) ==========
      if (cmd === 'font') {
        const v = String(args[0] || '').toLowerCase();
        const allowed = ['normal', 'bold', 'mono', 'italic', 'double', 'script', 'tiny', 'random', 'off'];
        if (!v) {
          await reply(`Font: *${config.FONT || 'bold'}*\nOptions: ${allowed.join(', ')}\nUsage: ${prefix}font bold`);
          return;
        }
        if (!allowed.includes(v)) {
          await reply(`Invalid. Use: ${allowed.join(', ')}`);
          return;
        }
        config.FONT = v === 'off' ? 'normal' : v;
        // Preview without double-styling confusion
        const sample = applyFont('Hello Confronter 123', config.FONT === 'random' ? 'bold' : config.FONT);
        await reply(`✅ Font → *${config.FONT}*\nPreview: ${sample}`);
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
      // ========== AUTOREAD (blue ticks) ==========
      if (cmd === 'autoread') {
        if (args[0] === 'on') { config.AUTO_READ = true; await reply('✅ AutoRead (blue ticks) ON'); }
        else if (args[0] === 'off') { config.AUTO_READ = false; await reply('❌ AutoRead (blue ticks) OFF'); }
        else await reply(`AutoRead: *${config.AUTO_READ ? 'ON' : 'OFF'}*\nUsage: ${prefix}autoread on/off`);
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
          `• AutoRead: ${on(config.AUTO_READ)}\n` +
          `• Font: ${config.FONT || 'bold'}\n` +
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
        if (cached?.message) forwardDelete(key, cached);
      } catch {}
    }
  });
}

startBot().catch(e => { console.error('Fatal:', e); process.exit(1); });
process.on('uncaughtException', e => console.log('Uncaught:', e.message));
