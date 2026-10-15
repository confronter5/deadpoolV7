const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidNormalizedUser,
  getContentType,
  Browsers,
  makeCacheableSignalKeyStore,
  proto,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execP = util.promisify(exec);

// ============ CONFIG (config.js + Heroku / process.env) ============
const defaults = {
  BOT_NAME: '𝐃𝐄𝐀𝐃𝐏𝐎𝐎𝐋 𝐕𝟕',
  PREFIX: '.',
  OWNER_NUMBER: '',
  DEVELOPERS: [],
  MODE: 'public',
  SESSION: '',
  POWERED_BY: '> *𝕻𝖔ω𝖊𝖗𝖊𝖉 𝐛ყ 𝖈𝖔𝖓𝖋𝖗𝖔𝖓𝖙𝖊𝖗 💧*',
  FONT: 'random',
  AUTO_VIEW_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_REACT: false,
  AUTO_READ: false,
  ANTI_DELETE: 'dm',
  ANTI_EDIT: 'dm',
  ANTI_VIEW_ONCE: 'dm',
  ANTI_CALL: true,
  ANTI_CALL_MSG: 'Calls are not allowed right now. Please text instead.',
  ANTILINK: false,
  WELCOME: true,
  GOODBYE: true,
  WELCOME_MSG: '♻𝐖𝐞𝐥𝐜𝐨𝐦𝐞 @user to *@group* 𝐓𝐡𝐢𝐬 𝐢𝐬 𝐧𝐨𝐭 𝐭𝐨𝐢𝐥𝐞𝐭 𝐨𝐫 𝐝𝐮𝐦𝐩𝐢𝐧𝐠 𝐬𝐢𝐭𝐞 𝐫𝐞𝐚𝐝 𝐠𝐫𝐨𝐮𝐩 𝐫𝐮𝐥𝐞𝐬 𝐚𝐧𝐝 𝐨𝐛𝐞𝐲 𝐧𝐨𝐛𝐨𝐝𝐲 𝐜𝐚𝐫𝐞𝐬 𝐰𝐡𝐨 𝐲𝐨𝐮 𝐚𝐫𝐞!',
  GOODBYE_MSG: '⚗ 𝐆𝐨𝐨𝐝𝐛𝐲𝐞 @user from *@group* 𝐖𝐞 𝐜𝐚𝐧𝐭 𝐦𝐢𝐬𝐬 𝐲𝐨𝐮 𝐠𝐨 𝐫𝐨𝐭 𝐭𝐨 𝐡𝐞𝐥𝐥 𝐰𝐞 𝐝𝐨𝐧𝐭 𝐧𝐞𝐞𝐝 𝐬𝐧𝐢𝐭𝐜𝐡𝐞𝐬 𝐡𝐞𝐫𝐞!.',
  PRESENCE: 'unavailable',
  ALWAYS_ONLINE: false,
  CHATBOT: false,
  ANTITOXIC: false,
  ANTIBUG: false,
  MENU_MEDIA: '',
  BOT_IMAGE: 'https://i.imgur.com/8KZQvQ0.png',
  GROUP_INVITE: '',
  GROUP_JID: '120363430854781207@g.us',
  CHANNEL_ID: '',
  PANEL_DOMAIN: '',
  PANEL_APIKEY: '',
  PANEL_CLIENT_APIKEY: '',
  PANEL_EGG: '15',
  PANEL_LOCATION: '1',
  BOT_EXPIRY_DATE: '',
  BOT_EXPIRY_DAYS: '',
  EXPIRY_MSG: '⛔ 𝐁𝐨𝐭 𝐡𝐚𝐬 𝐞𝐱𝐩𝐢𝐫𝐞𝐝 𝐜𝐨𝐧𝐭𝐚𝐜𝐭 𝐭𝐡𝐞 *_𝐃𝐞𝐯𝐞𝐥𝐨𝐩𝐞𝐫_* 𝐨𝐫 𝐲𝐨𝐮𝐫 *_𝐌𝐢𝐝𝐝𝐥𝐞𝐦𝐚𝐧_* 𝐝𝐞𝐩𝐥𝐨𝐲𝐞𝐝 𝐟𝐨𝐫 𝐲𝐨𝐮😤 𝖜𝖊 𝖗𝖚𝖑𝖊 𝖙𝖍𝖊𝖒 𝖆𝖑𝖑 👽 .'
};
let fileConfig = {};
try { fileConfig = require('./config'); } catch {}
const env = process.env;
function envBool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
const config = {
  ...defaults,
  ...fileConfig,
  BOT_NAME: env.BOT_NAME || fileConfig.BOT_NAME || defaults.BOT_NAME,
  PREFIX: env.PREFIX || fileConfig.PREFIX || defaults.PREFIX,
  OWNER_NUMBER: String(env.OWNER_NUMBER || env.OWNER || fileConfig.OWNER_NUMBER || defaults.OWNER_NUMBER).replace(/\D/g, ''),
  DEVELOPERS: (env.DEVELOPERS || (Array.isArray(fileConfig.DEVELOPERS) ? fileConfig.DEVELOPERS.join(',') : (fileConfig.DEVELOPERS || '')) || '')
    .split(',').map(s => String(s).replace(/\D/g, '')).filter(Boolean),
  MODE: (env.MODE || fileConfig.MODE || defaults.MODE).toLowerCase(),
  SESSION: env.SESSION || env.SESSION_ID || fileConfig.SESSION || defaults.SESSION,
  FONT: env.FONT || fileConfig.FONT || defaults.FONT,
  AUTO_VIEW_STATUS: env.AUTO_VIEW_STATUS !== undefined ? envBool(env.AUTO_VIEW_STATUS, true) : (fileConfig.AUTO_VIEW_STATUS ?? defaults.AUTO_VIEW_STATUS),
  AUTO_LIKE_STATUS: env.AUTO_LIKE_STATUS !== undefined ? envBool(env.AUTO_LIKE_STATUS, true) : (fileConfig.AUTO_LIKE_STATUS ?? defaults.AUTO_LIKE_STATUS),
  AUTO_REACT: env.AUTO_REACT !== undefined ? envBool(env.AUTO_REACT, false) : (fileConfig.AUTO_REACT ?? defaults.AUTO_REACT),
  AUTO_READ: env.AUTO_READ !== undefined ? envBool(env.AUTO_READ, false) : (fileConfig.AUTO_READ ?? defaults.AUTO_READ),
  ANTI_DELETE: env.ANTI_DELETE || fileConfig.ANTI_DELETE || defaults.ANTI_DELETE,
  ANTI_EDIT: env.ANTI_EDIT || fileConfig.ANTI_EDIT || defaults.ANTI_EDIT,
  ANTI_VIEW_ONCE: env.ANTI_VIEW_ONCE || fileConfig.ANTI_VIEW_ONCE || defaults.ANTI_VIEW_ONCE,
  ANTI_CALL: env.ANTI_CALL !== undefined ? envBool(env.ANTI_CALL, true) : (fileConfig.ANTI_CALL ?? defaults.ANTI_CALL),
  ANTI_CALL_MSG: env.ANTI_CALL_MSG || fileConfig.ANTI_CALL_MSG || defaults.ANTI_CALL_MSG,
  WELCOME: env.WELCOME !== undefined ? envBool(env.WELCOME, true) : (fileConfig.WELCOME ?? defaults.WELCOME),
  GOODBYE: env.GOODBYE !== undefined ? envBool(env.GOODBYE, true) : (fileConfig.GOODBYE ?? defaults.GOODBYE),
  WELCOME_MSG: env.WELCOME_MSG || fileConfig.WELCOME_MSG || defaults.WELCOME_MSG,
  GOODBYE_MSG: env.GOODBYE_MSG || fileConfig.GOODBYE_MSG || defaults.GOODBYE_MSG,
  GROUP_INVITE: env.GROUP_INVITE || fileConfig.GROUP_INVITE || defaults.GROUP_INVITE,
  GROUP_JID: env.GROUP_JID || fileConfig.GROUP_JID || defaults.GROUP_JID || '120363430854781207@g.us',
  CHANNEL_ID: env.CHANNEL_ID || fileConfig.CHANNEL_ID || defaults.CHANNEL_ID,
  MENU_MEDIA: env.MENU_MEDIA || env.BOT_IMAGE || fileConfig.MENU_MEDIA || fileConfig.BOT_IMAGE || defaults.MENU_MEDIA || defaults.BOT_IMAGE,
  BOT_IMAGE: env.BOT_IMAGE || env.MENU_MEDIA || fileConfig.BOT_IMAGE || fileConfig.MENU_MEDIA || defaults.BOT_IMAGE || defaults.MENU_MEDIA,
  PANEL_DOMAIN: env.PANEL_DOMAIN || fileConfig.PANEL_DOMAIN || defaults.PANEL_DOMAIN,
  PANEL_APIKEY: env.PANEL_APIKEY || fileConfig.PANEL_APIKEY || defaults.PANEL_APIKEY,
  POWERED_BY: env.POWERED_BY || fileConfig.POWERED_BY || defaults.POWERED_BY,
  ALWAYS_ONLINE: env.ALWAYS_ONLINE !== undefined ? envBool(env.ALWAYS_ONLINE, false) : (fileConfig.ALWAYS_ONLINE ?? defaults.ALWAYS_ONLINE),
  CHATBOT: env.CHATBOT !== undefined ? envBool(env.CHATBOT, false) : (fileConfig.CHATBOT ?? defaults.CHATBOT),
  ANTITOXIC: env.ANTITOXIC !== undefined ? envBool(env.ANTITOXIC, false) : (fileConfig.ANTITOXIC ?? defaults.ANTITOXIC),
  ANTIBUG: env.ANTIBUG !== undefined ? envBool(env.ANTIBUG, false) : (fileConfig.ANTIBUG ?? defaults.ANTIBUG),
  BOT_EXPIRY_DAYS: env.BOT_EXPIRY_DAYS || env.EXPIRY_DAYS || fileConfig.BOT_EXPIRY_DAYS || defaults.BOT_EXPIRY_DAYS,
  BOT_EXPIRY_DATE: env.BOT_EXPIRY_DATE || env.EXPIRY_DATE || fileConfig.BOT_EXPIRY_DATE || defaults.BOT_EXPIRY_DATE,
  BOT_ACTIVATED_AT: env.BOT_ACTIVATED_AT || fileConfig.BOT_ACTIVATED_AT || '',
  EXPIRY_MSG: env.EXPIRY_MSG || fileConfig.EXPIRY_MSG || defaults.EXPIRY_MSG
};
for (const k of ['ANTI_DELETE', 'ANTI_EDIT', 'ANTI_VIEW_ONCE']) {
  if (String(config[k]).toLowerCase() === 'pm' || String(config[k]).toLowerCase() === 'private') config[k] = 'dm';
}
if (!config.STATUS_LIKES) config.STATUS_LIKES = null;
if (!config.REACT_EMOJIS) config.REACT_EMOJIS = null;

// ============ NOISE SUPPRESS ============
const SUPPRESS = [
  'Closing session', 'Closing open session', 'Failed to decrypt',
  'Session error:', 'Bad MAC', 'Decrypted message with closed session', '[LID]',
  'No sessions', 'Message counter'
];
const _match = s => typeof s === 'string' && SUPPRESS.some(p => s.includes(p));
const _log = console.log.bind(console);
console.log = (...a) => { if (_match(a[0])) return; _log(...a); };

// ============ HELPERS ============
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function dlGet(url, e = {}) {
  return axios.get(url, {
    timeout: e.timeout || 45000,
    validateStatus: () => true,
    headers: { 'User-Agent': UA, Accept: '*/*', ...(e.headers || {}) },
    ...e
  });
}
async function fetchBuffer(url, t = 120000) {
  const r = await dlGet(url, { responseType: 'arraybuffer', timeout: t, maxContentLength: 250 * 1024 * 1024 });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  return Buffer.from(r.data);
}
const delay = ms => new Promise(r => setTimeout(r, ms));
const dig = v => String(v || '').replace(/\D/g, '');

// ============ PATHS ============
const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
const TMP_DIR = path.join(__dirname, 'tmp');
fs.ensureDirSync(TMP_DIR);
const msgCache = new NodeCache({ stdTTL: 60 * 60 * 8, checkperiod: 120 });
const groupCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 120 });
const floodMap = new Map();
let sock = null;
const _lidMap = new Map();
const _historyFetching = new Set();

const games = {
  family100: {},
  tebakgambar: {},
  tebakkata: {},
  tebakkalimat: {},
  tebaklirik: {},
  caklontong: {},
  caklontong_desk: {},
  math: {},
  tictactoe: {},
  suit: {}
};

// ============ LID CACHE + NAME HELPERS ============
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
  if (!jid) return null;
  const raw = String(jid);
  if (raw.includes('@lid')) {
    const lid = raw.split('@')[0];
    if (_lidMap.has(lid)) return _lidMap.get(lid);
    const alt = msg?.key?.participantAlt || msg?.key?.remoteJidAlt || msg?.participantAlt;
    if (alt && !String(alt).includes('@lid')) {
      const n = String(alt).split('@')[0].split(':')[0];
      if (/^\d{6,15}$/.test(n)) {
        _lidMap.set(lid, n);
        return n;
      }
    }
    return null;
  }
  const n = raw.split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(n) ? n : null;
}

function getDisplayName(jid, msg, pushName = null) {
  const phone = jidToPhone(jid, msg);
  if (phone) return '@' + phone;
  if (pushName && pushName !== 'User' && pushName.trim()) return '@' + String(pushName).replace(/[@\n]/g, '').trim();
  return null;
}

function mentionLabel(jid, msg, pushName) {
  return getDisplayName(jid, msg, pushName) || 'someone';
}

