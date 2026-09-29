/**
 * DEADPOOL V7.1
 * Full-featured multi-instance WhatsApp Bot
 * Auto Status • Anti-Delete/ViewOnce • Welcome/Goodbye • Antilink
 * Media Downloaders • Owner Broadcast • Group tools • Presence • Anticall
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
let y2mateDl = null;
try { y2mateDl = require('y2mate-dl'); } catch (_) {}
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const config = require('./config');

// Suppress noisy Baileys decrypt spam (Toxic-style)
const _SUPPRESS = [
  'Closing session', 'Closing open session', 'Failed to decrypt',
  'Session error:', 'Bad MAC', 'Decrypted message with closed session',
  '[LID]'
];
const _matchSuppress = (s) => typeof s === 'string' && _SUPPRESS.some(p => s.includes(p));
const _log = console.log.bind(console);
console.log = (...a) => { if (_matchSuppress(a[0])) return; _log(...a); };
const _warn = console.warn.bind(console);
console.warn = (...a) => { if (_matchSuppress(a[0])) return; _warn(...a); };


// ==================== PROXY ROTATION (optional) ====================
let _proxyIdx = 0;
const _uaList = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getProxyList() {
  return (config.PROXY_LIST && config.PROXY_LIST.length)
    ? config.PROXY_LIST
    : (process.env.PROXY_LIST || process.env.PROXIES || '')
        .split(',').map(s => s.trim()).filter(Boolean);
}

function parseProxy(raw) {
  try {
    const u = new URL(raw.includes('://') ? raw : 'http://' + raw);
    const conf = {
      protocol: (u.protocol || 'http:').replace(':', ''),
      host: u.hostname,
      port: Number(u.port) || 80
    };
    if (u.username) {
      conf.auth = {
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password || '')
      };
    }
    return conf;
  } catch {
    return null;
  }
}

function nextProxy() {
  const list = getProxyList();
  if (!list.length) return null;
  const raw = list[_proxyIdx % list.length];
  _proxyIdx++;
  return parseProxy(raw);
}

function nextUA() {
  return _uaList[Math.floor(Math.random() * _uaList.length)];
}

/** Axios options with rotating proxy + UA for download APIs */
function dlAxiosConfig(extra = {}) {
  const proxy = nextProxy();
  const headers = {
    'User-Agent': nextUA(),
    Accept: '*/*',
    ...(extra.headers || {})
  };
  const opts = { ...extra, headers, validateStatus: extra.validateStatus || (() => true) };
  if (proxy) opts.proxy = proxy;
  return opts;
}

async function dlGet(url, extra = {}) {
  const list = getProxyList();
  const attempts = Math.max(1, Math.min(list.length || 1, 4));
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await axios.get(url, dlAxiosConfig({ timeout: extra.timeout || 45000, ...extra }));
      if (res.status >= 400 && i < attempts - 1) continue;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return axios.get(url, dlAxiosConfig({ timeout: extra.timeout || 45000, ...extra }));
}

async function dlPost(url, body, extra = {}) {
  return axios.post(url, body, dlAxiosConfig({ timeout: extra.timeout || 45000, ...extra }));
}



const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');

const msgCache = new NodeCache({ stdTTL: 60 * 60 * 8, checkperiod: 120 });
let sock = null;

// ==================== DATA HELPERS ====================
async function ensureData() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(USERS_FILE))) await fs.writeJson(USERS_FILE, []);
  if (!(await fs.pathExists(GROUPS_FILE))) await fs.writeJson(GROUPS_FILE, {});
}

async function loadUsers() {
  try {
    return await fs.readJson(USERS_FILE);
  } catch {
    return [];
  }
}

async function saveUser(jid) {
  try {
    const users = await loadUsers();
    const id = jidNormalizedUser(jid);
    if (!users.includes(id)) {
      users.push(id);
      await fs.writeJson(USERS_FILE, users, { spaces: 2 });
    }
  } catch {}
}

async function loadGroupSettings() {
  try {
    return await fs.readJson(GROUPS_FILE);
  } catch {
    return {};
  }
}

async function saveGroupSetting(gid, key, value) {
  const data = await loadGroupSettings();
  if (!data[gid]) data[gid] = {};
  data[gid][key] = value;
  await fs.writeJson(GROUPS_FILE, data, { spaces: 2 });
}


// ==================== EXPIRY ====================
const ACTIVATED_FILE = path.join(DATA_DIR, 'activated.json');

async function getActivatedAt() {
  if (config.BOT_ACTIVATED_AT) {
    const t = Date.parse(config.BOT_ACTIVATED_AT);
    if (!isNaN(t)) return t;
  }
  try {
    if (await fs.pathExists(ACTIVATED_FILE)) {
      const d = await fs.readJson(ACTIVATED_FILE);
      if (d.activatedAt) return d.activatedAt;
    }
  } catch {}
  const now = Date.now();
  await fs.ensureDir(DATA_DIR);
  await fs.writeJson(ACTIVATED_FILE, { activatedAt: now }, { spaces: 2 });
  return now;
}

async function isBotExpired() {
  // Hard date takes priority
  if (config.BOT_EXPIRY_DATE) {
    const end = Date.parse(config.BOT_EXPIRY_DATE + 'T23:59:59');
    if (!isNaN(end) && Date.now() > end) return { expired: true, reason: 'date' };
  }
  // Days from activation
  if (config.BOT_EXPIRY_DAYS && config.BOT_EXPIRY_DAYS > 0) {
    const activated = await getActivatedAt();
    const end = activated + config.BOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > end) return { expired: true, reason: 'days', endsAt: end };
    return { expired: false, endsAt: end, activatedAt: activated };
  }
  return { expired: false };
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0m';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m || !parts.length) parts.push(m + 'm');
  return parts.join(' ');
}


function buildFooter() {
  const year = new Date().getFullYear();
  const powered = (config.POWERED_BY || 'Powered by Confronter').replace(/©?\d{4}/g, '').trim();
  return '\n\n—\n' + powered + ' ©' + year;
}

function jidToPhone(jid, msg) {
  if (!jid) return 'unknown';
  // Prefer real phone from alternate fields (avoid @lid internal ids)
  const alt = msg?.key?.participantAlt || msg?.key?.remoteJidAlt || msg?.participantAlt;
  if (alt && !String(alt).includes('@lid')) {
    return String(alt).split('@')[0].split(':')[0];
  }
  let id = String(jid);
  if (id.includes('@lid')) {
    // cannot resolve lid → show cleaned id without @lid label as fallback
    return id.split('@')[0] + ' (lid)';
  }
  return id.split('@')[0].split(':')[0];
}

function withFooter(content) {
  const foot = buildFooter();
  if (!foot) return content;
  if (typeof content === 'string') {
    if (!content.trim()) return content; // never send footer-only empty bubble
    return content + foot;
  }
  if (content && typeof content === 'object') {
    // never touch reactions / deletes / pure media keys without caption
    if (content.react || content.delete || content.protocolMessage) return content;
    const c = { ...content };
    if (c.caption != null && String(c.caption).length) {
      c.caption = String(c.caption) + foot;
    } else if (c.text != null) {
      if (!String(c.text).trim()) return content;
      c.text = String(c.text) + foot;
    }
    // do NOT invent c.text on image/video/audio/sticker-only payloads
    return c;
  }
  return content;
}

async function safeSend(sock, jid, content, opts) {
  try {
    if (!content) return;
    if (typeof content === 'string') {
      if (!content.trim()) return;
      return await sock.sendMessage(jid, { text: content }, opts);
    }
    if (content.text != null && !String(content.text).trim() && !content.image && !content.video && !content.audio && !content.sticker && !content.document && !content.react) {
      return; // block empty text bubbles
    }
    return await sock.sendMessage(jid, content, opts);
  } catch (e) {
    console.log('safeSend:', e.message);
  }
}

// ==================== UNICODE FONT CYCLER (WhatsApp-safe) ====================
// Real CSS fonts (Roboto/Algerian) are NOT available in WA — we use Unicode letter forms.
const FONT_STYLES = ['normal', 'bold', 'italic', 'mono', 'sans', 'double'];
let fontStyleIndex = 0;

const FONT_MAPS = {
  bold: {
    a:'𝐚',b:'𝐛',c:'𝐜',d:'𝐝',e:'𝐞',f:'𝐟',g:'𝐠',h:'𝐡',i:'𝐢',j:'𝐣',k:'𝐤',l:'𝐥',m:'𝐦',
    n:'𝐧',o:'𝐨',p:'𝐩',q:'𝐪',r:'𝐫',s:'𝐬',t:'𝐭',u:'𝐮',v:'𝐯',w:'𝐰',x:'𝐱',y:'𝐲',z:'𝐳',
    A:'𝐀',B:'𝐁',C:'𝐂',D:'𝐃',E:'𝐄',F:'𝐅',G:'𝐆',H:'𝐇',I:'𝐈',J:'𝐉',K:'𝐊',L:'𝐋',M:'𝐌',
    N:'𝐍',O:'𝐎',P:'𝐏',Q:'𝐐',R:'𝐑',S:'𝐒',T:'𝐓',U:'𝐔',V:'𝐕',W:'𝐖',X:'𝐗',Y:'𝐘',Z:'𝐙',
    '0':'𝟎','1':'𝟏','2':'𝟐','3':'𝟑','4':'𝟒','5':'𝟓','6':'𝟔','7':'𝟕','8':'𝟖','9':'𝟗'
  },
  italic: {
    a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',
    n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧',
    A:'𝐴',B:'𝐵',C:'𝐶',D:'𝐷',E:'𝐸',F:'𝐹',G:'𝐺',H:'𝐻',I:'𝐼',J:'𝐽',K:'𝐾',L:'𝐿',M:'𝑀',
    N:'𝑁',O:'𝑂',P:'𝑃',Q:'𝑄',R:'𝑅',S:'𝑆',T:'𝑇',U:'𝑈',V:'𝑉',W:'𝑊',X:'𝑋',Y:'𝑌',Z:'𝑍'
  },
  mono: {
    a:'𝚊',b:'𝚋',c:'𝚌',d:'𝚍',e:'𝚎',f:'𝚏',g:'𝚐',h:'𝚑',i:'𝚒',j:'𝚓',k:'𝚔',l:'𝚕',m:'𝚖',
    n:'𝚗',o:'𝚘',p:'𝚙',q:'𝚚',r:'𝚛',s:'𝚜',t:'𝚝',u:'𝚞',v:'𝚟',w:'𝚠',x:'𝚡',y:'𝚢',z:'𝚣',
    A:'𝙰',B:'𝙱',C:'𝙲',D:'𝙳',E:'𝙴',F:'𝙵',G:'𝙶',H:'𝙷',I:'𝙸',J:'𝙹',K:'𝙺',L:'𝙻',M:'𝙼',
    N:'𝙽',O:'𝙾',P:'𝙿',Q:'𝚀',R:'𝚁',S:'𝚂',T:'𝚃',U:'𝚄',V:'𝚅',W:'𝚆',X:'𝚇',Y:'𝚈',Z:'𝚉',
    '0':'𝟶','1':'𝟷','2':'𝟸','3':'𝟹','4':'𝟺','5':'𝟻','6':'𝟼','7':'𝟽','8':'𝟾','9':'𝟿'
  },
  sans: {
    a:'𝖺',b:'𝖻',c:'𝖼',d:'𝖽',e:'𝖾',f:'𝖿',g:'𝗀',h:'𝗁',i:'𝗂',j:'𝗃',k:'𝗄',l:'𝗅',m:'𝗆',
    n:'𝗇',o:'𝗈',p:'𝗉',q:'𝗊',r:'𝗋',s:'𝗌',t:'𝗍',u:'𝗎',v:'𝗏',w:'𝗐',x:'𝗑',y:'𝗒',z:'𝗓',
    A:'𝖠',B:'𝖡',C:'𝖢',D:'𝖣',E:'𝖤',F:'𝖥',G:'𝖦',H:'𝖧',I:'𝖨',J:'𝖩',K:'𝖪',L:'𝖫',M:'𝖬',
    N:'𝖭',O:'𝖮',P:'𝖯',Q:'𝖰',R:'𝖱',S:'𝖲',T:'𝖳',U:'𝖴',V:'𝖵',W:'𝖶',X:'𝖷',Y:'𝖸',Z:'𝖹',
    '0':'𝟢','1':'𝟣','2':'𝟤','3':'𝟥','4':'𝟦','5':'𝟧','6':'𝟨','7':'𝟩','8':'𝟪','9':'𝟫'
  },
  double: {
    a:'𝕒',b:'𝕓',c:'𝕔',d:'𝕕',e:'𝕖',f:'𝕗',g:'𝕘',h:'𝕙',i:'𝕚',j:'𝕛',k:'𝕜',l:'𝕝',m:'𝕞',
    n:'𝕟',o:'𝕠',p:'𝕡',q:'𝕢',r:'𝕣',s:'𝕤',t:'𝕥',u:'𝕦',v:'𝕧',w:'𝕨',x:'𝕩',y:'𝕪',z:'𝕫',
    A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',K:'𝕂',L:'𝕃',M:'𝕄',
    N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ',
    '0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'
  }
};

function nextFontStyle() {
  fontStyleIndex = (fontStyleIndex + 1) % FONT_STYLES.length;
  return FONT_STYLES[fontStyleIndex];
}

function applyUnicodeFont(text, style) {
  if (!text || style === 'normal') return text;
  const map = FONT_MAPS[style];
  if (!map) return text;
  return [...text].map(ch => map[ch] || ch).join('');
}

