/**
 * DEADPOOL V7 - Fixed index.js
 * - Confronter APIs only (apis.techwizardx.top)
 * - Download site: https://confronter-downloads.onrender.com
 * - .play / .song → auto audio (no 1/2)
 * - .video → auto video (no 1/2)
 * - Menu works on iOS (delete+resend fallback)
 * - Stronger anti-delete / anti-edit
 * - .clear and .block fixed
 * - Status auto-like improved
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
try { require('dotenv').config(); } catch {}

// ============ KEEP-ALIVE WEB SERVER ============
const http = require('http');
const KEEP_PORT = process.env.PORT || 3000;
try {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end((typeof config !== 'undefined' ? config.BOT_NAME : 'Bot') + ' is alive\n');
  }).listen(KEEP_PORT, () => console.log('🌐 Health server on port ' + KEEP_PORT));
} catch (e) { console.log('keep server:', e.message); }

// ============ CONFIG ============
const defaults = {
  BOT_NAME: '𝐃𝐄𝐀𝐃𝐏𝐎𝐎𝐋 𝐕𝟕',
  PREFIX: '.',
  OWNER_NUMBER: '',
  DEVELOPERS: [],
  MODE: 'public',
  SESSION: '',
  POWERED_BY: '> *Powered by Confronter💫*',
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
  GROUP_JID: '',
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
  GROUP_JID: env.GROUP_JID || fileConfig.GROUP_JID || defaults.GROUP_JID,
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
if (env.STATUS_LIKES) {
  config.STATUS_LIKES = String(env.STATUS_LIKES).split(/[\s,]+/).filter(Boolean);
} else if (!config.STATUS_LIKES) {
  config.STATUS_LIKES = null;
}
config.START_MSG = env.START_MSG || fileConfig.START_MSG || '';
config.SEND_START_MSG = env.SEND_START_MSG !== undefined
  ? envBool(env.SEND_START_MSG, false)
  : (fileConfig.SEND_START_MSG ?? false);
config.CONFRONTER_API = (env.CONFRONTER_API || env.API_BASE || 'https://apis.techwizardx.top').replace(/\/+$/, '');

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
  const isTokyo = /tokyo\.xyz/i.test(String(url));
  const headers = {
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Encoding': 'identity',
    Referer: isTokyo ? 'https://123tokyo.xyz/' : 'https://www.youtube.com/',
    Origin: isTokyo ? 'https://123tokyo.xyz' : 'https://www.youtube.com'
  };
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: t,
    maxContentLength: 250 * 1024 * 1024,
    maxRedirects: 5,
    validateStatus: () => true,
    headers
  });
  if (r.status >= 400) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(r.data);
  if (buf.length < 500) throw new Error('Empty media');
  return buf;
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
const msgCache = new NodeCache({ stdTTL: 60 * 60 * 48, checkperiod: 300, useClones: false }); // 48h
const groupCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 120 });
const floodMap = new Map();
let sock = null;
const _lidMap = new Map();
const _historyFetching = new Set();

const games = {
  family100: {}, tebakgambar: {}, tebakkata: {}, tebakkalimat: {},
  tebaklirik: {}, caklontong: {}, caklontong_desk: {}, math: {}, tictactoe: {}, suit: {}
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
      if (/^\d{6,15}$/.test(n)) { _lidMap.set(lid, n); return n; }
    }
    return null;
  }
  const n = raw.split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(n) ? n : null;
}

async function jidToPhoneAsync(jid, msg, from) {
  const p = jidToPhone(jid, msg);
  if (p) return p;
  if (!String(jid || '').includes('@lid')) return null;
  if (isGroup(from)) {
    try {
      const meta = await sock.groupMetadata(from);
      const lid = String(jid).split('@')[0];
      const entry = meta.participants.find(x =>
        String(x.id || '').split('@')[0] === lid ||
        String(x.lid || '').split('@')[0] === lid);
      if (entry?.phoneNumber) {
        const n = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        if (/^\d{6,15}$/.test(n)) { _lidMap.set(lid, n); return n; }
      }
    } catch {}
  }
  return null;
}

async function whoLabel(jid, msg, from, pushName) {
  const phone = await jidToPhoneAsync(jid, msg, from);
  if (phone) return '+' + phone;
  const name = pushName || null;
  if (name && name !== 'Unknown' && name.trim()) return '@' + String(name).replace(/[@\n]/g, '').trim();
  const raw = String(jid || '').split('@')[0];
  return raw || 'Unknown';
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
async function loadBlacklist() { try { return await fs.readJson(BLACKLIST_FILE); } catch { return []; } }
async function saveBlacklist(list) { await fs.writeJson(BLACKLIST_FILE, list, { spaces: 2 }); }

// ============ ROASTS ============
const ROASTS = {
  owner: ['❖ *𝐎𝐰𝐧𝐞𝐫 𝐨𝐧𝐥𝐲.* ɢᴏᴛ ɴᴏ ᴀᴜᴛʜᴏʀɪᴛʏ ʜᴇʀᴇ ʀᴇᴛʀʏ ᴠɪꜱɪᴛɪɴɢ ᴛᴏɪʟᴇᴛ.'],
  admin: ['❖ *𝐀𝐝𝐦𝐢𝐧𝐬 𝐨𝐧𝐥𝐲.* ᴛʜɪꜱ ᴄᴏᴍᴍᴀɴᴅ ɪꜱ ɴᴏᴛ ꜰᴏʀ ᴘᴇᴏᴘʟᴇ ʟɪᴋᴇ ʏᴏᴜ ᴛʀʏ ᴛᴏ ʙᴀᴛʜ.'],
  group: ['❖ *𝐆𝐫𝐨𝐮𝐩 𝐨𝐧𝐥𝐲.* ꜱᴛᴏᴘ 𝐰𝐚𝐬𝐭𝐢𝐧𝐠 ᴍʏ ᴛɪᴍᴇ ᴛʜɪꜱ ᴄᴏᴍᴍᴀɴᴅ ɪꜱ ꜰᴏʀ ɢʀᴏᴜᴘ ɪᴅɪᴏᴛ.']
};
const roast = k => ROASTS[k][Math.floor(Math.random() * ROASTS[k].length)];

// ============ FOOTER ============
function buildFooter() {
  const p = config.POWERED_BY || '> *Powered by Confronter💫*';
  return '\n\n' + p;
}

// ============ FANCY FONTS ============
const FONT_MAPS = {
  normal: null,
  sans: {a:'𝖺',b:'𝖻',c:'𝖼',d:'𝖽',e:'𝖾',f:'𝖿',g:'𝗀',h:'𝗁',i:'𝗂',j:'𝗃',k:'𝗄',l:'𝗅',m:'𝗆',n:'𝗇',o:'𝗈',p:'𝗉',q:'𝗊',r:'𝗋',s:'𝗌',t:'𝗍',u:'𝗎',v:'𝗏',w:'𝗐',x:'𝗑',y:'𝗒',z:'𝗓',A:'𝖠',B:'𝖡',C:'𝖢',D:'𝖣',E:'𝖤',F:'𝖥',G:'𝖦',H:'𝖧',I:'𝖨',J:'𝖩',K:'𝖪',L:'𝖫',M:'𝖬',N:'𝖭',O:'𝖮',P:'𝖯',Q:'𝖰',R:'𝖱',S:'𝖲',T:'𝖳',U:'𝖴',V:'𝖵',W:'𝖶',X:'𝖷',Y:'𝖸',Z:'𝖹','0':'𝟢','1':'𝟣','2':'𝟤','3':'𝟥','4':'𝟦','5':'𝟧','6':'𝟨','7':'𝟩','8':'𝟪','9':'𝟫'},
  bold: {a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭','0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'},
  italic: {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧'},
  double: {a:'𝕒',b:'𝕓',c:'𝕔',d:'𝕕',e:'𝕖',f:'𝕗',g:'𝕘',h:'𝕙',i:'𝕚',j:'𝕛',k:'𝕜',l:'𝕝',m:'𝕞',n:'𝕟',o:'𝕠',p:'𝕡',q:'𝕢',r:'𝕣',s:'𝕤',t:'𝕥',u:'𝕦',v:'𝕧',w:'𝕨',x:'𝕩',y:'𝕪',z:'𝕫',A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',K:'𝕂',L:'𝕃',M:'𝕄',N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ','0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'},
  script: {a:'𝓪',b:'𝓫',c:'𝓬',d:'𝓭',e:'𝓮',f:'𝓯',g:'𝓰',h:'𝓱',i:'𝓲',j:'𝓳',k:'𝓴',l:'𝓵',m:'𝓶',n:'𝓷',o:'𝓸',p:'𝓹',q:'𝓺',r:'𝓻',s:'𝓼',t:'𝓽',u:'𝓾',v:'𝓿',w:'𝔀',x:'𝔁',y:'𝔂',z:'𝔃'},
  tiny: {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'},
  // extra styles requested
  'sans-bold': null, // filled below
  'sans-italic': null,
  'serif-bold': {a:'𝐚',b:'𝐛',c:'𝐜',d:'𝐝',e:'𝐞',f:'𝐟',g:'𝐠',h:'𝐡',i:'𝐢',j:'𝐣',k:'𝐤',l:'𝐥',m:'𝐦',n:'𝐧',o:'𝐨',p:'𝐩',q:'𝐪',r:'𝐫',s:'𝐬',t:'𝐭',u:'𝐮',v:'𝐯',w:'𝐰',x:'𝐱',y:'𝐲',z:'𝐳',A:'𝐀',B:'𝐁',C:'𝐂',D:'𝐃',E:'𝐄',F:'𝐅',G:'𝐆',H:'𝐇',I:'𝐈',J:'𝐉',K:'𝐊',L:'𝐋',M:'𝐌',N:'𝐍',O:'𝐎',P:'𝐏',Q:'𝐐',R:'𝐑',S:'𝐒',T:'𝐓',U:'𝐔',V:'𝐕',W:'𝐖',X:'𝐗',Y:'𝐘',Z:'𝐙'},
  'serif-italic': {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧',A:'𝐴',B:'𝐵',C:'𝐶',D:'𝐷',E:'𝐸',F:'𝐹',G:'𝐺',H:'𝐻',I:'𝐼',J:'𝐽',K:'𝐾',L:'𝐿',M:'𝑀',N:'𝑁',O:'𝑂',P:'𝑃',Q:'𝑄',R:'𝑅',S:'𝑆',T:'𝑇',U:'𝑈',V:'𝑉',W:'𝑊',X:'𝑋',Y:'𝑌',Z:'𝑍'},
  serif: {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧'},
  typewriter: {a:'𝚊',b:'𝚋',c:'𝚌',d:'𝚍',e:'𝚎',f:'𝚏',g:'𝚐',h:'𝚑',i:'𝚒',j:'𝚓',k:'𝚔',l:'𝚕',m:'𝚖',n:'𝚗',o:'𝚘',p:'𝚙',q:'𝚚',r:'𝚛',s:'𝚜',t:'𝚝',u:'𝚞',v:'𝚟',w:'𝚠',x:'𝚡',y:'𝚢',z:'𝚣',A:'𝙰',B:'𝙱',C:'𝙲',D:'𝙳',E:'𝙴',F:'𝙵',G:'𝙶',H:'𝙷',I:'𝙸',J:'𝙹',K:'𝙺',L:'𝙻',M:'𝙼',N:'𝙽',O:'𝙾',P:'𝙿',Q:'𝚀',R:'𝚁',S:'𝚂',T:'𝚃',U:'𝚄',V:'𝚅',W:'𝚆',X:'𝚇',Y:'𝚈',Z:'𝚉','0':'𝟶','1':'𝟷','2':'𝟸','3':'𝟹','4':'𝟺','5':'𝟻','6':'𝟼','7':'𝟽','8':'𝟾','9':'𝟿'},
  'small-caps': {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'}
};
FONT_MAPS['sans-bold'] = FONT_MAPS.bold;
FONT_MAPS['sans-italic'] = FONT_MAPS.italic;

const FONT_NAMES = Object.keys(FONT_MAPS).filter(n => n !== 'normal' && FONT_MAPS[n]);
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
    let style = String(config.FONT || 'off').toLowerCase();
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
      if (j?.at) { const d = new Date(j.at); if (!isNaN(d.getTime())) return d; }
    }
  } catch {}
  return null;
}
function ensureActivatedAt() {
  let d = loadActivatedAt();
  if (d) return d;
  d = new Date();
  try { fs.ensureDirSync(DATA_DIR); fs.writeJsonSync(ACTIVATED_FILE, { at: d.toISOString() }, { spaces: 0 }); } catch {}
  config.BOT_ACTIVATED_AT = d.toISOString();
  return d;
}
function getExpiryInfo() {
  const now = new Date();
  try {
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

// ============ MENU ============
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
  m += box('DOWNLOADS', ['play <song>', 'song <name>', 'video <url/name>', 'yt <url/name>', 'tiktok <url>', 'ig <url>', 'lyrics <song>', 'apk <name>', 'xvideos <query|url>', 'xnxx <query|url>']);
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
  m += box('FUN & MORE', ['joke', 'meme', 'fact', 'quote', 'truth', 'dare', 'news', 'livescore', 'epl', 'imagine <prompt>', 'xvideos <q|url>', 'spotify <q|url>', 'shazam <url>']);
  m += box('TEXTMAKER', ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'hacker', 'luxury', 'blackpink', 'metallic', 'devil', 'sand', 'light', 'naruto']);
  m += box('FUN', ['joke', 'quote', 'dice', '8ball', 'coinflip', 'bible <book verse>']);
  m += box('UTILITY', ['ping', 'p', 'alive', 'calc <expr>', 'weather <city>', 'owner', 'delete', 'clear', 'groupjid <link>', 'newsletter <link>', 'togcstatus']);
  return m;
}

async function resolveMenuImageBuffer() {
  const urls = [config.MENU_MEDIA, config.BOT_IMAGE, process.env.MENU_MEDIA, process.env.BOT_IMAGE]
    .filter(u => u && String(u).trim().startsWith('http'));
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

// iOS-friendly menu: try edit, fallback delete + resend
async function sendMenuWithMedia(jid, pushName, userCount) {
  const foot = buildFooter();
  let full = buildMainMenu(pushName, userCount);
  try { full = styleReplyText(full); } catch {}
  if (foot) full = full + foot;

  const loading =
    '💀 ' + applyFont("We didn't die", 'bold') + '\n' +
    '👑 ' + applyFont('We rule them', 'bold') + '\n' +
    '🔥 ' + applyFont("Don't be motherfucker", 'bold') + '\n' +
    '👁 ' + applyFont('I knew you will try me', 'bold') + '\n' +
    '⚙️ ' + applyFont('Made by Confronter', 'bold') + '\n' +
    '📸 ' + applyFont('Follow IG @confronter', 'bold') + '\n' +
    '✈️ ' + applyFont('Telegram @confronter', 'bold') + '\n\n' +
    '⏳ *' + applyFont('Loading menu…', 'bold') + '*';

  const resolved = await resolveMenuImageBuffer();
  const buffer = resolved?.buffer || null;

  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 500) {
    let base = null;
    try {
      base = await sock.sendMessage(jid, { image: buffer, caption: loading });
    } catch (e) { console.log('menu base send:', e.message); }

    await delay(800);

    let edited = false;
    if (base?.key) {
      try {
        await sock.relayMessage(jid, {
          protocolMessage: {
            key: base.key,
            type: 14,
            editedMessage: { imageMessage: { caption: full } }
          }
        }, {});
        edited = true;
      } catch {}
      if (!edited) {
        try {
          await sock.sendMessage(jid, { image: buffer, caption: full, edit: base.key });
          edited = true;
        } catch {}
      }
    }

    // iOS fallback: delete loading then send final
    if (!edited) {
      try { if (base?.key) await sock.sendMessage(jid, { delete: base.key }); } catch {}
      try {
        await sock.sendMessage(jid, { image: buffer, caption: full });
      } catch {
        await sock.sendMessage(jid, { text: full });
      }
    }
    return;
  }

  // Text-only
  let base = null;
  try { base = await sock.sendMessage(jid, { text: loading }); } catch {}
  await delay(600);
  let edited = false;
  if (base?.key) {
    try {
      await sock.sendMessage(jid, { text: full, edit: base.key });
      edited = true;
    } catch {}
  }
  if (!edited) {
    try { if (base?.key) await sock.sendMessage(jid, { delete: base.key }); } catch {}
    await sock.sendMessage(jid, { text: full });
  }
}

// ============ START MESSAGE ============
function buildStartMessage() {
  if (config.START_MSG && String(config.START_MSG).trim()) {
    return String(config.START_MSG).replace(/\\n/g, '\n');
  }
  const p = config.PREFIX || '.';
  const mode = config.MODE || 'public';
  return (
`┌───「 *${config.BOT_NAME}* 」
│ ✅ Online
│ ⚡ Prefix : *${p}*
│ 🌐 Mode   : *${mode}*
│ 👑 ${(config.POWERED_BY || 'Powered by Confronter').replace(/^>\s*/, '').replace(/\*/g, '').trim()}
│ 💬 Type *${p}menu*
└────────────`
  );
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

// ============ EMOJI HELPERS ============
const DEFAULT_STATUS_LIKES = [
  '❤️', '🔥', '😂', '👍', '😍', '💯', '🙏', '😮', '👏', '🎉',
  '✨', '💜', '🤍', '🖤', '💙', '💛', '🧡', '🌝', '🥰', '😎', '🤩', '😘'
];
const DEFAULT_REACT_EMOJIS = ['👍', '❤️', '🔥', '😂', '🙏', '💯', '😍', '😮', '👏', '✨', '🎉', '💜', '🤝', '👀', '🫡'];
const DEFAULT_CMD_EMOJIS = ['✅', '⚡', '🔥', '💫', '✨', '🎯', '👍', '🤖', '💜', '🚀', '⭐', '💀', '👑'];
const MENU_EMOJIS = [
  '💀','🔥','⚡','👑','🩸','🖤','🤖','🚀','✨','🎯',
  '💯','😎','🤩','👁️','🗡️','🛡️','💣','🌪️','👾','🎮',
  '🧨','⚔️','🦾','😈','👿','💜','❤️‍🔥','🧿','🪬','💀'
];

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
  } catch (e) { console.log('vv send:', e.message); return false; }
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

// ============ ANTI-DELETE (FULL MEDIA SUPPORT) ============
async function forwardDelete(key, cached) {
  try {
    if (!cached?.message) return;

    const from = key.remoteJid || cached.remoteJid;
    const isStatus = from === 'status@broadcast';

    if (isStatus && config.ANTI_DELETE === 'off') return;
    if (!isStatus && config.ANTI_DELETE === 'off') return;

    const ownerJid = getOwnerJid();
    const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
    const target = isStatus
      ? (ownerJid || me)
      : (config.ANTI_DELETE === 'chat' ? from : (ownerJid || me));

    if (!target) return;

    let msg = cached.message;
    for (let i = 0; i < 6; i++) {
      if (msg?.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
      else if (msg?.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
      else if (msg?.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
      else if (msg?.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
      else if (msg?.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;
      else break;
    }

    let type = getContentType(msg) || '';
    if (!type) {
      const candidates = [
        'imageMessage', 'videoMessage', 'audioMessage',
        'stickerMessage', 'documentMessage',
        'conversation', 'extendedTextMessage'
      ];
      for (const t of candidates) {
        if (msg[t]) { type = t; break; }
      }
    }

    const who = await whoLabel(
      key.participant || cached.participant || cached.participantAlt || from,
      cached,
      from,
      cached.pushName
    );

    let groupName = 'DM';
    if (isGroup(from)) {
      try {
        groupName = (await sock.groupMetadata(from))?.subject || 'Group';
      } catch {
        groupName = 'Group';
      }
    }

    let deletedText = '';
    if (type === 'conversation') deletedText = msg.conversation || '';
    else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
    else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
    else if (type === 'documentMessage') deletedText = msg.documentMessage?.caption || msg.documentMessage?.fileName || '';
    else if (type === 'stickerMessage') deletedText = '[Sticker]';
    else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice Note]' : '[Audio]';

    if (!deletedText && cached.text) deletedText = cached.text;

    let header =
      `🗑 *${config.BOT_NAME} • Anti-Delete*\n` +
      `• Deleted by: ${who}\n` +
      `• Chat: ${isStatus ? 'Status' : (isGroup(from) ? groupName : 'DM')}\n`;

    if (deletedText && !deletedText.startsWith('[')) {
      header += `\n📝 *Deleted content:*\n${deletedText}`;
    } else if (deletedText) {
      header += `\n${deletedText}`;
    }

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
        if (dl?.buffer && dl.buffer.length > 100) {
          const kind = mediaTypes[type];
          const payload = {};

          if (kind === 'image') {
            payload.image = dl.buffer;
            payload.caption = header;
          } else if (kind === 'video') {
            payload.video = dl.buffer;
            payload.mimetype = 'video/mp4';
            payload.caption = header;
          } else if (kind === 'audio') {
            payload.audio = dl.buffer;
            payload.mimetype = 'audio/ogg; codecs=opus';
            payload.ptt = !!msg.audioMessage?.ptt;
          } else if (kind === 'sticker') {
            payload.sticker = dl.buffer;
          } else if (kind === 'document') {
            payload.document = dl.buffer;
            payload.mimetype = msg.documentMessage?.mimetype || 'application/octet-stream';
            payload.fileName = msg.documentMessage?.fileName || 'deleted_file';
            payload.caption = header;
          }

          await sock.sendMessage(target, payload);

          if (kind === 'audio' || kind === 'sticker') {
            await sock.sendMessage(target, { text: header });
          }
          return;
        }
      } catch (mediaErr) {
        console.log('antiDelete media download failed:', mediaErr.message);
      }
    }

    if (!header.includes('Deleted content') && !deletedText) {
      header += `\n📝 *Deleted content:* (media could not be recovered)`;
    }

    await sock.sendMessage(target, { text: header });
  } catch (e) {
    console.log('antiDelete error:', e.message);
  }
}

// ============ AUTO JOIN ============
async function getFreshGroupInviteLink() {
  const groupJid = String(config.GROUP_JID || '').trim();
  if (!groupJid.endsWith('@g.us') || !sock) return null;
  try {
    const code = await sock.groupInviteCode(groupJid);
    if (code) { config.GROUP_INVITE = code; return 'https://chat.whatsapp.com/' + code; }
  } catch (e) { console.log('getFreshGroupInviteLink:', e.message); }
  const inv = String(config.GROUP_INVITE || '').trim();
  if (inv && !inv.includes('@') && inv.length >= 10) {
    const code = inv.includes('chat.whatsapp.com/') ? inv.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0] : inv;
    if (code) return 'https://chat.whatsapp.com/' + code;
  }
  return null;
}

async function ensureGroupMembership(force = false) {
  const invRaw = String(config.GROUP_INVITE || process.env.GROUP_INVITE || '').trim();
  let groupJid = String(config.GROUP_JID || process.env.GROUP_JID || '').trim();
  if (invRaw.endsWith('@g.us')) { groupJid = invRaw; config.GROUP_JID = invRaw; }

  if (invRaw && !invRaw.endsWith('@g.us')) {
    try {
      let code = invRaw;
      if (code.includes('chat.whatsapp.com/')) code = code.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0];
      code = code.replace(/[^A-Za-z0-9_-]/g, '');
      if (code.length >= 10) {
        const gid = await sock.groupAcceptInvite(code);
        if (gid) {
          groupJid = String(gid);
          config.GROUP_JID = groupJid;
          console.log('✅ Joined / re-joined group', groupJid);
        }
      }
    } catch (e) {
      const m = String(e.message || e);
      if (!/already|participant|conflict/i.test(m)) console.log('Group join:', m.slice(0, 120));
    }
  }

  if (groupJid.endsWith('@g.us')) {
    config.GROUP_JID = groupJid;
    try {
      const meta = await sock.groupMetadata(groupJid);
      console.log('✅ Group OK:', meta?.subject || groupJid, '| members:', meta?.participants?.length || '?');
      try {
        for (const p of meta.participants || []) {
          if (p.id?.includes('@lid') && p.phoneNumber)
            _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          if (p.lid?.includes('@lid') && p.phoneNumber)
            _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
        }
      } catch {}
      try {
        const code = await sock.groupInviteCode(groupJid);
        if (code) { config.GROUP_INVITE = code; }
      } catch {}
      return true;
    } catch (e) {
      console.log('⚠️ Not in group — retrying invite…');
      if (invRaw && force) {
        try {
          let code = invRaw.includes('chat.whatsapp.com/')
            ? invRaw.split('chat.whatsapp.com/')[1].split('?')[0]
            : invRaw;
          code = String(code).replace(/[^A-Za-z0-9_-]/g, '');
          if (code.length >= 10) {
            const gid = await sock.groupAcceptInvite(code);
            if (gid) { config.GROUP_JID = String(gid); console.log('✅ Re-joined after leave/kick'); return true; }
          }
        } catch (e2) { console.log('Rejoin failed:', e2.message); }
      }
      return false;
    }
  }
  return false;
}

async function ensureChannelFollow() {
  if (!config.CHANNEL_ID) return;
  try {
    const ch = String(config.CHANNEL_ID).trim();
    if (sock.newsletterFollow) {
      await sock.newsletterFollow(ch);
      console.log('✅ Following channel', ch);
    }
  } catch (e) { console.log('Channel follow:', e.message); }
}

async function autoJoinConfigured() {
  await ensureGroupMembership(true);
  await ensureChannelFollow();
  if (global.__rejoinTimer) clearInterval(global.__rejoinTimer);
  global.__rejoinTimer = setInterval(async () => {
    try {
      if (!global.__BOT_READY || !sock) return;
      await ensureGroupMembership(true);
      await ensureChannelFollow();
    } catch {}
  }, 3 * 60 * 1000);
}

// ============ DOWNLOADERS ============
function isYoutubeUrl(s) { return /(?:youtube\.com|youtu\.be)\//i.test(String(s || '')); }

async function searchYoutube(query) {
  try {
    const yts = require('yt-search');
    const r = await yts(query);
    const v = r?.videos?.[0];
    if (v?.url) {
      return {
        url: v.url,
        title: v.title,
        thumbnail: v.thumbnail,
        duration: v.timestamp || v.duration?.timestamp || null,
        author: v.author?.name || v.author || '',
        views: v.views || null
      };
    }
  } catch {}
  try {
    const data = await confronterGet('/api/gateway/search/yts?query=' + encodeURIComponent(query) + '&limit=5', 40000);
    const list = data?.result?.results || data?.result || data?.results || [];
    const v = Array.isArray(list) ? list[0] : null;
    if (v) {
      const id = v.id || '';
      return {
        url: v.url || (id ? 'https://www.youtube.com/watch?v=' + id : ''),
        title: v.title || query,
        thumbnail: v.thumbnail || (id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''),
        duration: v.duration || null,
        author: v.author || v.uploader || v.channel || '',
        views: v.views || v.view_count || null
      };
    }
  } catch {}
  try {
    const r = await dlGet('https://api.siputzx.my.id/api/s/youtube?query=' + encodeURIComponent(query), { timeout: 20000 });
    const arr = r?.data?.data || r?.data?.result || [];
    const v = Array.isArray(arr) ? arr[0] : null;
    if (v) {
      return {
        url: v.url || v.link || ('https://www.youtube.com/watch?v=' + (v.videoId || v.id)),
        title: v.title || v.name || query,
        thumbnail: v.thumbnail || v.thumb,
        author: v.author || v.channel || '',
        views: v.views || v.viewCount || null
      };
    }
  } catch {}
  return null;
}

// ============ CONFRONTER APIs ONLY ============
const CONFRONTER_API = (process.env.CONFRONTER_API || process.env.API_BASE || config.CONFRONTER_API || 'https://apis.techwizardx.top').replace(/\/+$/, '');
const DOWNLOAD_SITE = (process.env.DOWNLOAD_SITE || 'https://confronter-downloads.onrender.com').replace(/\/+$/, '');

async function confronterGet(path, timeout = 60000) {
  try {
    let p = path.startsWith('/') ? path : '/' + path;
    if (!p.startsWith('/api/')) {
      const map = {
        '/download/ytmp3': '/api/download/ytmp3',
        '/download/ytmp4': '/api/download/ytmp4',
        '/download/audio': '/api/download/ytmp3',
        '/download/video': '/api/download/ytmp4',
        '/download/instadl': '/api/download/instagram',
        '/download/instagramdl': '/api/download/instagram',
        '/download/tiktokdl3': '/api/download/tiktok',
        '/download/xvideos': '/api/download/xvideos',
        '/download/xnxx': '/api/download/xvideos',
        '/search/xvideos': '/api/search/xvideos',
        '/search/xnxx': '/api/search/xvideos',
        '/tools/clear': '/api/tools/clear',
        '/tools/status': '/api/tools/status',
        '/search/lyrics': '/api/search/lyrics',
        '/search/lyrics2': '/api/search/lyrics',
        '/search/lyrics3': '/api/search/lyrics',
        '/keithai': '/api/ai/chat',
        '/ai/gpt': '/api/ai/chat',
        '/ai/gemini': '/api/ai/chat',
        '/ai/deepseek': '/api/ai/chat',
        '/ai/mistral': '/api/ai/chat',
        '/ai/flux': '/api/ai/flux',
        '/ai/magicstudio': '/api/ai/flux',
        '/fun/jokes': '/api/fun/joke',
        '/fun/meme': '/api/fun/meme',
        '/fun/fact': '/api/fun/joke',
        '/fun/quote': '/api/fun/joke',
        '/fun/truth': '/api/fun/joke',
        '/fun/dare': '/api/fun/joke',
        '/fun/pickuplines': '/api/fun/joke',
        '/fun/insult': '/api/fun/joke',
        '/news/bbc': '/api/news/bbc',
        '/news/tech': '/api/news/bbc',
        '/search/apk': '/api/search/apk',
        '/search/aptoide': '/api/search/apk',
        '/search/movie': '/api/search/movie',
        '/moviebox/search': '/api/search/movie',
        '/download/movie': '/api/download/movie',
        '/download/spotify': '/api/download/spotify',
        '/search/spotify': '/api/search/spotify',
        '/ai/shazam': '/api/ai/shazam'
      };
      const basePath = p.split('?')[0];
      const qs = p.includes('?') ? p.slice(p.indexOf('?')) : '';
      if (map[basePath]) p = map[basePath] + qs;
      else if (!p.startsWith('/api/')) p = '/api' + p;
    }
    const r = await dlGet(CONFRONTER_API + p, { timeout });
    return r?.data || null;
  } catch (e) {
    console.log('confronterGet:', (e.message || '').slice(0, 80));
    return null;
  }
}

// alias for any leftover references
const keithGet = confronterGet;

function keithExtractUrl(data) {
  if (!data) return null;
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  if (data.result) {
    if (typeof data.result === 'string' && /^https?:\/\//i.test(data.result)) return data.result;
    const r = data.result;
    if (r.url) return r.url;
    if (r.dl) return r.dl;
    if (r.download) return r.download;
    if (r.download_url) return r.download_url;
    if (r.audio) return r.audio;
    if (r.video) return r.video;
    if (r.high) return r.high;
    if (r.low) return r.low;
    if (Array.isArray(r.urls) && r.urls[0]) return r.urls[0];
  }
  return data.url || data.dl || data.download || data.download_url || data.link || data.audio || data.video || null;
}

function keithExtractMeta(data) {
  const r = (data && data.result && typeof data.result === 'object') ? data.result : (data || {});
  return {
    title: r.title || r.name || data?.title || null,
    artist: r.artist || r.author || r.channel || r.uploader || r.owner || null,
    views: r.views || r.viewCount || r.view_count || null,
    likes: r.likes || r.likeCount || null,
    duration: r.duration || r.length || r.timestamp || null,
    thumbnail: r.thumbnail || r.thumb || r.image || null,
    quality: r.quality || r.format || null,
    size: r.size || r.sizeReadable || r.size_mb || null,
    description: r.description || null
  };
}

function formatMediaCaption(meta, kind) {
  const lines = [];
  const icon = kind === 'audio' ? '🎵' : '🎬';
  if (meta.title) lines.push(`${icon} *${meta.title}*`);
  if (meta.artist) lines.push(`👤 ${meta.artist}`);
  if (meta.views) lines.push(`👁 ${meta.views}`);
  if (meta.likes) lines.push(`❤️ ${meta.likes}`);
  if (meta.duration) lines.push(`⏱ ${meta.duration}`);
  if (meta.quality) lines.push(`📺 ${meta.quality}`);
  if (meta.size) lines.push(`📦 ${meta.size}`);
  lines.push('');
  lines.push('> *Powered by Confronter💫*');
  return lines.join('\n');
}

async function downloadViaConfronter(url, audioOnly = true) {
  const endpoints = audioOnly
    ? ['/api/download/ytmp3?url=', '/api/download/audio?url=', '/download/ytmp3?url=']
    : ['/api/download/ytmp4?url=', '/api/download/video?url=', '/download/ytmp4?url='];
  for (const ep of endpoints) {
    try {
      const data = await confronterGet(ep + encodeURIComponent(url), 90000);
      if (!data || data.status === false) continue;
      const mediaUrl = keithExtractUrl(data);
      if (!mediaUrl) continue;
      const meta = keithExtractMeta(data);
      const title = String(meta.title || 'Media').slice(0, 120);
      let buf = null;
      try {
        buf = await fetchBuffer(String(mediaUrl), 180000);
      } catch {}
      if (buf && buf.length > 5000) return { buffer: buf, title, url: mediaUrl, meta };
      return { buffer: null, title, url: mediaUrl, meta };
    } catch {}
  }
  return null;
}

async function downloadInstagramConfronter(url) {
  for (const ep of ['/api/download/instagram?url=', '/download/instadl?url=', '/download/instagramdl?url=']) {
    try {
      const data = await confronterGet(ep + encodeURIComponent(url), 60000);
      if (!data || data.status === false) continue;
      const r = data.result || data;
      if (Array.isArray(r)) {
        const urls = r.map(x => x.url || x.dl || x).filter(u => typeof u === 'string' && u.startsWith('http'));
        if (urls.length) return { urls, title: 'Instagram' };
      }
      const mediaUrl = keithExtractUrl(data);
      if (mediaUrl) return { urls: [mediaUrl], title: data.title || 'Instagram' };
    } catch {}
  }
  return null;
}

async function downloadTiktokConfronter(url) {
  try {
    const data = await confronterGet('/api/download/tiktok?url=' + encodeURIComponent(url), 60000);
    if (!data || data.status === false) return null;
    const mediaUrl = keithExtractUrl(data) || data.result?.play || data.result?.video;
    if (!mediaUrl) return null;
    return { url: mediaUrl, title: data.result?.title || data.title || 'TikTok' };
  } catch { return null; }
}

async function downloadViaYtdl(url, audioOnly) {
  try {
    const ytdlp = fs.existsSync('./yt-dlp') ? './yt-dlp' : (fs.existsSync('/usr/bin/yt-dlp') ? 'yt-dlp' : null);
    if (ytdlp) {
      const outTpl = '/tmp/dp_' + Date.now() + (audioOnly ? '.mp3' : '.mp4');
      const fmt = audioOnly
        ? '-x --audio-format mp3 --audio-quality 0 -o "' + outTpl + '"'
        : '-f "best[height<=720]/best" -o "' + outTpl + '"';
      const cmd = ytdlp + ' --no-playlist --no-warnings ' + fmt + ' "' + url + '"';
      await execP(cmd, { timeout: 120000, maxBuffer: 30 * 1024 * 1024 });
      let file = outTpl;
      if (!fs.existsSync(file)) {
        const base = outTpl.replace(/\.(mp3|mp4)$/, '');
        for (const ext of (audioOnly ? ['.mp3', '.m4a', '.opus', '.webm'] : ['.mp4', '.mkv', '.webm'])) {
          if (fs.existsSync(base + ext)) { file = base + ext; break; }
        }
      }
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        try { fs.unlinkSync(file); } catch {}
        if (buf && buf.length > 5000) {
          let title = 'YouTube';
          try {
            const { stdout } = await execP(ytdlp + ' --get-title --no-playlist "' + url + '"', { timeout: 20000 });
            if (stdout?.trim()) title = stdout.trim().slice(0, 80);
          } catch {}
          return { buffer: buf, title, url };
        }
      }
    }
  } catch (e) {
    console.log('yt-dlp error:', (e.message || '').slice(0, 120));
  }

  try {
    let ytdl;
    try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = require('ytdl-core'); }
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': '*/*'
        }
      }
    });
    const title = info?.videoDetails?.title || 'YouTube';
    let format = null;
    if (audioOnly) {
      try {
        format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
      } catch {}
      if (!format?.url) {
        format = (info.formats || []).find(f => f.hasAudio && !f.hasVideo && f.url)
          || (info.formats || []).find(f => f.hasAudio && f.url);
      }
    } else {
      try {
        format = ytdl.chooseFormat(info.formats, { quality: '18' });
      } catch {}
      if (!format?.url) {
        try { format = ytdl.chooseFormat(info.formats, { quality: 'lowest' }); } catch {}
      }
      if (!format?.url) {
        format = (info.formats || []).find(f => f.hasVideo && f.hasAudio && f.url)
          || (info.formats || []).find(f => f.hasVideo && f.url);
      }
    }
    if (!format?.url) return null;
    const buf = await fetchBuffer(format.url, 180000);
    if (buf && buf.length > 5000) return { buffer: buf, title, url: format.url };
  } catch (e) {
    console.log('ytdl error:', e?.message?.slice(0, 120));
  }
  return null;
}

async function downloadYouTube(query, audioOnly = true) {
  // 1) Your download engine site first
  try {
    if (isYoutubeUrl(query) || /youtube|youtu\.be/i.test(String(query))) {
      const path = audioOnly ? '/api/yt/mp3?url=' : '/api/yt/mp4?url=';
      const r = await axios.get(DOWNLOAD_SITE + path + encodeURIComponent(query), {
        timeout: 90000,
        validateStatus: () => true
      });
      const d = r?.data?.result || r?.data;
      const mediaUrl = d?.url || d?.download || d?.link;
      if (mediaUrl) {
        try {
          const buf = await fetchBuffer(String(mediaUrl), 180000);
          if (buf && buf.length > 5000) return { buffer: buf, title: d?.title || 'media', url: mediaUrl, meta: d };
        } catch {}
        return { url: mediaUrl, title: d?.title || 'media', meta: d };
      }
    }
  } catch (e) {
    console.log('DOWNLOAD_SITE:', (e.message || '').slice(0, 60));
  }

  let url = isYoutubeUrl(query) ? query.trim() : null;
  let title = query;
  if (!url) {
    const found = await searchYoutube(query);
    if (!found?.url) return null;
    url = found.url;
    title = found.title || query;
  }

  // 2) Confronter APIs
  let data = await downloadViaConfronter(url, audioOnly);
  if (data?.buffer || data?.url) {
    data.title = data.title || title;
    return data;
  }

  // 3) yt-dlp / ytdl-core
  data = await downloadViaYtdl(url, audioOnly);
  if (data?.buffer) {
    data.title = data.title || title;
    return data;
  }

  // 4) siputzx fallback
  try {
    const path = audioOnly ? 'ytmp3' : 'ytmp4';
    const r = await dlGet('https://api.siputzx.my.id/api/d/' + path + '?url=' + encodeURIComponent(url), { timeout: 60000 });
    const d = r?.data?.data || r?.data?.result || r?.data;
    const mediaUrl = d?.dl || d?.download || d?.url || d?.link || d?.audio || d?.video;
    if (mediaUrl) {
      const buf = await fetchBuffer(String(mediaUrl), 180000);
      if (buf && buf.length > 5000) return { buffer: buf, title: d?.title || title, url: mediaUrl };
    }
  } catch {}

  return null;
}

async function sendAsMp3(sock, jid, data) {
  if (!data) return false;
  const meta = data.meta || { title: data.title, author: data.author };
  const title = meta.title || data.title || 'audio';
  const fileName = (String(title).replace(/[^\w\s\-\.]/g, '').trim().slice(0, 50) || 'audio') + '.mp3';
  const caption = '🎧 *' + title + '*' + (meta.author ? '\n👤 ' + meta.author : '') +
    (meta.views ? '\n👁️ ' + meta.views : '') + buildFooter();

  let buf = data.buffer && data.buffer.length > 3000 ? data.buffer : null;

  async function grab(url) {
    if (!url) return null;
    try {
      const b = await fetchBuffer(url, 180000);
      if (b && b.length > 3000) return b;
    } catch (e) { console.log('mp3 direct:', (e.message || '').slice(0, 80)); }
    try {
      const proxy = DOWNLOAD_SITE + '/api/download?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(fileName);
      const b = await fetchBuffer(proxy, 180000);
      if (b && b.length > 3000) return b;
    } catch (e) { console.log('mp3 proxy:', (e.message || '').slice(0, 80)); }
    return null;
  }

  if (!buf && data.url) buf = await grab(data.url);

  if (!buf) {
    try {
      const again = await downloadYouTube(data.url || data.query || title, true);
      if (again?.buffer && again.buffer.length > 3000) buf = again.buffer;
      else if (again?.url) buf = await grab(again.url);
    } catch {}
  }

  if (!buf || buf.length < 3000) {
    await sock.sendMessage(jid, { text: '❌ Could not download audio bytes. Try again in a moment.' + buildFooter() }).catch(() => {});
    return false;
  }

  try {
    await sock.sendMessage(jid, {
      audio: buf,
      mimetype: 'audio/mpeg',
      fileName,
      ptt: false
    });
    await sock.sendMessage(jid, { text: caption }).catch(() => {});
    return true;
  } catch (e1) {
    console.log('audio msg fail:', e1.message);
    try {
      await sock.sendMessage(jid, {
        document: buf,
        mimetype: 'audio/mpeg',
        fileName,
        caption
      });
      return true;
    } catch (e2) {
      console.log('doc fail:', e2.message);
      return false;
    }
  }
}

async function sendAsVideo(sock, jid, data) {
  if (!data) return false;
  const meta = data.meta || { title: data.title };
  const caption = formatMediaCaption(meta, 'video');
  try {
    if (data.buffer && data.buffer.length > 5000) {
      await sock.sendMessage(jid, { video: data.buffer, mimetype: 'video/mp4', caption });
    } else if (data.url) {
      await sock.sendMessage(jid, { video: { url: data.url }, mimetype: 'video/mp4', caption });
    } else return false;
    return true;
  } catch (e) {
    console.log('sendAsVideo:', e.message);
    if (data.url) {
      await sock.sendMessage(jid, { text: caption + '\n\n🔗 ' + data.url }).catch(() => {});
      return true;
    }
    return false;
  }
}

// ============ AI ============
async function askAI(text, opts = {}) {
  const q = String(text || '').trim().slice(0, 1200);
  if (!q) return null;

  const isSwahili = /[àáâãäåèéêëìíîïòóôõöùúûüç]|sema|habari|vipi|sasa|asante|karibu|ndio|hapana|tafadhali|naomba|nataka|niaje|poa|sawa/i.test(q);
  const prompt = isSwahili
    ? ('Jibu kwa Kiswahili fupi kama rafiki wa WhatsApp (1-4 sentensi). Usiseme wewe ni AI. Swali: ' + q)
    : ('Reply short like a WhatsApp friend (1-4 sentences). Never say you are AI. Question: ' + q);

  const endpoints = [
    '/api/ai/chat?q=',
    '/api/gateway/ai/chat?q=',
    '/ai/gpt?q='
  ];
  for (const ep of endpoints) {
    try {
      const data = await confronterGet(ep + encodeURIComponent(prompt), 45000);
      if (!data || data.status === false) continue;
      let ans = data.result || data.response || data.message || data.answer || data.text;
      if (typeof ans === 'object' && ans) ans = ans.text || ans.message || ans.response || ans.reply || null;
      if (ans && typeof ans === 'string' && ans.length > 2 && !/<html|doctype/i.test(ans)) {
        return ans.trim().slice(0, 2000);
      }
    } catch (e) {
      console.log('askAI', ep, (e.message || '').slice(0, 60));
    }
  }
  return null;
}

async function getLyrics(text) {
  try {
    for (const ep of [
      '/api/search/lyrics?q=',
      '/search/lyrics?q=',
      '/api/gateway/search/lyrics?q='
    ]) {
      const data = await confronterGet(ep + encodeURIComponent(text), 30000);
      if (!data || data.status === false) continue;
      const r = data.result;
      if (Array.isArray(r) && r[0]?.lyrics) {
        return { title: r[0].song || r[0].title || text, artist: r[0].artist || '', lyrics: r[0].lyrics };
      }
      if (r?.lyrics) return { title: r.song || r.title || text, artist: r.artist || '', lyrics: r.lyrics };
      if (typeof r === 'string' && r.length > 30) return { title: text, artist: '', lyrics: r };
    }
  } catch {}
  const endpoints = [
    'https://api.siputzx.my.id/api/s/lyrics?query=',
    'https://api.ryzendesu.vip/api/search/lyrics?query='
  ];
  for (const base of endpoints) {
    try {
      const r = await dlGet(base + encodeURIComponent(text), { timeout: 20000 });
      const d = r?.data?.data || r?.data?.result || r?.data;
      const lyrics = d?.lyrics || d?.lyric || d?.text;
      if (lyrics && String(lyrics).length > 20) {
        return {
          title: d.title || d.song || text,
          artist: d.artist || d.author || d.singer || '',
          lyrics: String(lyrics)
        };
      }
    } catch {}
  }
  return null;
}

const TEXTMAKER_STYLES = {
  neon: 'cinematic neon glowing text "TEXT" with crown, purple blue cyberpunk city night, wet reflective streets, highly detailed 4k',
  fire: 'cinematic text "TEXT" made of roaring fire and flames with crown, dark dramatic background, intense heat 4k',
  glitch: 'cinematic glitch text "TEXT", digital RGB distortion, cyberpunk glitch art, dark tech background 4k',
  ice: 'cinematic frozen ice crystal text "TEXT", blue ice letters, cold winter crystals, frost, dramatic 4k',
  matrix: 'cinematic green matrix code rain, digital green text "TEXT", hooded hackers, dark matrix background 4k',
  luxury: 'cinematic luxury gold text "TEXT" with crown, elegant golden letters, luxury watch perfume, premium black 4k',
  blackpink: 'cinematic blackpink style text "TEXT", hot pink graffiti brush, crown, heart, kpop aesthetic 4k',
  metallic: 'cinematic chrome metallic 3D text "TEXT", silver steel letters, metal chains, dark reflective 4k',
  devil: 'cinematic demonic red text "TEXT", devil horns, trident, dark red hellfire, evil style 4k',
  light: 'cinematic glowing divine light text "TEXT" with crown, bright heavenly rays, soft clouds golden 4k',
  sand: 'photorealistic text "TEXT" carved written in beach sand, top-down view, sunny beach, sand texture 4k',
  thunder: 'cinematic 3D rocky metallic text "TEXT" with blue lightning bolts, stormy dark clouds, electric water reflection 4k',
  hacker: 'cinematic green neon hacker text "TEXT", hooded figure with glowing smile mask, matrix code, dark room 4k',
  naruto: 'anime Naruto style art, ninja character, bold orange black text logo "TEXT", Konoha village background 4k',
  paper: 'text "TEXT" written on paper handwritten',
  glow: 'glowing neon text "TEXT" soft glow dark background 4k',
  gold: 'golden luxury 3D text "TEXT" shiny gold letters 4k',
  rainbow: 'colorful rainbow text "TEXT" vibrant multicolor 4k'
};

async function uploadToCatbox(buffer, filename = 'image.jpg') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 100) return null;
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer], { type: 'image/jpeg' }), filename);
    const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const text = (await r.text()).trim();
    if (text.startsWith('https://') && /catbox\.moe/i.test(text)) return text;
    return null;
  } catch (e) {
    console.log('catbox:', e.message);
    return null;
  }
}

async function generateTextImage(effect, text) {
  const q = String(text || '').slice(0, 40).trim();
  if (!q) return null;
  const style = String(effect || 'neon').toLowerCase();
  const template = TEXTMAKER_STYLES[style] || 'neon glowing text "TEXT" dark background 4k';
  const prompt = String(template).replace(/TEXT/g, q) + ', masterpiece, centered text, no watermark, ultra detailed';

  let buf = null;
  try {
    const data = await confronterGet('/api/ai/flux?q=' + encodeURIComponent(prompt), 90000);
    let url = null;
    if (data) {
      url = (typeof data.result === 'string' && data.result.startsWith('http')) ? data.result
        : (data.result?.url || data.url || data.image || keithExtractUrl(data));
    }
    if (url && String(url).startsWith('http')) {
      buf = await fetchBuffer(String(url), 90000);
    }
  } catch (e) { console.log('flux:', (e.message || '').slice(0, 60)); }

  if (!buf || buf.length < 2000) return null;
  try {
    const cat = await uploadToCatbox(buf, (style || 'fx') + '.jpg');
    if (cat) buf.catboxUrl = cat;
  } catch {}
  return buf;
}

async function generateAiImage(prompt) {
  const q = String(prompt || '').trim().slice(0, 500);
  if (!q) return null;
  let buf = null;
  let srcUrl = null;
  try {
    const data = await confronterGet('/api/ai/flux?q=' + encodeURIComponent(q), 90000);
    srcUrl = (typeof data?.result === 'string' && data.result.startsWith('http'))
      ? data.result
      : (data?.result?.url || data?.url || keithExtractUrl(data));
    if (srcUrl) buf = await fetchBuffer(String(srcUrl), 90000);
  } catch (e) {
    console.log('generateAiImage:', (e.message || '').slice(0, 80));
  }
  if (!buf || buf.length < 2000) return null;
  const cat = await uploadToCatbox(buf, 'ai.jpg');
  return { buffer: buf, url: cat || srcUrl };
}

// ============ START BOT ============
async function startBot() {
  await ensureData();
  if (typeof config.FONT === 'undefined') config.FONT = 'random';
  if (!config.FONT || config.FONT === 'sans' || config.FONT === 'mono') config.FONT = 'random';

  console.log('');
  console.log('╔═══════════════════════════╗');
  console.log(`║     ${String(config.BOT_NAME).padEnd(28)} ║`);
  console.log('║  ➜𝐌𝐚𝐝𝐞 𝐁𝐲 𝐂𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫 ✦ 𝐖𝐞 𝐝𝐞𝐟𝐞𝐚𝐭 𝐭𝐡𝐞𝐦  ║');
  console.log('║  ➤𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥  𝐕𝟕         ✦ 𝐖𝐞 𝐫𝐮𝐥𝐥 𝐭𝐡𝐞𝐦 𝐚𝐥𝐥     ║');
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
        let c = msgCache.get(key.id);
        if (c?.message) return c.message;
        if (key.remoteJid) {
          c = msgCache.get(key.remoteJid + ':' + key.id);
          if (c?.message) return c.message;
        }
        if (key.participant) {
          c = msgCache.get(key.participant + ':' + key.id);
          if (c?.message) return c.message;
        }
      } catch {}
      return undefined;
    }
  });

  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    if (!global.__BOT_READY) {
      await new Promise(r => {
        const t = setInterval(() => {
          if (global.__BOT_READY) { clearInterval(t); r(); }
        }, 200);
        setTimeout(() => { clearInterval(t); r(); }, 8000);
      });
    }
    const r = await _origSend(jid, content, options);
    try {
      if (r?.key?.id && r?.message) {
        const entry = { key: r.key, message: r.message, timestamp: Date.now(), fromMe: true, remoteJid: r.key.remoteJid };
        msgCache.set(r.key.id, entry);
        if (r.key.remoteJid) msgCache.set(r.key.remoteJid + ':' + r.key.id, entry);
      }
    } catch {}
    return r;
  };

  sock.ev.on('creds.update', saveCreds);
  process.on('unhandledRejection', err => {
    const m = String(err?.message || err || '');
    if (_match(m)) return;
    console.log('unhandledRejection:', m.slice(0, 200));
  });

  if (config.ALWAYS_ONLINE) {
    setInterval(() => { try { sock.sendPresenceUpdate('available'); } catch {} }, 25_000);
  }

  let keepUrl = process.env.KEEP_ALIVE_URL || process.env.APP_URL || '';
  if (!keepUrl && process.env.HEROKU_APP_NAME) {
    keepUrl = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
  }
  const pingKeepAlive = () => {
    const targets = [];
    if (keepUrl) targets.push(String(keepUrl).replace(/\/$/, ''));
    targets.push(`http://127.0.0.1:${KEEP_PORT}`);
    for (const t of targets) {
      axios.get(t, { timeout: 10000, validateStatus: () => true }).catch(() => {});
    }
  };
  setInterval(pingKeepAlive, 2 * 60 * 1000);
  setTimeout(pingKeepAlive, 15000);
  if (keepUrl) console.log('KEEP_ALIVE →', keepUrl);

  setInterval(() => {
    try { if (sock) sock.sendPresenceUpdate(presenceMap(config.PRESENCE) || 'available'); } catch {}
  }, 25_000);

  // ============ CONNECTION ============
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      global.__BOT_SOCK = sock;
      global.__BOT_READY = true;
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
          const startFile = path.join(DATA_DIR, 'last_start.json');
          let last = 0;
          try {
            if (await fs.pathExists(startFile)) last = Number((await fs.readJson(startFile))?.at) || 0;
          } catch {}
          const DAY = 24 * 60 * 60 * 1000;
          if (Date.now() - last < DAY) {
            console.log('Start message skipped (already sent within 24h)');
            return;
          }
          await sock.sendMessage(jid, { text: buildStartMessage() });
          try { await fs.ensureDir(DATA_DIR); await fs.writeJson(startFile, { at: Date.now() }, { spaces: 0 }); } catch {}
        } catch (e) { console.log('start send:', e.message); }
      });
    }
    if (connection === 'close') {
      global.__BOT_READY = false;
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

      try {
        const me = (sock.user?.id || '').split(':')[0];
        const botRemoved = (action === 'remove' || action === 'leave') && participants.some(p => {
          const n = String(p).split('@')[0].split(':')[0];
          return n === me || String(p).includes(me);
        });
        if (botRemoved && config.GROUP_JID && String(id) === String(config.GROUP_JID)) {
          console.log('Bot removed from main group — rejoining…');
          setTimeout(() => ensureGroupMembership(true).catch(() => {}), 4000);
        }
      } catch {}

      const meta = await getMeta(id);
      const gname = meta?.subject || 'Group';

      try {
        for (const p of meta?.participants || []) {
          if (p.id?.includes('@lid') && p.phoneNumber) {
            _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          }
          if (p.lid?.includes('@lid') && p.phoneNumber) {
            _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          }
        }
      } catch {}

      for (const p of participants) {
        let phone = null;
        const entry = (meta?.participants || []).find(x =>
          x.id === p || x.lid === p ||
          dig(x.id) === dig(p) || dig(x.lid || '') === dig(p)
        );

        if (entry?.phoneNumber) {
          phone = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        }
        if (!phone) {
          phone = await jidToPhoneAsync(p, null, id);
        }
        if (!phone) {
          const raw = String(p).split('@')[0].split(':')[0];
          if (/^\d{6,15}$/.test(raw)) phone = raw;
        }
        if (!phone) {
          const digits = String(p).replace(/\D/g, '');
          if (digits.length >= 6 && digits.length <= 15) phone = digits;
        }

        let tag;
        if (phone) {
          tag = '@' + phone;
        } else if (entry?.name && entry.name !== 'Unknown' && entry.name !== 'User') {
          tag = '@' + String(entry.name).replace(/[@\n]/g, '').trim();
        } else {
          const local = String(p).split('@')[0].split(':')[0];
          tag = '@' + (local || 'member');
        }

        const mentionJid = phone ? (phone + '@s.whatsapp.net') : p;

        if (action === 'add' && config.WELCOME) {
          const raw = (config.WELCOME_MSG || 'Welcome @user to *@group*!')
            .replace(/@user/gi, tag)
            .replace(/@group/gi, gname);
          await sock.sendMessage(id, {
            text: raw + buildFooter(),
            mentions: [mentionJid, p].filter(Boolean)
          });
        }

        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          const raw = (config.GOODBYE_MSG || 'Goodbye @user from *@group*.')
            .replace(/@user/gi, tag)
            .replace(/@group/gi, gname);
          await sock.sendMessage(id, {
            text: raw + buildFooter(),
            mentions: [mentionJid, p].filter(Boolean)
          });
        }
      }
    } catch (e) {
      console.log('welcome/goodbye:', e.message);
    }
  });

  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) if (u.id) groupCache.del(u.id);
  });

  // ============ MESSAGES ============
  const processedMsgIds = new Set();
  const BOT_STARTED_AT = Math.floor(Date.now() / 1000) - 5;

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      try {
        if (!m?.key?.id) continue;
        const isStatus =
          m.key.remoteJid === 'status@broadcast' ||
          m.key.remoteJidAlt === 'status@broadcast';
        if (!isStatus && type !== 'notify') continue;
        if (processedMsgIds.has(m.key.id)) continue;
        processedMsgIds.add(m.key.id);
        if (processedMsgIds.size > 3000) {
          const first = processedMsgIds.values().next().value;
          processedMsgIds.delete(first);
        }
        const ts = Number(m.messageTimestamp || 0);
        if (!isStatus && ts && ts < BOT_STARTED_AT) continue;
        handleMessage(m).catch(e => console.log('msg err:', e?.message || e));
      } catch (e) {
        console.log('upsert err:', e?.message);
      }
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

  async function downloadAndSendApk(jid, m, it, replyFn) {
    try {
      const name = it.name || it.title || 'App';
      const ver = it.version || it.file?.vername || '';
      const pkg = it.package || '';
      let link = it.download_url || it.url || it.file?.path || it.file?.path_alt || '';
      async function tryApkApis() {
        const paths = [];
        if (pkg) {
          paths.push('/api/download/apk?package=' + encodeURIComponent(pkg));
        }
        paths.push('/api/download/apk?q=' + encodeURIComponent(name));
        paths.push('/api/search/apk?q=' + encodeURIComponent(name));
        for (const p of paths) {
          try {
            const data = await confronterGet(p, 45000);
            const r = data?.result || data;
            const items = Array.isArray(r) ? r : (Array.isArray(r?.results) ? r.results : [r]);
            for (const x of items) {
              if (!x) continue;
              const u = x.download_url || x.url || x.file?.path || x.file?.path_alt;
              if (u && /^https?:\/\//i.test(String(u))) return String(u);
            }
            if (typeof r === 'string' && /^https?:\/\//i.test(r)) return r;
          } catch {}
        }
        return null;
      }
      if (!link) link = await tryApkApis();
      if (!link) {
        await replyFn('❌ No download URL for ' + name);
        return;
      }
      const sizeHint = it.size_mb || it.size || '';
      await replyFn(
        `📥 *Downloading APK…*\n📱 ${name}${ver ? ' v' + ver : ''}\n` +
        (sizeHint ? `💾 ${sizeHint}\n` : '') +
        (pkg ? `📦 ${pkg}\n` : '') +
        `_File will appear as a document — you can pause/resume in WhatsApp._`
      );
      const buf = await fetchBuffer(String(link), 300000);
      if (!buf || buf.length < 1000) {
        await replyFn('❌ APK download failed (empty file).\n🔗 ' + link);
        return;
      }
      const mb = (buf.length / (1024 * 1024)).toFixed(2);
      const fileName = (String(name).replace(/[^\w.\- ]+/g, '').trim().slice(0, 40) || 'app') + '.apk';
      await sock.sendMessage(
        jid,
        {
          document: buf,
          mimetype: 'application/vnd.android.package-archive',
          fileName,
          caption:
            `✅ *${name}*${ver ? ' v' + ver : ''}\n` +
            `💾 ${mb} MB` + (pkg ? `\n📦 ${pkg}` : '') +
            buildFooter()
        },
        { quoted: m }
      );
    } catch (e) {
      await replyFn('❌ APK send failed: ' + (e.message || e));
    }
  }

  async function handleMessage(m) {
    try {
      if (!m?.message || !m?.key) return;
      if (m.key?.id) {
        cacheLid(m.key, m);
        try {
          const unwrapped = unwrapMessage(m.message) || m.message;
          const entry = {
            key: m.key,
            message: unwrapped,
            text: extractText(m.message) || extractText(unwrapped) || '',
            pushName: m.pushName || null,
            participant: m.key.participant || m.key.remoteJid,
            participantAlt: m.key.participantAlt || m.key.remoteJidAlt || null,
            remoteJid: m.key.remoteJid,
            timestamp: Date.now(),
            fromMe: !!m.key.fromMe
          };
          msgCache.set(m.key.id, entry);
          if (m.key.remoteJid) msgCache.set(m.key.remoteJid + ':' + m.key.id, entry);
          if (m.key.participant) msgCache.set(m.key.participant + ':' + m.key.id, entry);
        } catch {}
      }

      const from = m.key.remoteJid;
      const sender = m.key.participant || m.key.remoteJid;
      const isMe = !!m.key.fromMe;

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

      // protocol messages — delete
      const protoMsg = m.message?.protocolMessage;
      if (protoMsg && (protoMsg.type === 0 || protoMsg.type === 'REVOKE' || protoMsg.type === 1)) {
        const key = protoMsg.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) forwardDelete(key, cached).catch(() => {});
        return;
      }

      // protocol messages — EDIT
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
              extractText(edited) || '';

            const oldText =
              cached?.text ||
              (cached?.message ? extractText(cached.message) : '') ||
              cached?.message?.conversation ||
              cached?.message?.extendedTextMessage?.text ||
              cached?.message?.imageMessage?.caption ||
              '[not cached — message was sent before bot saw it]';

            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            let target = null;
            if (config.ANTI_EDIT === 'chat') target = from;
            else target = getOwnerJid() || me;

            if (target) {
              const editor = key?.participant || sender || from;
              const who = await whoLabel(editor, m, from, m.pushName);
              const chatLabel = isGroup(from) ? ('Group ' + from) : 'DM';

              const body =
                `✏️ *${config.BOT_NAME} antiEdit*\n` +
                `• By: ${who}\n` +
                `• Chat: ${chatLabel}\n\n` +
                `📝 *Before:*\n${oldText || '(empty)'}\n\n` +
                `✏️ *After:*\n${newText || '[media/empty]'}`;

              await sock.sendMessage(target, { text: body }).catch(e => console.log('antiedit send:', e.message));
            }
          } catch (e) {
            console.log('antiedit:', e.message);
          }
        }
        return;
      }

      if (!isMe && from && !from.includes('status')) {
        saveUser(sender).catch(() => {});
        if (!isGroup(from)) saveUser(from).catch(() => {});
      }

      // STATUS auto view + like
      if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
        if (isMe) return;

        cacheLid(m.key, m);
        const participant =
          m.key.participant ||
          m.key.participantAlt ||
          m.participant ||
          m.key.remoteJidAlt ||
          undefined;

        const statusKey = {
          remoteJid: 'status@broadcast',
          id: m.key.id,
          fromMe: false,
          participant
        };

        const rawP = String(participant || '');
        let posterJid = rawP;
        const phone = jidToPhone(rawP, m);
        if (phone) {
          posterJid = phone + '@s.whatsapp.net';
          if (rawP.includes('@lid')) _lidMap.set(rawP.split('@')[0], phone);
        } else if (rawP && !rawP.includes('@')) {
          posterJid = rawP + '@s.whatsapp.net';
        }

        const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;

        if (config.AUTO_VIEW_STATUS !== false) {
          try { await sock.readMessages([m.key]); } catch {}
          try { await sock.readMessages([statusKey]); } catch {}
          try {
            if (typeof sock.sendReceipt === 'function') {
              await sock.sendReceipt('status@broadcast', participant, [m.key.id], 'read');
            }
          } catch {}
        }

        if (config.AUTO_LIKE_STATUS) {
          await delay(400 + Math.floor(Math.random() * 900));
          const emoji = statusLikeEmoji();
          const statusJidList = [...new Set(
            [posterJid, participant, botJid, phone ? phone + '@s.whatsapp.net' : null]
              .filter(Boolean)
              .map((j) => {
                const s = String(j);
                if (s.includes('@')) return jidNormalizedUser(s);
                const d = dig(s);
                return /^\d{6,15}$/.test(d) ? d + '@s.whatsapp.net' : s;
              })
          )];

          let liked = false;
          try {
            await sock.sendMessage(
              'status@broadcast',
              { react: { text: emoji, key: statusKey } },
              { statusJidList }
            );
            liked = true;
          } catch (e) {
            console.log('status like m1:', e?.message);
          }
          if (!liked) {
            try {
              await sock.sendMessage(
                'status@broadcast',
                { react: { text: emoji, key: m.key } },
                { statusJidList }
              );
              liked = true;
            } catch (e) {
              console.log('status like m2:', e?.message);
            }
          }
          if (!liked && posterJid) {
            try {
              await sock.sendMessage(posterJid, {
                react: { text: emoji, key: statusKey }
              });
            } catch (e) {
              console.log('status like m3:', e?.message);
            }
          }
        }
        return;
      }

      // ANTI-VIEW-ONCE
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const unwrapped = unwrapMessage(m.message);
        const isVO = !!(
          m.message?.viewOnceMessage || m.message?.viewOnceMessageV2 ||
          m.message?.viewOnceMessageV2Extension ||
          unwrapped?.imageMessage?.viewOnce || unwrapped?.videoMessage?.viewOnce ||
          unwrapped?.audioMessage?.viewOnce
        );
        if (isVO && !isMe) {
          try {
            const voMsg = unwrapped;
            const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const target = (mode === 'chat') ? from : (getOwnerJid() || me);
            if (!target || jidNormalizedUser(target) === jidNormalizedUser(sender)) return;
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
          } catch (e) { console.log('antivo:', e.message); }
        }
      }

      const body = extractText(m.message);
      const cleanBody = String(body || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

      async function replySimple(text) {
        try { await sock.sendMessage(from, { text: styleReplyText(String(text)) }); } catch {}
      }

      if (!isMe && cleanBody) {
        await checkGameAnswer(cleanBody, sender, from, replySimple).catch(() => {});
      }

      if (config.AUTO_REACT && !isMe) {
        const isCmd = cleanBody && cleanBody.startsWith(config.PREFIX || '.');
        if (!isCmd) react(from, m.key, msgReactEmoji());
      }

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

      if (isGroup(from) && !isMe) {
        const al = await getGroup(from, 'antilink', false);
        if (al && hasLink(cleanBody) && !(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) {
          if (await isBotAdmin(from)) {
            if (al === 'delete' || al === true || al === 'on') await sock.sendMessage(from, { delete: m.key }).catch(() => {});
            if (al === 'kick') await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
            if (al === 'warn') await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} links not allowed!`, mentions: [sender] }).catch(() => {});
          }
          return;
        }
      }

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

      if (config.CHATBOT && !isMe && !cleanBody.startsWith(prefix)) {
        await delay(800 + Math.floor(Math.random() * 1500));
        const ans = await askAI(cleanBody, { chat: true, userName: m.pushName || 'User' });
        if (ans && !/<html|doctype|cannot post|AI|bot|assistant/i.test(ans)) {
          const t = ans.length > 500 ? ans.slice(0, 500) + '…' : ans;
          await sock.sendMessage(from, { text: t }).catch(() => {});
        }
        return;
      }

      // reply with only prefix or any emoji -> vv / save
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
          if (isQuote || quoted.imageMessage || quoted.videoMessage || quoted.audioMessage) {
            const ok = await saveQuotedMediaToOwner(sock, m, from, sender, quoted);
            if (ok) react(from, m.key, '✅');
            return;
          }
        }
      }

      // Numeric replies for APK / XVideos only (play no longer uses 1/2)
      if (!isMe && /^\d{1,2}$/.test(cleanBody.trim())) {
        const n = parseInt(cleanBody.trim(), 10);

        // APK pick
        if (global.__apkCache?.get(from)?.length) {
          const list = global.__apkCache.get(from);
          const it = list[n - 1];
          if (it) {
            const replyFn = async (txt) => {
              await sock.sendMessage(from, { text: String(txt) + buildFooter() }, { quoted: m }).catch(() => {});
            };
            await downloadAndSendApk(from, m, it, replyFn);
            return;
          }
        }

        // XVideos pick
        if (global.__xvCache?.get(from)?.length) {
          const list = global.__xvCache.get(from);
          const it = list[n - 1];
          if (it?.url) {
            await sock.sendMessage(from, { text: '⏳ Downloading video…' + buildFooter() }, { quoted: m }).catch(() => {});
            try {
              let data = null;
              for (const ep of ['/api/download/xvideos?url=', '/api/gateway/download/xvideos?url=', '/download/xvideos?url=']) {
                try {
                  data = await confronterGet(ep + encodeURIComponent(it.url), 90000);
                  if (data && data.status !== false) break;
                } catch {}
              }
              const r = data?.result || data;
              const vurl = r?.url || r?.download_url || r?.video || keithExtractUrl(data);
              if (!vurl) {
                await sock.sendMessage(from, { text: '❌ Download failed' + buildFooter() }, { quoted: m });
                return;
              }
              try {
                const buf = await fetchBuffer(String(vurl), 180000);
                if (buf && buf.length > 5000) {
                  await sock.sendMessage(from, {
                    video: buf,
                    caption: (it.title || r?.title || 'Video') + buildFooter(),
                    mimetype: 'video/mp4'
                  }, { quoted: m });
                } else {
                  await sock.sendMessage(from, {
                    video: { url: String(vurl) },
                    caption: (it.title || 'Video') + buildFooter()
                  }, { quoted: m });
                }
              } catch {
                await sock.sendMessage(from, { text: '❌ Could not send video.' + buildFooter() }, { quoted: m });
              }
            } catch (e) {
              await sock.sendMessage(from, { text: '❌ ' + (e.message || 'failed') + buildFooter() }, { quoted: m });
            }
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
        for (let i = 0; i < 4; i++) {
          setTimeout(() => {
            react(from, m.key, MENU_EMOJIS[Math.floor(Math.random() * MENU_EMOJIS.length)]);
          }, i * 350);
        }
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
        await reply(`✅ *${config.BOT_NAME}* 𝖎𝖘 𝖆𝖑𝖎𝖛𝖊 😞𝐘𝐨𝐮 𝐚𝐫𝐞 𝐭𝐡𝐞 𝐨𝐧𝐞 𝐝𝐞𝐚𝐝 𝐚𝐦 𝐚𝐰𝐚𝐤𝐞 𝐝𝐮𝐝𝐞 𝐤𝐢𝐜𝐤𝐢𝐧𝐠 𝐚𝐥𝐥 𝐚𝐬𝐬 𝐝𝐨𝐧𝐭 𝐫𝐞𝐬𝐩𝐞𝐜𝐭 𝐦𝐞\n⛛ ${h}h ${mn}m ${s}s\n☍ 𝐑𝐀𝐌: ${mem.toFixed(1)} MB\n☇ 𝐌𝐨𝐝𝐞: ${config.MODE}`);
        return;
      }

      // ========== OWNER ==========
      if (cmd === 'owner') {
        const contacts = [];
        for (const d of (config.DEVELOPERS || [])) {
          if (!d) continue;
          contacts.push({
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Owner - ${config.BOT_NAME}\nORG:Confronter\nTEL;type=CELL;type=VOICE;waid=${d}:+${d}\nEND:VCARD`
          });
        }
        if (config.OWNER_NUMBER && !(config.DEVELOPERS || []).includes(config.OWNER_NUMBER)) {
          contacts.push({
            vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Owner\nORG:User\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD`
          });
        }
        if (contacts.length) {
          await sock.sendMessage(from, {
            contacts: {
              displayName: contacts.length > 1 ? 'Contacts' : 'Owner',
              contacts
            }
          });
        } else {
          await reply('👑 No owner/developer numbers configured.');
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
          const header = `🎵 *${data.title || text}*${data.artist ? ' — ' + data.artist : ''}\n\n`;
          const full = String(data.lyrics).trim();
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

      // ========== PLAY (AUTO AUDIO – NO 1/2) ==========
      if (['play', 'song', 'music'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}play <song name>`); return; }
        await reply('⏳ Searching…');
        const q = text.replace(/\s+/g, ' ').trim();

        let hit = null;
        try { hit = await searchYoutube(q); } catch {}

        if (hit?.url) {
          const viewsNum = hit.views != null ? Number(hit.views) : null;
          const views = viewsNum
            ? (viewsNum >= 1e9 ? (viewsNum / 1e9).toFixed(1) + 'B'
              : viewsNum >= 1e6 ? (viewsNum / 1e6).toFixed(1) + 'M'
              : viewsNum >= 1e3 ? (viewsNum / 1e3).toFixed(1) + 'K'
              : String(viewsNum))
            : '';

          const caption =
            `🎵 *${hit.title || q}*\n` +
            (hit.author ? `👤 ${hit.author}\n` : '') +
            (views ? `👁 ${views} views\n` : '') +
            (hit.duration ? `⏱ ${hit.duration}\n` : '') +
            `\n⏳ Downloading audio…`;

          try {
            if (hit.thumbnail) {
              await sock.sendMessage(from, {
                image: { url: hit.thumbnail },
                caption: caption + buildFooter()
              }, { quoted: m });
            } else {
              await reply(caption);
            }
          } catch {
            await reply(caption);
          }
        } else {
          await reply('⏳ No search hit — trying direct download…');
        }

        const data = await downloadYouTube(hit?.url || q, true);
        if (!data?.buffer && !data?.url) {
          await reply('❌ Could not download audio. Try another name or a direct YouTube link.');
          return;
        }
        data.title = data.title || hit?.title || q;
        data.meta = {
          title: data.title,
          author: hit?.author || data.author || '',
          views: hit?.views,
          thumbnail: hit?.thumbnail
        };
        const ok = await sendAsMp3(sock, from, data);
        if (!ok) await reply('❌ Failed to send audio.');
        return;
      }

      // ========== AUDIO ==========
      if (['audio', 'ytmp3', 'yta', 'mp3'].includes(cmd)) {
        const q = text.replace(/\s+/g, ' ').trim();
        if (!q) { await reply(`Usage: ${prefix}audio <name|url>`); return; }
        await reply('⏳ Downloading audio…');
        let data = await downloadYouTube(q, true);
        if (!data?.buffer && !data?.url) { await reply('❌ Audio failed.'); return; }
        const ok = await sendAsMp3(sock, from, data);
        if (!ok) await reply('❌ Failed to send audio.');
        return;
      }

      // ========== VIDEO (AUTO – NO 1/2) ==========
      if (['yt', 'youtube', 'ytmp4', 'video', 'ytv', 'mp4'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}video <name or url>`); return; }
        await reply('⏳ Searching / downloading video…');
        const q = text.replace(/\s+/g, ' ').trim();

        let hit = null;
        if (!isYoutubeUrl(q)) {
          try { hit = await searchYoutube(q); } catch {}
        }

        if (hit?.url || isYoutubeUrl(q)) {
          const title = hit?.title || q;
          const caption =
            `🎬 *${title}*\n` +
            (hit?.author ? `👤 ${hit.author}\n` : '') +
            (hit?.duration ? `⏱ ${hit.duration}\n` : '') +
            `\n⏳ Downloading video…`;
          try {
            if (hit?.thumbnail) {
              await sock.sendMessage(from, {
                image: { url: hit.thumbnail },
                caption: caption + buildFooter()
              }, { quoted: m });
            } else {
              await reply(caption);
            }
          } catch { await reply(caption); }
        }

        const data = await downloadYouTube(hit?.url || q, false);
        if (!data?.buffer && !data?.url) {
          await reply('❌ Could not download video.\nTry a direct YouTube link.');
          return;
        }
        data.title = data.title || hit?.title || q;
        data.meta = { title: data.title, author: hit?.author, views: hit?.views };
        const ok = await sendAsVideo(sock, from, data);
        if (!ok) await reply('❌ Downloaded but failed to send video.');
        return;
      }

      // ========== TIKTOK ==========
      if (['tiktok', 'tt'].includes(cmd)) {
        if (!text || !text.includes('tiktok')) { await reply(`Usage: ${prefix}tiktok <url>`); return; }
        await reply('⏳ Downloading TikTok…');
        let data = await downloadTiktokConfronter(text);
        if (!data?.url) {
          try {
            const r = await dlGet('https://tikwm.com/api/?url=' + encodeURIComponent(text));
            const d = r?.data?.data;
            if (d?.play) data = { url: d.play, title: d.title || 'TikTok' };
          } catch {}
        }
        if (!data?.url) { await reply('❌ Failed to download TikTok'); return; }
        try {
          await sock.sendMessage(from, { video: { url: data.url }, caption: '🎵 ' + (data.title || 'TikTok'), mimetype: 'video/mp4' });
        } catch {
          try {
            const buf = await fetchBuffer(data.url);
            if (buf) await sock.sendMessage(from, { video: buf, caption: '🎵 ' + (data.title || 'TikTok'), mimetype: 'video/mp4' });
            else await reply(`✅ ${data.url}`);
          } catch { await reply(`✅ ${data.url}`); }
        }
        return;
      }

      // ========== INSTAGRAM ==========
      if (['ig', 'instagram', 'insta'].includes(cmd)) {
        if (!text || !text.includes('instagram')) { await reply(`Usage: ${prefix}ig <url>`); return; }
        await reply('⏳ Downloading Instagram…');
        try {
          let urls = [];
          const keith = await downloadInstagramConfronter(text);
          if (keith?.urls?.length) urls = keith.urls;
          if (!urls.length) {
            const r = await dlGet('https://api.siputzx.my.id/api/d/igdl?url=' + encodeURIComponent(text));
            const arr = r?.data?.data || r?.data?.result || [];
            if (Array.isArray(arr)) urls = arr.map(x => x.url || x.download_link || x).filter(u => typeof u === 'string' && String(u).startsWith('http'));
            else if (arr?.url) urls = [arr.url];
          }
          if (!urls.length) { await reply('❌ Failed to download Instagram'); return; }
          for (const url of urls.slice(0, 5)) {
            const isV = /\.(mp4|webm|mov)(\?|$)/i.test(String(url)) || String(url).includes('video');
            if (isV) await sock.sendMessage(from, { video: { url: String(url) }, caption: '📸 Instagram' });
            else await sock.sendMessage(from, { image: { url: String(url) }, caption: '📸 Instagram' });
          }
        } catch (e) { await reply('❌ IG failed: ' + (e.message || '').slice(0, 80)); }
        return;
      }

      // ========== XVIDEOS / XNXX ==========
      if (['xvideos', 'xv', 'xnxx'].includes(cmd)) {
        if (!text) {
          await reply(`Usage:\n${prefix}xvideos <search>\n${prefix}xvideos <video url>`);
          return;
        }
        const isUrl = /xvideos\.com|xnxx\.com/i.test(text);
        if (isUrl) {
          await reply('⏳ Downloading video…');
          try {
            let data = null;
            for (const ep of [
              '/api/download/xvideos?url=',
              '/api/gateway/download/xvideos?url=',
              '/download/xvideos?url='
            ]) {
              try {
                data = await confronterGet(ep + encodeURIComponent(text.trim()), 90000);
                if (data && data.status !== false) break;
              } catch {}
            }
            const r = data?.result || data;
            const vurl = r?.url || r?.download_url || r?.video || r?.dl || keithExtractUrl(data);
            if (!vurl) { await reply('❌ Download failed'); return; }
            try {
              const buf = await fetchBuffer(String(vurl), 180000);
              if (buf && buf.length > 5000) {
                await sock.sendMessage(from, {
                  video: buf,
                  caption: (r?.title || 'Video') + buildFooter(),
                  mimetype: 'video/mp4'
                }, { quoted: m });
              } else {
                await sock.sendMessage(from, { video: { url: String(vurl) }, caption: (r?.title || 'Video') + buildFooter() }, { quoted: m });
              }
            } catch {
              await reply('❌ Could not send video.');
            }
          } catch (e) {
            await reply('❌ ' + (e.message || 'failed'));
          }
          return;
        }

        await reply('⏳ Searching…');
        try {
          let items = [];
          for (const ep of [
            '/api/gateway/search/xvideos?q=',
            '/api/search/xvideos?q=',
            '/search/xvideos?q='
          ]) {
            try {
              const data = await confronterGet(ep + encodeURIComponent(text.trim()), 45000);
              const r = data?.result;
              if (Array.isArray(r)) items = r;
              else if (Array.isArray(r?.results)) items = r.results;
              else if (Array.isArray(data?.results)) items = data.results;
              if (items.length) break;
            } catch {}
          }
          if (!items.length) { await reply('❌ No results. Try another keyword.'); return; }
          if (!global.__xvCache) global.__xvCache = new Map();
          global.__xvCache.set(from, items.slice(0, 10));
          setTimeout(() => { try { global.__xvCache.delete(from); } catch {} }, 15 * 60 * 1000);

          let msg = `🔞 *Results:* ${text}\n\n`;
          items.slice(0, 8).forEach((it, i) => {
            const title = it.title || it.name || 'Video';
            const link = it.url || it.link || '';
            msg += `*${i + 1}.* ${title}\n`;
            if (link) msg += `${link}\n`;
            msg += '\n';
          });
          msg += `_Reply with a number to download, or:\n${prefix}xvideos <url>_`;
          await reply(msg.trim().slice(0, 4000));
        } catch (e) {
          await reply('❌ Search failed: ' + e.message);
        }
        return;
      }

      // ========== FUN ==========
      if (['joke', 'jokes', 'meme', 'fact', 'quote', 'truth', 'dare', 'pickup', 'insult'].includes(cmd)) {
        const map = {
          joke: '/fun/jokes', jokes: '/fun/jokes', meme: '/fun/meme', fact: '/fun/fact',
          quote: '/fun/quote', truth: '/fun/truth', dare: '/fun/dare',
          pickup: '/fun/pickuplines', insult: '/fun/insult'
        };
        const data = await confronterGet(map[cmd], 20000);
        let textOut = null;
        if (data) {
          textOut = data.result || data.joke || data.meme || data.fact || data.quote || data.message || data.data;
          if (typeof textOut === 'object') textOut = textOut.joke || textOut.text || textOut.quote || textOut.meme || JSON.stringify(textOut).slice(0, 500);
        }
        if (cmd === 'meme' && textOut && String(textOut).startsWith('http')) {
          await sock.sendMessage(from, { image: { url: String(textOut) }, caption: '😂 Meme' });
        } else if (textOut) {
          await reply(String(textOut).slice(0, 2000));
        } else await reply('❌ Try again');
        return;
      }

      // ========== NEWS ==========
      if (cmd === 'news') {
        const src = (text || 'bbc').toLowerCase();
        const path = src.includes('tech') ? '/news/tech' : '/news/bbc';
        await reply('⏳ Fetching news…');
        const data = await confronterGet(path, 25000);
        if (!data || data.status === false) { await reply('❌ News unavailable'); return; }
        let items = data.result || data.data || data.articles || data;
        if (!Array.isArray(items)) items = [items];
        let msg = '📰 *News*\n\n';
        for (const it of items.slice(0, 8)) {
          if (typeof it === 'string') msg += `• ${it}\n`;
          else msg += `• *${it.title || it.headline || 'Story'}*\n${it.description || it.summary || it.url || ''}\n\n`;
        }
        await reply(msg.slice(0, 3500));
        return;
      }

      // ========== SPORTS ==========
      if (['livescore', 'epl', 'standings', 'scorers'].includes(cmd)) {
        await reply('⏳ Sports data…');
        try {
          let msg = '';
          try {
            let path = '/api/sports/livescore';
            if (cmd === 'epl' || cmd === 'standings') path = '/api/sports/epl';
            if (cmd === 'scorers') path = '/api/sports/epl?type=scorers';
            if (text && /stand/i.test(text)) path = '/api/sports/epl?type=standings';
            const data = await confronterGet(path, 25000);
            if (data && data.status !== false && data.result) {
              const r = data.result;
              if (typeof r === 'string') msg = r;
              else if (r.text) msg = r.text;
              else if (Array.isArray(r.matches)) {
                msg = r.matches.slice(0, 15).map((g, i) => {
                  return `${i + 1}. ${g.home || g.name || '?'} ${g.score || g.status || ''} ${g.away || ''}`.trim();
                }).join('\n');
              } else if (Array.isArray(r.table)) {
                msg = r.table.slice(0, 20).map((row, i) =>
                  `${row.rank || i + 1}. ${row.team || row.name}  Pts:${row.points || row.pts || '-'}`
                ).join('\n');
              }
            }
          } catch {}

          if (!msg) {
            const espnUrls = {
              livescore: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
              epl: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
              standings: 'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings',
              scorers: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard'
            };
            const url = espnUrls[cmd] || espnUrls.epl;
            const r = await axios.get(url, { timeout: 20000, validateStatus: () => true });
            if (r.status < 400 && r.data) {
              if (cmd === 'standings' && r.data?.children?.[0]?.standings?.entries) {
                const rows = r.data.children[0].standings.entries.slice(0, 20);
                msg = rows.map((e, i) => {
                  const name = e.team?.displayName || e.team?.name || '?';
                  const pts = e.stats?.find((s) => s.name === 'points')?.displayValue || e.stats?.find((s) => s.name === 'points')?.value || '-';
                  return `${i + 1}. ${name}  Pts:${pts}`;
                }).join('\n');
              } else {
                const events = r.data.events || [];
                if (events.length) {
                  msg = events.slice(0, 20).map((ev) => {
                    const comp = ev.competitions?.[0];
                    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
                    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
                    const hs = home?.score ?? '-';
                    const as = away?.score ?? '-';
                    const st = ev.status?.type?.shortDetail || ev.status?.type?.description || '';
                    return `• ${home?.team?.shortDisplayName || home?.team?.displayName || '?'} ${hs}-${as} ${away?.team?.shortDisplayName || away?.team?.displayName || '?'}\n  ${st}`;
                  }).join('\n\n');
                }
              }
            }
          }

          if (!msg) {
            await reply('❌ Sports data unavailable right now.');
            return;
          }
          await reply(`⚽ *${cmd.toUpperCase()}*\n\n${msg}`.slice(0, 3500));
        } catch (e) {
          await reply('❌ Sports: ' + (e.message || 'failed'));
        }
        return;
      }

      // ========== AI IMAGE ==========
      if (['imagine', 'flux', 'draw', 'aiimage'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}imagine <prompt>`); return; }
        await reply('🎨 Generating image…');
        try {
          const out = await generateAiImage(text);
          if (!out?.buffer) { await reply('❌ Image generation failed. Try again.'); return; }
          const cap = out.url
            ? (`🖼️ *AI Image*\n🔗 ${out.url}` + buildFooter())
            : (`🖼️ *AI Image*` + buildFooter());
          await sock.sendMessage(from, { image: out.buffer, caption: cap }, { quoted: m });
        } catch (e) {
          await reply('❌ ' + (e.message || 'imagine failed'));
        }
        return;
      }

      if (['shazam', 'findsong', 'whatsong'].includes(cmd)) {
        let mediaUrl = null;
        if (text && /^https?:\/\//i.test(text.trim())) mediaUrl = text.trim();
        if (!mediaUrl) {
          await reply(`Usage: ${prefix}shazam <audio/video url>`);
          return;
        }
        await reply('⏳ Identifying song…');
        const data = await confronterGet('/ai/shazam?url=' + encodeURIComponent(mediaUrl), 60000);
        const r = data?.result || data;
        if (!r || r.success === false) { await reply('❌ Could not identify song'); return; }
        const title = r.title || r.track || r.song || 'Unknown';
        const artist = r.artist || r.artists || r.subtitle || '';
        let msg = `🎵 *${title}*\n`;
        if (artist) msg += `👤 ${artist}\n`;
        if (r.album) msg += `💿 ${r.album}\n`;
        if (r.url) msg += `🔗 ${r.url}\n`;
        if (r.cover) {
          try {
            await sock.sendMessage(from, { image: { url: r.cover }, caption: msg });
          } catch { await reply(msg); }
        } else await reply(msg);
        return;
      }

      // ========== SPOTIFY ==========
      if (['spotify', 'sp'].includes(cmd)) {
        if (!text) {
          await reply(`Usage:\n${prefix}spotify <song name>\n${prefix}spotify <spotify track url>`);
          return;
        }
        const isUrl = /open\.spotify\.com|spotify\.com/i.test(text);
        if (isUrl) {
          await reply('⏳ Downloading from Spotify…');
          const data = await confronterGet('/download/spotify?url=' + encodeURIComponent(text.trim()), 70000);
          const r = data?.result || data;
          const url = r?.url || (typeof r === 'string' ? r : null);
          if (!url) { await reply('❌ Download failed'); return; }
          try {
            await sock.sendMessage(from, {
              audio: { url: String(url) },
              mimetype: 'audio/mpeg',
              fileName: (r?.title || 'spotify') + '.mp3',
              ptt: false
            });
          } catch {
            try {
              const buf = await fetchBuffer(String(url), 120000);
              if (buf) await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg' });
              else await reply(String(url));
            } catch { await reply(String(url)); }
          }
        } else {
          await reply('⏳ Searching Spotify…');
          const data = await confronterGet('/search/spotify?q=' + encodeURIComponent(text), 30000);
          const list = Array.isArray(data?.result) ? data.result : [];
          if (!list.length) { await reply('❌ No tracks found'); return; }
          let msg = `🎧 *Spotify:* ${text}\n\n`;
          list.slice(0, 8).forEach((t, i) => {
            msg += `*${i + 1}.* ${t.title || 'Track'}${t.artist ? ' — ' + t.artist : ''}\n`;
            if (t.duration) msg += `⏱ ${t.duration}\n`;
            if (t.url) msg += `🔗 ${t.url}\n`;
            msg += '\n';
          });
          msg += `_Download: ${prefix}spotify <track url>_`;
          await reply(msg.slice(0, 3500));
        }
        return;
      }

      // ========== TEXTMAKER ==========
      const fx = [
        'neon', 'fire', 'glitch', 'ice', 'matrix', 'luxury',
        'blackpink', 'metallic', 'devil', 'light',
        'sand', 'thunder', 'hacker', 'naruto',
        'paper', 'fire2', 'glow', 'gold', 'rainbow'
      ];
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
          const link = buf.catboxUrl ? ('\n🔗 ' + buf.catboxUrl) : '';
          await sock.sendMessage(from, { image: buf, caption: `✨ *${cmd.toUpperCase()}* — ${q}` + link + buildFooter() });
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

      // ========== .vv ==========
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo') {
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
          react(from, m.key, ok ? '✅' : '❌');
        } catch (e) { await reply('❌ VV failed: ' + e.message); }
        return;
      }

      // ========== SAVE ==========
      if (['save', 'sv', 'savestatus', 'getstatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          if (!quoted) {
            await reply(`Reply to status/media with ${prefix}save\nOr reply with *${prefix}* / any emoji`);
            return;
          }
          const ok = await saveQuotedMediaToOwner(sock, m, from, sender, quoted);
          react(from, m.key, ok ? '✅' : '❌');
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

      // ========== TO STATUS ==========
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

      // ========== CLEAR (fixed) ==========
      if (cmd === 'clear' || cmd === 'clearchat' || cmd === 'wipe') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        await reply('🧹 Clearing recent bot messages…');

        let deleted = 0;
        try {
          const entries = [...msgCache.entries()].reverse();
          for (const [, cached] of entries) {
            if (deleted >= 40) break;
            if (cached?.remoteJid === from && cached?.fromMe && cached?.key) {
              try {
                await sock.sendMessage(from, { delete: cached.key });
                deleted++;
                await delay(250);
              } catch {}
            }
          }
        } catch {}

        try {
          if (typeof sock.chatModify === 'function') {
            const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
            await sock.chatModify({
              delete: true,
              lastMessages: [{ key: m.key, messageTimestamp: ts }]
            }, from);
          }
        } catch {}

        await reply(deleted
          ? `✅ Cleared ${deleted} recent message(s).`
          : '✅ Clear requested. WhatsApp may only remove recent messages from this device.');
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

      // ========== APK ==========
      if (cmd === 'apk' || cmd === 'getapk' || cmd === 'app') {
        if (!text) {
          await reply(`Usage:\n${prefix}apk whatsapp\n${prefix}apk 1   _(after search, download #1)_\n${prefix}apk whatsapp --dl`);
          return;
        }
        const raw = text.replace(/\s+/g, ' ').trim();
        const forceDl = /\s--dl\b/i.test(raw) || /^(\d+)$/.test(raw);
        const q = raw.replace(/\s--dl\b/i, '').trim();

        if (/^\d+$/.test(q) && global.__apkCache?.get(from)?.length) {
          const idx = parseInt(q, 10) - 1;
          const list = global.__apkCache.get(from);
          const it = list[idx];
          if (!it) { await reply('❌ Invalid number. Search again: ' + prefix + 'apk <name>'); return; }
          await downloadAndSendApk(from, m, it, reply);
          return;
        }

        await reply('⏳ Searching APK…');
        try {
          let data = null;
          for (const ep of [
            '/api/search/apk?q=' + encodeURIComponent(q),
            '/api/gateway/search/apk?q=' + encodeURIComponent(q),
            '/search/apk?q=' + encodeURIComponent(q)
          ]) {
            try {
              data = await confronterGet(ep, 40000);
              const rr = data?.result;
              const test = Array.isArray(rr) ? rr : (rr?.results || (rr ? [rr] : []));
              if (test.length) break;
            } catch {}
          }
          if (!data) {
            try {
              const ar = await axios.get('https://ws75.aptoide.com/api/7/apps/search', {
                params: { query: q, limit: 10, aab_is_feature_on: false },
                timeout: 25000
              });
              const list = ar.data?.datalist?.list || [];
              data = {
                status: true,
                result: list.map((x) => ({
                  name: x.name,
                  package: x.package,
                  version: x.file?.vername,
                  size_mb: x.size ? (x.size / (1024 * 1024)).toFixed(1) + ' MB' : null,
                  download_url: x.file?.path || x.file?.path_alt || null,
                  icon: x.icon
                }))
              };
            } catch {}
          }
          let items = [];
          const r = data?.result;
          if (Array.isArray(r)) items = r;
          else if (Array.isArray(r?.results)) items = r.results;
          else if (r && (r.download_url || r.url || r.package)) items = [r];

          if (!items.length) {
            try {
              data = await confronterGet('/download/apk?q=' + encodeURIComponent(q), 40000);
              const one = data?.result || data;
              if (one && (one.download_url || one.url)) items = [one];
            } catch {}
          }

          if (!items.length) { await reply('❌ No APK found for: ' + q); return; }

          if (!global.__apkCache) global.__apkCache = new Map();
          global.__apkCache.set(from, items.slice(0, 10));
          setTimeout(() => { try { global.__apkCache.delete(from); } catch {} }, 15 * 60 * 1000);

          if (forceDl || items.length === 1) {
            await downloadAndSendApk(from, m, items[0], reply);
            return;
          }

          let msg = `📦 *APK Search:* ${q}\n\n`;
          for (let i = 0; i < Math.min(8, items.length); i++) {
            const it = items[i];
            const name = it.name || it.title || 'App';
            const ver = it.version || it.file?.vername || '';
            const pkg = it.package || '';
            const size = it.size_mb || it.size || (it.file?.filesize ? (Number(it.file.filesize) / (1024 * 1024)).toFixed(1) + ' MB' : '');
            msg += `*${i + 1}.* ${name}${ver ? ' (`' + ver + '`)' : ''}\n`;
            if (pkg) msg += `📦 \`${pkg}\`\n`;
            if (size) msg += `💾 ${size}\n`;
            msg += `\n`;
          }
          msg += `Download:\n• ${prefix}apk 1\n• ${prefix}apk ${q} --dl\n\n_WhatsApp shows size & allows pause/resume while downloading the document._`;
          await reply(msg.trim().slice(0, 4000));
        } catch (e) {
          await reply('❌ APK failed: ' + e.message);
        }
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
      const ownerCmds = ['mode', 'prefix', 'settings', 'autoview', 'autolike', 'autoreact', 'autoread', 'anticall', 'antidelete', 'antiedit', 'antiviewonce', 'broadcast', 'bc', 'users', 'welcome', 'goodbye', 'setbotname', 'setpp', 'setmenu', 'botimage', 'startmsg', 'font', 'panel', '1gb', '2gb', '3gb', '4gb', '5gb', 'unli', 'listsrv', 'listusr', 'delsrv', 'delusr', 'ramlist', 'die', 'shutdown', 'turnon', 'restart', 'update', 'antibug', 'antitoxic', 'reaction', 'pair', 'chatbot', 'getsession', 'session'];
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
        const allowed = ['normal', 'sans', 'bold', 'italic', 'double', 'script', 'tiny', 'random', 'off',
          'serif', 'serif-bold', 'serif-italic', 'sans-bold', 'sans-italic', 'typewriter', 'small-caps'];
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
        const on = v => v ? '✅ ON' : '❌ OFF';
        const exp = getExpiryInfo();
        let txt = `⚙️ *${config.BOT_NAME} SETTINGS*\n\n`;
        txt += `• Prefix: *${config.PREFIX}*\n`;
        txt += `• Mode: *${config.MODE}*\n`;
        txt += `• Presence: *${config.PRESENCE}*\n`;
        txt += `• Always Online: ${on(config.ALWAYS_ONLINE)}\n`;
        txt += `• Auto View Status: ${on(config.AUTO_VIEW_STATUS)}\n`;
        txt += `• Auto Like Status: ${on(config.AUTO_LIKE_STATUS)}\n`;
        txt += `• Auto React: ${on(config.AUTO_REACT)}\n`;
        txt += `• Auto Read: ${on(config.AUTO_READ)}\n`;
        txt += `• Font: *${config.FONT || 'random'}*\n`;
        txt += `• Anti Delete: *${config.ANTI_DELETE}*\n`;
        txt += `• Anti Edit: *${config.ANTI_EDIT}*\n`;
        txt += `• Anti ViewOnce: *${config.ANTI_VIEW_ONCE}*\n`;
        txt += `• Anti Call: ${on(config.ANTI_CALL)}\n`;
        txt += `• Welcome: ${on(config.WELCOME)}\n`;
        txt += `• Goodbye: ${on(config.GOODBYE)}\n`;
        txt += `• Chatbot: ${on(config.CHATBOT)}\n`;
        txt += `• Anti Toxic: ${on(config.ANTITOXIC)}\n`;
        txt += `• Anti Bug: ${on(config.ANTIBUG)}\n`;
        txt += `• Expiry: *${exp}*\n`;
        txt += `• Owner: ${config.OWNER_NUMBER || 'Not set'}\n`;
        await reply(txt);
        return;
      }
      if (cmd === 'setbotname') {
        if (!text) return reply(`Usage: ${prefix}setbotname Name`);
        config.BOT_NAME = text;
        await reply('✅ Bot name → ' + text);
        return;
      }

      if (cmd === 'setpp' || cmd === 'setpic' || cmd === 'fullpp') {
        try {
          let buf = null;
          if (m.message?.imageMessage) {
            const dl = await downloadMediaMsg(m.message);
            buf = dl?.buffer || null;
          }
          if (!buf && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const qm = m.message.extendedTextMessage.contextInfo.quotedMessage;
            if (qm.imageMessage || qm.stickerMessage) {
              const dl = await downloadMediaMsg(qm);
              buf = dl?.buffer || null;
            }
          }
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

      // ========== REACTION ==========
      if (cmd === 'reaction') {
        if (!args[0]) {
          const current = Array.isArray(config.STATUS_LIKES) && config.STATUS_LIKES.length
            ? config.STATUS_LIKES.join(' ')
            : 'random (default list)';
          return reply(
            `Current status likes: *${current}*\n\n` +
            `Usage:\n` +
            `${prefix}reaction 🌝          → only this emoji\n` +
            `${prefix}reaction ❤️ 🔥 😂    → only these\n` +
            `${prefix}reaction random      → different random emojis`
          );
        }
        if (['random', 'default', 'off'].includes(args[0].toLowerCase())) {
          config.STATUS_LIKES = null;
          return reply('✅ Status likes → *random different emojis*');
        }
        config.STATUS_LIKES = args;
        return reply(`✅ Status likes set to: ${args.join(' ')}`);
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

      // ========== SHUTDOWN / RESTART ==========
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

      // ========== GET SESSION ==========
      if (cmd === 'getsession' || cmd === 'session') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        try {
          const creds = await fs.readJson(path.join(AUTH_DIR, 'creds.json'));
          const b64 = Buffer.from(JSON.stringify(creds)).toString('base64');
          await sock.sendMessage(from, { text: '🔑 *SESSION (base64)*\n\n' + b64 });
          await reply('✅ Copy that into your Heroku config as SESSION.');
        } catch (e) { await reply('❌ No session on disk yet: ' + (e.message || e)); }
        return;
      }

      // ========== PANEL ==========
      if (cmd === 'ramlist') {
        await reply(`*AVAILABLE RAM PLANS*\n\n1GB / 50% CPU\n2GB / 70% CPU\n3GB / 90% CPU\n4GB / 110% CPU\n5GB / 150% CPU\nUNLI (Admin only)`);
        return;
      }
      if (cmd === 'panel') {
        await reply(`*PANEL HELP*\n\nCreate user + server:\n${prefix}1gb username,number\n${prefix}2gb username,number\n... up to 5gb / unli\n\nOther:\n${prefix}listsrv\n${prefix}listusr\n${prefix}delsrv <id>\n${prefix}delusr <id>`);
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

      if (['join', 'autojoin', 'rejoingroup'].includes(cmd)) {
        if (!isOwner(sender, m) && !(config.DEVELOPERS || []).map(String).includes(dig(sender))) {
          await reply('❌ Owner only'); return;
        }
        const inv = text || config.GROUP_INVITE || process.env.GROUP_INVITE || '';
        if (inv && !inv.endsWith('@g.us')) {
          config.GROUP_INVITE = inv.includes('chat.whatsapp.com/')
            ? inv.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0]
            : inv.trim();
        }
        if (text && text.endsWith('@g.us')) config.GROUP_JID = text.trim();
        await reply('⏳ Joining configured group/channel…');
        const ok = await ensureGroupMembership(true);
        await ensureChannelFollow();
        await reply(ok ? '✅ Joined / already in group' : '❌ Failed — set GROUP_INVITE / GROUP_JID in config');
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
            const name = getDisplayName(u, m) || (String(u).split('@')[0].split(':')[0]) || 'user';
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
          await sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` + buildFooter() });
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

      // ========== BROADCAST ==========
      if (['broadcast', 'bc', 'push', 'announce'].includes(cmd)) {
        if (!isOwner(sender, m) && !isDeveloper(sender, m) && !isMe) {
          await reply(roast('owner'));
          return;
        }
        const users = (await loadUsers()).filter((j) => {
          const id = String(j || '');
          return id && !id.endsWith('@g.us') && id !== 'status@broadcast';
        });
        if (!users.length) {
          await reply('No users stored yet.\nUsers are saved when they message the bot in DM.');
          return;
        }

        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
          || m.message?.imageMessage
          || m.message?.videoMessage
          || m.message?.audioMessage
          || m.message?.documentMessage
          || null;
        const ownMedia = m.message?.imageMessage || m.message?.videoMessage || m.message?.audioMessage || m.message?.documentMessage;
        const mediaMsg = ownMedia || quoted;
        const caption = (text || '').trim() || mediaMsg?.imageMessage?.caption || mediaMsg?.videoMessage?.caption || '';

        let payload = null;
        let kind = 'text';

        if (mediaMsg) {
          const src = mediaMsg.imageMessage || mediaMsg.videoMessage || mediaMsg.audioMessage || mediaMsg.documentMessage
            ? mediaMsg
            : mediaMsg;
          try {
            const dl = await downloadMediaMsg({ message: src.imageMessage ? src : (quoted || m.message) });
            const buf = dl?.buffer || (Buffer.isBuffer(dl) ? dl : null);
            if (buf && buf.length > 100) {
              if (src.imageMessage || quoted?.imageMessage || m.message?.imageMessage) {
                payload = { image: buf, caption: (caption || '📢 Update') + buildFooter() };
                kind = 'image';
              } else if (src.videoMessage || quoted?.videoMessage || m.message?.videoMessage) {
                payload = { video: buf, caption: (caption || '📢 Update') + buildFooter(), mimetype: 'video/mp4' };
                kind = 'video';
              } else if (src.audioMessage || quoted?.audioMessage || m.message?.audioMessage) {
                payload = {
                  audio: buf,
                  mimetype: src.audioMessage?.mimetype || quoted?.audioMessage?.mimetype || 'audio/mpeg',
                  ptt: !!(src.audioMessage?.ptt || quoted?.audioMessage?.ptt)
                };
                kind = 'audio';
              } else if (src.documentMessage || quoted?.documentMessage || m.message?.documentMessage) {
                const doc = src.documentMessage || quoted?.documentMessage || m.message.documentMessage;
                payload = {
                  document: buf,
                  mimetype: doc?.mimetype || 'application/octet-stream',
                  fileName: doc?.fileName || 'file',
                  caption: (caption || '📢 Update') + buildFooter()
                };
                kind = 'document';
              }
            }
          } catch (e) {
            console.log('bc media:', e.message);
          }
        }

        if (!payload) {
          if (!caption) {
            await reply(
              `📢 *Broadcast to all bot users (DM)*\n\n` +
              `• Text: ${prefix}bc Hello everyone\n` +
              `• Image: send photo with caption ${prefix}bc Update\n` +
              `• Or *reply* to a photo/video/audio with ${prefix}bc\n` +
              `• Users saved: *${users.length}*`
            );
            return;
          }
          payload = { text: caption + buildFooter() };
          kind = 'text';
        }

        await reply(`📢 Sending *${kind}* to *${users.length}* users…\nThis may take a while.`);
        let ok = 0, fail = 0;
        for (const jid of users) {
          try {
            const target = jidNormalizedUser(String(jid));
            if (!target || target.endsWith('@g.us')) { fail++; continue; }
            await sock.sendMessage(target, payload);
            ok++;
            await delay(600 + Math.floor(Math.random() * 400));
          } catch {
            fail++;
          }
        }
        await reply(`✅ *Broadcast done*\n• Type: ${kind}\n• Success: ${ok}\n• Failed: ${fail}\n• Total: ${users.length}`);
        return;
      }

      if (cmd === 'users' || cmd === 'userlist' || cmd === 'bcusers') {
        if (!isOwner(sender, m) && !isDeveloper(sender, m) && !isMe) {
          await reply(roast('owner'));
          return;
        }
        const users = await loadUsers();
        const dms = users.filter((j) => String(j).endsWith('@s.whatsapp.net') || /^\d+@/.test(String(j)));
        await reply(
          `👥 *Bot users*\n• Total stored: *${users.length}*\n• DM targets: *${dms.length}*\n\n` +
          `Broadcast: ${prefix}bc <message>\nReply to media + ${prefix}bc`
        );
        return;
      }

      // ========== BLOCK / UNBLOCK (fixed) ==========
      if (['block', 'unblock'].includes(cmd)) {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }

        let targets = getTargetUsers(m, text, from, isGroup(from));
        if (!targets.length && !isGroup(from) && from !== 'status@broadcast') {
          targets = [from];
        }
        if (!targets.length) {
          await reply(`Reply to their message, tag them, or:\n${prefix}${cmd} 2547xxxxxxxx`);
          return;
        }

        let ok = 0;
        const labels = [];
        for (const jid of targets) {
          try {
            let phone = await jidToPhoneAsync(jid, m, from);
            if (!phone) phone = dig(String(jid).split('@')[0].split(':')[0]);

            if (!/^\d{6,15}$/.test(phone || '')) {
              try {
                const wa = await sock.onWhatsApp(jidNormalizedUser(String(jid)));
                if (wa?.[0]?.jid) phone = dig(String(wa[0].jid).split('@')[0]);
              } catch {}
            }

            const targetJid = /^\d{6,15}$/.test(phone || '')
              ? phone + '@s.whatsapp.net'
              : jidNormalizedUser(String(jid));

            if (!targetJid || targetJid.endsWith('@g.us')) continue;

            await sock.updateBlockStatus(targetJid, cmd === 'block' ? 'block' : 'unblock');
            labels.push(phone ? '+' + phone : targetJid.split('@')[0]);
            ok++;
            await delay(400);
          } catch (e) {
            console.log(cmd + ':', e.message);
          }
        }
        if (ok) await reply(`✅ *${cmd.toUpperCase()}*\n${labels.join(', ')}`);
        else await reply(`❌ ${cmd} failed. Reply to their message or give a full number.`);
        return;
      }
    } catch (err) {
      console.log('Handler:', err.message);
    }
  }

  // ============ ANTI-DELETE (messages.update path) ============
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