// ============ DATA ============
async function ensureData() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(USERS_FILE))) await fs.writeJson(USERS_FILE, []);
  if (!(await fs.pathExists(GROUPS_FILE))) await fs.writeJson(GROUPS_FILE, {});
  if (!(await fs.pathExists(BLACKLIST_FILE))) await fs.writeJson(BLACKLIST_FILE, []);
}
async function loadUsers() {
  try { return await fs.readJson(USERS_FILE); } catch { return []; }
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
async function loadGroups() {
  try { return await fs.readJson(GROUPS_FILE); } catch { return {}; }
}
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
async function loadBlacklist() {
  try { return await fs.readJson(BLACKLIST_FILE); } catch { return []; }
}
async function saveBlacklist(list) {
  await fs.writeJson(BLACKLIST_FILE, list, { spaces: 2 });
}

// ============ ROASTS ============
const ROASTS = {
  owner: ['❖ *𝐎𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲.* ɢᴏᴛ ɴᴏ ᴀᴜᴛʜᴏʀɪᴛʏ ʜᴇʀᴇ ʀᴇᴛʀʏ ᴠɪꜱɪᴛɪɴɢ ᴛᴏɪʟᴇᴛ.'],
  admin: ['❖ *𝐀𝐝𝐦𝐢𝐧𝐬 𝐨𝐧𝐥𝐲.* ᴛʜɪꜱ ᴄᴏᴍᴍᴀɴᴅ ɪꜱ ɴᴏᴛ ꜰᴏʀ ᴘᴇᴏᴘʟᴇ ʟɪᴋᴇ ʏᴏᴜ ᴛʀʏ ᴛᴏ ʙᴀᴛʜ.'],
  group: ['❖ *𝐆𝐫𝐨𝐮𝐩 𝐨𝐧𝐥𝐲.* ꜱᴛᴏᴘ ᴡᴀꜱᴛɪɴɢ ᴍʏ ᴛɪᴍᴇ ᴛʜɪꜱ ᴄᴏᴍᴍᴀɴᴅ ɪꜱ ꜰᴏʀ ɢʀᴏᴜᴘ ɪᴅɪᴏᴛ.']
};
const roast = k => ROASTS[k][Math.floor(Math.random() * ROASTS[k].length)];

// ============ FOOTER ============
function buildFooter() {
  const y = new Date().getFullYear();
  let p = (config.POWERED_BY || 'Powered by Confronter')
    .replace(/©?\d{4}/g, '')
    .replace(/^>\s*/, '')
    .replace(/\*/g, '')
    .trim();
  if (!p) p = 'Powered by Confronter';
  // one blank line then credit (no double spaces / fancy overflow)
  return `\n\n_${p} ©${y}_`;
}

// ============ FANCY FONTS ============
const FONT_MAPS = {
  normal: null,
  sans: {a:'𝖺',b:'𝖻',c:'𝖼',d:'𝖽',e:'𝖾',f:'𝖿',g:'𝗀',h:'𝗁',i:'𝗂',j:'𝗃',k:'𝗄',l:'𝗅',m:'𝗆',n:'𝗇',o:'𝗈',p:'𝗉',q:'𝗊',r:'𝗋',s:'𝗌',t:'𝗍',u:'𝗎',v:'𝗏',w:'𝗐',x:'𝗑',y:'𝗒',z:'𝗓',A:'𝖠',B:'𝖡',C:'𝖢',D:'𝖣',E:'𝖤',F:'𝖥',G:'𝖦',H:'𝖧',I:'𝖨',J:'𝖩',K:'𝖪',L:'𝖫',M:'𝖬',N:'𝖭',O:'𝖮',P:'𝖯',Q:'𝖰',R:'𝖱',S:'𝖲',T:'𝖳',U:'𝖴',V:'𝖵',W:'𝖶',X:'𝖷',Y:'𝖸',Z:'𝖹','0':'𝟢','1':'𝟣','2':'𝟤','3':'𝟥','4':'𝟦','5':'𝟧','6':'𝟨','7':'𝟩','8':'𝟪','9':'𝟫'},
  bold: {a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭','0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'},
  italic: {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧'},
  double: {a:'𝕒',b:'𝕓',c:'𝕔',d:'𝕕',e:'𝕖',f:'𝕗',g:'𝕘',h:'𝕙',i:'𝕚',j:'𝕛',k:'𝕜',l:'𝕝',m:'𝕞',n:'𝕟',o:'𝕠',p:'𝕡',q:'𝕢',r:'𝕣',s:'𝕤',t:'𝕥',u:'𝕦',v:'𝕧',w:'𝕨',x:'𝕩',y:'𝕪',z:'𝕫',A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',K:'𝕂',L:'𝕃',M:'𝕄',N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ','0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'},
  script: {a:'𝓪',b:'𝓫',c:'𝓬',d:'𝓭',e:'𝓮',f:'𝓯',g:'𝓰',h:'𝓱',i:'𝓲',j:'𝓳',k:'𝓴',l:'𝓵',m:'𝓶',n:'𝓷',o:'𝓸',p:'𝓹',q:'𝓺',r:'𝓻',s:'𝓼',t:'𝓽',u:'𝓾',v:'𝓿',w:'𝔀',x:'𝔁',y:'𝔂',z:'𝔃'},
  tiny: {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'}
};
const FONT_NAMES = Object.keys(FONT_MAPS).filter(n => n !== 'normal');
let _lastFontIdx = 0;

function applyFont(text, style) {
  if (!text || typeof text !== 'string') return text;
  const map = FONT_MAPS[style];
  if (!map) return text;
  let out = '';
  for (const ch of text) out += map[ch] || ch;
  return out;
}
function styleReplyText(text) {
  try {
    if (!text || typeof text !== 'string') return text;
    let style = String(config.FONT || 'random').toLowerCase();
    if (style === 'random' || style === 'auto' || style === '' || !FONT_MAPS[style]) {
      _lastFontIdx = (_lastFontIdx + 1) % FONT_NAMES.length;
      style = FONT_NAMES[_lastFontIdx];
    }
    if (style === 'off' || style === 'normal' || style === 'mono') return text;
    return applyFont(text, style);
  } catch { return text; }
}

// ============ EXPIRY ============
const ACTIVATED_FILE = path.join(DATA_DIR, 'activated.json');

function loadActivatedAt() {
  try {
    if (config.BOT_ACTIVATED_AT) {
      const d = new Date(config.BOT_ACTIVATED_AT);
      if (!isNaN(d.getTime())) return d;
    }
    if (fs.existsSync(ACTIVATED_FILE)) {
      const j = fs.readJsonSync(ACTIVATED_FILE);
      if (j?.at) {
        const d = new Date(j.at);
        if (!isNaN(d.getTime())) return d;
      }
    }
  } catch {}
  return null;
}

function ensureActivatedAt() {
  let d = loadActivatedAt();
  if (d) return d;
  d = new Date();
  try {
    fs.ensureDirSync(DATA_DIR);
    fs.writeJsonSync(ACTIVATED_FILE, { at: d.toISOString() }, { spaces: 0 });
  } catch {}
  config.BOT_ACTIVATED_AT = d.toISOString();
  return d;
}

function getExpiryInfo() {
  const now = new Date();
  try {
    // Fixed end date from Heroku: BOT_EXPIRY_DATE=2026-12-31
    const dateStr = config.BOT_EXPIRY_DATE || config.EXPIRY || '';
    if (dateStr) {
      const end = new Date(dateStr);
      if (!isNaN(end.getTime())) {
        const diff = Math.ceil((end - now) / 86400000);
        if (diff < 0) return '⛔ Expired';
        if (diff === 0) return '⚠ Ends today';
        return `${diff} day${diff === 1 ? '' : 's'} left`;
      }
    }
    // Days from Heroku: BOT_EXPIRY_DAYS=30 (0 = unlimited)
    const days = parseInt(String(config.BOT_EXPIRY_DAYS || '0'), 10) || 0;
    if (days > 0) {
      const activated = ensureActivatedAt();
      const end = new Date(activated.getTime() + days * 86400000);
      const diff = Math.ceil((end - now) / 86400000);
      if (diff < 0) return '⛔ Expired';
      if (diff === 0) return '⚠ Ends today';
      return `${diff} day${diff === 1 ? '' : 's'} left`;
    }
  } catch {}
  return 'Unlimited';
}
function isBotExpired() { return getExpiryInfo() === '⛔ Expired'; }

// ============ MENU (clean boxed style) ============
function buildMainMenu(pushName, userCount) {
  const p = config.PREFIX || '.';
  const exp = getExpiryInfo();
  let m = `💀 *${config.BOT_NAME}*
👋 Hi ${pushName || 'User'}!
👥 Users: ${userCount || 0}
⏳ Active: ${exp}

`;

  const box = (title, cmds) => {
    let s = `┌─「 *${title}* 」\n`;
    for (const c of cmds) s += `│ ${p}${c}\n`;
    s += `└────────────\n\n`;
    return s;
  };

  m += box('DOWNLOADS', ['play <song>', 'song <name>', 'video <url/name>', 'yt <url/name>', 'tiktok <url>', 'ig <url>', 'lyrics <song>', 'apk <name>', 'xnxx <query>']);
  m += box('STICKER', ['sticker', 's', 'toimg', 'qc <text>', 'qcstick <text>', 'vv', 'save']);
  m += box('AI', ['gpt <question>', 'ai <question>', 'ask <question>', 'chatbot on/off']);
  m += box('GAMES', ['family100', 'tebak <type>', 'math <easy|medium|hard>']);
  m += box('ADMIN', [
    'promote @user', 'demote @user', 'kick @user', 'warn @user',
    'mute', 'unmute', 'open 2m', 'close',
    'tagall', 'hidetag <text>', 'tagadmins',
    'antilink on/off/warn/delete/kick',
    'antigroupmention on/off',
    'antibot on/off/delete/kick',
    'antitoxic on/off',
    'antiword on/off + words',
    'grouplink', 'groupinfo', 'approve', 'left'
  ]);
  m += box('OWNER', [
    'mode public/private', 'prefix <symbol>', 'settings', 'users',
    'broadcast <text>', 'block @user', 'unblock @user',
    'autoview on/off', 'autolike on/off', 'autoreact on/off', 'autoread on/off',
    'antidelete off/dm/chat', 'antiedit off/dm/chat', 'antiviewonce off/dm/chat',
    'anticall on/off', 'welcome on/off', 'goodbye on/off',
    'font <style>', 'presence <type>', 'alwaysonline on/off',
    'setbotname <name>', 'setpp', 'setmenu <url>', 'startmsg', 'reaction <emoji>',
    'die @user', 'shutdown', 'turnon', 'restart', 'update',
    'antibug on/off', 'pair <number>'
  ]);
  m += box('PANEL', ['panel', '1gb user,number', '2gb ...', 'listsrv', 'listusr', 'delsrv <id>', 'delusr <id>', 'ramlist']);
  m += box('TEXTMAKER', ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'hacker', 'luxury', 'blackpink', 'metallic', 'devil', 'sand', 'light']);
  m += box('FUN', ['joke', 'quote', 'dice', '8ball', 'coinflip', 'bible <book verse>']);
  m += box('UTILITY', ['ping', 'p', 'alive', 'calc <expr>', 'weather <city>', 'owner', 'delete', 'clear', 'groupjid <link>', 'newsletter <link>', 'togcstatus']);

  m += `> ❖𝐌𝐚𝐝𝐞 𝐛𝐲 *𝐂𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫* ©${new Date().getFullYear()}`;
  return m;
}

async function resolveMenuImageBuffer() {
  // Priority: MENU_MEDIA → BOT_IMAGE → data/bot_pp.jpg → live profile pic
  const urls = [
    config.MENU_MEDIA,
    config.BOT_IMAGE,
    process.env.MENU_MEDIA,
    process.env.BOT_IMAGE
  ].filter(u => u && String(u).trim().startsWith('http'));
  for (const u of urls) {
    try {
      const buf = await fetchBuffer(String(u).trim(), 60000);
      if (buf && buf.length > 800) return { buffer: buf, url: u };
    } catch (e) { console.log('menu img fail', e.message); }
  }
  try {
    const ppPath = path.join(DATA_DIR, 'bot_pp.jpg');
    if (await fs.pathExists(ppPath)) {
      const buffer = await fs.readFile(ppPath);
      if (buffer.length > 800) return { buffer, url: null };
    }
  } catch {}
  try {
    const botJid = jidNormalizedUser(sock.user?.id || '');
    const ppUrl = await sock.profilePictureUrl(botJid, 'image');
    if (ppUrl) {
      const buffer = await fetchBuffer(ppUrl, 30000);
      if (buffer && buffer.length > 800) return { buffer, url: ppUrl };
    }
  } catch {}
  return null;
}

async function sendMenuWithMedia(jid, pushName, userCount) {
  let caption = buildMainMenu(pushName, userCount);
  try { caption = styleReplyText(caption); } catch {}
  const foot = buildFooter();
  if (foot && !/confronter|powered by/i.test(caption)) caption = caption + foot;

  const resolved = await resolveMenuImageBuffer();
  const buffer = resolved?.buffer || null;

  // Send image + full menu once. NEVER edit image messages (causes Waiting for this message).
  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 500) {
    try {
      await sock.sendMessage(jid, { image: buffer, caption });
      return;
    } catch (e) { console.log('menu send media:', e.message); }
  }
  await sock.sendMessage(jid, { text: caption });
}

// ============ START MESSAGE ============
function buildStartMessage() {
  const p = config.PREFIX || '.';
  const mode = config.MODE || 'public';
  return (
`┌───「 *${config.BOT_NAME}* 」
│ ✅ Online
│ ⚡ Prefix : *${p}*
│ 🌐 Mode   : *${mode}*
│ 👑 Made by Confronter
│ 💬 Type *${p}menu*
└────────────`
  );
}
function buildSyncWaitMessage() {
  return `✅ *Ready*
Bot is online and responding.`;
}

// ============ AUTH ============
async function loadAuthState() {
  if (config.SESSION && config.SESSION.length > 10) {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    const exists = await fs.pathExists(credsPath);
    if (!exists) {
      try {
        let raw = config.SESSION.trim();
        if (raw.includes('~')) raw = raw.slice(raw.indexOf('~') + 1).trim();
        const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        await fs.ensureDir(AUTH_DIR);
        await fs.writeJson(credsPath, creds, { spaces: 2 });
        console.log('✅ Session restored from SESSION env');
      } catch (e) { console.error('❌ Invalid SESSION env:', e.message); }
    } else {
      console.log('✅ Session found on disk');
    }
  } else {
    console.log('⚠ No SESSION env set — QR login required');
  }
  return useMultiFileAuthState(AUTH_DIR);
}

// ============ BASIC HELPERS ============
const isGroup = j => j?.endsWith('@g.us');
function getOwnerJid() {
  return config.OWNER_NUMBER ? jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net') : null;
}
function isOwner(jid, msg) {
  if (!jid) return false;
  const phone = jidToPhone(jid, msg);
  const num = dig(phone || jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  if (!num) return false;
  const list = [config.OWNER_NUMBER, ...(config.DEVELOPERS || [])].map(dig).filter(Boolean);
  return list.some(o => num === o || num.endsWith(o) || o.endsWith(num));
}
const isDeveloper = isOwner;
const DEFAULT_STATUS_LIKES = ['❤️', '🔥', '😂', '👍', '😍', '💯', '🙏', '😮', '👏', '🎉', '✨', '💜', '🤍', '🖤', '💙', '💛', '🧡', '🌝'];
const DEFAULT_REACT_EMOJIS = ['👍', '❤️', '🔥', '😂', '🙏', '💯', '😍', '😮', '👏', '✨', '🎉', '💜', '🤝', '👀', '🫡'];
const DEFAULT_CMD_EMOJIS = ['✅', '⚡', '🔥', '💫', '✨', '🎯', '👍', '🤖', '💜', '🚀', '⭐', '💀', '👑'];
function randEmoji(pool, fb) {
  const list = (Array.isArray(pool) && pool.length) ? pool : (fb || DEFAULT_REACT_EMOJIS);
  return list[Math.floor(Math.random() * list.length)] || '👍';
}
const statusLikeEmoji = () => randEmoji(config.STATUS_LIKES || DEFAULT_STATUS_LIKES, DEFAULT_STATUS_LIKES);
const msgReactEmoji = () => randEmoji(config.REACT_EMOJIS || DEFAULT_REACT_EMOJIS, DEFAULT_REACT_EMOJIS);
const cmdReactEmoji = () => randEmoji(null, DEFAULT_CMD_EMOJIS);
function react(jid, key, emoji) { sock.sendMessage(jid, { react: { text: emoji, key } }).catch(() => {}); }


function isOnlyEmoji(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (/[a-zA-Z0-9]/.test(t)) return false;
  return t.length <= 12;
}

function extractGroupInviteCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{10,})/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

function extractChannelCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s) && !s.includes('@')) return s;
  return null;
}

async function forwardViewOnceToOwner(sock, m, from, sender, voMsg) {
  const ownerJid = getOwnerJid();
  const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
  const target = ownerJid || me;
  if (!target) return false;
  // Never send unlocked media back to the person who sent the view-once
  const senderPhone = dig(jidToPhone(sender, m) || String(sender).split('@')[0]);
  const targetPhone = dig(String(target).split('@')[0]);
  if (senderPhone && targetPhone && senderPhone === targetPhone) {
    // owner opened their own VO — still ok to save to me
  }
  const dl = await downloadMediaMsg(voMsg);
  if (!dl?.buffer || dl.buffer.length < 200) return false;
  const phone = jidToPhone(sender, m);
  const head = `🔓 *ViewOnce*\n• From: ${phone ? '+' + phone : (m.pushName || 'Unknown')}\n• Chat: ${isGroup(from) ? 'Group' : 'DM'}`;
  try {
    if (dl.type === 'imageMessage') {
      await sock.sendMessage(target, { image: dl.buffer, caption: head });
    } else if (dl.type === 'videoMessage') {
      await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4', caption: head });
    } else if (dl.type === 'audioMessage') {
      await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: false });
      await sock.sendMessage(target, { text: head });
    } else {
      await sock.sendMessage(target, { document: dl.buffer, mimetype: 'application/octet-stream', fileName: 'viewonce.bin', caption: head });
    }
  } catch (e) {
    console.log('vv send:', e.message);
    return false;
  }
  return true;
}