function styleMenuText(text) {
  const style = nextFontStyle();
  if (!text || style === 'normal') return text;
  const map = FONT_MAPS[style];
  if (!map) return text;
  // Font ONLY on a-z A-Z 0-9 — box lines ┌─┐└┘│ stay plain so edges stay equal
  return [...text].map(ch => {
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) {
      return map[ch] || ch;
    }
    return ch;
  }).join('');
}

function buildMainMenu(pushName, userCount) {
  const name = (pushName || 'User').slice(0, 16);
  const expInfo = (config.BOT_EXPIRY_DAYS > 0)
    ? (config.BOT_EXPIRY_DAYS + ' days pass')
    : (config.BOT_EXPIRY_DATE || 'Unlimited');
  const p = config.PREFIX;

  // Same width for TOP and BOTTOM on every box
  const W = 28; // inner text width
  const top = () => '┌' + '─'.repeat(W + 2) + '┐';
  const bot = () => '└' + '─'.repeat(W + 2) + '┘';
  const mid = () => '├' + '─'.repeat(W + 2) + '┤';
  const row = (s) => {
    let t = String(s || '');
    // strip for length count without wide emoji bias as much as possible
    if (t.length > W) t = t.slice(0, W);
    return '│ ' + t + ' '.repeat(Math.max(0, W - t.length)) + ' │';
  };

  let m = '';

  // Header box — top and bottom equal
  m += top() + '\n';
  m += row('💀 ' + config.BOT_NAME) + '\n';
  m += row('👋 Hi ' + name + '!') + '\n';
  m += row('👥 Users: ' + (userCount || 0)) + '\n';
  m += row('🎉 Active: ' + expInfo) + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('📥 DOWNLOADS') + '\n';
  m += mid() + '\n';
  m += row(p + 'play / song  (mp3)') + '\n';
  m += row(p + 'video / yt   (mp4)') + '\n';
  m += row(p + 'tiktok / ig / fb') + '\n';
  m += row(p + 'lyrics <song>') + '\n';
  m += row(p + 'pinterest <query>') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('🎨 STICKER') + '\n';
  m += mid() + '\n';
  m += row(p + 'sticker / s / toimg') + '\n';
  m += row(p + 'attp / tts <text>') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('🤖 AI') + '\n';
  m += mid() + '\n';
  m += row(p + 'gpt / ai / ask') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('👥 ADMIN') + '\n';
  m += mid() + '\n';
  m += row(p + 'promote demote kick') + '\n';
  m += row(p + 'mute unmute delete') + '\n';
  m += row(p + 'tagall hidetag') + '\n';
  m += row(p + 'antilink welcome') + '\n';
  m += row(p + 'groupinfo left') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('👑 OWNER') + '\n';
  m += mid() + '\n';
  m += row(p + 'settings mode prefix') + '\n';
  m += row(p + 'block unblock') + '\n';
  m += row(p + 'autoview autolike') + '\n';
  m += row(p + 'anticall antidelete') + '\n';
  m += row(p + 'antiviewonce presence') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('👾 ANIME / FUN') + '\n';
  m += mid() + '\n';
  m += row(p + 'waifu neko megumin') + '\n';
  m += row(p + 'joke meme truth dare') + '\n';
  m += bot() + '\n\n';

  m += top() + '\n';
  m += row('🔧 UTILITY') + '\n';
  m += mid() + '\n';
  m += row(p + 'translate calc weather') + '\n';
  m += row(p + 'owner ping uptime') + '\n';
  m += bot() + '\n\n';

  m += '💡 Type *' + p + 'menu* anytime';
  return m;
}


async function loadAuthState() {
  if (config.SESSION && config.SESSION.length > 10) {
    try {
      let raw = config.SESSION.trim();
      if (raw.toLowerCase().startsWith('deadpool~')) {
        raw = raw.slice(raw.indexOf('~') + 1).trim();
      }
      // Full base64 session only: deadpool~eyJ...
      const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      await fs.ensureDir(AUTH_DIR);
      await fs.writeJson(path.join(AUTH_DIR, 'creds.json'), creds, { spaces: 2 });
      console.log('✅ Session loaded (deadpool~ base64)');
    } catch (e) {
      console.error('❌ Invalid SESSION (need full deadpool~ base64):', e.message);
    }
  }
  return useMultiFileAuthState(AUTH_DIR);
}