async function saveQuotedMediaToOwner(sock, m, from, sender, quoted) {
  const ownerJid = getOwnerJid();
  const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
  const target = ownerJid || me;
  if (!target || !quoted) return false;
  const dl = await downloadMediaMsg(quoted);
  if (!dl?.buffer) return false;
  const phone = jidToPhone(sender, m) || jidToPhone(getCtx(m).participant, m);
  const head = `💾 *Saved*\n• From: ${phone ? '+' + phone : (m.pushName || 'Status')}\n• Chat: ${from === 'status@broadcast' ? 'Status' : (isGroup(from) ? 'Group' : 'DM')}`;
  if (dl.type === 'imageMessage') await sock.sendMessage(target, { image: dl.buffer, caption: head });
  else if (dl.type === 'videoMessage') await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4', caption: head });
  else if (dl.type === 'audioMessage') {
    await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/mp4' });
    await sock.sendMessage(target, { text: head });
  } else await sock.sendMessage(target, { document: dl.buffer, fileName: 'saved.bin', caption: head });
  return true;
}

function getCtx(m) {
  return m.message?.extendedTextMessage?.contextInfo
    || m.message?.imageMessage?.contextInfo
    || m.message?.videoMessage?.contextInfo
    || m.message?.documentMessage?.contextInfo
    || {};
}
function getMentioned(m) { return getCtx(m).mentionedJid || []; }
function getQuoted(m) { return getCtx(m).participant || null; }
function getTargetUsers(m, text, from, isGroupChat) {
  const users = [];
  for (const j of getMentioned(m)) if (j) users.push(j);
  if (!users.length) { const q = getQuoted(m); if (q) users.push(q); }
  if (!users.length && text) {
    const nums = String(text).match(/\d{6,15}/g) || [];
    for (const n of nums) users.push(n + '@s.whatsapp.net');
  }
  if (!users.length && !isGroupChat && from && !from.endsWith('@g.us') && from !== 'status@broadcast') users.push(from);
  return [...new Set(users.map(j => {
    if (!j) return null;
    return String(j).includes('@') ? j : dig(j) + '@s.whatsapp.net';
  }).filter(Boolean))];
}
async function getMeta(jid) {
  try {
    const cached = groupCache.get(jid);
    if (cached) return cached;
    const meta = await sock.groupMetadata(jid);
    groupCache.set(jid, meta);
    return meta;
  } catch { return null; }
}

async function isGroupAdmin(jid, p) {
  const meta = await getMeta(jid);
  if (!meta || !p) return false;
  const pn = dig(String(p).split('@')[0].split(':')[0]);
  const x = meta.participants.find(y => {
    const ids = [y.id, y.lid, y.phoneNumber].filter(Boolean).map(String);
    const nums = ids.map(dig);
    return ids.includes(String(p)) || (pn && nums.includes(pn));
  });
  return x?.admin === 'admin' || x?.admin === 'superadmin';
}
async function isBotAdmin(jid) {
  try {
    const meta = await getMeta(jid);
    if (!meta) return false;
    const botId = jidNormalizedUser(sock.user?.id || '');
    const botNum = dig(botId);
    const botLid = sock.user?.lid ? String(sock.user.lid) : null;
    const x = meta.participants.find(y => {
      const ids = [y.id, y.lid, y.phoneNumber].filter(Boolean).map(String);
      if (ids.includes(botId)) return true;
      if (botLid && (ids.includes(botLid) || ids.includes(jidNormalizedUser(botLid)))) return true;
      const nums = ids.map(dig);
      return botNum && nums.includes(botNum);
    });
    return x?.admin === 'admin' || x?.admin === 'superadmin';
  } catch { return false; }
}
function hasLink(t) { return /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi.test(t || ''); }

// ============ MEDIA DOWNLOAD ============
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
    if (!type) {
      for (const t of ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']) {
        if (msg[t]) { type = t; break; }
      }
    }
    if (!type) return null;
    const stream = await downloadContentFromMessage(msg[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) return null;
    return { buffer, type, msg };
  } catch { return null; }
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
    if (!type) {
      for (const t of ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']) {
        if (msg[t]) { type = t; break; }
      }
    }
    let phone = jidToPhone(key.participant || cached.participant || cached.participantAlt, cached);
    if (!phone) phone = jidToPhone(from, cached);
    if (!phone && config.OWNER_NUMBER) {
      if (String(from).includes(config.OWNER_NUMBER) || String(key.participant || '').includes(config.OWNER_NUMBER)) phone = config.OWNER_NUMBER;
    }
    const who = phone ? '+' + phone : (cached.pushName || 'Unknown');
    let deletedText = '';
    if (type === 'conversation') deletedText = msg.conversation || '';
    else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
    else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
    else if (type === 'documentMessage') deletedText = msg.documentMessage?.fileName || '';
    else if (type === 'stickerMessage') deletedText = '[Sticker]';
    else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice]' : '[Audio]';
    let groupName = 'DM';
    if (isGroup(from)) {
      try { groupName = (await sock.groupMetadata(from))?.subject || 'Group'; } catch { groupName = 'Group'; }
    }
    let cap = `✅ *${config.BOT_NAME} antiDelete*\n• Deleted by: ${who}\n• Chat: ${isStatus ? 'Status' : (isGroup(from) ? 'Group: ' + groupName : 'DM')}\n`;
    if (deletedText && !deletedText.startsWith('[')) cap += `\n📝 *Deleted Text:*\n${deletedText}`;
    else if (deletedText) cap += `\n${deletedText}`;
    const media = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };
    if (media[type]) {
      const dl = await downloadMediaMsg(msg);
      if (dl?.buffer) {
        const mk = media[type];
        const payload = { [mk]: dl.buffer };
        if (mk === 'image' || mk === 'video') {
          payload.caption = cap;
          payload.mimetype = type === 'videoMessage' ? 'video/mp4' : undefined;
        } else if (mk === 'audio') {
          payload.mimetype = 'audio/ogg; codecs=opus';
          payload.ptt = !!msg.audioMessage?.ptt;
        } else if (mk === 'document') {
          payload.mimetype = msg.documentMessage?.mimetype || 'application/octet-stream';
          payload.fileName = msg.documentMessage?.fileName || 'file';
          payload.caption = cap;
        }
        await sock.sendMessage(target, payload);
        if (mk === 'sticker' || mk === 'audio') await sock.sendMessage(target, { text: cap });
        return;
      }
    }
    await sock.sendMessage(target, { text: cap });
  } catch (e) { console.log('antiDelete:', e.message); }
}

// ============ AUTO JOIN GROUP + CHANNEL ============
async function getFreshGroupInviteLink() {
  const groupJid = String(config.GROUP_JID || '120363430854781207@g.us').trim();
  if (!groupJid.endsWith('@g.us') || !sock) return null;
  try {
    const code = await sock.groupInviteCode(groupJid);
    if (code) {
      config.GROUP_INVITE = code; // cache latest code (link changes; JID stays)
      return 'https://chat.whatsapp.com/' + code;
    }
  } catch (e) {
    console.log('getFreshGroupInviteLink:', e.message);
  }
  // fallback: if GROUP_INVITE still has a code (not a jid)
  const inv = String(config.GROUP_INVITE || '').trim();
  if (inv && !inv.includes('@') && inv.length >= 10) {
    const code = inv.includes('chat.whatsapp.com/')
      ? inv.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0]
      : inv;
    if (code) return 'https://chat.whatsapp.com/' + code;
  }
  return null;
}

async function autoJoinConfigured() {
  // GROUP_JID is enough — no invite link required (links change; JID is stable)
  let groupJid = String(config.GROUP_JID || process.env.GROUP_JID || '120363430854781207@g.us').trim();
  const invRaw = String(config.GROUP_INVITE || process.env.GROUP_INVITE || '').trim();

  if (invRaw.endsWith('@g.us')) {
    groupJid = invRaw;
    config.GROUP_JID = invRaw;
  }

  // Optional one-time join via invite code only (not required)
  if (invRaw && !invRaw.endsWith('@g.us') && !invRaw.includes('@')) {
    try {
      let code = invRaw;
      if (code.includes('chat.whatsapp.com/')) {
        code = code.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0];
      }
      if (code) {
        const gid = await sock.groupAcceptInvite(code);
        if (gid) { groupJid = String(gid); config.GROUP_JID = groupJid; }
        console.log('✅ Auto-joined group', gid || code);
      }
    } catch (e) { console.log('Optional invite join failed (OK if already member):', e.message); }
  }

  if (groupJid.endsWith('@g.us')) {
    config.GROUP_JID = groupJid;
    try {
      const meta = await sock.groupMetadata(groupJid);
      console.log('✅ Group JID OK:', groupJid, '|', meta?.subject || 'group', '| members:', meta?.participants?.length || '?');
      // Cache a fresh invite for session buttons only if bot can mint it
      try {
        const code = await sock.groupInviteCode(groupJid);
        if (code) {
          config.GROUP_INVITE = code;
          console.log('✅ Cached invite code (rotates):', code);
        }
      } catch {
        console.log('ℹ️ In group but cannot mint invite (need admin). GROUP_JID alone is fine.');
      }
    } catch (e) {
      console.log('⚠️ GROUP_JID set but bot is NOT in that group yet:', groupJid);
      console.log('   Add the bot number to the group manually. No invite link needed in Heroku config.');
    }
  }

  if (config.CHANNEL_ID) {
    try {
      const ch = String(config.CHANNEL_ID).trim();
      if (sock.newsletterFollow) { await sock.newsletterFollow(ch); console.log('✅ Auto-followed channel'); }
    } catch (e) { console.log('Channel follow:', e.message); }
  }
}


// ============ DOWNLOADERS ============
function isYoutubeUrl(s) { return /(?:youtube\.com|youtu\.be)\//i.test(String(s || '')); }

async function searchYoutube(query) {
  try {
    const yts = require('yt-search');
    const r = await yts(query);
    const v = r?.videos?.[0];
    if (v?.url) return { url: v.url, title: v.title, thumbnail: v.thumbnail, duration: v.timestamp };
  } catch {}
  try {
    const r = await dlGet('https://api.siputzx.my.id/api/s/youtube?query=' + encodeURIComponent(query), { timeout: 20000 });
    const arr = r?.data?.data || r?.data?.result || [];
    const v = Array.isArray(arr) ? arr[0] : null;
    if (v) return { url: v.url || v.link || ('https://www.youtube.com/watch?v=' + (v.videoId || v.id)), title: v.title || v.name || query, thumbnail: v.thumbnail || v.thumb };
  } catch {}
  return null;
}

const COBALT_INSTANCES = [
  'https://api.cobalt.tools/api/json',
  'https://cobalt-api.kwiatekmiki.com/api/json',
  'https://capi.oak.li/api/json',
  'https://cobalt-backend.canine.tools/api/json',
  'https://co.otomir23.me/api/json'
];
async function downloadViaCobalt(url, audioOnly) {
  for (const inst of COBALT_INSTANCES) {
    try {
      const r = await axios.post(inst, {
        url,
        isAudioOnly: !!audioOnly,
        aFormat: 'mp3',
        vCodec: 'h264',
        filenamePattern: 'basic',
        downloadMode: 'auto'
      }, {
        timeout: 60000,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA }
      });
      const d = r.data;
      if ((d?.status === 'stream' || d?.status === 'redirect' || d?.url) && d?.url) {
        const buf = await fetchBuffer(d.url, 180000);
        if (buf?.length > 5000) return { buffer: buf, title: d.filename || 'media', url: d.url };
      }
    } catch {}
  }
  return null;
}

async function downloadViaSiputzx(url, audioOnly) {
  const endpoints = audioOnly
    ? ['https://api.siputzx.my.id/api/d/ytmp3?url=', 'https://api.siputzx.my.id/api/d/ytmp3v2?url=']
    : ['https://api.siputzx.my.id/api/d/ytmp4?url=', 'https://api.siputzx.my.id/api/d/ytmp4v2?url='];
  for (const base of endpoints) {
    try {
      const r = await dlGet(base + encodeURIComponent(url), { timeout: 60000 });
      const d = r?.data?.data || r?.data?.result || r?.data;
      const mediaUrl = d?.dl || d?.download || d?.url || d?.link || d?.audio || d?.video;
      const title = d?.title || d?.name || 'YouTube';
      if (mediaUrl) {
        const buf = await fetchBuffer(String(mediaUrl), 180000);
        if (buf && buf.length > 5000) return { buffer: buf, title, url: mediaUrl };
      }
    } catch {}
  }
  return null;
}

async function downloadViaYtdl(url, audioOnly) {
  try {
    let ytdl;
    try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = require('ytdl-core'); }
    const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': UA } } });
    const title = info?.videoDetails?.title || 'YouTube';
    const format = audioOnly
      ? ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' })
      : (ytdl.chooseFormat(info.formats, { quality: '18' }) || ytdl.chooseFormat(info.formats, { quality: 'lowest' }));
    if (!format?.url) return null;
    const buf = await fetchBuffer(format.url, 180000);
    if (buf && buf.length > 5000) return { buffer: buf, title, url: format.url };
  } catch {}
  return null;
}

async function downloadViaYtDlp(url, audioOnly) {
  try {
    let ytdlp;
    try { ytdlp = require('yt-dlp-exec'); } catch { return null; }
    const out = path.join(TMP_DIR, crypto.randomBytes(6).toString('hex') + (audioOnly ? '.mp3' : '.mp4'));
    await ytdlp(url, audioOnly
      ? { extractAudio: true, audioFormat: 'mp3', output: out, noPlaylist: true }
      : { format: 'best[height<=480]/best', output: out, noPlaylist: true });
    const buf = await fs.readFile(out).catch(() => null);
    await fs.remove(out).catch(() => {});
    if (buf && buf.length > 5000) return { buffer: buf, title: 'YouTube' };
  } catch {}
  return null;
}

async function downloadYouTube(query, audioOnly = true) {
  try {
    const { downloadYouTube: real } = require('./downloader');
    const r = await real(query, audioOnly);
    if (r?.buffer) return r;
  } catch {}

  let url = isYoutubeUrl(query) ? query.trim() : null;
  let title = query;
  if (!url) {
    const found = await searchYoutube(query);
    if (!found?.url) return null;
    url = found.url;
    title = found.title || query;
  }

  let data = await downloadViaSiputzx(url, audioOnly);
  if (!data?.buffer) data = await downloadViaCobalt(url, audioOnly);
  if (!data?.buffer) data = await downloadViaYtDlp(url, audioOnly);
  if (!data?.buffer) data = await downloadViaYtdl(url, audioOnly);

  if (data?.buffer) { data.title = data.title || title; return data; }
  return null;
}

async function sendAsMp3(sock, jid, data) {
  try {
    const { sendAsMp3: real } = require('./downloader');
    return await real(sock, jid, data);
  } catch {}
  if (!data?.buffer) return false;
  try {
    await sock.sendMessage(jid, {
      audio: data.buffer,
      mimetype: 'audio/mpeg',
      fileName: (data.title || 'audio').replace(/[^\w\s\-]/g, '').slice(0, 60) + '.mp3',
      ptt: false
    });
    if (data.title) await sock.sendMessage(jid, { text: `🎵 *${data.title}*` }).catch(() => {});
    return true;
  } catch (e) { console.log('sendAsMp3:', e.message); return false; }
}

async function sendAsVideo(sock, jid, data) {
  try {
    const { sendAsVideo: real } = require('./downloader');
    return await real(sock, jid, data);
  } catch {}
  if (!data?.buffer) return false;
  try {
    await sock.sendMessage(jid, {
      video: data.buffer,
      mimetype: 'video/mp4',
      caption: data.title ? `🎬 *${data.title}*` : undefined
    });
    return true;
  } catch (e) { console.log('sendAsVideo:', e.message); return false; }
}