// ==================== HELPERS ====================
function getOwnerJid() {
  if (!config.OWNER_NUMBER) return null;
  return jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net');
}

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}
function isOwner(jid) {
  if (!jid) return false;
  const num = digitsOnly(jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  if (!num) return false;
  const owners = [];
  if (config.OWNER_NUMBER) owners.push(digitsOnly(config.OWNER_NUMBER));
  for (const d of (config.DEVELOPERS || [])) owners.push(digitsOnly(d));
  // match exact or suffix (country code variants)
  return owners.filter(Boolean).some(o => num === o || num.endsWith(o) || o.endsWith(num));
}

function roastOwnerOnly() {
  const lines = [
    '😂👉 *Owner only.* Crawl back under your rock.',
    '🤣 *Not for you.* This is owner territory, clown.',
    '💀 Nice try. *Owner only.* Stay in your lane.',
    '💀 *Owner command.* You are not him. Sit down.',
    '😹 *Denied.* Only the owner runs this. Go touch grass.'
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
function roastAdminOnly() {
  const lines = [
    '😂 *Admin only.* You are not admin. Point and laugh 👉',
    '🤣 Who gave *you* admin rights? Nobody. Sit.',
    '💀 *Admins only.* Regular users stay quiet.',
    '😹 Denied. Ask an admin… or dream about it.',
    '💀 Not admin = not allowed. Simple.'
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
function roastAlreadyOn(feature) {
  const lines = [
    `😂 *${feature}* is *already ON*. You cannot "activate" oxygen, genius.`,
    `🤣 *${feature}* was already enabled. Reading is free — try it.`,
    `💀 *${feature}* is ON. Stop spamming the same command.`,
    `😹 Already *ON*. Congrats, you discovered a switch that was flipped.`
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
function roastAlreadyOff(feature) {
  const lines = [
    `😂 *${feature}* is *already OFF*. Killing a corpse twice is weird.`,
    `🤣 Already off. Your attention span needs a patch.`,
    `💀 *${feature}* is OFF. Stop poking dead buttons.`
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
function roastGroupOnly() {
  return '😂 *Group only.* This is not your DMs, lonely one.';
}

function isDeveloper(jid) {
  if (!jid) return false;
  const num = digitsOnly(jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  const list = (config.DEVELOPERS || []).map(digitsOnly).filter(Boolean);
  if (list.some(o => num === o || num.endsWith(o) || o.endsWith(num))) return true;
  if (config.OWNER_NUMBER) {
    const o = digitsOnly(config.OWNER_NUMBER);
    if (o && (num === o || num.endsWith(o) || o.endsWith(num))) return true;
  }
  return false;
}

function isGroup(jid) {
  return jid?.endsWith('@g.us');
}

async function unwrapMessage(message) {
  if (!message) return null;
  let msg = message;
  // peel wrappers
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
    if (!type) {
      // direct media keys
      for (const t of ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']) {
        if (msg[t]) { type = t; break; }
      }
    }
    if (!type) return null;
    const media = msg[type];
    if (!media) return null;
    let mediaType = type.replace('Message', '');
    if (mediaType === 'sticker') mediaType = 'sticker';
    if (mediaType === 'document') mediaType = 'document';
    const stream = await downloadContentFromMessage(media, mediaType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) return null;
    return { buffer, type, media, msg };
  } catch (e) {
    console.log('downloadMediaMsg:', e.message);
    return null;
  }
}

function randomEmoji(pool) {
  const fallbackStatus = ['❤️', '🔥', '💯', '😂', '👍', '😍', '🫡', '🙏', '🎉', '✨', '💕', '😎', '🤝', '💜', '⭐'];
  const fallbackReact = ['👍', '❤️', '🔥', '😂', '🙏', '💯', '😍', '🫡', '🎉', '✨', '👏', '🤝', '😊', '💪', '✅', '🤩'];
  const fallbackCmd = ['✅', '⚡', '🔥', '💫', '✨', '🎯', '👍', '🤖', '💜', '🚀', '⭐', '👏', '💯', '🤩'];
  let list = pool;
  if (!list || !list.length) list = fallbackReact;
  return list[Math.floor(Math.random() * list.length)] || '👍';
}

function statusLikeEmoji() {
  return randomEmoji(config.STATUS_LIKES);
}

function msgReactEmoji() {
  return randomEmoji(config.REACT_EMOJIS);
}

function cmdReactEmoji() {
  return randomEmoji(['✅', '⚡', '🔥', '💫', '✨', '🎯', '👍', '🤖', '💜', '🚀', '⭐', '👏', '💯', '🤩', '🙌', '😊']);
}

async function reactToMessage(sock, jid, key, emoji) {
  try {
    await sock.sendMessage(jid, { react: { text: emoji, key } });
    return true;
  } catch {
    return false;
  }
}

function getMentioned(m) {
  return m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

function getQuotedParticipant(m) {
  return m.message?.extendedTextMessage?.contextInfo?.participant || null;
}

async function getGroupMeta(jid) {
  try {
    return await sock.groupMetadata(jid);
  } catch {
    return null;
  }
}

async function isGroupAdmin(jid, participant) {
  const meta = await getGroupMeta(jid);
  if (!meta) return false;
  const p = meta.participants.find(
    x => x.id === participant || x.id.split('@')[0] === participant.split('@')[0]
  );
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}

async function isBotAdmin(jid) {
  const botId = sock.user?.id;
  if (!botId) return false;
  return isGroupAdmin(jid, jidNormalizedUser(botId));
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hasLink(text) {
  const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi;
  return linkRegex.test(text || '');
}

// ==================== MEDIA DOWNLOADERS ====================
async function downloadYouTube(query, audioOnly = false) {
  const q = (query || '').trim();
  if (!q) return null;
  const isUrl = /youtube\.com|youtu\.be|music\.youtube/i.test(q);
  let videoUrl = isUrl ? q : null;

  // --- Search song name → YouTube URL ---
  if (!videoUrl) {
    const searchApis = [
      `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(q)}`,
      `https://vreden.my.id/api/ytsearch?query=${encodeURIComponent(q)}`,
      `https://api.agatz.xyz/api/ytsearch?message=${encodeURIComponent(q)}`,
      `https://bk9.fun/search/youtube?q=${encodeURIComponent(q)}`
    ];
    for (const ep of searchApis) {
      try {
        const res = await dlGet(ep, { timeout: 25000 });
        const raw = res?.data?.data || res?.data?.result || res?.data?.BK9 || res?.data?.videos || res?.data || [];
        const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
        const first = arr[0];
        if (!first) continue;
        videoUrl =
          first.url || first.link || first.video_url || first.webpage_url ||
          (first.videoId ? `https://www.youtube.com/watch?v=${first.videoId}` : null) ||
          (first.id && String(first.id).length >= 10 ? `https://www.youtube.com/watch?v=${first.id}` : null);
        if (videoUrl) {
          console.log('YT search hit:', videoUrl);
          break;
        }
      } catch (e) {
        console.log('yt search fail', e.message);
      }
    }
  }
  if (!videoUrl) return null;

  // --- y2mate-dl npm (jsdelivr package) first ---
  if (y2mateDl && videoUrl) {
    try {
      const fn = y2mateDl.default || y2mateDl.y2mate || y2mateDl.download || y2mateDl;
      if (typeof fn === 'function') {
        const r = await Promise.race([
          fn(videoUrl, audioOnly ? 'mp3' : 'mp4'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('y2mate-dl timeout')), 45000))
        ]);
        const link = r?.url || r?.dl || r?.link || r?.download || r?.result?.url || r?.medias?.[0]?.url;
        const title = r?.title || r?.result?.title || q;
        if (link && String(link).startsWith('http')) {
          console.log('y2mate-dl hit');
          return { url: String(link), title, audioOnly };
        }
      }
    } catch (e) {
      console.log('y2mate-dl:', e.message);
    }
  }

  // --- y2mate.com analyze API ---
  try {
    if (videoUrl) {
      const an = await axios.post(
        'https://www.y2mate.com/mates/analyzeV2/ajax',
        new URLSearchParams({ k_query: videoUrl, k_page: 'home', hl: 'en', q_auto: '0' }).toString(),
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0',
            Origin: 'https://www.y2mate.com',
            Referer: 'https://www.y2mate.com/'
          },
          validateStatus: () => true
        }
      );
      const links = an.data?.links || {};
      let pick = null;
      if (audioOnly) {
        const mp3 = links.mp3 || links.audio || {};
        const keys = Object.keys(mp3);
        pick = keys.length ? mp3[keys[0]] : null;
      } else {
        const mp4 = links.mp4 || links.video || {};
        // prefer 360p/720p
        pick = mp4['360'] || mp4['720'] || mp4[Object.keys(mp4)[0]];
      }
      if (pick?.k) {
        const conv = await axios.post(
          'https://www.y2mate.com/mates/convertV2/index',
          new URLSearchParams({ vid: an.data.vid, k: pick.k }).toString(),
          {
            timeout: 45000,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0',
              Origin: 'https://www.y2mate.com',
              Referer: 'https://www.y2mate.com/'
            },
            validateStatus: () => true
          }
        );
        const dlink = conv.data?.dlink || conv.data?.url;
        if (dlink) {
          console.log('y2mate.com hit');
          return { url: dlink, title: an.data?.title || q, audioOnly };
        }
      }
    }
  } catch (e) {
    console.log('y2mate.com:', e.message);
  }

  // --- y2mate / vidmate style download APIs ---
  const endpoints = audioOnly
    ? [
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://api.agatz.xyz/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://bk9.fun/download/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://api.nyxs.pw/dl/yt-mp3?url=${encodeURIComponent(videoUrl)}`,
        `https://yt.vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`
      ]
    : [
        `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://vreden.my.id/api/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.agatz.xyz/api/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://bk9.fun/download/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.nyxs.pw/dl/yt-mp4?url=${encodeURIComponent(videoUrl)}`,
        `https://yt.vreden.my.id/api/ytmp4?url=${encodeURIComponent(videoUrl)}`
      ];

  for (const ep of endpoints) {
    try {
      const res = await dlGet(ep, { timeout: 55000 });
      const d = res?.data?.data || res?.data?.result || res?.data?.BK9 || res?.data?.download || res?.data;
      if (!d) continue;
      let url = null;
      let title = audioOnly ? 'Audio' : 'Video';
      if (typeof d === 'string' && d.startsWith('http')) {
        url = d;
      } else if (typeof d === 'object') {
        url =
          d.url || d.dl || d.download || d.media || d.link || d.audio || d.mp3 || d.mp4 ||
          d.dl_url || d.download_url || d.audio_url || d.video_url ||
          d.medias?.[0]?.url || d.formats?.[0]?.url || d[0]?.url || d[0]?.link;
        title = d.title || d.filename || d.name || title;
      }
      if (url && String(url).startsWith('http')) {
        console.log('YT dl hit:', ep.split('?')[0]);
        return { title: String(title), url: String(url), isAudio: audioOnly, source: videoUrl };
      }
    } catch (e) {
      console.log('yt dl fail', ep.split('/')[2], e.message);
    }
  }

  // Cobalt-style (y2mate alternative)
  for (const host of ['https://api.cobalt.tools', 'https://cobalt-api.kwiatekmiki.com']) {
    try {
      const res = await dlPost(
        host + '/api/json',
        {
          url: videoUrl,
          filenameStyle: 'pretty',
          downloadMode: audioOnly ? 'audio' : 'auto',
          audioFormat: 'mp3',
          videoQuality: '720'
        },
        {
          timeout: 50000,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
      const url = res.data?.url || res.data?.audio || res.data?.download;
      if (url && String(url).startsWith('http')) {
        return {
          title: res.data?.filename || (audioOnly ? 'Audio' : 'Video'),
          url: String(url),
          isAudio: audioOnly,
          source: videoUrl
        };
      }
    } catch {}
  }

  return null;
}

async function fetchBuffer(url, timeout = 90000) {
  const res = await dlGet(url, {
    responseType: 'arraybuffer',
    timeout,
    maxContentLength: 80 * 1024 * 1024
  });
  if (res.status >= 400) throw new Error('HTTP ' + res.status);
  return Buffer.from(res.data);
}

async function sendAsMp3(sock, jid, data, quoted) {
  const safeName = (data.title || 'audio')
    .replace(/[^\w\s\-]/g, '')
    .slice(0, 50)
    .trim() || 'audio';
  try {
    const buffer = await fetchBuffer(data.url);
    // Try as audio
    try {
      await sock.sendMessage(jid, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: safeName + '.mp3',
        ptt: false
      });
      return true;
    } catch {
      // Document fallback (always works better on some devices)
      await sock.sendMessage(jid, {
        document: buffer,
        mimetype: 'audio/mpeg',
        fileName: safeName + '.mp3',
        caption: '🎵 *' + (data.title || 'Audio') + '*'
      });
      return true;
    }
  } catch (e) {
    console.log('sendAsMp3:', e.message);
    try {
      await sock.sendMessage(jid, {
        audio: { url: data.url },
        mimetype: 'audio/mpeg',
        fileName: safeName + '.mp3'
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function sendAsVideo(sock, jid, data, quoted) {
  const cap = '🎬 *' + (data.title || 'Video') + '*';
  try {
    const buffer = await fetchBuffer(data.url);
    await sock.sendMessage(jid, {
      video: buffer,
      caption: cap,
      mimetype: 'video/mp4'
    });
    return true;
  } catch (e) {
    console.log('sendAsVideo:', e.message);
    try {
      await sock.sendMessage(jid, {
        video: { url: data.url },
        caption: cap,
        mimetype: 'video/mp4'
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function downloadTikTok(url) {
  const endpoints = [
    `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
    `https://vreden.my.id/api/tiktok?url=${encodeURIComponent(url)}`,
    `https://api.agatz.xyz/api/tiktok?url=${encodeURIComponent(url)}`,
    `https://bk9.fun/download/tiktok?url=${encodeURIComponent(url)}`,
    `https://tikwm.com/api/?url=${encodeURIComponent(url)}`,
    `https://api.nyxs.pw/dl/tiktok?url=${encodeURIComponent(url)}`
  ];
  for (const ep of endpoints) {
    try {
      const res = await dlGet(ep, { timeout: 40000 });
      const d = res?.data?.data || res?.data?.result || res?.data?.BK9 || res?.data;
      if (!d) continue;
      const mediaUrl =
        d.play || d.hdplay || d.wmplay || d.video || d.url || d.download ||
        d.nwm_video_url || d.playAddr || d.medias?.[0]?.url || d.links?.[0] || d[0]?.url;
      if (mediaUrl && String(mediaUrl).startsWith('http')) {
        return { title: d.title || d.desc || 'TikTok', url: String(mediaUrl) };
      }
    } catch {}
  }
  try {
    const res = await dlPost(
      'https://api.cobalt.tools/api/json',
      { url },
      {
        timeout: 40000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
      }
    );
    if (res.data?.url) return { title: 'TikTok', url: res.data.url };
  } catch {}
  return null;
}

async function downloadInstagram(url) {
  const endpoints = [
    `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(url)}`,
    `https://vreden.my.id/api/igdownload?url=${encodeURIComponent(url)}`,
    `https://api.agatz.xyz/api/instagram?url=${encodeURIComponent(url)}`,
    `https://bk9.fun/download/instagram?url=${encodeURIComponent(url)}`,
    `https://api.nyxs.pw/dl/ig?url=${encodeURIComponent(url)}`
  ];
  for (const ep of endpoints) {
    try {
      const res = await dlGet(ep, { timeout: 40000 });
      const d = res?.data?.data || res?.data?.result || res?.data?.BK9 || res?.data;
      if (!d) continue;
      let mediaUrl = null;
      if (Array.isArray(d)) mediaUrl = d[0]?.url || d[0]?.download_link || d[0];
      else if (Array.isArray(d?.media)) mediaUrl = d.media[0]?.url || d.media[0];
      else mediaUrl = d.url || d.video || d.image || d.download || d.media;
      if (mediaUrl && String(mediaUrl).startsWith('http')) {
        return { url: String(mediaUrl), title: d.title || 'Instagram' };
      }
    } catch {}
  }
  try {
    const res = await dlPost(
      'https://api.cobalt.tools/api/json',
      { url },
      {
        timeout: 40000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
      }
    );
    if (res.data?.url) return { url: res.data.url, title: 'Instagram' };
  } catch {}
  return null;
}

async function startBot() {
  await ensureData();

  console.log('\n╔══════════════════════════════════════╗');
  console.log(`║     ${config.BOT_NAME.padEnd(28)} ║`);
  console.log('╚══════════════════════════════════════╝\n');

  const { state, saveCreds } = await loadAuthState();
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  // makeCacheableSignalKeyStore reduces Bad MAC / decrypt failures
  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: !config.SESSION,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    fireInitQueries: true,
    getMessage: async (key) => {
      const c = msgCache.get(key.id);
      return c?.message || { conversation: '' };
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Soft-handle decrypt noise (does not spam logs)
  process.on('unhandledRejection', (err) => {
    const msg = String(err && err.message || err || '');
    if (msg.includes('Bad MAC') || msg.includes('Failed to decrypt') || msg.includes('No session')) return;
    console.log('unhandledRejection:', msg.slice(0, 200));
  });

  // ---------- Connection ----------
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

      // Start message → linked account (who paired) — real newlines, clean style
      try {
        const me = sock.user?.id;
        if (me) {
          const linkedJid = me.includes(':')
            ? me.split(':')[0] + '@s.whatsapp.net'
            : jidNormalizedUser(me);
          const p = config.PREFIX || '.';
          // Fix literal \n from Heroku env vars
          let banner = (config.START_MSG || `💀 *${config.BOT_NAME}* connected`)
            .replace(/\\n/g, '\n');
          const startText =
            banner + '\n\n' +
            '╭───『 *BOT READY* 』───╮\n' +
            `│ ⚡ Prefix: *${p}*\n` +
            `│ 🌐 Mode: *${config.MODE}*\n` +
            `│ 📋 Menu: *${p}menu*\n` +
            `│ 📡 Ping: *${p}ping*\n` +
            '╰──────────────────╯\n\n' +
            `✨ Type *${p}menu* to see all commands.`;
          await sock.sendMessage(linkedJid, { text: startText });
          console.log('📩 Start message sent to linked user', linkedJid);
        }
      } catch (e) {
        console.log('Start msg error:', e.message);
      }
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : 0;
      console.log(`Connection closed (${code})`);
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Re-pair needed.');
        await fs.remove(AUTH_DIR).catch(() => {});
        process.exit(1);
      }
      console.log('🔄 Reconnecting in 5s...');
      setTimeout(startBot, 5000);
    }
  });

  // ---------- Anti-Call ----------
  sock.ev.on('call', async (calls) => {
    if (!config.ANTI_CALL) return;
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from);
          const callMsg = config.ANTI_CALL_MSG || 'Calls not allowed now. Kindly use text messages.';
          // Notify the caller
          try {
            await sock.sendMessage(call.from, { text: `📞 *${config.BOT_NAME}*\n\n${callMsg}` });
          } catch {}
          // Notify owner
          const ownerJid = getOwnerJid();
          if (ownerJid) {
            await sock.sendMessage(ownerJid, {
              text: `📞 *Anti-Call*\nRejected call from: ${call.from.split('@')[0]}\n\nMessage sent: ${callMsg}`
            }).catch(() => {});
          }
        } catch (e) {
          console.log('anticall:', e.message);
        }
      }
    }
  });

  // ---------- Welcome / Goodbye ----------
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const { id, participants, action } = update;
      const meta = await getGroupMeta(id);
      const groupName = meta?.subject || 'Group';

      for (const p of participants) {
        const user = p.split('@')[0];
        const mention = `@${user}`;

        if (action === 'add' && config.WELCOME) {
          let text = config.WELCOME_MSG
            .replace(/@user/gi, mention)
            .replace(/@group/gi, groupName);
          await sock.sendMessage(id, {
            text,
            mentions: [p]
          });
        }

        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          let text = config.GOODBYE_MSG
            .replace(/@user/gi, mention)
            .replace(/@group/gi, groupName);
          await sock.sendMessage(id, {
            text,
            mentions: [p]
          });
        }
      }
    } catch (e) {
      console.log('Welcome/Goodbye error:', e.message);
    }
  });

  // ---------- Messages ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // accept notify + append so statuses are not missed
    if (type && type !== 'notify' && type !== 'append') return;

    for (const m of messages) {
      try {
        if (!m.message) continue;
                if (m.key?.id) msgCache.set(m.key.id, {
          key: m.key,
          message: m.message,
          pushName: m.pushName,
          participant: m.key.participant || m.key.remoteJid
        });

        const from = m.key.remoteJid;
        // Presence per-chat (typing / recording / online)
        if (from && from !== 'status@broadcast' && !m.key.fromMe) {
          try {
            const p = config.PRESENCE;
            if (p === 'composing' || p === 'typing') await sock.sendPresenceUpdate('composing', from);
            else if (p === 'recording') await sock.sendPresenceUpdate('recording', from);
            else if (p === 'available' || p === 'online') await sock.sendPresenceUpdate('available', from);
            else if (p === 'unavailable' || p === 'offline') await sock.sendPresenceUpdate('unavailable', from);
          } catch {}
        }

        const sender = m.key.participant || m.key.remoteJid;
        const isMe = m.key.fromMe;

        // Track users who interact (for broadcast)
        if (!isMe && from && !from.endsWith('@g.us') && !from.includes('status')) {
          await saveUser(sender);
        }
        if (!isMe && from?.endsWith('@g.us')) {
          await saveUser(sender);
        }

        // ===== PRESENCE (every message, not only commands) =====
        if (from && from !== 'status@broadcast' && !isMe) {
          try {
            const p = config.PRESENCE;
            if (p === 'composing' || p === 'typing') await sock.sendPresenceUpdate('composing', from);
            else if (p === 'recording') await sock.sendPresenceUpdate('recording', from);
            else if (p === 'available' || p === 'online') await sock.sendPresenceUpdate('available', from);
            else if (p === 'unavailable' || p === 'offline') await sock.sendPresenceUpdate('unavailable', from);
          } catch {}
        }

        // ===== STATUS: Toxic-style silent auto-view + auto-like =====
        if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
          if (isMe) continue;
          try {
            const rawP = m.key.participant || m.key.remoteJidAlt || '';
            let poster = rawP;
            if (String(rawP).includes('@lid')) {
              const phone = jidToPhone(rawP, m);
              if (phone && !String(phone).includes('lid')) {
                poster = String(phone).replace(/\D/g, '') + '@s.whatsapp.net';
              }
            }
            const statusKey = {
              remoteJid: 'status@broadcast',
              id: m.key.id,
              participant: poster || m.key.participant,
              fromMe: false
            };
            if (config.AUTO_VIEW_STATUS) {
              try { await sock.readMessages([statusKey]); }
              catch { await sock.readMessages([m.key]).catch(() => {}); }
            }
            if (config.AUTO_LIKE_STATUS) {
              const emoji = statusLikeEmoji();
              const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
              const list = [poster || rawP, botJid].filter(Boolean);
              await sock.sendMessage(
                'status@broadcast',
                { react: { text: emoji, key: { ...m.key, participant: poster || m.key.participant } } },
                { statusJidList: list }
              ).catch(() => {});
            }
          } catch (e) {}
          continue;
        }

        // ===== ANTI VIEW-ONCE (pm/private → owner only | chat → same chat) =====
        if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
          const contentType = getContentType(m.message);
          const isVO =
            ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(contentType) ||
            m.message?.viewOnceMessage ||
            m.message?.viewOnceMessageV2 ||
            m.message?.viewOnceMessageV2Extension;

          if (isVO && !isMe) {
            try {
              const voMsg =
                m.message.viewOnceMessage?.message ||
                m.message.viewOnceMessageV2?.message ||
                m.message.viewOnceMessageV2Extension?.message ||
                m.message;
              const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
              const target = (mode === 'chat') ? from : getOwnerJid();
              if (target) {
                let dl = await downloadMediaMsg(voMsg);
                if (!dl) dl = await downloadMediaMsg(m.message);
                const who = m.pushName || sender.split('@')[0];
                const caption =
                  `✅ *${config.BOT_NAME} antiViewOnce*
` +
                  `• From: @${sender.split('@')[0]} (${who})
` +
                  `• Chat: ${isGroup(from) ? 'Group' : 'Private'}`;
                const mentions = [jidNormalizedUser(sender)];
                if (dl?.buffer) {
                  if (dl.type === 'imageMessage' || voMsg.imageMessage) {
                    await sock.sendMessage(target, { image: dl.buffer, caption, mentions });
                  } else if (dl.type === 'videoMessage' || voMsg.videoMessage) {
                    await sock.sendMessage(target, { video: dl.buffer, caption, mentions });
                  } else if (dl.type === 'audioMessage' || voMsg.audioMessage) {
                    await sock.sendMessage(target, {
                      audio: dl.buffer,
                      mimetype: voMsg.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
                      ptt: !!voMsg.audioMessage?.ptt
                    });
                    await sock.sendMessage(target, { text: caption, mentions });
                  } else {
                    await sock.sendMessage(target, {
                      document: dl.buffer,
                      fileName: 'viewonce.bin',
                      mimetype: 'application/octet-stream',
                      caption,
                      mentions
                    });
                  }
                }
              }
            } catch (e) {
              console.log('antiviewonce:', e.message);
            }
          }
        }

        const body =
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          m.message.imageMessage?.caption ||
          m.message.videoMessage?.caption ||
          '';


        // ===== AUTO-REACT to messages (text + media, not commands) =====
        if (config.AUTO_REACT && !isMe) {
          const isCmd = body && body.startsWith(config.PREFIX || '.');
          if (!isCmd) {
            const emoji = msgReactEmoji();
            await reactToMessage(sock, from, m.key, emoji);
          }
        }

        // ===== ANTILINK =====
        if (isGroup(from) && !isMe && (config.ANTILINK || (await getGroupSetting(from, 'antilink')))) {
          if (hasLink(body) && !(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
            try {
              if (await isBotAdmin(from)) {
                await sock.sendMessage(from, { delete: m.key });
                const action = config.ANTILINK_ACTION || 'delete';
                if (action === 'kick') {
                  await sock.groupParticipantsUpdate(from, [sender], 'remove');
                  await sock.sendMessage(from, {
                    text: `🔗 Antilink: @${sender.split('@')[0]} removed for sending a link.`,
                    mentions: [sender]
                  });
                } else {
                  await sock.sendMessage(from, {
                    text: `🔗 Antilink: @${sender.split('@')[0]} links are not allowed.`,
                    mentions: [sender]
                  });
                }
              }
            } catch {}
            continue;
          }
        }


        // ===== BOT EXPIRY CHECK (blocks every command when expired) =====
        if (body && (body.startsWith(config.PREFIX) || /^[0-9]{1,2}$/.test(body.trim()))) {
          const exp = await isBotExpired();
          if (exp.expired) {
            const low = body.toLowerCase();
            const isExpiryCmd = low.includes('expiry') || low.includes('expire');
            // Only .expiry works when expired (owner can check status)
            if (!(isOwner(sender) && isExpiryCmd)) {
              const msg = isOwner(sender)
                ? ('⛔ *Bot Duration has expired*\nRenew to continue using the bot.\n\n' +
                   '1. Open Heroku → Settings → Config Vars\n' +
                   '2. Increase *BOT_EXPIRY_DAYS* or set a new *BOT_EXPIRY_DATE*\n' +
                   '3. Restart the dyno (or set BOT_ACTIVATED_AT to today)\n\n' +
                   'Then type: ' + config.PREFIX + 'expiry')
                : (config.EXPIRY_MSG || '⛔ *Bot Duration has expired*\nRenew to continue using the bot.');
              await sock.sendMessage(from, { text: msg }, { quoted: m });
              continue;
            }
          }
        }

        // Normalize body (trim, handle weird spaces)
        const cleanBody = (body || '').trim();
        const prefix = config.PREFIX || '.';
        if (!cleanBody.startsWith(prefix)) continue;

        // Mode: private = only owner + linked account (fromMe)
        if (config.MODE === 'private' && !isOwner(sender) && !isMe) continue;

        const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
        const cmd = (args.shift() || '').toLowerCase();
        const text = args.join(' ');
        console.log('CMD:', cmd, 'from:', (sender || '').split('@')[0], 'chat:', from);
        // React on every command with a different emoji
        await reactToMessage(sock, from, m.key, cmdReactEmoji());

        const reply = async (content) => {
          // Always quote the user command (swipe-reply style)
          const qopts = { quoted: m };
          try {
            if (typeof content === 'string') {
              const body = String(content).trim();
              if (!body) return;
              // Footer as plain text only — no fancy unicode
              const foot = (typeof buildFooter === 'function' ? buildFooter() : '') || '';
              return await sock.sendMessage(from, { text: body + foot }, qopts);
            }
            const payload = { ...content };
            // strip empty text
            if (payload.text != null && !String(payload.text).trim()) delete payload.text;
            if (payload.caption != null) {
              const foot = (typeof buildFooter === 'function' ? buildFooter() : '') || '';
              if (foot && !String(payload.caption).includes('Powered')) {
                payload.caption = String(payload.caption) + foot;
              }
            }
            return await sock.sendMessage(from, payload, qopts);
          } catch (e) {
            try {
              if (typeof content === 'string') {
                return await sock.sendMessage(from, { text: String(content) }, qopts);
              }
              return await sock.sendMessage(from, content, qopts);
            } catch (e2) {
              console.log('reply fail:', e2.message);
            }
          }
        };

        if (config.PRESENCE === 'composing') {
          await sock.sendPresenceUpdate('composing', from).catch(() => {});
        } else if (config.PRESENCE === 'recording') {
          await sock.sendPresenceUpdate('recording', from).catch(() => {});
        } else if (config.PRESENCE === 'available') {
          await sock.sendPresenceUpdate('available', from).catch(() => {});
        }

        // ===================== MENU =====================
        if (['menu', 'help', 'list'].includes(cmd)) {
          let userCount = 0;
          try { userCount = (await loadUsers()).length; } catch {}
          let menuText = styleMenuText(buildMainMenu(m.pushName, userCount));

          if (config.MENU_MEDIA) {
            const mediaUrl = config.MENU_MEDIA;
            const url = mediaUrl.toLowerCase();
            const isGif = url.includes('.gif');
            const isVideo = url.includes('.mp4') || url.includes('.mkv') || url.includes('.mov') ||
                            url.includes('.webm') || url.includes('video') || isGif;
            try {
              const bufRes = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                maxContentLength: 40 * 1024 * 1024,
                headers: { 'User-Agent': 'Mozilla/5.0' }
              });
              const buffer = Buffer.from(bufRes.data);
              const caption = withFooter(menuText);
              if (isVideo) {
                await sock.sendMessage(from, {
                  video: buffer,
                  caption,
                  mimetype: 'video/mp4',
                  gifPlayback: !!isGif
                });
              } else {
                await sock.sendMessage(from, { image: buffer, caption });
              }
            } catch (e) {
              console.log('Menu media error:', e.message);
              try {
                if (isVideo) {
                  await sock.sendMessage(from, {
                    video: { url: mediaUrl },
                    caption: withFooter(menuText),
                    mimetype: 'video/mp4'
                  });
                } else {
                  await sock.sendMessage(from, {
                    image: { url: mediaUrl },
                    caption: withFooter(menuText)
                  });
                }
              } catch (e2) {
                await reply(menuText);
              }
            }
          } else {
            await reply(menuText);
          }
          continue;
        }

        // ----- ALIVE -----
        if (['alive', 'ping'].includes(cmd)) {
          const up = Math.floor(process.uptime());
          const h = Math.floor(up / 3600);
          const min = Math.floor((up % 3600) / 60);
          const s = up % 60;
          await reply(
            `✅ *${config.BOT_NAME}* is alive\n⏱ ${h}h ${min}m ${s}s\n🌐 Mode: ${config.MODE}`
          );
          continue;
        }

        // ----- VIEW ONCE (.vv) -----
        if (['vv', 'viewonce', 'reveal'].includes(cmd)) {
          try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;
            let vo =
              quoted?.viewOnceMessage?.message ||
              quoted?.viewOnceMessageV2?.message ||
              quoted?.viewOnceMessageV2Extension?.message;
            if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) {
              vo = quoted;
            }
            if (!vo) {
              vo =
                m.message?.viewOnceMessage?.message ||
                m.message?.viewOnceMessageV2?.message ||
                m.message?.viewOnceMessageV2Extension?.message;
            }
            if (!vo) {
              await reply('Reply to a *view once* photo/video with:\n' + config.PREFIX + 'vv');
              continue;
            }
            const dl = await downloadMediaMsg(vo);
            if (!dl || !dl.buffer) {
              await reply('❌ Could not download view once media.');
              continue;
            }
            const cap = ''; // no caption
            if (dl.type === 'imageMessage' || vo.imageMessage) {
              await sock.sendMessage(from, cap ? { image: dl.buffer, caption: cap } : { image: dl.buffer });
            } else if (dl.type === 'videoMessage' || vo.videoMessage) {
              await sock.sendMessage(from, cap ? { video: dl.buffer, caption: cap } : { video: dl.buffer });
            } else if (dl.type === 'audioMessage' || vo.audioMessage) {
              await sock.sendMessage(from, { audio: dl.buffer, mimetype: vo.audioMessage?.mimetype || 'audio/ogg; codecs=opus', ptt: !!vo.audioMessage?.ptt });
              await sock.sendMessage(from, { text: cap });
            } else {
              await sock.sendMessage(from, { document: dl.buffer, fileName: 'revealed.bin', caption: cap });
            }
          } catch (e) {
            await reply('❌ VV failed: ' + (e.message || e));
          }
          continue;
        }



        // ----- EXPIRY INFO -----
        if (cmd === 'expiry' || cmd === 'expire') {
          const exp = await isBotExpired();
          const now = new Date();
          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const today = dayNames[now.getDay()] + ' ' + now.toLocaleDateString('en-GB');
          let msg = `📋 *Bot License*\nToday: *${today}*\n\n`;
          if (config.BOT_EXPIRY_DATE) {
            msg += `📅 Expiry date: *${config.BOT_EXPIRY_DATE}*\n`;
            msg += `Status: *${exp.expired ? 'EXPIRED ⛔' : 'ACTIVE ✅'}*`;
          } else if (config.BOT_EXPIRY_DAYS > 0) {
            const left = exp.endsAt ? formatDuration(Math.max(0, exp.endsAt - Date.now())) : 'N/A';
            msg += `⏱ Duration: *${config.BOT_EXPIRY_DAYS} days*\n`;
            msg += `Time left: *${exp.expired ? '0 (EXPIRED)' : left}*\n`;
            msg += `Status: *${exp.expired ? 'EXPIRED ⛔' : 'ACTIVE ✅'}*`;
          } else {
            msg += `Status: *UNLIMITED ♾*`;
          }
          if (exp.expired && isOwner(sender)) {
            msg += `\n\n*Renew:*\n1. Heroku → Config Vars\n2. Set BOT_EXPIRY_DAYS (e.g. 30) or BOT_EXPIRY_DATE\n3. Set BOT_ACTIVATED_AT=` + now.toISOString().slice(0,10) + `\n4. Restart dyno`;
          }
          await reply(msg);
          continue;
        }

        // ----- SIMPLE GAMES -----
        if (cmd === 'dice') {
          const n = Math.floor(Math.random() * 6) + 1;
          await reply(`🎲 You rolled: *${n}*`);
          continue;
        }
        if (cmd === 'slot') {
          const items = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
          const a = items[Math.floor(Math.random() * items.length)];
          const b = items[Math.floor(Math.random() * items.length)];
          const c = items[Math.floor(Math.random() * items.length)];
          const win = a === b && b === c;
          await reply(`🎰 *SLOT*\n\n${a} | ${b} | ${c}\n\n${win ? '🎉 JACKPOT!' : 'Try again!'}`);
          continue;
        }

        // ----- GPT / AI (multi-API fallback) -----
        if (['gpt', 'ai', 'ask', 'chatgpt', 'bot'].includes(cmd)) {
          if (!text) {
            await reply(`Usage: ${config.PREFIX}gpt <your question>\nExample: ${config.PREFIX}ai hello`);
            continue;
          }
          await reply('🤖 Thinking...');
          let answer = null;
          const prompt = text.slice(0, 1500);

          const tryExtract = (data) => {
            if (!data) return null;
            if (typeof data === 'string' && data.trim().length > 1) return data.trim();
            if (typeof data === 'object') {
              const v =
                data.data || data.result || data.response || data.message ||
                data.answer || data.output || data.text || data.reply ||
                data.content || data.gpt || data.msg ||
                (typeof data.data === 'object' ? (data.data.response || data.data.message || data.data.answer) : null);
              if (typeof v === 'string' && v.trim()) return v.trim();
              if (typeof v === 'object' && v !== null) {
                const v2 = v.response || v.message || v.answer || v.text;
                if (typeof v2 === 'string' && v2.trim()) return v2.trim();
              }
            }
            return null;
          };

          // GET endpoints
          const getApis = [
            `https://api.siputzx.my.id/api/ai/gpt3?prompt=${encodeURIComponent(prompt)}`,
            `https://api.siputzx.my.id/api/ai/gpt4?prompt=${encodeURIComponent(prompt)}`,
            `https://vreden.my.id/api/gpt?prompt=${encodeURIComponent(prompt)}`,
            `https://api.agatz.xyz/api/gpt4?text=${encodeURIComponent(prompt)}`,
            `https://bk9.fun/ai/gpt4?q=${encodeURIComponent(prompt)}`,
            `https://api.nyxs.pw/ai/gpt4?text=${encodeURIComponent(prompt)}`,
            `https://api.giftedtech.co.ke/api/ai/gpt4?apikey=gifted&q=${encodeURIComponent(prompt)}`
          ];

          for (const ep of getApis) {
            try {
              const res = await dlGet(ep, { timeout: 35000 });
              answer = tryExtract(res?.data);
              if (answer) {
                console.log('AI hit:', ep.split('?')[0]);
                break;
              }
            } catch (e) {
              console.log('AI fail', e.message);
            }
          }

          // POST fallbacks
          if (!answer) {
            const posts = [
              {
                url: 'https://api.siputzx.my.id/api/ai/gpt3',
                body: { prompt }
              },
              {
                url: 'https://vreden.my.id/api/gpt',
                body: { prompt, query: prompt, text: prompt }
              }
            ];
            for (const p of posts) {
              try {
                const res = await dlPost(p.url, p.body, {
                  timeout: 35000,
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
                });
                answer = tryExtract(res?.data);
                if (answer) break;
              } catch {}
            }
          }

          if (answer) {
            // WhatsApp message limit safety
            if (answer.length > 3500) answer = answer.slice(0, 3500) + '...';
            await reply(`🤖 *${config.BOT_NAME} AI*\n\n${answer}`);
          } else {
            await reply('❌ AI is busy or offline. Try again in a moment.\nTip: keep the question short.');
          }
          continue;
        }

        // Owner-only config commands
        const ownerCmds = [
          'mode', 'presence', 'anticall', 'autoview', 'autolike', 'prefix', 'settings', 'save', 'welcomemsg', 'setwelcome', 'goodbyemsg', 'setgoodbye', 'autoread',
          'antidelete', 'antiviewonce', 'antibot', 'broadcast', 'bc', 'users',
          'welcome', 'goodbye', 'autoreact', 'startmsg', 'sendstart', 'expiry'
        ];
        if (ownerCmds.includes(cmd) && !isOwner(sender) && !isMe) {
          await reply(roastOwnerOnly());
          continue;
        }

        // ----- MODE -----
        if (cmd === 'mode') {
          if (['public', 'private'].includes(args[0])) {
            config.MODE = args[0];
            await reply(`✅ Mode → *${config.MODE}*`);
          } else await reply(`Current: *${config.MODE}*\nUsage: ${config.PREFIX}mode public/private`);
          continue;
        }

        // ----- PRESENCE -----
        if (cmd === 'presence') {
          const val = (args[0] || '').toLowerCase();
          const map = {
            available: 'available', online: 'available', on: 'available',
            composing: 'composing', typing: 'composing', type: 'composing',
            recording: 'recording', record: 'recording',
            offline: 'unavailable', unavailable: 'unavailable', off: 'unavailable'
          };
          if (map[val]) {
            config.PRESENCE = map[val];
            try { await sock.sendPresenceUpdate(config.PRESENCE === 'unavailable' ? 'unavailable' : config.PRESENCE); } catch {}
            await reply(`✅ Presence → *${val}* (${config.PRESENCE})`);
          } else {
            await reply(
              `Current: *${config.PRESENCE}*\n\n` +
              `Usage:\n` +
              `${config.PREFIX}presence online\n` +
              `${config.PREFIX}presence typing\n` +
              `${config.PREFIX}presence recording\n` +
              `${config.PREFIX}presence offline`
            );
          }
          continue;
        }

        // ----- ANTICALL -----
        if (cmd === 'anticall') {
          if (args[0] === 'on') { config.ANTI_CALL = true; await reply('✅ Anti-Call ON'); }
          else if (args[0] === 'off') { config.ANTI_CALL = false; await reply('❌ Anti-Call OFF'); }
          else await reply(`Current: *${config.ANTI_CALL ? 'ON' : 'OFF'}*\nReject message:\n${config.ANTI_CALL_MSG}`);
          continue;
        }

        // ----- PREFIX -----
        if (cmd === 'prefix') {
          if (!args[0]) {
            await reply(`Current prefix: *${config.PREFIX}*\nUsage: ${config.PREFIX}prefix <symbol>\nExample: ${config.PREFIX}prefix !`);
            continue;
          }
          const np = args[0].slice(0, 3);
          config.PREFIX = np;
          await reply(`✅ Prefix changed to: *${config.PREFIX}*\nTry: ${config.PREFIX}menu`);
          continue;
        }

        // ----- SETTINGS -----
        if (cmd === 'settings') {
          const exp = await isBotExpired();
          const on = (v) => (v ? '✅ ON' : '❌ OFF');
          const lines = [
            `✅ *${config.BOT_NAME}* ⚙️ *SETTINGS*`,
            `━━━━━━━━━━━━━━━━`,
            `• Prefix: *${config.PREFIX}*`,
            `• Mode: *${config.MODE}*`,
            `• Presence: *${config.PRESENCE}*`,
            `• AutoView status: ${on(config.AUTO_VIEW_STATUS)}`,
            `• AutoLike status: ${on(config.AUTO_LIKE_STATUS)}`,
            `• AutoReact messages: ${on(config.AUTO_REACT)}`,
            `• AntiDelete: *${config.ANTI_DELETE}*`,
            `• AntiDelete status: ${on(config.ANTI_DELETE_STATUS)}`,
            `• AntiViewOnce: *${config.ANTI_VIEW_ONCE}*  (pm/private/chat)`,
            `• AntiCall: ${on(config.ANTI_CALL)}`,
            `• Antilink: ${on(config.ANTILINK)}`,
            `• Welcome: ${on(config.WELCOME)}`,
            `• Goodbye: ${on(config.GOODBYE)}`,
            `• Expiry: *${exp.expired ? 'EXPIRED' : (config.BOT_EXPIRY_DAYS ? config.BOT_EXPIRY_DAYS + ' days' : (config.BOT_EXPIRY_DATE || 'unlimited'))}*`,
            `━━━━━━━━━━━━━━━━`,
            `_Toggle with .autoview on | .autolike on | .autoreact on_`
          ];
          await reply(lines.join('\n'));
          continue;
        }

        // ----- SAVE STATUS (reply to status) -----
        if (cmd === 'save') {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          const statusJid = ctx?.remoteJid || ctx?.participant;
          if (!quoted && !m.message?.imageMessage && !m.message?.videoMessage) {
            await reply(`Reply to a *status* (or media) with:\n${config.PREFIX}save`);
            continue;
          }
          try {
            const qMsg = quoted ? { message: quoted, key: { remoteJid: statusJid, id: ctx.stanzaId } } : m;
            const type = getContentType(qMsg.message || m.message);
            const dl = await downloadMediaMsg(qMsg.message ? qMsg : m);
            const dest = sender; // save to user's PM
            const cap = `💾 *Saved status*\nFrom: ${ctx?.participant?.split('@')[0] || m.pushName || 'status'}`;
            if (dl && type === 'imageMessage') {
              await sock.sendMessage(dest, { image: dl.buffer, caption: cap });
            } else if (dl && type === 'videoMessage') {
              await sock.sendMessage(dest, { video: dl.buffer, caption: cap });
            } else if (dl && type === 'audioMessage') {
              await sock.sendMessage(dest, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
            } else {
              const t = quoted?.conversation || quoted?.extendedTextMessage?.text || 'Status saved';
              await sock.sendMessage(dest, { text: cap + '\n\n' + t });
            }
            if (isGroup(from)) await reply('✅ Status saved to your PM');
            else await reply('✅ Saved');
          } catch (e) {
            await reply('❌ Could not save. Reply directly to the status.');
          }
          continue;
        }


        // ----- AUTOVIEW / AUTOLIKE -----
        if (cmd === 'autoview') {
          if (args[0] === 'on') {
            if (config.AUTO_VIEW_STATUS) await reply(roastAlreadyOn('AutoView'));
            else { config.AUTO_VIEW_STATUS = true; await reply('✅ Auto View ON'); }
          } else if (args[0] === 'off') {
            if (!config.AUTO_VIEW_STATUS) await reply(roastAlreadyOff('AutoView'));
            else { config.AUTO_VIEW_STATUS = false; await reply('❌ Auto View OFF'); }
          } else await reply(`Current: *${config.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}*`);
          continue;
        }
        if (cmd === 'autolike') {
          if (args[0] === 'on') {
            if (config.AUTO_LIKE_STATUS) await reply(roastAlreadyOn('AutoLike'));
            else { config.AUTO_LIKE_STATUS = true; await reply('✅ Auto Like ON'); }
          } else if (args[0] === 'off') {
            if (!config.AUTO_LIKE_STATUS) await reply(roastAlreadyOff('AutoLike'));
            else { config.AUTO_LIKE_STATUS = false; await reply('❌ Auto Like OFF'); }
          } else await reply(`Current: *${config.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ----- ANTIDELETE / ANTIVIEWONCE -----
        if (cmd === 'antideletestatus') {
          const onoff = (args[0] || '').toLowerCase();
          if (onoff === 'on') { config.ANTI_DELETE_STATUS = true; await reply('✅ Anti-Delete Status ON'); }
          else if (onoff === 'off') { config.ANTI_DELETE_STATUS = false; await reply('❌ Anti-Delete Status OFF'); }
          else await reply(`Anti-Delete Status: *${config.ANTI_DELETE_STATUS ? 'ON' : 'OFF'}*\n${config.PREFIX}antideletestatus on/off`);
          continue;
        }

        if (cmd === 'antidelete') {
          const v = (args[0] || '').toLowerCase();
          if (['off', 'pm', 'chat'].includes(v)) {
            config.ANTI_DELETE = v;
            await reply(`✅ Anti-Delete → *${config.ANTI_DELETE}*\n(off | pm | chat)`);
          } else if (v === 'status') {
            const onoff = (args[1] || '').toLowerCase();
            if (onoff === 'on') { config.ANTI_DELETE_STATUS = true; await reply('✅ Anti-Delete *Status* ON — deleted statuses forwarded'); }
            else if (onoff === 'off') { config.ANTI_DELETE_STATUS = false; await reply('❌ Anti-Delete *Status* OFF'); }
            else await reply(`Status anti-delete: *${config.ANTI_DELETE_STATUS ? 'ON' : 'OFF'}*\nUsage: ${config.PREFIX}antidelete status on/off`);
          } else {
            await reply(
              `Anti-Delete: *${config.ANTI_DELETE}*\n` +
              `Status: *${config.ANTI_DELETE_STATUS ? 'ON' : 'OFF'}*\n\n` +
              `Usage:\n${config.PREFIX}antidelete off/pm/chat\n${config.PREFIX}antidelete status on/off`
            );
          }
          continue;
        }
        if (cmd === 'antiedit') {
          let v = (args[0] || '').toLowerCase();
          if (v === 'private') v = 'pm';
          if (['off', 'pm', 'chat'].includes(v)) {
            if (config.ANTI_EDIT === v) await reply(roastAlreadyOn('AntiEdit → ' + v));
            else { config.ANTI_EDIT = v; await reply('✅ Anti-Edit → *' + v + '*'); }
          } else await reply('Usage: ' + config.PREFIX + 'antiedit off/pm/chat\nCurrent: *' + (config.ANTI_EDIT||'pm') + '*');
          continue;
        }

        if (cmd === 'antiviewonce') {
          let v = (args[0] || '').toLowerCase();
          if (v === 'private') v = 'pm';
          if (['off', 'pm', 'chat'].includes(v)) {
            config.ANTI_VIEW_ONCE = v;
            await reply(
              `✅ Anti-ViewOnce → *${config.ANTI_VIEW_ONCE}*\n` +
              (v === 'pm' ? 'View-once media is sent to *your private chat* only.' :
               v === 'chat' ? 'View-once media is revealed in *this chat*.' :
               'Anti-ViewOnce is off.')
            );
          } else await reply(`Current: *${config.ANTI_VIEW_ONCE}*\nUsage: ${config.PREFIX}antiviewonce off/pm/private/chat`);
          continue;
        }

        // ----- WELCOME / GOODBYE -----
        if (cmd === 'welcome') {
          if (args[0] === 'on') { config.WELCOME = true; await reply('✅ Welcome ON'); }
          else if (args[0] === 'off') { config.WELCOME = false; await reply('❌ Welcome OFF'); }
          else await reply(`Current: *${config.WELCOME ? 'ON' : 'OFF'}*\nSet text: ${config.PREFIX}welcomemsg <text>`);
          continue;
        }
        if (cmd === 'welcomemsg' || cmd === 'setwelcome') {
          if (!text) await reply(`Current:\n${config.WELCOME_MSG}\n\nUsage: ${config.PREFIX}welcomemsg Welcome @user to @group`);
          else { config.WELCOME_MSG = text; await reply('✅ Welcome message updated'); }
          continue;
        }
        if (cmd === 'goodbyemsg' || cmd === 'setgoodbye') {
          if (!text) await reply(`Current:\n${config.GOODBYE_MSG}`);
          else { config.GOODBYE_MSG = text; await reply('✅ Goodbye message updated'); }
          continue;
        }

        if (cmd === 'goodbye') {
          if (args[0] === 'on') { config.GOODBYE = true; await reply('✅ Goodbye ON'); }
          else if (args[0] === 'off') { config.GOODBYE = false; await reply('❌ Goodbye OFF'); }
          else await reply(`Current: *${config.GOODBYE ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ----- AUTO-REACT -----
        if (cmd === 'autoread') {
          if (args[0] === 'on') { config.AUTO_READ = true; await reply('✅ Auto-Read ON'); }
          else if (args[0] === 'off') { config.AUTO_READ = false; await reply('❌ Auto-Read OFF'); }
          else await reply(`Auto-Read: *${config.AUTO_READ ? 'ON' : 'OFF'}*`);
          continue;
        }

        if (cmd === 'autoreact') {
          if (args[0] === 'on') { config.AUTO_REACT = true; await reply('✅ Auto-React ON'); }
          else if (args[0] === 'off') { config.AUTO_REACT = false; await reply('❌ Auto-React OFF'); }
          else await reply(`Current: *${config.AUTO_REACT ? 'ON' : 'OFF'}*\nUsage: ${config.PREFIX}autoreact on/off`);
          continue;
        }

        // ----- START MESSAGE (view / set) -----
        if (cmd === 'startmsg') {
          if (!text) {
            await reply(`*Current start message:*\n\n${config.START_MSG}\n\nTo change:\n${config.PREFIX}startmsg Your new message here`);
          } else {
            config.START_MSG = text;
            await reply('✅ Start message updated.\n\n' + config.START_MSG);
          }
          continue;
        }

        if (cmd === 'sendstart') {
          if (args[0] === 'on') { config.SEND_START_MSG = true; await reply('✅ Send start message ON'); }
          else if (args[0] === 'off') { config.SEND_START_MSG = false; await reply('❌ Send start message OFF'); }
          else await reply(`Current: *${config.SEND_START_MSG ? 'ON' : 'OFF'}*\nDefault OFF.\nUse ${config.PREFIX}broadcast <msg> to message all users.\nSTART_MSG is only the template.`);
          continue;
        }


        // ----- ANTIBOT -----
        if (cmd === 'antibot') {
          if (args[0] === 'on') { config.ANTI_BOT = true; await reply('✅ Anti-Bot ON'); }
          else if (args[0] === 'off') { config.ANTI_BOT = false; await reply('❌ Anti-Bot OFF'); }
          else await reply(`Current: *${config.ANTI_BOT ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ----- ANTILINK (global or per group) -----
        if (cmd === 'antilink') {
          if (!isGroup(from)) {
            // global toggle by owner
            if (args[0] === 'on') { config.ANTILINK = true; await reply('✅ Antilink (global) ON'); }
            else if (args[0] === 'off') { config.ANTILINK = false; await reply('❌ Antilink (global) OFF'); }
            else await reply(`Current: *${config.ANTILINK ? 'ON' : 'OFF'}*`);
          } else {
            if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
              await reply(roastAdminOnly());
              continue;
            }
            if (args[0] === 'on') {
              await saveGroupSetting(from, 'antilink', true);
              await reply('✅ Antilink ON for this group');
            } else if (args[0] === 'off') {
              await saveGroupSetting(from, 'antilink', false);
              await reply('❌ Antilink OFF for this group');
            } else {
              const cur = await getGroupSetting(from, 'antilink', config.ANTILINK);
              await reply(`Current for this group: *${cur ? 'ON' : 'OFF'}*`);
            }
          }
          continue;
        }

        // ===================== BROADCAST (DEVELOPERS ONLY — hidden from users) =====================
        if (['broadcast', 'bc'].includes(cmd)) {
          if (!isDeveloper(sender)) {
            // silent — command not for normal users
            continue;
          }
          const users = await loadUsers();
          if (!users.length) {
            await reply('No users stored yet.');
            continue;
          }

          // Media broadcast: reply to photo/video/audio/voice OR caption text
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const quoted = ctx?.quotedMessage;
          const hasImage = m.message?.imageMessage || quoted?.imageMessage;
          const hasVideo = m.message?.videoMessage || quoted?.videoMessage;
          const hasAudio = m.message?.audioMessage || quoted?.audioMessage;
          const hasDoc = m.message?.documentMessage || quoted?.documentMessage;
          const hasSticker = m.message?.stickerMessage || quoted?.stickerMessage;

          let payload = null;
          const caption = text || '';

          try {
            if (hasImage) {
              const src = m.message?.imageMessage ? m.message : quoted;
              const dl = await downloadMediaMsg(src);
              if (dl) payload = { image: dl.buffer, caption: caption || undefined };
            } else if (hasVideo) {
              const src = m.message?.videoMessage ? m.message : quoted;
              const dl = await downloadMediaMsg(src);
              if (dl) payload = { video: dl.buffer, caption: caption || undefined };
            } else if (hasAudio) {
              const src = m.message?.audioMessage ? m.message : quoted;
              const dl = await downloadMediaMsg(src);
              const ptt = !!(src.audioMessage || quoted?.audioMessage)?.ptt;
              if (dl) payload = { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt };
            } else if (hasDoc) {
              const src = m.message?.documentMessage ? m.message : quoted;
              const dl = await downloadMediaMsg(src);
              const doc = src.documentMessage || quoted?.documentMessage;
              if (dl) payload = {
                document: dl.buffer,
                mimetype: doc?.mimetype || 'application/octet-stream',
                fileName: doc?.fileName || 'file'
              };
            } else if (hasSticker) {
              const src = m.message?.stickerMessage ? m.message : quoted;
              const dl = await downloadMediaMsg(src);
              if (dl) payload = { sticker: dl.buffer };
            } else {
              let msgText = caption;
              if (!msgText) {
                await reply(
                  `📢 *Developer Broadcast*\n\n` +
                  `• ${config.PREFIX}bc <text>\n` +
                  `• ${config.PREFIX}bc start  (START_MSG)\n` +
                  `• Send/reply with photo, video, voice, audio + ${config.PREFIX}bc`
                );
                continue;
              }
              if (msgText.toLowerCase() === 'start') msgText = config.START_MSG;
              payload = { text: msgText };
            }
          } catch (e) {
            await reply('Failed to read media: ' + e.message);
            continue;
          }

          if (!payload) {
            await reply('Nothing to broadcast.');
            continue;
          }

          await reply(`📢 Broadcasting to *${users.length}* users...`);
          let success = 0, fail = 0;
          for (const jid of users) {
            try {
              await sock.sendMessage(jid, payload);
              success++;
              await delay(900);
            } catch {
              fail++;
            }
          }
          await reply(`✅ Broadcast done\nSuccess: *${success}*\nFailed: *${fail}*`);
          continue;
        }

        // ----- USERS count -----
        if (cmd === 'users') {
          const users = await loadUsers();
          await reply(`👥 Active users stored: *${users.length}*`);
          continue;
        }

        // ===================== MEDIA DOWNLOADERS =====================
        if (['yt', 'youtube', 'ytmp4', 'video', 'ytv'].includes(cmd)) {
          if (!text) {
            await reply(`Usage: ${config.PREFIX}video <youtube-url or search>\nOr: ${config.PREFIX}yt <url>`);
            continue;
          }
          await reply('⏳ Downloading video...');
          const data = await downloadYouTube(text, false);
          if (!data?.url) {
            await reply('❌ Could not download video. Try a direct YouTube link or different name.');
            continue;
          }
          const ok = await sendAsVideo(sock, from, data, m);
          if (!ok) {
            await reply(`✅ *${data.title}*\n\nDownload link:\n${data.url}`);
          }
          continue;
        }

        if (['play', 'song', 'ytmp3', 'music'].includes(cmd)) {
          if (!text) {
            await reply(`Usage: ${config.PREFIX}play <song name or youtube url>`);
            continue;
          }
          await reply('⏳ Searching & downloading MP3...');
          const data = await downloadYouTube(text, true);
          if (!data?.url) {
            await reply('❌ Could not find/download that track. Try a different name or a YouTube link.');
            continue;
          }
          const ok = await sendAsMp3(sock, from, data, m);
          if (!ok) {
            await reply(`✅ *${data.title}*\n\nDownload link:\n${data.url}`);
          }
          continue;
        }

        if (['tiktok', 'tt'].includes(cmd)) {
          if (!text || !text.includes('tiktok')) {
            await reply(`Usage: ${config.PREFIX}tiktok <tiktok-url>`);
            continue;
          }
          await reply('⏳ Downloading TikTok...');
          const data = await downloadTikTok(text);
          if (!data?.url) {
            await reply('❌ Could not download TikTok.');
            continue;
          }
          try {
            const buf = await fetchBuffer(data.url);
            await sock.sendMessage(from, {
              video: buf,
              caption: `🎵 ${data.title || 'TikTok'}`,
              mimetype: 'video/mp4'
            });
          } catch {
            try {
              await sock.sendMessage(from, {
                video: { url: data.url },
                caption: `🎵 ${data.title || 'TikTok'}`
              });
            } catch {
              await reply(`✅ ${data.url}`);
            }
          }
          continue;
        }

        if (['ig', 'instagram', 'insta'].includes(cmd)) {
          if (!text || !text.includes('instagram')) {
            await reply(`Usage: ${config.PREFIX}ig <instagram-url>`);
            continue;
          }
          await reply('⏳ Downloading Instagram...');
          const data = await downloadInstagram(text);
          if (!data?.url) {
            await reply('❌ Could not download Instagram media.');
            continue;
          }
          try {
            const isVideo = (data.type || '').includes('video') || data.url.includes('.mp4');
            if (isVideo) {
              await sock.sendMessage(from, {
                video: { url: data.url },
                caption: `📸 Instagram\n\n${config.BOT_NAME}`
              }, { quoted: m });
            } else {
              await sock.sendMessage(from, {
                image: { url: data.url },
                caption: `📸 Instagram\n\n${config.BOT_NAME}`
              }, { quoted: m });
            }
          } catch {
            await reply(`✅ ${data.url}`);
          }
          continue;
        }


        // ===================== STICKER COMMANDS =====================
        if (['sticker', 's', 'stiker'].includes(cmd)) {
          try {
            let mediaMsg = null;
            // Reply to image/video/sticker
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
              mediaMsg = quoted;
            } else if (m.message?.imageMessage || m.message?.videoMessage) {
              mediaMsg = m.message;
            }

            if (!mediaMsg) {
              await reply(`Reply to an image/video with ${config.PREFIX}sticker`);
              continue;
            }

            const type = getContentType(mediaMsg);
            if (!['imageMessage', 'videoMessage', 'stickerMessage'].includes(type)) {
              await reply('Reply to an *image* or *video* only.');
              continue;
            }

            await reply('⏳ Creating sticker...');
            const dl = await downloadMediaMsg(mediaMsg);
            if (!dl?.buffer) {
              await reply('❌ Failed to download media.');
              continue;
            }

            const sticker = new Sticker(dl.buffer, {
              pack: config.BOT_NAME,
              author: 'Confronter',
              type: StickerTypes.FULL,
              quality: 80
            });
            const buffer = await sticker.toBuffer();
            await sock.sendMessage(from, { sticker: buffer }, { quoted: m });
          } catch (e) {
            console.log('Sticker error:', e.message);
            await reply('❌ Could not create sticker. Try a smaller image.');
          }
          continue;
        }

        if (['toimg', 'toimage', 'photo'].includes(cmd)) {
          try {
            const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted?.stickerMessage) {
              await reply(`Reply to a sticker with ${config.PREFIX}toimg`);
              continue;
            }
            await reply('⏳ Converting...');
            const dl = await downloadMediaMsg(quoted);
            if (!dl?.buffer) {
              await reply('❌ Failed.');
              continue;
            }
            await sock.sendMessage(from, {
              image: dl.buffer,
              caption: `🖼️ Converted by ${config.BOT_NAME}`
            }, { quoted: m });
          } catch (e) {
            await reply('❌ Could not convert sticker.');
          }
          continue;
        }

        // ===================== GROUP COMMANDS =====================
        if (!isGroup(from) && ['promote', 'demote', 'kick', 'left', 'approve', 'hidetag', 'tagall'].includes(cmd)) {
          await reply(roastGroupOnly());
          continue;
        }

        if (['promote', 'demote', 'kick'].includes(cmd)) {
          if (!(await isBotAdmin(from))) {
            await reply('❌ Bot needs admin.');
            continue;
          }
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
            await reply('❌ You need to be admin.');
            continue;
          }
          let users = getMentioned(m);
          if (!users.length) {
            const q = getQuotedParticipant(m);
            if (q) users = [q];
          }
          if (!users.length) {
            await reply(`Tag or reply to a user.\n${config.PREFIX}${cmd} @user`);
            continue;
          }
          try {
            const action = cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove';
            await sock.groupParticipantsUpdate(from, users, action);
            await reply(`✅ ${cmd} done.`);
          } catch (e) {
            await reply('❌ Failed: ' + e.message);
          }
          continue;
        }

        if (cmd === 'left' || cmd === 'leave') {
          if (!isOwner(sender) && !(await isGroupAdmin(from, sender))) {
            await reply(roastAdminOnly());
            continue;
          }
          await reply('👋 Leaving...');
          await delay(600);
          await sock.groupLeave(from);
          continue;
        }

        if (cmd === 'join') {
          if (!isOwner(sender)) {
            await reply(roastOwnerOnly());
            continue;
          }
          const link = text || args[0];
          if (!link?.includes('chat.whatsapp.com')) {
            await reply(`Usage: ${config.PREFIX}join <group-link>`);
            continue;
          }
          try {
            const code = link.split('chat.whatsapp.com/')[1].split(/[?&#]/)[0];
            await sock.groupAcceptInvite(code);
            await reply('✅ Joined.');
          } catch (e) {
            await reply('❌ ' + e.message);
          }
          continue;
        }

        if (cmd === 'approve') {
          if (!(await isBotAdmin(from))) {
            await reply('❌ Bot needs admin.');
            continue;
          }
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
            await reply(roastAdminOnly());
            continue;
          }
          try {
            const pending = await sock.groupRequestParticipantsList(from);
            if (!pending?.length) {
              await reply('No pending requests.');
              continue;
            }
            const jids = pending.map(p => p.jid || p.id);
            await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
            await reply(`✅ Approved ${jids.length} request(s).`);
          } catch (e) {
            await reply('❌ ' + e.message);
          }
          continue;
        }

        if (['hidetag', 'tagall', 'htag'].includes(cmd)) {
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) {
            await reply(roastAdminOnly());
            continue;
          }
          const meta = await getGroupMeta(from);
          if (!meta) continue;
          const participants = meta.participants.map(p => p.id);
          await sock.sendMessage(from, {
            text: text || (cmd === 'tagall' ? '📢 Attention everyone!' : '‏'),
            mentions: participants
          });
          continue;
        }


        // ===================== EXTRA ADMIN =====================
        if (['mute', 'unmute'].includes(cmd)) {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); continue; }
          if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); continue; }
          try {
            await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
            await reply(cmd === 'mute' ? '🔇 Group muted (admins only)' : '🔊 Group unmuted');
          } catch (e) { await reply('❌ ' + e.message); }
          continue;
        }

        if (['delete', 'del'].includes(cmd)) {
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          if (!ctx?.stanzaId) { await reply('Reply to a message to delete it'); continue; }
          try {
            await sock.sendMessage(from, {
              delete: {
                remoteJid: from,
                fromMe: ctx.participant ? false : true,
                id: ctx.stanzaId,
                participant: ctx.participant
              }
            });
          } catch (e) { await reply('❌ Cannot delete'); }
          continue;
        }

        if (cmd === 'clean' || cmd === 'purge') {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); continue; }
          await reply('🧹 Clean: reply to messages and use ' + config.PREFIX + 'delete (bulk purge limited by WA).');
          continue;
        }

        if (cmd === 'warn') {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          if (!(await isGroupAdmin(from, sender)) && !isOwner(sender)) { await reply(roastAdminOnly()); continue; }
          let users = getMentioned(m);
          if (!users.length) { const q = getQuotedParticipant(m); if (q) users = [q]; }
          if (!users.length) { await reply('Tag user to warn'); continue; }
          await reply(`⚠️ Warned @${users[0].split('@')[0]}`);
          try {
            await sock.sendMessage(from, {
              text: `⚠️ *WARNING*\n@${users[0].split('@')[0]} you have been warned.\nReason: ${text || 'No reason'}`,
              mentions: users
            });
          } catch {}
          continue;
        }

        if (cmd === 'tagadmins') {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          const meta = await getGroupMeta(from);
          const admins = (meta?.participants || []).filter(p => p.admin).map(p => p.id);
          if (!admins.length) { await reply('No admins'); continue; }
          const tags = admins.map(a => '@' + a.split('@')[0]).join(' ');
          await sock.sendMessage(from, {
            text: `👑 *Admins*\n${tags}\n\n${text || ''}`.trim(),
            mentions: admins
          });
          continue;
        }

        if (cmd === 'grouplink' || cmd === 'invite') {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          if (!(await isBotAdmin(from))) { await reply('Bot needs admin'); continue; }
          try {
            const code = await sock.groupInviteCode(from);
            await reply(`🔗 https://chat.whatsapp.com/${code}`);
          } catch (e) { await reply('❌ ' + e.message); }
          continue;
        }

        if (cmd === 'groupinfo' || cmd === 'groupstatus') {
          if (!isGroup(from)) { await reply(roastGroupOnly()); continue; }
          try {
            const meta = await getGroupMeta(from);
            const admins = (meta.participants || []).filter(p => p.admin).length;
            await reply(
              `👥 *${meta.subject}*\n` +
              `Members: *${meta.participants?.length || 0}*\n` +
              `Admins: *${admins}*\n` +
              `Desc: ${(meta.desc || 'N/A').slice(0, 200)}`
            );
          } catch (e) { await reply('❌ ' + e.message); }
          continue;
        }

        if (cmd === 'antispam') {
          if (args[0] === 'on') { config.ANTI_SPAM = true; await reply('✅ Anti-spam ON'); }
          else if (args[0] === 'off') { config.ANTI_SPAM = false; await reply('❌ Anti-spam OFF'); }
          else await reply(`Anti-spam: *${config.ANTI_SPAM ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ===================== OWNER EXTRA =====================
        if (['block', 'unblock'].includes(cmd)) {
          if (!isOwner(sender)) { await reply(roastOwnerOnly()); continue; }
          let jid = getMentioned(m)[0] || getQuotedParticipant(m);
          if (!jid && text) jid = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!jid) { await reply('Tag user or give number'); continue; }
          try {
            await sock.updateBlockStatus(jid, cmd === 'block' ? 'block' : 'unblock');
            await reply(`✅ ${cmd}ed ${String(jid).split('@')[0]}`);
          } catch (e) { await reply('❌ ' + e.message); }
          continue;
        }

        if (cmd === 'setbotname') {
          if (!isOwner(sender)) { await reply(roastOwnerOnly()); continue; }
          if (!text) { await reply('Usage: ' + config.PREFIX + 'setbotname Name'); continue; }
          config.BOT_NAME = text;
          try { await sock.updateProfileName(text); } catch {}
          await reply('✅ Bot name → *' + text + '*');
          continue;
        }

        if (cmd === 'setmenuimage' || cmd === 'setmenu') {
          if (!isOwner(sender)) { await reply(roastOwnerOnly()); continue; }
          if (!text) { await reply('Usage: ' + config.PREFIX + 'setmenuimage <url>'); continue; }
          config.MENU_MEDIA = text.trim();
          await reply('✅ Menu media updated');
          continue;
        }

        if (cmd === 'owner') {
          const o = config.OWNER_NUMBER || 'not set';
          await reply(`👑 *Owner*\nwa.me/${o}\n${config.DEV_LINK || ''}`);
          continue;
        }

        if (cmd === 'uptime') {
          const up = Math.floor(process.uptime());
          const h = Math.floor(up / 3600), min = Math.floor((up % 3600) / 60), s = up % 60;
          await reply(`⏱️ Uptime: *${h}h ${min}m ${s}s*`);
          continue;
        }

        // ===================== ANIME =====================
        const animeMap = {
          waifu: 'waifu', neko: 'neko', megumin: 'megumin', shinobu: 'shinobu',
          husbu: 'waifu', loli: 'neko', hneko: 'neko', hwaifu: 'waifu', random: 'waifu'
        };
        if (animeMap[cmd]) {
          try {
            await reply('⏳ Loading...');
            const cat = animeMap[cmd];
            let img = null;
            try {
              const r = await dlGet(`https://api.waifu.pics/sfw/${cat}`, { timeout: 20000 });
              img = r?.data?.url;
            } catch {}
            if (!img) {
              try {
                const r = await dlGet(`https://api.waifu.im/search/?included_tags=${cat}`, { timeout: 20000 });
                img = r?.data?.images?.[0]?.url;
              } catch {}
            }
            if (!img) {
              const r = await dlGet('https://nekos.life/api/v2/img/' + (cat === 'megumin' ? 'neko' : cat), { timeout: 15000 });
              img = r?.data?.url;
            }
            if (img) {
              const buf = await fetchBuffer(img);
              await sock.sendMessage(from, { image: buf, caption: `🌸 *${cmd}*\n${config.BOT_NAME}` });
            } else await reply('❌ Could not fetch image');
          } catch (e) {
            await reply('❌ Anime API error');
          }
          continue;
        }

        // ===================== TEXTMAKER (simple canvas-style via APIs) =====================
        const textFx = ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'devil', 'sand',
          'blackpink', 'metallic', 'light', 'hacker', 'snow', 'purple', 'leaves', 'impressive',
          '1917', 'arena'];
        if (textFx.includes(cmd)) {
          if (!text) { await reply(`Usage: ${config.PREFIX}${cmd} your text`); continue; }
          await reply('⏳ Creating...');
          const q = encodeURIComponent(text.slice(0, 40));
          const apis = [
            `https://api.siputzx.my.id/api/canvas/${cmd}?text=${q}`,
            `https://api.agatz.xyz/api/textpro?text=${q}&effect=${cmd}`,
            `https://vreden.my.id/api/textpro?text=${q}&theme=${cmd}`
          ];
          let ok = false;
          for (const ep of apis) {
            try {
              const res = await dlGet(ep, { timeout: 30000, responseType: 'arraybuffer' });
              if (res.status < 400 && res.data && res.data.byteLength > 500) {
                await sock.sendMessage(from, { image: Buffer.from(res.data), caption: `🖋️ *${cmd}*\n${text}` });
                ok = true;
                break;
              }
              // JSON with url
              try {
                const j = typeof res.data === 'object' && res.data.url ? res.data : JSON.parse(Buffer.from(res.data).toString());
                const url = j?.url || j?.result || j?.data;
                if (url && String(url).startsWith('http')) {
                  const buf = await fetchBuffer(url);
                  await sock.sendMessage(from, { image: buf, caption: `🖋️ *${cmd}*\n${text}` });
                  ok = true;
                  break;
                }
              } catch {}
            } catch {}
          }
          if (!ok) {
            // fallback styled text
            await reply(`🖋️ *${cmd.toUpperCase()}*\n\n*${text}*\n\n_Image API offline — text fallback_`);
          }
          continue;
        }

        // ===================== FUN =====================
        if (cmd === 'joke') {
          try {
            const r = await dlGet('https://official-joke-api.appspot.com/random_joke', { timeout: 15000 });
            const d = r.data;
            await reply(`😂 *${d.setup}*\n\n_${d.punchline}_`);
          } catch {
            await reply('😂 Why did the bot go to therapy? Too many Bad MAC errors.');
          }
          continue;
        }
        if (cmd === 'meme') {
          try {
            const r = await dlGet('https://meme-api.com/gimme', { timeout: 15000 });
            const url = r?.data?.url;
            if (url) {
              const buf = await fetchBuffer(url);
              await sock.sendMessage(from, { image: buf, caption: r.data.title || 'Meme' });
            } else await reply('❌ No meme');
          } catch { await reply('❌ Meme API error'); }
          continue;
        }
        if (cmd === 'quote') {
          try {
            const r = await dlGet('https://api.quotable.io/random', { timeout: 15000 });
            await reply(`💬 *"${r.data.content}"*\n— ${r.data.author}`);
          } catch { await reply('💬 Stay hungry, stay foolish.'); }
          continue;
        }
        if (cmd === 'fact') {
          try {
            const r = await dlGet('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 15000 });
            await reply(`📌 *Fact*\n${r.data.text}`);
          } catch { await reply('📌 Water is wet.'); }
          continue;
        }
        if (cmd === 'truth') {
          const list = ['What is your biggest fear?','Who was your first crush?','What is a secret you never told?','Have you ever lied to your best friend?'];
          await reply('🧠 *Truth*\n' + list[Math.floor(Math.random()*list.length)]);
          continue;
        }
        if (cmd === 'dare') {
          const list = ['Send a funny selfie','Text your crush hi','Change your status for 1 hour','Do 10 pushups'];
          await reply('🔥 *Dare*\n' + list[Math.floor(Math.random()*list.length)]);
          continue;
        }
        if (cmd === 'coinflip') {
          await reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!');
          continue;
        }
        if (cmd === '8ball') {
          const a = ['Yes','No','Maybe','Ask again','Definitely','Never','Sure','I doubt it'];
          await reply(`🎱 ${a[Math.floor(Math.random()*a.length)]}`);
          continue;
        }
        if (['gayrate','howgay','simprate','iqrate','rizzrate','toxicrate'].includes(cmd)) {
          const n = Math.floor(Math.random()*101);
          await reply(`📊 *${cmd}*\n@${(getMentioned(m)[0]||sender).split('@')[0]} → *${n}%*`);
          continue;
        }
        if (cmd === 'ship') {
          const u = getMentioned(m);
          const a = u[0] || sender;
          const b = u[1] || getOwnerJid() || sender;
          const n = Math.floor(Math.random()*101);
          await reply(`💕 Ship rate: *${n}%*\n@${a.split('@')[0]} ❤️ @${b.split('@')[0]}`);
          continue;
        }
        if (cmd === 'compliment') {
          const c = ['You light up the chat!','Your vibe is elite.','You are built different.','Main character energy.'];
          await reply('✨ ' + c[Math.floor(Math.random()*c.length)]);
          continue;
        }
        if (cmd === 'flirt') {
          const c = ['Are you WiFi? Because I feel a connection.','Is your name Google? You have everything I search for.'];
          await reply('💘 ' + c[Math.floor(Math.random()*c.length)]);
          continue;
        }
        if (cmd === 'insult') {
          const c = ['You bring everyone so much joy… when you leave.','Somewhere out there is a tree working hard to replace oxygen you waste.'];
          await reply('😈 ' + c[Math.floor(Math.random()*c.length)]);
          continue;
        }

        // ===================== UTILITY =====================
        if (cmd === 'calc' || cmd === 'calculate') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'calc 2+2*5'); continue; }
          try {
            const safe = text.replace(/[^0-9+\-*/().%\s]/g, '');
            // eslint-disable-next-line no-new-func
            const result = Function('"use strict"; return (' + safe + ')')();
            await reply(`🧮 *${safe}* = *${result}*`);
          } catch { await reply('❌ Invalid expression'); }
          continue;
        }
        if (cmd === 'translate' || cmd === 'tr') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'tr en|sw hello'); continue; }
          try {
            let lang = 'en', q = text;
            const mtr = text.match(/^([a-z]{2})\|(.+)/i) || text.match(/^([a-z]{2})\s+(.+)/i);
            if (mtr) { lang = mtr[1]; q = mtr[2]; }
            const r = await dlGet(
              `https://api.siputzx.my.id/api/tools/translate?text=${encodeURIComponent(q)}&target=${lang}`,
              { timeout: 20000 }
            );
            const out = r?.data?.data || r?.data?.result || r?.data?.translated || r?.data;
            await reply(`🌐 *Translate → ${lang}*\n${typeof out === 'string' ? out : JSON.stringify(out)}`);
          } catch { await reply('❌ Translate failed'); }
          continue;
        }
        if (cmd === 'weather') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'weather Nairobi'); continue; }
          try {
            const r = await dlGet(`https://wttr.in/${encodeURIComponent(text)}?format=3`, { timeout: 15000 });
            await reply(`🌤️ ${String(r.data).trim()}`);
          } catch { await reply('❌ Weather unavailable'); }
          continue;
        }
        if (cmd === 'lyrics') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'lyrics faded alan walker'); continue; }
          await reply('⏳ Searching lyrics...');
          let lyrics = null, title = text;
          const apis = [
            `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(text)}`,
            `https://vreden.my.id/api/lyrics?query=${encodeURIComponent(text)}`,
            `https://api.agatz.xyz/api/lyrics?message=${encodeURIComponent(text)}`
          ];
          for (const ep of apis) {
            try {
              const r = await dlGet(ep, { timeout: 25000 });
              const d = r?.data?.data || r?.data?.result || r?.data;
              lyrics = d?.lyrics || d?.lyric || d?.text || (typeof d === 'string' ? d : null);
              title = d?.title || d?.song || title;
              if (lyrics) break;
            } catch {}
          }
          if (lyrics) {
            if (lyrics.length > 3500) lyrics = lyrics.slice(0, 3500) + '...';
            await reply(`🎵 *${title}*\n\n${lyrics}`);
          } else await reply('🎵 No lyrics available.');
          continue;
        }
        if (['facebook', 'fb'].includes(cmd)) {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'fb <url>'); continue; }
          await reply('⏳ Downloading FB...');
          try {
            const r = await dlGet(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(text)}`, { timeout: 40000 });
            const d = r?.data?.data || r?.data?.result || r?.data;
            const url = d?.url || d?.video || d?.hd || d?.sd;
            if (url) {
              const buf = await fetchBuffer(url);
              await sock.sendMessage(from, { video: buf, caption: '📘 Facebook' });
            } else await reply('❌ Failed');
          } catch { await reply('❌ FB download failed'); }
          continue;
        }
        if (['twitter', 'x', 'twdl'].includes(cmd)) {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'twitter <url>'); continue; }
          await reply('⏳ Downloading...');
          try {
            const r = await dlGet(`https://api.siputzx.my.id/api/d/twitter?url=${encodeURIComponent(text)}`, { timeout: 40000 });
            const d = r?.data?.data || r?.data?.result || r?.data;
            const url = d?.url || d?.video || d?.media;
            if (url) {
              const buf = await fetchBuffer(String(url));
              await sock.sendMessage(from, { video: buf, caption: '🐦 Twitter/X' });
            } else await reply('❌ Failed');
          } catch { await reply('❌ Twitter download failed'); }
          continue;
        }
        if (cmd === 'pinterest' || cmd === 'pin') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'pinterest query'); continue; }
          try {
            const r = await dlGet(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(text)}`, { timeout: 25000 });
            const list = r?.data?.data || r?.data?.result || [];
            const first = Array.isArray(list) ? list[0] : null;
            const url = first?.url || first?.image || first?.img;
            if (url) {
              const buf = await fetchBuffer(url);
              await sock.sendMessage(from, { image: buf, caption: '📌 ' + text });
            } else await reply('❌ No results');
          } catch { await reply('❌ Pinterest failed'); }
          continue;
        }
        if (cmd === 'ssweb' || cmd === 'ss') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'ssweb https://google.com'); continue; }
          try {
            const url = `https://api.siputzx.my.id/api/tools/ssweb?url=${encodeURIComponent(text)}`;
            const buf = await fetchBuffer(url);
            await sock.sendMessage(from, { image: buf, caption: '📸 ' + text });
          } catch { await reply('❌ Screenshot failed'); }
          continue;
        }
        if (cmd === 'tts') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'tts hello world'); continue; }
          try {
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(text.slice(0, 200))}`;
            const buf = await fetchBuffer(url);
            await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
          } catch { await reply('❌ TTS failed'); }
          continue;
        }
        if (cmd === 'attp') {
          if (!text) { await reply('Usage: ' + config.PREFIX + 'attp text'); continue; }
          try {
            const url = `https://api.siputzx.my.id/api/m/attp?text=${encodeURIComponent(text.slice(0, 40))}`;
            const res = await dlGet(url, { timeout: 25000, responseType: 'arraybuffer' });
            let buf = null;
            if (res.data && res.data.byteLength > 100) buf = Buffer.from(res.data);
            else {
              const j = JSON.parse(Buffer.from(res.data).toString());
              if (j.url) buf = await fetchBuffer(j.url);
            }
            if (buf) {
              const sticker = new Sticker(buf, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 80 });
              await sock.sendMessage(from, { sticker: await sticker.toBuffer() });
            } else await reply('❌ ATTP failed');
          } catch { await reply('❌ ATTP failed'); }
          continue;
        }


      } catch (err) {
        console.log('Handler:', err.message);
      }
    }
  });

  // ==================== ANTI-DELETE ====================
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const isDeleted =
          u.update?.message === null ||
          u.update?.messageStubType === 1 ||
          u.update?.messageStubType === 2 ||
          u.update?.messageStubType === 68;
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
        const deleter = key.participant || sender;
        const target = isStatus
          ? getOwnerJid()
          : (config.ANTI_DELETE === 'chat' ? from : getOwnerJid());
        if (!target) continue;

        let msg = cached.message;
        // unwrap viewOnce / ephemeral so media type is real
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
        const pushName = cached.pushName || 'Unknown';
        const senderTag = '@' + String(sender).split('@')[0].split(':')[0];
        const deleterTag = '@' + String(deleter).split('@')[0].split(':')[0];
        const mentions = [];
        try {
          mentions.push(jidNormalizedUser(sender));
          if (deleter !== sender) mentions.push(jidNormalizedUser(deleter));
        } catch {}

        let groupName = 'Private';
        let chatType = isStatus ? 'Status' : (isGroup(from) ? 'Group' : 'Private');
        if (isGroup(from)) {
          try {
            const meta = await sock.groupMetadata(from);
            groupName = meta?.subject || 'Group';
          } catch {
            groupName = 'Group';
          }
        }

        // Extract text
        let deletedText = '';
        if (type === 'conversation') deletedText = msg.conversation || '';
        else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
        else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
        else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
        else if (type === 'documentMessage') deletedText = msg.documentMessage?.caption || msg.documentMessage?.fileName || '';
        else if (type === 'buttonsMessage') deletedText = msg.buttonsMessage?.contentText || '';
        else if (type === 'templateMessage') deletedText = '[Template]';
        else if (type === 'stickerMessage') deletedText = '[Sticker]';
        else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice note]' : '[Audio]';
        else deletedText = type ? `[${type.replace('Message', '')}]` : '[Message]';

        // Keith-style caption
        const botLabel = config.BOT_NAME || 'Deadpool V7';
        let caption =
          `✅ *${botLabel} antiDelete*\n` +
          `• Deleted by: ${deleterTag}\n` +
          `• Original sender: ${senderTag}\n`;
        if (isGroup(from)) caption += `• Group: ${groupName}\n`;
        caption += `• Chat type: ${chatType}\n`;
        if (deletedText && !deletedText.startsWith('[')) {
          caption += `\n📝 *Deleted Text:*\n${deletedText}`;
        } else if (deletedText) {
          caption += `\n${deletedText}`;
        }

        // Try forward media
        const mediaTypes = {
          imageMessage: 'image',
          videoMessage: 'video',
          audioMessage: 'audio',
          stickerMessage: 'sticker',
          documentMessage: 'document'
        };

        if (mediaTypes[type]) {
          try {
            const dl = await downloadMediaMsg(msg);
            if (dl?.buffer) {
              const mediaKey = mediaTypes[type];
              const payload = { [mediaKey]: dl.buffer };
              if (mediaKey === 'image' || mediaKey === 'video') {
                payload.caption = caption;
                payload.mimetype = type === 'videoMessage' ? 'video/mp4' : undefined;
              } else if (mediaKey === 'audio') {
                payload.mimetype = 'audio/ogg; codecs=opus';
                payload.ptt = !!msg.audioMessage?.ptt;
              } else if (mediaKey === 'document') {
                payload.mimetype = msg.documentMessage?.mimetype || 'application/octet-stream';
                payload.fileName = msg.documentMessage?.fileName || 'file';
                payload.caption = caption;
              }
              await sock.sendMessage(target, payload, { mentions });
              // also send text info for sticker/audio
              if (mediaKey === 'sticker' || mediaKey === 'audio') {
                await sock.sendMessage(target, { text: caption, mentions });
              }
              continue;
            }
          } catch (e) {
            console.log('antidelete media:', e.message);
          }
        }

        await sock.sendMessage(target, { text: caption, mentions });
      } catch (e) {
        console.log('antidelete:', e.message);
      }
    }
  });

  // ==================== ANTI-EDIT ====================
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        const protoMsg = m.message?.protocolMessage;
        // MESSAGE_EDIT
        if (protoMsg && (protoMsg.type === 14 || protoMsg.type === 'MESSAGE_EDIT' || protoMsg.editedMessage)) {
          if (!config.ANTI_EDIT || config.ANTI_EDIT === 'off') continue;
          const key = protoMsg.key || m.key;
          const cached = key?.id ? msgCache.get(key.id) : null;
          const edited = protoMsg.editedMessage || {};
          const newText =
            edited.conversation ||
            edited.extendedTextMessage?.text ||
            edited.imageMessage?.caption ||
            edited.videoMessage?.caption ||
            '';
          const oldText =
            cached?.message?.conversation ||
            cached?.message?.extendedTextMessage?.text ||
            cached?.message?.imageMessage?.caption ||
            '[unknown]';
          const from = key?.remoteJid || m.key.remoteJid;
          const target = config.ANTI_EDIT === 'chat' ? from : getOwnerJid();
          if (!target) continue;
          const who = m.pushName || (key.participant || from || '').split('@')[0];
          await sock.sendMessage(target, {
            text:
              `✅ *${config.BOT_NAME} antiEdit*\n` +
              `• Edited by: @${String(who).split('@')[0]}\n` +
              `• Chat: ${from?.endsWith('@g.us') ? 'Group' : 'Private'}\n\n` +
              `📝 *Before:*\n${oldText}\n\n` +
              `✏️ *After:*\n${newText || '[media/empty]'}`,
            mentions: key.participant ? [key.participant] : []
          }).catch(() => {});
        }
      } catch {}
    }
  });

}

startBot().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

process.on('uncaughtException', e => console.log('Uncaught:', e.message));
process.on('unhandledRejection', e => console.log('Unhandled:', e?.message || e));