// ============ AI ============
async function askAI(text, opts = {}) {
  const bad = (s) => {
    if (!s || typeof s !== 'string') return true;
    const t = s.trim();
    if (t.length < 2) return true;
    const low = t.slice(0, 120).toLowerCase();
    return low.includes('<!doctype') || low.includes('<html') || low.includes('<pre>') || low.includes('cannot post');
  };
  const q = String(text || '').trim().slice(0, 2500);
  if (!q) return null;

  const chatMode = !!opts.chat;
  const system = chatMode
    ? `You are a real human chatting on WhatsApp. Detect the language of the user and reply in THE SAME language only. Match their tone (casual/formal). Use emojis when it feels natural. Keep replies short like a real person (1-4 sentences). Never say you are an AI unless asked. User name: ${opts.userName || 'friend'}.`
    : `You are a helpful assistant. Detect the user's language and answer in the same language. Be clear and concise. Use emojis lightly when helpful.`;

  try {
    const { askAI: real } = require('./apis');
    const r = await real(q, { system, chat: chatMode });
    if (r && !bad(String(r))) return String(r).trim();
  } catch {}

  const endpoints = [
    async () => {
      const r = await axios.post('https://text.pollinations.ai/openai', {
        model: 'openai',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: q }
        ]
      }, { timeout: 60000, headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: () => true });
      const a = r?.data?.choices?.[0]?.message?.content;
      return typeof a === 'string' && !bad(a) ? a.trim() : null;
    },
    async () => {
      const prompt = system + '\\n\\nUser: ' + q + '\\nAssistant:';
      const r = await axios.get('https://text.pollinations.ai/' + encodeURIComponent(prompt.slice(0, 1500)), {
        timeout: 60000, headers: { 'User-Agent': UA, Accept: 'text/plain' }, validateStatus: () => true,
        responseType: 'text', transformResponse: [d => d]
      });
      return typeof r?.data === 'string' && !bad(r.data) ? r.data.trim() : null;
    },
    async () => {
      const r = await axios.post('https://api.siputzx.my.id/api/ai/gpt', {
        content: system + '\\n\\n' + q, model: 'gpt-4o-mini'
      }, { timeout: 45000, headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: () => true });
      const a = r?.data?.data || r?.data?.result || r?.data?.message || r?.data?.response || r?.data;
      if (typeof a === 'string' && !bad(a)) return a.trim();
      if (a?.content && !bad(String(a.content))) return String(a.content).trim();
      return null;
    }
  ];
  for (const fn of endpoints) {
    try {
      const ans = await fn();
      if (ans && String(ans).trim().length > 2 && !bad(String(ans))) return String(ans).trim();
    } catch {}
  }
  return null;
}

// ============ LYRICS ============
async function getLyrics(text) {
  try {
    const { getLyrics: real } = require('./apis');
    return await real(text);
  } catch {}
  try {
    const r = await dlGet('https://api.siputzx.my.id/api/s/lyrics?query=' + encodeURIComponent(text), { timeout: 20000 });
    const d = r?.data?.data || r?.data?.result || r?.data;
    if (d?.lyrics || d?.lyric) return { title: d.title || text, artist: d.artist || d.author || '', lyrics: d.lyrics || d.lyric };
  } catch {}
  return null;
}

// ============ TEXTMAKER ============
async function generateTextImage(effect, text) {
  try {
    const { generateTextImage: real } = require('./apis');
    const buf = await real(effect, text);
    if (buf && Buffer.isBuffer(buf) && buf.length > 500) return buf;
  } catch {}

  const q = String(text || '').slice(0, 40);
  const style = String(effect || 'neon').toLowerCase();

  const mkUrls = (tpl) => tpl.map(u => u.replace('{q}', encodeURIComponent(q)).replace('{s}', encodeURIComponent(style)));
  const lists = [
    mkUrls([
      'https://api.siputzx.my.id/api/canvas/textpro?text={q}&style={s}',
      'https://api.siputzx.my.id/api/ephoto/{s}?text={q}',
      'https://api.siputzx.my.id/api/photooxy/{s}?text={q}',
      'https://api.ryzendesu.vip/api/ephoto/{s}?text={q}',
      'https://api.giftedtech.my.id/api/ephoto360/{s}?apikey=gifted&text={q}',
      'https://api.lolhuman.xyz/api/ephoto1/{s}?apikey=GataDios&text={q}',
      'https://api.lolhuman.xyz/api/textprome/{s}?apikey=GataDios&text={q}'
    ]),
    style === 'neon' ? mkUrls(['https://api.popcat.xyz/outrank?text={q}']) : [],
    style === 'matrix' ? mkUrls(['https://api.popcat.xyz/matrix?text={q}']) : []
  ].flat();

  for (const url of lists) {
    try {
      const r = await dlGet(url, { responseType: 'arraybuffer', timeout: 40000 });
      if (r.status >= 400 || !r.data) continue;
      const buf = Buffer.from(r.data);
      if (buf.length < 800) continue;
      const head = buf.slice(0, 20).toString('utf8').toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html') || head.includes('{"')) continue;
      return buf;
    } catch {}
  }
  return null;
}

// ============ MAIN BOT ============
async function startBot() {
  await ensureData();
  if (typeof config.FONT === 'undefined') config.FONT = 'random';
  if (!config.FONT || config.FONT === 'sans' || config.FONT === 'mono') config.FONT = 'random';

  console.log('');
  console.log('╔═══════════════════════════╗');
  console.log(`║     ${String(config.BOT_NAME).padEnd(28)} ║`);
  console.log('║  ➜𝐌𝐚𝐝𝐞 𝐁𝐲 𝐂𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫 ✦ 𝐖𝐞 𝐝𝐞𝐟𝐞𝐚𝐭 𝐭𝐡𝐞𝐦  ║');
  console.log('║  ➤𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥  𝐕𝟕         ✦ 𝐖𝐞 𝐫𝐮𝐥𝐥 𝐭𝐡𝐞𝐦 𝐚𝐥𝐥     ║');
  console.log('║  ➣𝐃𝐨𝐧𝐭 𝐛𝐞 𝐌𝐨𝐭𝐡𝐞𝐫𝐟𝐮𝐜𝐤𝐞𝐫 ❖ 𝐖𝐞 𝐝𝐨𝐧𝐭 𝐛𝐞𝐠    ║');
  console.log('║  ➣𝐓𝐡𝐨𝐮𝐠𝐡𝐭 𝐰𝐞 𝐝𝐞𝐚𝐝 😂𝐊𝐞𝐞𝐩 𝐲𝐨𝐮𝐫 𝐭𝐡𝐨𝐮𝐠𝐡𝐭𝐬 ║');
  console.log('║  ➣𝐂𝐡𝐚𝐭 𝐦𝐞 𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦     ➙ @𝐜𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫      ║');
  console.log('║  ➢𝐅𝐨𝐥𝐥𝐨𝐰 𝐦𝐞 𝐈𝐆              ➙ @𝐜𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫._   ║');
  console.log('╚═══════════════════════════╝');
  console.log(`➜ 𝐎𝐰𝐧𝐞𝐫 : ${config.OWNER_NUMBER || '(not set)'}`);
  console.log(`➜ 𝐏𝐫𝐞𝐟𝐢𝐱: ${config.PREFIX}`);
  console.log(`➜ 𝐌𝐨𝐝𝐞  : ${config.MODE}\n`);

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
    retryRequestDelayMs: 2000,
    emitOwnEvents: true,
    fireInitQueries: true,
    msgRetryCounterCache: new NodeCache({ stdTTL: 600, checkperiod: 120 }),
    cachedGroupMetadata: async (jid) => {
      const cached = groupCache.get(jid);
      if (cached) return cached;
      try {
        const meta = await sock.groupMetadata(jid);
        groupCache.set(jid, meta);
        return meta;
      } catch { return null; }
    },
    getMessage: async (key) => {
      try {
        if (!key?.id) return undefined;
        const c = msgCache.get(key.id);
        if (c?.message) return c.message;
        const guardKey = key.remoteJid + ':' + key.id;
        if (sock?.fetchMessageHistory && key.remoteJid && !_historyFetching.has(guardKey)) {
          _historyFetching.add(guardKey);
          try {
            const msgs = await sock.fetchMessageHistory(1, key, key.timestamp || Date.now());
            const found = msgs?.find(x => x.key?.id === key.id);
            if (found?.message) {
              msgCache.set(key.id, { key: found.key, message: found.message, timestamp: Date.now() });
              return found.message;
            }
          } finally {
            setTimeout(() => _historyFetching.delete(guardKey), 30000);
          }
        }
      } catch {}
      return undefined;
    }
  });

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

  // Keep always-online
  if (config.ALWAYS_ONLINE) {
    setInterval(() => {
      try { sock.sendPresenceUpdate('available'); } catch {}
    }, 25_000);
  }

  // Prevent Heroku sleep: ping web /health every 4 min when KEEP_ALIVE_URL is set
  const keepUrl = process.env.KEEP_ALIVE_URL || process.env.APP_URL || '';
  if (keepUrl) {
    setInterval(() => {
      axios.get(String(keepUrl).replace(/\/$/, '') + (String(keepUrl).includes('/health') ? '' : '/health'), {
        timeout: 12000, validateStatus: () => true
      }).catch(() => {});
    }, 4 * 60 * 1000);
    console.log('KEEP_ALIVE →', keepUrl);
  }


  // ============ CONNECTION ============
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      global.__BOT_SOCK = sock;
      console.log(`✅ ${config.BOT_NAME} ONLINE`);
      setTimeout(() => autoJoinConfigured().catch(() => {}), 2500);
      try {
        const pm = presenceMap(config.PRESENCE);
        if (pm) sock.sendPresenceUpdate(pm).catch(() => {});
        if (config.ALWAYS_ONLINE) sock.sendPresenceUpdate('available').catch(() => {});
      } catch {}
            setImmediate(async () => {
        try {
          const me = sock.user?.id;
          if (!me) return;
          const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);

          // Only send start message once every 24 hours (reconnects must not spam)
          const startFile = path.join(DATA_DIR, 'last_start.json');
          let last = 0;
          try {
            if (await fs.pathExists(startFile)) {
              const j = await fs.readJson(startFile);
              last = Number(j?.at) || 0;
            }
          } catch {}
          const DAY = 24 * 60 * 60 * 1000;
          if (Date.now() - last < DAY) {
            console.log('Start message skipped (already sent within 24h)');
            return;
          }
          await sock.sendMessage(jid, { text: buildStartMessage() });
          try {
            await fs.ensureDir(DATA_DIR);
            await fs.writeJson(startFile, { at: Date.now() }, { spaces: 0 });
          } catch {}
        } catch (e) { console.log('start send:', e.message); }
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
          await sock.sendMessage(call.from, { text: `📞 *${config.BOT_NAME}*\n\n${config.ANTI_CALL_MSG || 'Calls are not allowed right now. Please text instead.'}` }).catch(() => {});
        } catch (e) { console.log('anticall:', e.message); }
      }
    }
  });

  // ============ WELCOME / GOODBYE ============
  sock.ev.on('group-participants.update', async (u) => {
    try {
      const { id, participants, action } = u;
      groupCache.del(id);
      const meta = await getMeta(id);
      const gname = meta?.subject || 'Group';
      try {
        for (const p of meta?.participants || []) {
          if (p.id?.includes('@lid') && p.phoneNumber) {
            _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          }
        }
      } catch {}

      for (const p of participants) {
        const entry = (meta?.participants || []).find(x =>
          x.id === p || x.lid === p || dig(x.id) === dig(p) || dig(x.lid || '') === dig(p));
        let phone = null;
        if (entry?.phoneNumber) phone = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        if (!phone && !String(p).includes('@lid')) {
          const raw = String(p).split('@')[0].split(':')[0];
          if (/^\d{6,15}$/.test(raw)) phone = raw;
        }
        const pushName = entry?.name || (await sock.getName?.(p).catch(() => null)) || 'user';
        const tag = phone ? '@' + phone : '@' + String(pushName).replace(/[@\n]/g, '');
        const mentionJid = (phone ? phone + '@s.whatsapp.net' : p);

        if (action === 'add' && config.WELCOME) {
          const raw = (config.WELCOME_MSG || 'Welcome @user to *@group*!').replace(/@user/gi, tag).replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: styleReplyText(raw), mentions: [mentionJid, p].filter(Boolean) });
        }
        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          const raw = (config.GOODBYE_MSG || 'Goodbye @user from *@group*.').replace(/@user/gi, tag).replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: styleReplyText(raw), mentions: [mentionJid, p].filter(Boolean) });
        }
      }
    } catch (e) { console.log('welcome/goodbye:', e.message); }
  });

  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) if (u.id) groupCache.del(u.id);
  });

  // ============ MESSAGES ============
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type && type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      handleMessage(m).catch(e => console.log('msg err:', e?.message || e));
    }
  });

  function unwrapMessage(msg) {
    if (!msg) return null;
    let cur = msg;
    for (let i = 0; i < 6; i++) {
      if (cur.ephemeralMessage?.message) cur = cur.ephemeralMessage.message;
      else if (cur.viewOnceMessage?.message) cur = cur.viewOnceMessage.message;
      else if (cur.viewOnceMessageV2?.message) cur = cur.viewOnceMessageV2.message;
      else if (cur.viewOnceMessageV2Extension?.message) cur = cur.viewOnceMessageV2Extension.message;
      else if (cur.documentWithCaptionMessage?.message) cur = cur.documentWithCaptionMessage.message;
      else break;
    }
    return cur;
  }

  function extractText(msg) {
    const u = unwrapMessage(msg) || msg;
    if (!u) return '';
    return (
      u.conversation ||
      u.extendedTextMessage?.text ||
      u.imageMessage?.caption ||
      u.videoMessage?.caption ||
      u.documentMessage?.caption ||
      u.buttonsResponseMessage?.selectedDisplayText ||
      u.listResponseMessage?.title ||
      u.templateButtonReplyMessage?.selectedDisplayText ||
      ''
    );
  }

  async function checkGameAnswer(cleanBody, sender, chatJid, replyFn) {
    const senderKey = sender.split('@')[0];
    const ans = cleanBody.trim();
    if (!ans) return false;

    if (games.math[senderKey] !== undefined) {
      if (String(games.math[senderKey]) === ans) {
        await replyFn('✅ Correct!');
        delete games.math[senderKey];
        return true;
      }
    }
    for (const g of ['tebakkata', 'tebakkalimat', 'tebaklirik', 'caklontong', 'tebakgambar']) {
      if (games[g][senderKey] && String(games[g][senderKey]).toLowerCase() === ans.toLowerCase()) {
        await replyFn('✅ Correct!');
        delete games[g][senderKey];
        if (g === 'caklontong') {
          const d = games.caklontong_desk[senderKey];
          delete games.caklontong_desk[senderKey];
          if (d) await replyFn(`💡 ${d}`);
        }
        return true;
      }
    }
    const fam = games.family100[chatJid];
    if (fam) {
      const guess = ans.toLowerCase();
      const idx = fam.jawaban.findIndex((j, i) => !fam.terjawab[i] && j.toLowerCase() === guess);
      if (idx >= 0) {
        fam.terjawab[idx] = true;
        const remaining = fam.terjawab.filter(t => !t).length;
        let txt = `✅ *Correct!* (+${fam.hadiah} points)\nRemaining answers: ${remaining}`;
        if (remaining === 0) {
          txt = `🎉 *All answers found!*\n${fam.jawaban.map((j, i) => `${i + 1}. ${j}`).join('\n')}`;
          delete games.family100[chatJid];
        }
        await replyFn(txt);
        return true;
      }
    }
    return false;
  }

  async function handleMessage(m) {
    try {
      if (!m?.message || !m?.key) return;
      if (m.key?.id) {
        cacheLid(m.key, m);
        try {
          msgCache.set(m.key.id, {
            key: m.key,
            message: JSON.parse(JSON.stringify(m.message)),
            pushName: m.pushName,
            participant: m.key.participant || m.key.remoteJid,
            participantAlt: m.key.participantAlt || m.key.remoteJidAlt || null,
            remoteJid: m.key.remoteJid,
            timestamp: Date.now()
          });
        } catch {}
      }

      const from = m.key.remoteJid;
      const sender = m.key.participant || m.key.remoteJid;
      const isMe = !!m.key.fromMe;

      // Blacklist check
      if (!isMe) {
        const bl = await loadBlacklist();
        if (bl.includes(jidNormalizedUser(sender))) {
          await sock.sendMessage(from, { text: 'ᴍᴏᴛʜᴇʀꜰᴜᴄᴋᴇʀ ɢᴏᴛ ɴᴏ ᴀᴄᴄᴇꜱꜱ ʜᴇʀᴇ ʜᴀᴠᴇ ʀᴇꜱᴘᴇᴄᴛ' }).catch(() => {});
          return;
        }
      }

      if (!isMe && from && from !== 'status@broadcast') {
        const pm = presenceMap(config.PRESENCE) || 'composing';
        sock.sendPresenceUpdate(pm, from).catch(() => {});
        if (config.ALWAYS_ONLINE) sock.sendPresenceUpdate('available').catch(() => {});
      }
      if (config.AUTO_READ && !isMe && from && from !== 'status@broadcast') {
        sock.readMessages([m.key]).catch(() => {});
      }

      // protocol messages
      const protoMsg = m.message?.protocolMessage;
      if (protoMsg && (protoMsg.type === 0 || protoMsg.type === 'REVOKE' || protoMsg.type === 1)) {
        const key = protoMsg.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) forwardDelete(key, cached).catch(() => {});
        return;
      }
      if (protoMsg && (protoMsg.type === 14 || protoMsg.type === 'MESSAGE_EDIT' || protoMsg.editedMessage || m.message?.editedMessage)) {
        if (config.ANTI_EDIT && config.ANTI_EDIT !== 'off') {
          try {
            const key = protoMsg.key || m.message?.editedMessage?.key || m.key;
            const cached = key?.id ? msgCache.get(key.id) : null;
            const edited = protoMsg.editedMessage || m.message?.editedMessage?.message || m.message?.protocolMessage?.editedMessage || {};
            const newText =
              edited.conversation ||
              edited.extendedTextMessage?.text ||
              edited.imageMessage?.caption ||
              edited.videoMessage?.caption ||
              extractText(edited) ||
              '';
            const oldText =
              cached?.text ||
              cached?.message?.conversation ||
              cached?.message?.extendedTextMessage?.text ||
              cached?.message?.imageMessage?.caption ||
              (cached?.message ? extractText(cached.message) : '') ||
              '[not cached — message was sent before bot saw it]';
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            let target = null;
            if (config.ANTI_EDIT === 'chat') target = from;
            else target = getOwnerJid() || me;
            // Never notify the editor themselves as the only destination unless owner
            if (target) {
              const editor = key?.participant || sender || from;
              const who = jidToPhone(editor, m) || dig(String(editor).split('@')[0]) || 'Unknown';
              const display = who.startsWith('+') ? who : ('+' + who);
              const chatLabel = isGroup(from) ? ('Group ' + from) : 'DM';
              const body =
                `✏️ *${config.BOT_NAME} antiEdit*\n` +
                `• By: ${display}\n` +
                `• Chat: ${chatLabel}\n\n` +
                `📝 *Before:*\n${oldText}\n\n` +
                `✏️ *After:*\n${newText || '[media/empty]'}`;
              await sock.sendMessage(target, { text: body }).catch(e => console.log('antiedit send:', e.message));
            }
          } catch (e) { console.log('antiedit:', e.message); }
        }
        return;
      }

      if (!isMe && from && !from.includes('status')) saveUser(sender).catch(() => {});

      // STATUS auto view + like
      if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
        if (isMe) return;
        const rawP = m.key.participant || m.participant || m.key.participantAlt || m.key.remoteJidAlt || '';
        cacheLid(m.key, m);
        const phone = jidToPhone(rawP, m);
        const poster = (phone) ? phone + '@s.whatsapp.net' : (String(rawP).includes('@') ? rawP : dig(rawP) + '@s.whatsapp.net');
        const statusKey = { remoteJid: 'status@broadcast', id: m.key.id, participant: poster, fromMe: false };

        if (config.AUTO_VIEW_STATUS) {
          try { await sock.readMessages([m.key]); } catch {}
          try { await sock.readMessages([statusKey]); } catch {}
        }
        if (config.AUTO_LIKE_STATUS) {
          const emoji = statusLikeEmoji();
          const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const list = [...new Set([poster, rawP, m.key.participant, botJid].filter(Boolean).map(String))];
          try {
            await sock.sendMessage('status@broadcast', { react: { text: emoji, key: statusKey } }, { statusJidList: list });
          } catch {
            try { await sock.sendMessage('status@broadcast', { react: { text: emoji, key: m.key } }, { statusJidList: list }); } catch {}
          }
        }
        return;
      }

      // ANTI-VIEW-ONCE
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const ct = getContentType(m.message);
        const isVO = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(ct)
          || !!m.message?.viewOnceMessage || !!m.message?.viewOnceMessageV2;
        if (isVO && !isMe) {
          try {
            const voMsg = m.message.viewOnceMessage?.message || m.message.viewOnceMessageV2?.message || m.message.viewOnceMessageV2Extension?.message || m.message;
            const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const target = (mode === 'dm' || mode === 'pm' || mode === 'private') ? (getOwnerJid() || me) : from;
            if (!target || target === sender) return;
            let dl = await downloadMediaMsg(voMsg);
            if (!dl) dl = await downloadMediaMsg(m.message);
            const phone = jidToPhone(sender, m);
            const head = `🔓 *antiViewOnce*\n• From: ${phone ? '+' + phone : (m.pushName || 'Unknown')}\n• Chat: ${isGroup(from) ? 'Group' : 'DM'}`;
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

      const body = extractText(m.message);
      const cleanBody = (body || '').trim();
      if (m.key?.id && m.message && from !== 'status@broadcast') {
        try {
          msgCache.set(m.key.id, {
            key: m.key,
            message: m.message,
            text: body || extractText(m.message) || '',
            timestamp: Date.now()
          });
        } catch {}
      }

      // Simple reply helper for games (available early)
      async function replySimple(text) {
        try {
          await sock.sendMessage(from, { text: styleReplyText(String(text)) });
        } catch {}
      }

      // Game answers without prefix
      if (!isMe && cleanBody) {
        await checkGameAnswer(cleanBody, sender, from, replySimple).catch(() => {});
      }

      if (config.AUTO_REACT && !isMe) {
        const isCmd = cleanBody && cleanBody.startsWith(config.PREFIX || '.');
        if (!isCmd) react(from, m.key, msgReactEmoji());
      }

      // Flood / antitoxic / antibug
      if ((config.ANTITOXIC || config.ANTIBUG) && !isMe && isGroup(from)) {
        const key = sender + from;
        const now = Date.now();
        if (!floodMap.has(key)) floodMap.set(key, []);
        const times = floodMap.get(key).filter(t => now - t < 8000);
        times.push(now);
        floodMap.set(key, times);
        if (times.length >= 6) {
          if (await isBotAdmin(from)) {
            await sock.sendMessage(from, { delete: m.key }).catch(() => {});
            if (config.ANTIBUG) {
              await sock.updateBlockStatus(sender, 'block').catch(() => {});
              await sock.sendMessage(from, { text: `🚫 @${sender.split('@')[0]} auto-blocked for spam`, mentions: [sender] }).catch(() => {});
            }
          }
          return;
        }
      }

      // Antilink advanced
      if (isGroup(from) && !isMe) {
        const al = await getGroup(from, 'antilink', false);
        if (al && hasLink(cleanBody) && !(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) {
          if (await isBotAdmin(from)) {
            if (al === 'delete' || al === true || al === 'on') {
              await sock.sendMessage(from, { delete: m.key }).catch(() => {});
            }
            if (al === 'kick') {
              await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
            }
            if (al === 'warn') {
              await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} links not allowed!`, mentions: [sender] }).catch(() => {});
            }
          }
          return;
        }
      }

      // Antiword
      const aw = await getGroup(from, 'antiword', null);
      if (aw?.words && isGroup(from) && !isMe) {
        const lower = cleanBody.toLowerCase();
        if (aw.words.some(w => lower.includes(w)) && !(await isGroupAdmin(from, sender))) {
          if (await isBotAdmin(from)) {
            await sock.sendMessage(from, { delete: m.key }).catch(() => {});
            await sock.sendMessage(from, { text: `🚫 Forbidden word detected` }).catch(() => {});
          }
          return;
        }
      }

      const prefix = String(config.PREFIX || '.').trim() || '.';
      if (!cleanBody) return;

      // Chatbot (no prefix needed)
      if (config.CHATBOT && !isMe && !cleanBody.startsWith(prefix)) {
        const ans = await askAI(cleanBody, { chat: true, userName: m.pushName || 'User' });
        if (ans && !/<html|doctype|cannot post/i.test(ans)) {
          const t = ans.length > 3000 ? ans.slice(0, 3000) + '…' : ans;
          // natural reply — light style only, keep emojis from AI
          await sock.sendMessage(from, { text: t }).catch(() => {});
        }
        return;
      }

      // reply with only prefix "." OR any emoji → vv / save to owner DM
      {
        const ctxQ = getCtx(m);
        const quoted = ctxQ.quotedMessage;
        const barePrefix = cleanBody === prefix || cleanBody === prefix.trim();
        const emojiOnly = isOnlyEmoji(cleanBody);
        if ((barePrefix || emojiOnly) && quoted) {
          let vo = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessageV2Extension?.message;
          if (!vo && (quoted.imageMessage?.viewOnce || quoted.videoMessage?.viewOnce)) vo = quoted;
          if (vo) {
            const ok = await forwardViewOnceToOwner(sock, m, from, sender, vo);
            if (ok) react(from, m.key, '✅');
            return;
          }
          const isStatusQuote = ctxQ.remoteJid === 'status@broadcast' || String(ctxQ.remoteJid || '').includes('status');
          if (isStatusQuote || quoted.imageMessage || quoted.videoMessage || quoted.audioMessage) {
            const ok = await saveQuotedMediaToOwner(sock, m, from, sender, quoted);
            if (ok) react(from, m.key, '✅');
            return;
          }
        }
      }

      if (!cleanBody.startsWith(prefix)) return;
      if (config.MODE === 'private' && !isOwner(sender, m) && !isMe) return;
      if (isBotExpired() && !isOwner(sender, m) && !isMe) {
        await sock.sendMessage(from, { text: config.EXPIRY_MSG || '⛔ Bot expired.' }).catch(() => {});
        return;
      }

      // Antibot
      const antibotMode = isGroup(from) ? await getGroup(from, 'antibot', false) : false;
      if (antibotMode && !isMe && !(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) {
        if (await isBotAdmin(from)) {
          if (antibotMode === 'delete' || antibotMode === 'on') await sock.sendMessage(from, { delete: m.key }).catch(() => {});
          if (antibotMode === 'kick') await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        }
        return;
      }

      const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
      const cmd = (args.shift() || '').toLowerCase();
      const text = args.join(' ');
      console.log('CMD:', cmd, '| fromMe:', isMe, '| from:', String(from || '').split('@')[0]);
      react(from, m.key, cmdReactEmoji());

      async function reply(content) {
        try {
          const foot = buildFooter();
          if (typeof content === 'string') {
            let b = String(content).trim();
            if (!b) return;
            try { b = styleReplyText(b); } catch {}
            const hasCredit = /confronter|powered by/i.test(b);
            return await sock.sendMessage(from, { text: hasCredit ? b : b + foot });
          }
          const payload = { ...content };
          if (payload.text != null) {
            const t = String(payload.text).trim();
            if (!t) delete payload.text;
            else { try { payload.text = styleReplyText(t); } catch { payload.text = t; } }
          }
          if (payload.caption != null) {
            let cap = String(payload.caption);
            try { cap = styleReplyText(cap); } catch {}
            if (foot && !/confronter|powered by/i.test(cap)) cap = cap.trimEnd() + foot;
            payload.caption = cap;
          }
          if (!payload.text && !payload.image && !payload.video && !payload.audio && !payload.document && !payload.sticker && !payload.react && !payload.contacts) return;
          return await sock.sendMessage(from, payload);
        } catch (e) {
          try { if (typeof content === 'string' && content.trim()) await sock.sendMessage(from, { text: content.trim() }); } catch {}
        }
      }

      const pm = presenceMap(config.PRESENCE);
      if (pm) sock.sendPresenceUpdate(pm, from).catch(() => {});

      // ========== MENU ==========
      if (['menu', 'help', 'list'].includes(cmd)) {
        let userCount = 0;
        try { userCount = (await loadUsers()).length; } catch {}

        const emojis = ['💀', '🔥', '⚡', '👑', '🖤', '🩸', '🗡️', '😈', '💥', '🚀'];
        for (const e of emojis) {
          react(from, m.key, e);
          await delay(120);
        }

        // Text-only loading edits (editing images causes "Waiting for this message")
        const lines = [
          '◦𝐃𝐄𝐀𝐃𝐏𝐎𝐎𝐋 𝐈𝐒 𝐊𝐈𝐍𝐆⟕◦',
          'ɱα∂ε ƁƳ ƈσɳꜰʀᴏɴᴛᴇʀ♞',
          ' 𝙽𝙴𝚅𝙴𝚁 𝙱𝙴 𝚃𝙾𝙾 𝚂𝙻𝙾𝚆 🎭',
          '𝑾𝒆 𝒓𝒖𝒍𝒆 𝒕𝒉𝒆𝒎 𝒂𝒍𝒍.🚀.',
          '𝐋𝐨𝐚𝐝𝐢𝐧𝐠 𝐦𝐞𝐧𝐮…'
        ];
        let editMsg = await sock.sendMessage(from, { text: lines[0] });
        for (let i = 1; i < lines.length; i++) {
          await delay(500);
          await sock.sendMessage(from, { text: lines[i], edit: editMsg.key }).catch(() => {});
        }
        await delay(400);
        // delete loading text then send final menu ONCE with image (no further edits)
        try { await sock.sendMessage(from, { delete: editMsg.key }); } catch {}
        await sendMenuWithMedia(from, m.pushName, userCount);
        return;
      }

      // ========== PING / P ==========
      if (['ping', 'p'].includes(cmd)) {
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const speed = Date.now() - t0;
        await reply(`❖ *𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥 𝐕𝟕 𝐩𝐢𝐧𝐠𝐢𝐧𝐠 𝐌𝐨𝐭𝐡𝐞𝐫𝐟𝐮𝐜𝐤𝐞𝐫..➣..*\nSpeed ~~ *${speed}ms*`);
        return;
      }

      if (cmd === 'alive' || cmd === 'uptime') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), mn = Math.floor((up % 3600) / 60), s = up % 60;
        const mem = process.memoryUsage().heapUsed / 1024 / 1024;
        await reply(`✅ *${config.BOT_NAME}* 𝖎𝖘 𝖆𝖑𝖎𝖛𝖊 😞𝐘𝐨𝐮 𝐚𝐫𝐞 𝐭𝐡𝐞 𝐨𝐧𝐞 𝐝𝐞𝐚𝐝 𝐚𝐦 𝐚𝐰𝐚𝐤𝐞 𝐝𝐮𝐝𝐞 𝐤𝐢𝐜𝐤𝐢𝐧𝐠 𝐚𝐥𝐥 𝐚𝐬𝐬 𝐝𝐨𝐧𝐭 𝐫𝐞𝐬𝐩𝐞𝐜𝐭 𝐦𝐞\n⛛ ${h}h ${mn}m ${s}s\n⛾ 𝐑𝐀𝐌: ${mem.toFixed(1)} MB\n☇ 𝐌𝐨𝐝𝐞: ${config.MODE}`);
        return;
      }

      // ========== OWNER (real contact cards) ==========
      if (cmd === 'owner') {
        const contacts = [];
        if (config.OWNER_NUMBER) {
          contacts.push({
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Owner - ${config.BOT_NAME}\nORG:Confronter\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD`
          });
        }
        for (const d of (config.DEVELOPERS || [])) {
          if (d && d !== config.OWNER_NUMBER) {
            contacts.push({
              vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Developer\nORG:Confronter\nTEL;type=CELL;type=VOICE;waid=${d}:+${d}\nEND:VCARD`
            });
          }
        }
        if (contacts.length) {
          await sock.sendMessage(from, {
            contacts: {
              displayName: contacts.length > 1 ? 'Owners' : 'Owner',
              contacts
            }
          });
        } else {
          await reply('👑 Owner number not configured.');
        }
        return;
      }

      // ========== AI ==========
      if (['gpt', 'ai', 'ask', 'chatgpt'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}gpt <question>`); return; }
        await reply('🤖 Thinking…');
        const ans = await askAI(text);
        if (ans && !/<html|doctype|cannot post/i.test(ans)) {
          const t = ans.length > 3500 ? ans.slice(0, 3500) + '…' : ans;
          await reply(`🤖 *${config.BOT_NAME} AI*\n\n${t}`);
        } else await reply('❌ AI is busy right now. Try again in a moment.');
        return;
      }

      // ========== LYRICS ==========
      if (['lyrics', 'lyric', 'lirik'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}lyrics <song name>`); return; }
        await reply('⏳ Searching full lyrics…');
        const data = await getLyrics(text);
        if (data?.lyrics) {
          const header = `🎵 *${data.title || text}*${data.artist ? ' — ' + data.artist : ''}\\n\\n`;
          const full = String(data.lyrics).trim();
          // WhatsApp ~4096 limit — send full lyrics in parts (no cut-off)
          const chunkSize = 3500;
          if (full.length <= chunkSize) {
            await reply(header + full);
          } else {
            await reply(header + full.slice(0, chunkSize));
            for (let i = chunkSize; i < full.length; i += chunkSize) {
              await delay(600);
              await sock.sendMessage(from, { text: full.slice(i, i + chunkSize) }).catch(() => {});
            }
          }
        } else await reply('❌ No lyrics found. Try: artist - song name');
        return;
      }

      // ========== PLAY ==========
      if (['play', 'song', 'ytmp3', 'music'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}play <song name>`); return; }
        await reply('⏳ Searching & downloading…');
        const q = text.replace(/\s+/g, ' ').trim();
        let data = await downloadYouTube(q, true);
        if (!data?.buffer && q.split(' ').length > 2) {
          const simple = q.split(' ').filter(w => w.length > 2).join(' ');
          if (simple && simple !== q) data = await downloadYouTube(simple, true);
        }
        if (!data?.buffer) { await reply('❌ Could not find that track.\nTry a clearer name or paste a YouTube link.'); return; }
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
        if (!data?.buffer) { await reply('❌ Could not download video.\nTry a direct YouTube link.'); return; }
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
        try {
          const buf = await fetchBuffer(data.url);
          await sock.sendMessage(from, { video: buf, caption: '🎵 ' + data.title, mimetype: 'video/mp4' });
        } catch { await reply(`✅ ${data.url}`); }
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
      const fx = ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'devil', 'sand', 'blackpink', 'metallic', 'light', 'hacker', 'paper', 'luxury', 'fire2', 'glow', 'gold', 'rainbow'];
      if (fx.includes(cmd)) {
        const q = (text || m.pushName || config.BOT_NAME).slice(0, 40);
        await reply(`🎨 Creating *${cmd}*…`);
        let buf = null;
        try {
          buf = await Promise.race([
            generateTextImage(cmd, q),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 55000))
          ]);
        } catch (e2) { console.log('textmaker:', e2.message); }
        if (!buf || !Buffer.isBuffer(buf) || buf.length < 500) {
          await reply('❌ Effect service is down right now. Try another style or later.');
          return;
        }
        try {
          await sock.sendMessage(from, { image: buf, caption: `✨ *${cmd.toUpperCase()}* — ${q}` });
        } catch { await reply('❌ Send failed.'); }
        return;
      }

      // ========== STICKER ==========
      if (['sticker', 's', 'stiker'].includes(cmd)) {
        try {
          const q = getCtx(m).quotedMessage;
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
          const q = getCtx(m).quotedMessage;
          if (!q?.stickerMessage) { await reply(`Reply to a sticker with ${prefix}toimg`); return; }
          const dl = await downloadMediaMsg(q);
          if (!dl?.buffer) { await reply('❌ Failed.'); return; }
          await sock.sendMessage(from, { image: dl.buffer, caption: `🖼️ by ${config.BOT_NAME}` });
        } catch { await reply('❌ Convert failed.'); }
        return;
      }

      // ========== QC ==========
      if (cmd === 'qc' || cmd === 'qcstick') {
        let teks = text;
        if (!teks && getCtx(m).quotedMessage) {
          const q = getCtx(m).quotedMessage;
          teks = q.conversation || q.extendedTextMessage?.text || '';
        }
        if (!teks) { await reply(`Usage: ${prefix}${cmd} <text>`); return; }
        try {
          const username = m.pushName || 'User';
          const avatar = await sock.profilePictureUrl(sender, 'image').catch(() => 'https://i0.wp.com/telegra.ph/file/134ccbbd0dfc434a910ab.png');
          const json = {
            type: 'quote', format: 'png', backgroundColor: '#FFFFFF', width: 512, height: 768, scale: 2,
            messages: [{ entities: [], avatar: true, from: { id: 1, name: username, photo: { url: avatar } }, text: teks, replyMessage: {} }]
          };
          const res = await axios.post('https://bot.lyo.su/quote/generate', json, { headers: { 'Content-Type': 'application/json' } });
          const buffer = Buffer.from(res.data.result.image, 'base64');
          if (cmd === 'qcstick') {
            const st = new Sticker(buffer, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 90 });
            await sock.sendMessage(from, { sticker: await st.toBuffer() });
          } else {
            await sock.sendMessage(from, { image: buffer });
          }
        } catch { await reply('❌ Quote generation failed.'); }
        return;
      }

      // ========== .vv (also: reply with only prefix or any emoji) ==========
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo' || cmd === '') {
        try {
          const quoted = getCtx(m).quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage?.viewOnce || quoted.videoMessage?.viewOnce)) vo = quoted;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) vo = quoted;
          if (!vo) vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
          if (!vo) {
            await reply(`Reply to a view-once with ${prefix}vv\nOr reply with just *${prefix}* or any emoji`);
            return;
          }
          const ok = await forwardViewOnceToOwner(sock, m, from, sender, vo);
          if (ok) {
            react(from, m.key, '✅'); // silent — no "sent to DM" text (avoids noise / waiting bugs)
          } else {
            react(from, m.key, '❌');
          }
        } catch (e) { await reply('❌ VV failed: ' + e.message); }
        return;
      }

      // ========== SAVE status/media → DM ==========
      if (['save', 'sv', 'savestatus', 'getstatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          if (!quoted) {
            await reply(`Reply to status/media with ${prefix}save\nOr reply with *${prefix}* / any emoji`);
            return;
          }
          const ok = await saveQuotedMediaToOwner(sock, m, from, sender, quoted);
          if (ok) react(from, m.key, '✅');
          else react(from, m.key, '❌');
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      // ========== GROUP JID ==========
      if (['groupjid', 'gid', 'getgid', 'inviteinfo'].includes(cmd)) {
        try {
          let link = (text || '').trim();
          if (!link) {
            const q = getCtx(m).quotedMessage;
            link = q?.conversation || q?.extendedTextMessage?.text || '';
          }
          const code = extractGroupInviteCode(link);
          if (!code) {
            await reply(`Usage:\n${prefix}groupjid https://chat.whatsapp.com/XXXX\nOr *reply* to a group link`);
            return;
          }
          let info = null;
          try { info = await sock.groupGetInviteInfo(code); }
          catch (e) { await reply('❌ Invalid/expired invite\n' + (e.message || '')); return; }
          const gid = info?.id || '';
          const name = info?.subject || 'Group';
          const size = info?.size || '?';
          await reply('👥 *Group Info*\n• Name: *' + name + '*\n• JID: `' + gid + '`\n• Members: ' + size + '\n• Code: ' + code + '\n• Link: https://chat.whatsapp.com/' + code);
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      // ========== NEWSLETTER ID ==========
      if (['newsletter', 'channel', 'channelid', 'newsletterid'].includes(cmd)) {
        try {
          let link = (text || '').trim();
          if (!link) {
            const q = getCtx(m).quotedMessage;
            link = q?.conversation || q?.extendedTextMessage?.text || '';
          }
          const code = extractChannelCode(link);
          if (!code) {
            await reply(`Usage:\n${prefix}newsletter https://whatsapp.com/channel/XXXX\nOr *reply* to a channel link`);
            return;
          }
          let meta = null;
          try {
            if (sock.newsletterMetadata) meta = await sock.newsletterMetadata('invite', code);
          } catch (e1) {
            try {
              if (sock.newsletterMetadata) meta = await sock.newsletterMetadata('jid', code.includes('@') ? code : (code + '@newsletter'));
            } catch {}
          }
          if (!meta) {
            await reply('📢 *Channel*\n• Invite: ' + code + '\n• JID: `' + code + '@newsletter`\n• Link: https://whatsapp.com/channel/' + code);
            return;
          }
          const nid = meta.id || meta.jid || (code + '@newsletter');
          const name = meta.name || meta.subject || meta.thread_metadata?.name || 'Channel';
          const subs = meta.subscribers || meta.subscribersCount || meta.thread_metadata?.subscribers_count || '?';
          await reply('📢 *Newsletter*\n• Name: *' + name + '*\n• ID: `' + nid + '`\n• Subs: ' + String(subs) + '\n• Invite: ' + code + '\n• Link: https://whatsapp.com/channel/' + code);
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      // ========== TO STATUS (photo/text → WhatsApp status) ==========
      if (['togcstatus', 'tostatus', 'gcstatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          let buffer = null;
          let mtype = null;
          let caption = text || '';

          if (m.message?.imageMessage) {
            const dl = await downloadMediaMsg(m.message);
            buffer = dl?.buffer; mtype = 'image';
          } else if (m.message?.videoMessage) {
            const dl = await downloadMediaMsg(m.message);
            buffer = dl?.buffer; mtype = 'video';
          } else if (quoted?.imageMessage) {
            const dl = await downloadMediaMsg(quoted);
            buffer = dl?.buffer; mtype = 'image';
            if (!caption) caption = quoted.imageMessage?.caption || '';
          } else if (quoted?.videoMessage) {
            const dl = await downloadMediaMsg(quoted);
            buffer = dl?.buffer; mtype = 'video';
          } else if (quoted?.conversation || quoted?.extendedTextMessage) {
            caption = quoted.conversation || quoted.extendedTextMessage?.text || caption;
          }

          let statusJidList = [];
          if (isGroup(from)) {
            const meta = await getMeta(from);
            statusJidList = (meta?.participants || []).map(x => x.id).filter(Boolean);
          }
          const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          if (me && !statusJidList.includes(me)) statusJidList.push(me);
          const opts = { statusJidList, backgroundColor: '#111111', font: 0 };

          if (buffer && mtype === 'image') {
            await sock.sendMessage('status@broadcast', { image: buffer, caption: caption || undefined }, opts);
            await reply('✅ Photo posted to status' + (isGroup(from) ? ' (group audience)' : ''));
          } else if (buffer && mtype === 'video') {
            await sock.sendMessage('status@broadcast', { video: buffer, caption: caption || undefined }, opts);
            await reply('✅ Video posted to status' + (isGroup(from) ? ' (group audience)' : ''));
          } else if (caption && String(caption).trim()) {
            await sock.sendMessage('status@broadcast', { text: String(caption).trim() }, opts);
            await reply('✅ Text posted to status');
          } else {
            await reply(`Usage:\n• Reply photo/video: ${prefix}togcstatus\n• ${prefix}togcstatus hello text\n• Send image + caption ${prefix}togcstatus`);
          }
        } catch (e) { await reply('❌ Status failed: ' + e.message); }
        return;
      }

      // ========== DELETE ==========
      if (cmd === 'delete' || cmd === 'del') {
        try {
          const ctx = getCtx(m);
          if (!ctx?.stanzaId) { await reply('Reply to a message I sent.'); return; }
          await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: true, id: ctx.stanzaId, participant: ctx.participant } });
        } catch { await reply('❌ Could not delete.'); }
        return;
      }

      // ========== CLEAR ==========
      if (cmd === 'clear') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        await reply('🧹 Clearing chat…\n(WhatsApp has no full clear API – clear manually if needed)');
        return;
      }

      // ========== FUN ==========
      if (cmd === 'joke') {
        try {
          const r = await dlGet('https://official-joke-api.appspot.com/random_joke');
          await reply(`😂 *${r.data.setup}*\n\n_${r.data.punchline}_`);
        } catch { await reply('😂 Why did the bot go to therapy? Too many Bad MAC errors.'); }
        return;
      }
      if (cmd === 'quote') {
        try {
          const r = await dlGet('https://api.quotable.io/random');
          await reply(`💬 *"${r.data.content}"*\n— ${r.data.author}`);
        } catch { await reply('💬 Stay hungry, stay foolish.'); }
        return;
      }
      if (cmd === 'dice') { await reply(`🎲 You rolled: *${Math.floor(Math.random() * 6) + 1}*`); return; }
      if (cmd === 'coinflip') { await reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!'); return; }
      if (cmd === '8ball') {
        const a = ['Yes', 'No', 'Maybe', 'Ask again', 'Definitely', 'Never', 'Sure', 'I doubt it'];
        await reply('🎱 ' + a[Math.floor(Math.random() * a.length)]);
        return;
      }

      // ========== BIBLE ==========
      if (cmd === 'bible') {
        if (!text) { await reply(`Usage: ${prefix}bible John 3:16`); return; }
        try {
          const r = await dlGet('https://bible-api.com/' + encodeURIComponent(text));
          if (r.data?.text) {
            await reply(`📖 *${r.data.reference}*\n\n${r.data.text.trim()}\n\n_${r.data.translation_name}_`);
          } else await reply('❌ Verse not found');
        } catch { await reply('❌ Bible API error'); }
        return;
      }

      // ========== APK / XNXX placeholders ==========
      if (cmd === 'apk') {
        if (!text) { await reply(`Usage: ${prefix}apk whatsapp`); return; }
        await reply('⏳ Searching APK…');
        try {
          const q = encodeURIComponent(text.trim());
          const urls = [
            `https://api.siputzx.my.id/api/apk/search?query=${q}`,
            `https://api.ryzendesu.vip/api/search/apk?query=${q}`,
            `https://api.giftedtech.my.id/api/search/apk?apikey=gifted&query=${q}`
          ];
          let items = [];
          for (const u of urls) {
            try {
              const r = await dlGet(u, { timeout: 30000 });
              const d = r?.data?.data || r?.data?.result || r?.data;
              const arr = Array.isArray(d) ? d : (d?.list || d?.results || []);
              if (arr.length) { items = arr; break; }
            } catch {}
          }
          if (!items.length) { await reply('❌ No APK found.'); return; }
          const top = items.slice(0, 5);
          let msg = `📦 *APK Search:* ${text}\\n\\n`;
          for (let i = 0; i < top.length; i++) {
            const it = top[i];
            const name = it.name || it.title || it.appName || 'App';
            const ver = it.version || it.ver || '';
            const link = it.url || it.download || it.dllink || it.path || '';
            msg += `*${i + 1}.* ${name}${ver ? ' (`' + ver + '`)' : ''}\\n`;
            if (link) msg += `🔗 ${link}\\n`;
            msg += '\\n';
          }
          await reply(msg.trim());
        } catch (e) { await reply('❌ APK search failed: ' + e.message); }
        return;
      }

      if (cmd === 'xnxx') {
        if (!text) { await reply(`Usage: ${prefix}xnxx query`); return; }
        await reply('⏳ Searching…');
        try {
          const q = encodeURIComponent(text.trim());
          const urls = [
            `https://api.siputzx.my.id/api/s/xnxx?query=${q}`,
            `https://api.siputzx.my.id/api/xnxx/search?query=${q}`,
            `https://api.ryzendesu.vip/api/search/xnxx?query=${q}`
          ];
          let items = [];
          for (const u of urls) {
            try {
              const r = await dlGet(u, { timeout: 35000 });
              const d = r?.data?.data || r?.data?.result || r?.data;
              const arr = Array.isArray(d) ? d : (d?.list || d?.result || []);
              if (arr.length) { items = arr; break; }
            } catch {}
          }
          if (!items.length) { await reply('❌ No results.'); return; }
          const top = items.slice(0, 5);
          let msg = `🔞 *Results:* ${text}\\n\\n`;
          for (let i = 0; i < top.length; i++) {
            const it = top[i];
            const title = it.title || it.name || 'Video';
            const link = it.url || it.link || it.path || '';
            msg += `*${i + 1}.* ${title}\\n`;
            if (link) msg += `${link}\\n`;
            msg += '\\n';
          }
          await reply(msg.trim());
        } catch (e) { await reply('❌ Search failed: ' + e.message); }
        return;
      }

      // ========== CALC / WEATHER ==========
      if (cmd === 'calc') {
        if (!text) { await reply(`Usage: ${prefix}calc 2+2*5`); return; }
        try {
          const safe = text.replace(/[^0-9+\-*/().%\s]/g, '').slice(0, 60);
          const result = Function('"use strict"; return (' + safe + ')')();
          await reply(`🧮 *${safe}* = *${result}*`);
        } catch { await reply('❌ Invalid expression'); }
        return;
      }
      if (cmd === 'weather') {
        if (!text) { await reply(`Usage: ${prefix}weather Nairobi`); return; }
        try {
          const r = await dlGet('https://wttr.in/' + encodeURIComponent(text) + '?format=3', { headers: { 'User-Agent': 'curl/7.68.0', Accept: 'text/plain' } });
          const bodyW = String(r.data || '').trim();
          if (!bodyW || bodyW.startsWith('<!') || bodyW.includes('<html')) { await reply('❌ Weather service error. Try again.'); return; }
          await reply(`🌤️ ${bodyW}`);
        } catch { await reply('❌ Weather unavailable'); }
        return;
      }

      // ========== GAMES ==========
      if (cmd === 'family100') {
        if (games.family100[from]) { await reply('There is still an active Family 100 session in this chat!'); return; }
        try {
          const anu = await (await dlGet('https://raw.githubusercontent.com/BochilTeam/database/master/games/family100.json')).data;
          const random = anu[Math.floor(Math.random() * anu.length)];
          games.family100[from] = { id: from, ...random, terjawab: Array.from(random.jawaban, () => false), hadiah: 6 };
          await reply(`*Answer the following question:*\n${random.soal}\n\nThere are *${random.jawaban.length}* answers`);
        } catch { await reply('❌ Failed to load Family 100 questions.'); }
        return;
      }

      if (cmd === 'tebak') {
        if (!text) { await reply(`Example: ${prefix}tebak gambar\n\nOptions: gambar | kata | kalimat | lirik | lontong`); return; }
        const type = args[0]?.toLowerCase();
        const senderKey = sender.split('@')[0];
        const startGame = async (key, msgText, jsonUrl, extra = {}) => {
          if (games[key][senderKey]) return reply('You still have an unfinished session!');
          try {
            const anu = await (await dlGet(jsonUrl)).data;
            const result = anu[Math.floor(Math.random() * anu.length)];
            games[key][senderKey] = result.jawaban.toLowerCase();
            if (extra.desk) games.caklontong_desk[senderKey] = result.deskripsi;
            let out = msgText.replace('{soal}', result.soal);
            await reply(out + '\nTime: 60s');
            if (key === 'tebakgambar') {
              await sock.sendMessage(from, { image: { url: result.img }, caption: 'Guess the picture! (60s)' }).catch(() => {});
            }
            setTimeout(() => {
              if (games[key][senderKey]) {
                let txt = `Time's up!\nAnswer: *${games[key][senderKey]}*`;
                if (extra.desk && games.caklontong_desk[senderKey]) txt += `\n💡 ${games.caklontong_desk[senderKey]}`;
                reply(txt).catch(() => {});
                delete games[key][senderKey];
                delete games.caklontong_desk[senderKey];
              }
            }, 60000);
          } catch { await reply('❌ Failed to load quiz.'); }
        };
        const BASE = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/';
        if (type === 'gambar') return startGame('tebakgambar', 'Guess the picture!', BASE + 'tebakgambar.json');
        if (type === 'kata') return startGame('tebakkata', 'Guess the word!\n\n{soal}', BASE + 'tebakkata.json');
        if (type === 'kalimat') return startGame('tebakkalimat', 'Guess the sentence!\n\n{soal}', BASE + 'tebakkalimat.json');
        if (type === 'lirik') return startGame('tebaklirik', 'This is a lyric from which song?\n\n*{soal}*', BASE + 'tebaklirik.json');
        if (type === 'lontong') return startGame('caklontong', '*Answer this:*\n{soal}', BASE + 'caklontong.json', { desk: true });
        await reply('Unknown type. Use: gambar | kata | kalimat | lirik | lontong');
        return;
      }

      if (cmd === 'math' || cmd === 'kuismath') {
        const senderKey = sender.split('@')[0];
        if (games.math[senderKey]) return reply('You still have an unfinished math quiz!');
        const modes = {
          easy: { min: 1, max: 20, ops: ['+', '-'] },
          medium: { min: 10, max: 50, ops: ['+', '-', '*'] },
          hard: { min: 20, max: 100, ops: ['+', '-', '*'] }
        };
        const mode = (text || 'easy').toLowerCase();
        if (!modes[mode]) return reply(`Mode: ${Object.keys(modes).join(' | ')}\nExample: ${prefix}math medium`);
        const mdef = modes[mode];
        const a = Math.floor(Math.random() * (mdef.max - mdef.min + 1)) + mdef.min;
        const b = Math.floor(Math.random() * (mdef.max - mdef.min + 1)) + mdef.min;
        const op = mdef.ops[Math.floor(Math.random() * mdef.ops.length)];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
        games.math[senderKey] = answer;
        await reply(`*What is the result of: ${a} ${op} ${b} ?*\n\nTime: 30 seconds`);
        setTimeout(() => {
          if (games.math[senderKey] !== undefined) {
            reply(`Time's up!\nAnswer: *${games.math[senderKey]}*`).catch(() => {});
            delete games.math[senderKey];
          }
        }, 30000);
        return;
      }

      // ========== PRESENCE ==========
      if (cmd === 'presence') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        const v = String(args[0] || '').toLowerCase();
        const pm2 = presenceMap(v);
        if (pm2) {
          config.PRESENCE = pm2;
          try { await sock.sendPresenceUpdate(pm2, from); } catch {}
          await reply(`✅ Presence → *${v}* (${pm2})`);
        } else await reply(`Usage: ${prefix}presence <typing|recording|online|offline>\nCurrent: *${config.PRESENCE}*`);
        return;
      }
      if (cmd === 'autotyping' || cmd === 'autorecording') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        const want = cmd === 'autotyping' ? 'composing' : 'recording';
        if (args[0] === 'on') {
          config.PRESENCE = want;
          try { await sock.sendPresenceUpdate(want, from); } catch {}
          await reply(`✅ ${cmd} ON`);
        } else if (args[0] === 'off') {
          config.PRESENCE = 'unavailable';
          try { await sock.sendPresenceUpdate('unavailable', from); } catch {}
          await reply(`❌ ${cmd} OFF`);
        } else await reply(`Usage: ${prefix}${cmd} on/off\nCurrent: *${config.PRESENCE}*`);
        return;
      }
      if (cmd === 'alwaysonline') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        if (args[0] === 'on') {
          config.ALWAYS_ONLINE = true;
          config.PRESENCE = 'available';
          sock.sendPresenceUpdate('available').catch(() => {});
          await reply('✅ Always Online ON');
        } else if (args[0] === 'off') {
          config.ALWAYS_ONLINE = false;
          config.PRESENCE = 'unavailable';
          await reply('❌ Always Online OFF');
        } else await reply(`Always Online: *${config.ALWAYS_ONLINE ? 'ON' : 'OFF'}*`);
        return;
      }

      // ========== OWNER COMMANDS ==========
      const ownerCmds = ['mode', 'prefix', 'settings', 'autoview', 'autolike', 'autoreact', 'autoread', 'anticall', 'antidelete', 'antiedit', 'antiviewonce', 'broadcast', 'bc', 'users', 'welcome', 'goodbye', 'setbotname', 'setpp', 'setmenu', 'botimage', 'startmsg', 'font', 'panel', '1gb', '2gb', '3gb', '4gb', '5gb', 'unli', 'listsrv', 'listusr', 'delsrv', 'delusr', 'ramlist', 'die', 'shutdown', 'turnon', 'restart', 'update', 'antibug', 'antitoxic', 'reaction', 'pair', 'chatbot'];
      if (ownerCmds.includes(cmd) && !isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }

      if (cmd === 'mode') {
        if (['public', 'private'].includes(args[0])) { config.MODE = args[0]; await reply(`✅ Mode → *${config.MODE}*`); }
        else await reply(`Current: *${config.MODE}*\nUsage: ${prefix}mode public/private`);
        return;
      }
      if (cmd === 'prefix') {
        if (!args[0]) { await reply(`Current: *${config.PREFIX}*`); return; }
        config.PREFIX = args[0].slice(0, 3);
        await reply(`✅ Prefix → *${config.PREFIX}*`);
        return;
      }
      if (cmd === 'font') {
        const v = String(args[0] || '').toLowerCase();
        const allowed = ['normal', 'sans', 'bold', 'italic', 'double', 'script', 'tiny', 'random', 'off'];
        if (!v) return reply(`Font: *${config.FONT || 'random'}*\nOptions: ${allowed.join(', ')}`);
        if (!allowed.includes(v)) return reply(`Invalid. Use: ${allowed.join(', ')}`);
        config.FONT = v === 'off' ? 'normal' : v;
        const sampleStyle = config.FONT === 'random' ? 'sans' : config.FONT;
        await reply(`✅ Font → *${config.FONT}*\nPreview: ${applyFont('Hello Confronter 123', sampleStyle)}`);
        return;
      }
      const toggleCmd = (key, label) => {
        if (args[0] === 'on') { config[key] = true; return reply(`✅ ${label} ON`); }
        if (args[0] === 'off') { config[key] = false; return reply(`❌ ${label} OFF`); }
        return reply(`${label}: *${config[key] ? 'ON' : 'OFF'}*`);
      };
      if (cmd === 'autoview') return toggleCmd('AUTO_VIEW_STATUS', 'AutoView');
      if (cmd === 'autolike') return toggleCmd('AUTO_LIKE_STATUS', 'AutoLike');
      if (cmd === 'autoreact') return toggleCmd('AUTO_REACT', 'AutoReact');
      if (cmd === 'autoread') return toggleCmd('AUTO_READ', 'AutoRead');
      if (cmd === 'anticall') return toggleCmd('ANTI_CALL', 'AntiCall');
      if (cmd === 'welcome') return toggleCmd('WELCOME', 'Welcome');
      if (cmd === 'goodbye') return toggleCmd('GOODBYE', 'Goodbye');
      if (cmd === 'chatbot') return toggleCmd('CHATBOT', 'Chatbot');
      if (cmd === 'antitoxic') return toggleCmd('ANTITOXIC', 'AntiToxic');
      if (cmd === 'antibug') return toggleCmd('ANTIBUG', 'AntiBug');

      if (cmd === 'antidelete' || cmd === 'antiedit' || cmd === 'antiviewonce') {
        const keyMap = { antidelete: 'ANTI_DELETE', antiedit: 'ANTI_EDIT', antiviewonce: 'ANTI_VIEW_ONCE' };
        const key = keyMap[cmd];
        let v = (args[0] || '').toLowerCase();
        if (v === 'pm' || v === 'private') v = 'dm';
        if (['off', 'dm', 'chat'].includes(v)) { config[key] = v; return reply(`✅ ${cmd} → *${v}*`); }
        return reply(`${cmd}: *${config[key]}*\nUsage: ${prefix}${cmd} off/dm/chat`);
      }
      if (cmd === 'users') { await reply(`👥 Users stored: *${(await loadUsers()).length}*`); return; }
      if (cmd === 'settings') {
        const on = v => v ? '✅' : '❌';
        await reply(`⚙️ *SETTINGS*\n• Prefix: ${config.PREFIX}\n• Mode: ${config.MODE}\n• Presence: ${config.PRESENCE}\n• AlwaysOnline: ${on(config.ALWAYS_ONLINE)}\n• AutoView: ${on(config.AUTO_VIEW_STATUS)}\n• AutoLike: ${on(config.AUTO_LIKE_STATUS)}\n• AutoReact: ${on(config.AUTO_REACT)}\n• AutoRead: ${on(config.AUTO_READ)}\n• Font: ${config.FONT || 'random'}\n• AntiDelete: ${config.ANTI_DELETE}\n• AntiEdit: ${config.ANTI_EDIT}\n• AntiViewOnce: ${config.ANTI_VIEW_ONCE}\n• AntiCall: ${on(config.ANTI_CALL)}\n• Welcome: ${on(config.WELCOME)}\n• Goodbye: ${on(config.GOODBYE)}\n• Chatbot: ${on(config.CHATBOT)}\n• AntiToxic: ${on(config.ANTITOXIC)}\n• AntiBug: ${on(config.ANTIBUG)}`);
        return;
      }
      if (cmd === 'setbotname') {
        if (!text) return reply(`Usage: ${prefix}setbotname Name`);
        config.BOT_NAME = text;
        await reply('✅ Bot name → ' + text);
        return;
      }

      // Set bot profile picture (reply to image OR send image with caption .setpp OR .setpp <url>)
      if (cmd === 'setpp' || cmd === 'setpic' || cmd === 'fullpp') {
        try {
          let buf = null;
          // image sent with caption .setpp
          if (m.message?.imageMessage) {
            const dl = await downloadMediaMsg(m.message);
            buf = dl?.buffer || null;
          }
          // reply to an image/sticker
          if (!buf && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const qm = m.message.extendedTextMessage.contextInfo.quotedMessage;
            if (qm.imageMessage || qm.stickerMessage) {
              const dl = await downloadMediaMsg(qm);
              buf = dl?.buffer || null;
            }
          }
          // URL
          if (!buf && text && /^https?:\/\//i.test(text.trim())) {
            buf = await fetchBuffer(text.trim(), 60000);
          }
          if (!buf || !Buffer.isBuffer(buf) || buf.length < 500) {
            return reply(`Usage:\n• Send image with caption ${prefix}setpp\n• Reply to an image: ${prefix}setpp\n• Or: ${prefix}setpp https://image-url.jpg`);
          }
          const botJid = jidNormalizedUser(sock.user.id);
          await sock.updateProfilePicture(botJid, buf);
          try {
            await fs.ensureDir(DATA_DIR);
            await fs.writeFile(path.join(DATA_DIR, 'bot_pp.jpg'), buf);
          } catch {}
          await reply('✅ Bot profile picture updated\n(Menu will use this image too)');
        } catch (e) {
          await reply('❌ Failed to set PP: ' + (e.message || e));
        }
        return;
      }

      // Menu media image/video URL
      if (cmd === 'setmenu' || cmd === 'botimage' || cmd === 'setimage') {
        if (!text || !/^https?:\/\//i.test(text.trim())) {
          return reply(`Current MENU_MEDIA: ${config.MENU_MEDIA || '(none)'}\nUsage: ${prefix}setmenu https://image-or-video-url`);
        }
        config.MENU_MEDIA = text.trim();
        config.BOT_IMAGE = text.trim();
        await reply('✅ Menu/bot image set.\nKeep it after restart: Heroku config BOT_IMAGE or MENU_MEDIA');
        return;
      }

      if (cmd === 'startmsg') { await reply(buildStartMessage()); return; }
      if (cmd === 'reaction') {
        if (!args[0]) return reply(`Current: ${(config.STATUS_LIKES && config.STATUS_LIKES[0]) || '❤️'}\nUsage: ${prefix}reaction 🌝`);
        config.STATUS_LIKES = [args[0]];
        await reply(`✅ Status reaction set to ${args[0]}`);
        return;
      }

      // ========== DIE / BLACKLIST ==========
      if (cmd === 'die') {
        const users = getTargetUsers(m, text, from, isGroup(from));
        if (!users.length) return reply(`Tag someone or give number\n${prefix}die @user`);
        let list = await loadBlacklist();
        for (const u of users) {
          const id = jidNormalizedUser(u);
          if (!list.includes(id)) list.push(id);
        }
        await saveBlacklist(list);
        await reply('ᴍᴏᴛʜᴇʀꜰᴜᴄᴋᴇʀ ɢᴏᴛ ɴᴏ ᴀᴄᴄᴇꜱꜱ ʜᴇʀᴇ ʜᴀᴠᴇ ʀᴇꜱᴘᴇᴄᴛ');
        return;
      }

      // ========== SHUTDOWN / TURNON / RESTART / UPDATE ==========
      if (cmd === 'shutdown') {
        await reply('🛑 Bot shutting down...');
        setTimeout(() => process.exit(0), 1000);
        return;
      }
      if (cmd === 'turnon' || cmd === 'turn on') {
        await reply('✅ Bot is already online');
        return;
      }
      if (cmd === 'restart') {
        await reply('🔄 Restarting...');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
      if (cmd === 'update') {
        await reply('🔄 Update requested.\nPull latest code & restart your process manager (pm2 / heroku / etc).');
        return;
      }

      // ========== PAIR ==========
      if (cmd === 'pair') {
        const number = dig(args[0] || '');
        if (!number || number.length < 10) return reply(`Usage: ${prefix}pair 2547xxxxxxx`);
        try {
          const code = await sock.requestPairingCode(number);
          await reply('📲 *Pairing Code for +' + number + '*\n\n```' + code + '```\n\n1. Open WhatsApp → Linked Devices\n2. Link a Device → Link with phone number instead\n3. Enter the code above\n\nCode expires in ~1 minute.');
        } catch (e) {
          await reply('❌ Pairing failed: ' + e.message);
        }
        return;
      }

      // ========== PANEL ==========
      const domain = config.PANEL_DOMAIN || '';
      const apikey2 = config.PANEL_APIKEY || '';
      if (cmd === 'ramlist') {
        await reply(`*AVAILABLE RAM PLANS*\n\n1GB / 50% CPU\n2GB / 70% CPU\n3GB / 90% CPU\n4GB / 110% CPU\n5GB / 150% CPU\nUNLI (Admin only)`);
        return;
      }
      if (cmd === 'panel') {
        await reply(`*PANEL HELP*\n\nCreate user + server:\n${prefix}1gb username,number\n${prefix}2gb username,number\n... up to 5gb / unli\n\nOther:\n${prefix}listsrv\n${prefix}listusr\n${prefix}delsrv <id>\n${prefix}delusr <id>`);
        return;
      }
      async function createPanelUser(username, targetJid, memo, cpu, disk, nameSuffix) {
        if (!domain || !apikey2) { await reply('❌ Panel domain / API key not configured in config.'); return; }
        const email = username + Math.floor(Math.random() * 9000 + 1000) + '@gmail.com';
        const password = username + '001';
        const name = username + nameSuffix;
        let f = await fetch(domain + '/api/application/users', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 },
          body: JSON.stringify({ email, username, first_name: username, last_name: username, language: 'en', password })
        });
        let data = await f.json();
        if (data.errors) { await reply(JSON.stringify(data.errors[0], null, 2)); return; }
        const user = data.attributes;
        await reply(`✅ User created • ID: ${user.id}`);
        const ctf = `Hi @${targetJid.split('@')[0]}\n\n👤 *USERNAME* : ${user.username}\n🔐 *PASSWORD* : ${password}\n🌐 *LOGIN* : ${domain}\n\nNOTE: Save your credentials carefully.`;
        await sock.sendMessage(targetJid, { text: ctf, mentions: [targetJid] });
        const egg = config.PANEL_EGG || '15';
        const loc = config.PANEL_LOCATION || '1';
        let f2 = await fetch(domain + '/api/application/nests/5/eggs/' + egg, {
          method: 'GET',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 }
        });
        let data2 = await f2.json();
        const startup_cmd = data2?.attributes?.startup || 'npm start';
        let f3 = await fetch(domain + '/api/application/servers', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 },
          body: JSON.stringify({
            name, description: ' ', user: user.id, egg: parseInt(egg),
            docker_image: 'ghcr.io/parkervcp/yolks:nodejs_18', startup: startup_cmd,
            environment: { INST: 'npm', USER_UPLOAD: '0', AUTO_UPDATE: '0', CMD_RUN: 'npm start' },
            limits: { memory: memo, swap: 0, disk, io: 500, cpu },
            feature_limits: { databases: 5, backups: 5, allocations: 1 },
            deploy: { locations: [parseInt(loc)], dedicated_ip: false, port_range: [] }
          })
        });
        let res = await f3.json();
        if (res.errors) { await reply(JSON.stringify(res.errors[0], null, 2)); return; }
        const server = res.attributes;
        await reply(`*SERVER CREATED SUCCESSFULLY*\n\nID: ${user.id}\nNAME: ${user.first_name} ${user.last_name}\nMEMORY: ${server.limits.memory === 0 ? 'Unlimited' : server.limits.memory} MB\nDISK: ${server.limits.disk === 0 ? 'Unlimited' : server.limits.disk} MB\nCPU: ${server.limits.cpu}%`);
      }
      if (['1gb', '2gb', '3gb', '4gb', '5gb', 'unli'].includes(cmd)) {
        const t = text.split(',');
        if (t.length < 2) return reply(`*Wrong format!*\nUsage:\n${prefix + cmd} username,number`);
        const username = t[0].trim();
        let u = getMentioned(m)[0] || (t[1] ? dig(t[1]) + '@s.whatsapp.net' : null);
        if (!u) return reply('Provide a valid number or tag a user.');
        const plans = {
          '1gb': { memo: 1024, cpu: 50, disk: 1024, suffix: '1GB' },
          '2gb': { memo: 2048, cpu: 70, disk: 2048, suffix: '2GB' },
          '3gb': { memo: 3072, cpu: 90, disk: 3072, suffix: '3GB' },
          '4gb': { memo: 4096, cpu: 110, disk: 4096, suffix: '4GB' },
          '5gb': { memo: 5120, cpu: 150, disk: 5120, suffix: '5GB' },
          'unli': { memo: 0, cpu: 0, disk: 0, suffix: 'Unli' }
        };
        const plan = plans[cmd];
        await createPanelUser(username, u, plan.memo, plan.cpu, plan.disk, plan.suffix);
        return;
      }
      if (cmd === 'listsrv') {
        if (!domain || !apikey2) return reply('Panel not configured.');
        let f = await fetch(domain + '/api/application/servers?page=' + (args[0] || '1'), {
          method: 'GET',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 }
        });
        let res = await f.json();
        let servers = res.data || [];
        let messageText = 'Here is the server list:\n\n';
        for (let server of servers) { let s = server.attributes; messageText += `ID: ${s.id}\nName: ${s.name}\nStatus: ${s.status || 'unknown'}\n\n`; }
        messageText += `Page: ${res.meta?.pagination?.current_page || 1}/${res.meta?.pagination?.total_pages || 1}\nTotal Servers: ${res.meta?.pagination?.count || servers.length}`;
        await reply(messageText);
        return;
      }
      if (cmd === 'listusr') {
        if (!domain || !apikey2) return reply('Panel not configured.');
        let f = await fetch(domain + '/api/application/users?page=' + (args[0] || '1'), {
          method: 'GET',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 }
        });
        let res = await f.json();
        let users = res.data || [];
        let messageText = 'Here is the user list:\n\n';
        for (let user of users) { let u = user.attributes; messageText += `ID: ${u.id}\n${u.username}\n${u.first_name} ${u.last_name}\n\n`; }
        messageText += `Page: ${res.meta?.pagination?.current_page || 1}/${res.meta?.pagination?.total_pages || 1}\nTotal Users: ${res.meta?.pagination?.count || users.length}`;
        await reply(messageText);
        return;
      }
      if (cmd === 'delsrv' || cmd === 'delusr') {
        if (!domain || !apikey2) return reply('Panel not configured.');
        const id = args[0];
        if (!id) return reply('ID required.');
        const f = await fetch(domain + '/api/application/' + (cmd === 'delsrv' ? 'servers/' : 'users/') + id, {
          method: 'DELETE',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + apikey2 }
        });
        if (f.ok) await reply(`✅ ${cmd === 'delsrv' ? 'Server' : 'User'} deleted successfully.`);
        else await reply('❌ Not found or error.');
        return;
      }

      // ========== GROUP COMMANDS ==========
      const groupCmds = ['promote', 'demote', 'kick', 'left', 'leave', 'approve', 'hidetag', 'tagall', 'mute', 'unmute', 'antilink', 'grouplink', 'groupinfo', 'warn', 'tagadmins', 'open', 'close', 'antibot', 'antiword', 'antigroupmention'];
      if (!isGroup(from) && groupCmds.includes(cmd)) { await reply(roast('group')); return; }

      if (cmd === 'antilink') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const mode = (args[0] || '').toLowerCase();
        if (['on', 'off', 'warn', 'delete', 'kick'].includes(mode)) {
          await saveGroup(from, 'antilink', mode === 'off' ? false : mode);
          await reply(`✅ Antilink → *${mode}*`);
        } else {
          const cur = await getGroup(from, 'antilink', false);
          await reply(`Antilink: *${cur || 'off'}*\nUsage: ${prefix}antilink on/off/warn/delete/kick`);
        }
        return;
      }

      if (cmd === 'antibot') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const mode = (args[0] || '').toLowerCase();
        if (['on', 'off', 'delete', 'kick'].includes(mode)) {
          await saveGroup(from, 'antibot', mode === 'off' ? false : mode);
          await reply(`✅ Antibot → *${mode}*`);
        } else await reply(`Usage: ${prefix}antibot on/off/delete/kick`);
        return;
      }

      if (cmd === 'antiword') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (args[0] === 'off') {
          await saveGroup(from, 'antiword', null);
          await reply('❌ Antiword OFF');
          return;
        }
        if (args[0] === 'on' || args.length > 0) {
          const words = (args[0] === 'on' ? args.slice(1) : args).join(' ').toLowerCase().split(/[,\s]+/).filter(Boolean);
          if (!words.length) return reply(`Usage:\n${prefix}antiword on dick,pussy,ass\n${prefix}antiword off`);
          await saveGroup(from, 'antiword', { words, action: 'delete' });
          await reply(`✅ Antiword set: ${words.join(', ')}`);
          return;
        }
        await reply(`Usage:\n${prefix}antiword on dick,pussy,ass\n${prefix}antiword off`);
        return;
      }

      if (cmd === 'antigroupmention') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (args[0] === 'on') { await saveGroup(from, 'antigroupmention', true); await reply('✅ Anti Group Mention ON'); }
        else if (args[0] === 'off') { await saveGroup(from, 'antigroupmention', false); await reply('❌ Anti Group Mention OFF'); }
        else await reply(`Usage: ${prefix}antigroupmention on/off`);
        return;
      }

      if (['promote', 'demote', 'kick'].includes(cmd)) {
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first. Make the bot an admin, then try again.'); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const users = getTargetUsers(m, text, from, true);
        if (!users.length) {
          await reply(`Tag a user, reply to their message, or give a number.\nExample: ${prefix}${cmd} @user`);
          return;
        }
        const action = cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove';
        try {
          await sock.groupParticipantsUpdate(from, users, action);
          const labels = [];
          for (const u of users) {
            const name = getDisplayName(u, m) || (await sock.getName(u).catch(() => null)) || u.split('@')[0];
            labels.push(name.startsWith('@') ? name : '@' + name);
          }
          await sock.sendMessage(from, { text: styleReplyText(`✅ *${cmd.toUpperCase()}*\n${labels.join(', ')} ${cmd === 'kick' ? 'removed' : cmd + 'd'}.`), mentions: users });
        } catch (e) { await reply(`❌ Failed to ${cmd}: ${e.message || e}`); }
        return;
      }

      if (['hidetag', 'tagall', 'htag'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const meta = await getMeta(from);
        if (!meta) return;
        const parts = meta.participants.map(p => p.id);
        await sock.sendMessage(from, { text: text || '📢 Attention!', mentions: parts });
        return;
      }

      if (['mute', 'unmute'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
        await reply(cmd === 'mute' ? '🔇 Group muted' : '🔊 Group unmuted');
        return;
      }

      if (cmd === 'open') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        const mins = parseInt(args[0]) || 2;
        await sock.groupSettingUpdate(from, 'not_announcement');
        await reply(`🔓 Group opened for *${mins} minutes*`);
        setTimeout(async () => {
          try {
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: '🔒 Group auto-closed (only admins can send)' });
          } catch {}
        }, mins * 60 * 1000);
        return;
      }
      if (cmd === 'close') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        await sock.groupSettingUpdate(from, 'announcement');
        await reply('🔒 Group closed (only admins)');
        return;
      }

      if (cmd === 'grouplink' || cmd === 'invite') {
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        try {
          const code = await sock.groupInviteCode(from);
          // Clean link – no fancy font so it stays clickable
          await sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}\n\n_Powered by Confronter ©${new Date().getFullYear()}_` });
        } catch (e) { await reply('❌ ' + e.message); }
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
        if (!isOwner(sender, m) && !(await isGroupAdmin(from, sender))) { await reply(roast('admin')); return; }
        await reply('👋 Leaving…');
        await delay(600);
        await sock.groupLeave(from);
        return;
      }

      if (cmd === 'warn') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const users = getTargetUsers(m, text, from, true);
        if (!users.length) { await reply(`Tag a user or reply to their message.\nExample: ${prefix}warn @user spam`); return; }
        const reason = (text || 'None').replace(/@\d+/g, '').replace(/\d{6,15}/g, '').trim() || 'None';
        const label = getDisplayName(users[0], m) || users[0].split('@')[0];
        await sock.sendMessage(from, {
          text: styleReplyText(`⚠️ *WARNING*\n${label} has been warned.\nReason: ${reason}`),
          mentions: users
        });
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
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        try {
          const pending = await sock.groupRequestParticipantsList(from);
          if (!pending?.length) { await reply('No pending requests.'); return; }
          const jids = pending.map(p => p.jid || p.id);
          await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
          await reply(`✅ Approved ${jids.length} request(s)`);
        } catch (e) { await reply('❌ ' + e.message); }
        return;
      }

      if (cmd === 'broadcast' || cmd === 'bc') {
        if (!isOwner(sender, m) && !isDeveloper(sender, m)) return;
        const users = await loadUsers();
        if (!users.length) { await reply('No users stored yet.'); return; }
        if (!text) { await reply(`Usage: ${prefix}bc <text>`); return; }
        await reply(`📢 Broadcasting to ${users.length} users…`);
        let ok = 0, fail = 0;
        for (const jid of users) {
          try { await sock.sendMessage(jid, { text }); ok++; await delay(800); }
          catch { fail++; }
        }
        await reply(`✅ Done — Success: ${ok}, Failed: ${fail}`);
        return;
      }

      if (['block', 'unblock'].includes(cmd)) {
        const inGroup = isGroup(from);
        // Owner always; in group also bot owner only (block is account-level)
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }

        let targets = [];
        // reply to someone
        const quotedP = getQuoted(m);
        if (quotedP) targets.push(quotedP);
        // mentions
        for (const j of getMentioned(m)) targets.push(j);
        // number in text
        if (text) {
          const nums = String(text).match(/\d{6,15}/g) || [];
          for (const n of nums) targets.push(n + '@s.whatsapp.net');
        }
        // DM with no args → block this chat
        if (!targets.length && !inGroup && from && !from.endsWith('@g.us') && from !== 'status@broadcast') {
          targets.push(from);
        }
        targets = [...new Set(targets.filter(Boolean))];
        if (!targets.length) {
          await reply(inGroup
            ? `Reply to their message or tag them.\\n${prefix}${cmd}`
            : `In this chat type: ${prefix}${cmd}`);
          return;
        }

        let ok = 0, fail = 0;
        const labels = [];
        for (const jid of targets) {
          try {
            let blockJid = jidNormalizedUser(String(jid));
            // Prefer real phone for updateBlockStatus (LID often fails)
            let phone = jidToPhone(jid, m);
            if (!phone) phone = dig(String(jid).split('@')[0].split(':')[0]);
            if (phone && phone.length >= 6 && phone.length <= 15) {
              blockJid = phone + '@s.whatsapp.net';
            }
            await sock.updateBlockStatus(blockJid, cmd === 'block' ? 'block' : 'unblock');
            labels.push(phone ? ('+' + phone) : blockJid.split('@')[0]);
            ok++;
          } catch (e) {
            console.log(cmd + ' err:', e.message);
            fail++;
          }
        }
        if (ok) await reply(`✅ *${cmd.toUpperCase()}*\\n${labels.join(', ')}`);
        else await reply(`❌ ${cmd} failed. Reply to their message or use number.`);
        return;
      }
    } catch (err) {
      console.log('Handler:', err.message);
    }
  }

  // ============ ANTI-DELETE ============
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        const isDel = u.update?.message === null;
        if (!isDel) continue;
        const key = u.key;
        if (!key?.id) continue;
        const cached = msgCache.get(key.id);
        if (cached?.message) forwardDelete(key, cached);
      } catch {}
    }
  });
}

startBot().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
process.on('uncaughtException', e => console.log('Uncaught:', e.message));

