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
const crypto = require('crypto');
const { exec } = require('child_process');
const util = require('util');
const execP = util.promisify(exec);
const http = require('http');

// ============ KEEP-ALIVE ============
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
  GROUP_JID: '',
  CHANNEL_ID: '',
  PANEL_DOMAIN: '',
  PANEL_APIKEY: '',
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
if (!config.STATUS_LIKES) config.STATUS_LIKES = null;
if (!config.REACT_EMOJIS) config.REACT_EMOJIS = null;

// ============ NOISE SUPPRESS ============
const SUPPRESS = ['Closing session', 'Closing open session', 'Failed to decrypt', 'Session error:', 'Bad MAC', 'Decrypted message with closed session', '[LID]', 'No sessions', 'Message counter'];
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
  family100: {}, tebakgambar: {}, tebakkata: {}, tebakkalimat: {},
  tebaklirik: {}, caklontong: {}, caklontong_desk: {}, math: {}, tictactoe: {}, suit: {}
};

// ============ LID + NAME HELPERS ============
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
  const name = pushName || (await sock.getName?.(jid).catch(() => null));
  if (name && name !== 'Unknown' && name !== 'User' && name.trim()) return '@' + String(name).replace(/[@\n]/g, '').trim();
  return String(jid || '').split('@')[0] || 'Unknown';
}

function getDisplayName(jid, msg, pushName = null) {
  const phone = jidToPhone(jid, msg);
  if (phone) return '@' + phone;
  if (pushName && pushName !== 'User' && pushName.trim()) return '@' + String(pushName).replace(/[@\n]/g, '').trim();
  return null;
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
  const y = new Date().getFullYear();
  let p = (config.POWERED_BY || 'Powered by Confronter').replace(/©?\d{4}/g, '').replace(/^>\s*/, '').replace(/\*/g, '').trim();
  if (!p) p = 'Powered by Confronter';
  return `\n\n_${p} ©${y}_`;
}

// ============ FONTS ============
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
    } catch {}
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

async function editImageCaption(jid, key, buffer, caption) {
  if (key) {
    try {
      await sock.relayMessage(jid, {
        protocolMessage: { key, type: 14, editedMessage: { imageMessage: { caption } } }
      }, {});
      return true;
    } catch {}
    try {
      await sock.sendMessage(jid, { image: buffer, caption, edit: key });
      return true;
    } catch {}
  }
  try { if (key) await sock.sendMessage(jid, { delete: key }); } catch {}
  try {
    await sock.sendMessage(jid, { image: buffer, caption });
    return true;
  } catch {}
  await sock.sendMessage(jid, { text: caption });
  return true;
}

async function sendMenuWithMedia(jid, pushName, userCount) {
  const foot = buildFooter();
  let full = buildMainMenu(pushName, userCount);
  try { full = styleReplyText(full); } catch {}
  if (foot) full = full + foot;
  const loading = '⏳ *𝐋𝐨𝐚𝐝𝐢𝐧𝐠 𝐦𝐞𝐧𝐮…*';

  const resolved = await resolveMenuImageBuffer();
  const buffer = resolved?.buffer || null;

  if (buffer && Buffer.isBuffer(buffer) && buffer.length > 500) {
    let base = null;
    try { base = await sock.sendMessage(jid, { image: buffer, caption: loading }); } catch {}
    await delay(900);
    await editImageCaption(jid, base?.key || null, buffer, full);
    return;
  }
  let base = null;
  try { base = await sock.sendMessage(jid, { text: loading }); } catch {}
  await delay(700);
  try {
    if (base?.key) await sock.sendMessage(jid, { text: full, edit: base.key });
    else await sock.sendMessage(jid, { text: full });
  } catch { await sock.sendMessage(jid, { text: full }); }
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

// ============ EMOJI ============
const DEFAULT_STATUS_LIKES = ['❤️','🔥','😂','👍','😍','💯','🙏','😮','👏','🎉','✨','💜','🤍','🖤','💙','💛','🧡','🌝','🥰','😎','🤩','😘'];
const DEFAULT_REACT_EMOJIS = ['👍','❤️','🔥','😂','🙏','💯','😍','😮','👏','✨','🎉','💜','🤝','👀','🫡'];
const DEFAULT_CMD_EMOJIS = ['✅','⚡','🔥','💫','✨','🎯','👍','🤖','💜','🚀','⭐','💀','👑'];
const MENU_EMOJIS = ['💀','🔥','⚡','✨','🚀','👑','🎯','💯','🤖','💜','🌟','💥','🦾','🖤','🩸'];

function randEmoji(pool, fb) {
  const list = (Array.isArray(pool) && pool.length) ? pool : (fb || DEFAULT_REACT_EMOJIS);
  return list[Math.floor(Math.random() * list.length)] || '👍';
}
const statusLikeEmoji = () => randEmoji(config.STATUS_LIKES || DEFAULT_STATUS_LIKES, DEFAULT_STATUS_LIKES);
const msgReactEmoji = () => randEmoji(config.REACT_EMOJIS || DEFAULT_REACT_EMOJIS, DEFAULT_REACT_EMOJIS);
const cmdReactEmoji = () => randEmoji(null, DEFAULT_CMD_EMOJIS);
function react(jid, key, emoji) { sock.sendMessage(jid, { react: { text: emoji, key } }).catch(() => {}); }

async function multiReact(jid, key, emojis = MENU_EMOJIS) {
  for (const e of emojis) {
    try {
      await sock.sendMessage(jid, { react: { text: e, key } });
      await delay(280);
    } catch {}
  }
}

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
    if (dl.type === 'imageMessage') await sock.sendMessage(target, { image: dl.buffer, caption: head });
    else if (dl.type === 'videoMessage') await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4', caption: head });
    else if (dl.type === 'audioMessage') {
      await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: false });
      await sock.sendMessage(target, { text: head });
    } else await sock.sendMessage(target, { document: dl.buffer, mimetype: 'application/octet-stream', fileName: 'viewonce.bin', caption: head });
  } catch { return false; }
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

// ============ PRESENCE ============
function presenceMap(v) {
  v = String(v || '').toLowerCase();
  if (v === 'typing' || v === 'composing' || v === 'type') return 'composing';
  if (v === 'recording' || v === 'record' || v === 'rec') return 'recording';
  if (v === 'online' || v === 'available' || v === 'on') return 'available';
  if (v === 'offline' || v === 'unavailable' || v === 'off') return 'unavailable';
  return null;
}

// ============ ANTI-DELETE (FULL MEDIA) ============
async function forwardDelete(key, cached) {
  try {
    const from = key.remoteJid;
    const isStatus = from === 'status@broadcast';
    if (isStatus && !config.ANTI_DELETE_STATUS) return;
    if (!isStatus && config.ANTI_DELETE === 'off') return;
    const target = isStatus ? getOwnerJid() : (config.ANTI_DELETE === 'chat' ? from : getOwnerJid());
    if (!target) return;

    let msg = cached.message;
    if (msg?.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;

    let type = getContentType(msg) || cached.mediaType || '';
    if (!type) {
      for (const t of ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']) {
        if (msg?.[t] || cached.mediaType === t) { type = t; break; }
      }
    }

    const who = await whoLabel(key.participant || cached.participant || cached.participantAlt || from, cached, from, cached.pushName);

    let deletedText = '';
    if (type === 'conversation') deletedText = msg.conversation || '';
    else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '';
    else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '';
    else if (type === 'documentMessage') deletedText = msg.documentMessage?.fileName || '';
    else if (type === 'stickerMessage') deletedText = '[Sticker]';
    else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice Note]' : '[Audio]';

    let groupName = 'DM';
    if (isGroup(from)) {
      try { groupName = (await sock.groupMetadata(from))?.subject || 'Group'; } catch { groupName = 'Group'; }
    }

    let cap = `✅ *${config.BOT_NAME} antiDelete*\n• Deleted by: ${who}\n• Chat: ${isStatus ? 'Status' : (isGroup(from) ? 'Group: ' + groupName : 'DM')}\n`;
    if (deletedText && !deletedText.startsWith('[')) cap += `\n📝 *Deleted Text:*\n${deletedText}`;
    else if (deletedText) cap += `\n${deletedText}`;

    const buffer = cached.mediaBuffer;
    const mediaMap = {
      imageMessage: 'image',
      videoMessage: 'video',
      audioMessage: 'audio',
      stickerMessage: 'sticker',
      documentMessage: 'document'
    };

    if (buffer && mediaMap[type]) {
      const mk = mediaMap[type];
      const payload = { [mk]: buffer };
      if (mk === 'image' || mk === 'video') {
        payload.caption = cap;
        if (mk === 'video') payload.mimetype = 'video/mp4';
      } else if (mk === 'audio') {
        payload.mimetype = 'audio/ogg; codecs=opus';
        payload.ptt = !!msg?.audioMessage?.ptt;
      } else if (mk === 'document') {
        payload.mimetype = msg?.documentMessage?.mimetype || 'application/octet-stream';
        payload.fileName = msg?.documentMessage?.fileName || 'file';
        payload.caption = cap;
      }
      await sock.sendMessage(target, payload);
      if (mk === 'sticker' || mk === 'audio') await sock.sendMessage(target, { text: cap });
      return;
    }

    if (mediaMap[type]) {
      const dl = await downloadMediaMsg(msg);
      if (dl?.buffer) {
        const mk = mediaMap[type];
        const payload = { [mk]: dl.buffer };
        if (mk === 'image' || mk === 'video') {
          payload.caption = cap;
          if (mk === 'video') payload.mimetype = 'video/mp4';
        } else if (mk === 'audio') {
          payload.mimetype = 'audio/ogg; codecs=opus';
          payload.ptt = !!msg?.audioMessage?.ptt;
        } else if (mk === 'document') {
          payload.mimetype = msg?.documentMessage?.mimetype || 'application/octet-stream';
          payload.fileName = msg?.documentMessage?.fileName || 'file';
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

// ============ AUTO JOIN ============
async function getFreshGroupInviteLink() {
  const groupJid = String(config.GROUP_JID || '').trim();
  if (!groupJid.endsWith('@g.us') || !sock) return null;
  try {
    const code = await sock.groupInviteCode(groupJid);
    if (code) { config.GROUP_INVITE = code; return 'https://chat.whatsapp.com/' + code; }
  } catch {}
  const inv = String(config.GROUP_INVITE || '').trim();
  if (inv && !inv.includes('@') && inv.length >= 10) {
    const code = inv.includes('chat.whatsapp.com/') ? inv.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0] : inv;
    if (code) return 'https://chat.whatsapp.com/' + code;
  }
  return null;
}

async function autoJoinConfigured() {
  let groupJid = String(config.GROUP_JID || '').trim();
  const invRaw = String(config.GROUP_INVITE || process.env.GROUP_INVITE || '').trim();
  if (invRaw.endsWith('@g.us')) { groupJid = invRaw; config.GROUP_JID = invRaw; }
  if (invRaw && !invRaw.endsWith('@g.us') && !invRaw.includes('@')) {
    try {
      let code = invRaw;
      if (code.includes('chat.whatsapp.com/')) code = code.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0];
      if (code) {
        const gid = await sock.groupAcceptInvite(code);
        if (gid) { groupJid = String(gid); config.GROUP_JID = groupJid; }
        console.log('✅ Auto-joined group', gid || code);
      }
    } catch {}
  }
  if (groupJid.endsWith('@g.us')) {
    config.GROUP_JID = groupJid;
    try {
      const meta = await sock.groupMetadata(groupJid);
      console.log('✅ Group OK:', groupJid, '|', meta?.subject || 'group');
      for (const p of meta.participants || []) {
        if (p.id?.includes('@lid') && p.phoneNumber) _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
        if (p.lid?.includes('@lid') && p.phoneNumber) _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
      }
    } catch {}
  }
  if (config.CHANNEL_ID) {
    try {
      if (sock.newsletterFollow) await sock.newsletterFollow(String(config.CHANNEL_ID).trim());
    } catch {}
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
  return null;
}

async function downloadViaYtdl(url, audioOnly) {
  try {
    let ytdl;
    try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = require('ytdl-core'); }
    const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': UA } } });
    const title = info?.videoDetails?.title || 'YouTube';
    let format = null;
    if (audioOnly) {
      try { format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' }); } catch {}
      if (!format?.url) format = (info.formats || []).find(f => f.hasAudio && !f.hasVideo && f.url) || (info.formats || []).find(f => f.hasAudio && f.url);
    } else {
      try { format = ytdl.chooseFormat(info.formats, { quality: '18' }); } catch {}
      if (!format?.url) try { format = ytdl.chooseFormat(info.formats, { quality: 'lowest' }); } catch {}
      if (!format?.url) format = (info.formats || []).find(f => f.hasVideo && f.hasAudio && f.url) || (info.formats || []).find(f => f.hasVideo && f.url);
    }
    if (!format?.url) return null;
    const buf = await fetchBuffer(format.url, 180000);
    if (buf && buf.length > 5000) return { buffer: buf, title, url: format.url };
  } catch (e) { console.log('ytdl error:', e?.message?.slice(0, 100)); }
  return null;
}

async function downloadYouTube(query, audioOnly = true) {
  let url = isYoutubeUrl(query) ? query.trim() : null;
  let title = query;
  if (!url) {
    const found = await searchYoutube(query);
    if (!found?.url) return null;
    url = found.url;
    title = found.title || query;
  }
  const data = await downloadViaYtdl(url, audioOnly);
  if (data?.buffer) { data.title = data.title || title; return data; }
  return null;
}

async function sendAsMp3(sock, jid, data) {
  if (!data?.buffer) return false;
  try {
    await sock.sendMessage(jid, {
      audio: data.buffer, mimetype: 'audio/mpeg',
      fileName: (data.title || 'audio').replace(/[^\w\s\-]/g, '').slice(0, 60) + '.mp3', ptt: false
    });
    if (data.title) await sock.sendMessage(jid, { text: `🎵 *${data.title}*` }).catch(() => {});
    return true;
  } catch { return false; }
}
async function sendAsVideo(sock, jid, data) {
  if (!data?.buffer) return false;
  try {
    await sock.sendMessage(jid, { video: data.buffer, mimetype: 'video/mp4', caption: data.title ? `🎬 *${data.title}*` : undefined });
    return true;
  } catch { return false; }
}

// ============ CHATBOT (ENGLISH + KISWAHILI ONLY) ============
const SWAHILI_GREETINGS = {
  'sema': ['One tam', 'Sema bana', 'Niaje', 'Sasa', 'Poa sana'],
  'uko aje': ['Poa sana, wewe je?', 'Niko poa, wewe?', 'Safi sana'],
  'habari': ['Nzuri sana', 'Salama', 'Poa'],
  'niaje': ['Poa', 'Safi', 'Niko poa'],
  'sasa': ['Poa', 'Safi sana'],
  'vipi': ['Poa', 'Safi'],
  'mambo': ['Poa', 'Safi sana'],
  'hello': ['Hi', 'Hello', 'Hey'],
  'hi': ['Hi', 'Hello', 'Hey there'],
  'hey': ['Hey', 'Hi'],
  'good morning': ['Good morning', 'Habari za asubuhi'],
  'good night': ['Good night', 'Lala salama'],
  'how are you': ['I\'m good, you?', 'Niko poa, wewe je?'],
  'how are you?': ['I\'m good, you?', 'Niko poa']
};

function isEnglishOrSwahili(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  // Allow common Swahili + English characters and words
  const hasNonLatin = /[^\x00-\x7F\u00C0-\u024F\s.,!?'"0-9]/.test(t);
  if (hasNonLatin) return false; // Chinese, Arabic, Hindi etc → silent
  return true;
}

function getQuickReply(text) {
  const t = String(text || '').toLowerCase().trim();
  for (const [key, replies] of Object.entries(SWAHILI_GREETINGS)) {
    if (t === key || t.startsWith(key + ' ') || t.startsWith(key + '?')) {
      return replies[Math.floor(Math.random() * replies.length)];
    }
  }
  return null;
}

async function askAI(text, opts = {}) {
  const q = String(text || '').trim().slice(0, 2000);
  if (!q) return null;

  // Quick replies for common greetings (no AI needed)
  const quick = getQuickReply(q);
  if (quick) return quick;

  // Only reply in English or Kiswahili
  if (!isEnglishOrSwahili(q)) return null;

  const system = `You are a friendly WhatsApp chatbot. 
Rules:
- Reply ONLY in English or Kiswahili (Swahili). Never mix other languages.
- Keep replies short and natural (1-3 sentences max).
- If the user writes in Kiswahili, reply in Kiswahili.
- If the user writes in English, reply in English.
- Never say you are an AI unless asked.
- Be casual and friendly.
User name: ${opts.userName || 'friend'}.`;

  const endpoints = [
    async () => {
      const r = await axios.post('https://text.pollinations.ai/openai', {
        model: 'openai',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: q }
        ]
      }, { timeout: 45000, headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, validateStatus: () => true });
      const a = r?.data?.choices?.[0]?.message?.content;
      return (typeof a === 'string' && a.trim().length > 1) ? a.trim() : null;
    },
    async () => {
      const prompt = system + '\n\nUser: ' + q + '\nAssistant:';
      const r = await axios.get('https://text.pollinations.ai/' + encodeURIComponent(prompt.slice(0, 1400)), {
        timeout: 45000, headers: { 'User-Agent': UA, Accept: 'text/plain' },
        validateStatus: () => true, responseType: 'text', transformResponse: [d => d]
      });
      return (typeof r?.data === 'string' && r.data.trim().length > 1 && !r.data.includes('404')) ? r.data.trim() : null;
    }
  ];

  for (const fn of endpoints) {
    try {
      const ans = await fn();
      if (ans && !/404|not found|error|<!doctype|<html/i.test(ans)) {
        return ans.length > 800 ? ans.slice(0, 800) + '…' : ans;
      }
    } catch {}
  }
  return null; // stay silent on failure (no more 404)
}

// ============ LYRICS ============
async function getLyrics(text) {
  try {
    const r = await dlGet('https://api.siputzx.my.id/api/s/lyrics?query=' + encodeURIComponent(text), { timeout: 20000 });
    const d = r?.data?.data || r?.data?.result || r?.data;
    if (d?.lyrics || d?.lyric) return { title: d.title || text, artist: d.artist || d.author || '', lyrics: d.lyrics || d.lyric };
  } catch {}
  return null;
}

// ============ HIGH QUALITY TEXTMAKER ============
const TEXTMAKER_PROMPTS = {
  neon: (t) => `ultra detailed neon text "${t}", glowing purple and cyan neon lights, cyberpunk city background at night, wet reflective street, crown on top of the text, cinematic lighting, 8k, sharp, high contrast`,
  fire: (t) => `ultra detailed fiery text "${t}", burning orange and red flames, fire particles, dark volcanic background, golden crown floating above, intense heat glow, cinematic, 8k`,
  glitch: (t) => `digital glitch text "${t}", heavy RGB split, pink and cyan distortion, horizontal glitch lines, dark background, cyber aesthetic, sharp, high detail`,
  ice: (t) => `frozen ice crystal text "${t}", sharp blue ice shards, frost particles, cold blue lighting, dark icy background, crystalline texture, ultra detailed, 8k`,
  matrix: (t) => `green matrix digital text "${t}", falling green code rain, cyberpunk matrix style, glowing green, dark background, digital distortion, high detail`,
  luxury: (t) => `luxury golden metallic text "${t}", shiny gold 3D letters, crown on top, expensive watch and perfume bottle on the sides, black elegant background, cinematic lighting, ultra realistic, 8k`,
  blackpink: (t) => `BLACKPINK style text "${t}", bold pink brush stroke font, blackpink logo, pink heart, dark purple background, kpop aesthetic, vibrant, high detail`,
  metallic: (t) => `chrome metallic 3D text "${t}", polished silver metal, chains on both sides, dark smoky background, sharp reflections, ultra realistic, cinematic`,
  devil: (t) => `demonic red text "${t}", devil horns, red trident, dark hellfire background, glowing red eyes effect, evil atmosphere, ultra detailed, 8k`,
  light: (t) => `divine glowing light text "${t}", golden rays of light, soft clouds, bright sky, golden crown, heavenly atmosphere, cinematic glow, ultra detailed`,
  thunder: (t) => `electric thunder text "${t}", blue lightning bolts, rocky metallic letters, stormy dark clouds, electric arcs, dramatic lighting, ultra detailed, 8k`,
  hacker: (t) => `hacker matrix scene, large glowing green digital text "${t}" in the center, hooded hacker with glowing green X eyes and smile, green matrix code rain, multiple computer screens showing ACCESS GRANTED and world map, Razer headphones and laptop on desk, dark cyberpunk room, cinematic green lighting, ultra detailed, 8k`,
  sand: (t) => `the word "${t}" written in sand on a beach, realistic sand texture, natural sunlight, high detail, photorealistic`,
  naruto: (t) => `Naruto Uzumaki style anime scene, large bold orange and yellow text "${t}", Naruto making the shh hand sign, Konoha village background with Hokage mountain, vibrant anime colors, high quality anime art`
};

async function generateTextImage(effect, text) {
  const style = String(effect || 'neon').toLowerCase();
  const q = String(text || 'TEXT').slice(0, 30).trim() || 'TEXT';
  const promptFn = TEXTMAKER_PROMPTS[style];
  if (promptFn) {
    const prompt = promptFn(q);
    const urls = [
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&nologo=true&enhance=true&model=flux`,
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=576&nologo=true&model=flux`,
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=576&nologo=true`
    ];
    for (const url of urls) {
      try {
        const r = await dlGet(url, { responseType: 'arraybuffer', timeout: 90000 });
        if (r.status >= 400 || !r.data) continue;
        const buf = Buffer.from(r.data);
        if (buf.length < 8000) continue;
        const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const isWebp = buf.slice(0, 4).toString() === 'RIFF';
        if (isJpeg || isPng || isWebp) return buf;
      } catch {}
    }
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
  console.log('╚═══════════════════════════╝');
  console.log(`➜ Owner : ${config.OWNER_NUMBER || '(not set)'}`);
  console.log(`➜ Prefix: ${config.PREFIX}`);
  console.log(`➜ Mode  : ${config.MODE}\n`);

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

  if (config.ALWAYS_ONLINE) {
    setInterval(() => { try { sock.sendPresenceUpdate('available'); } catch {} }, 25000);
  }

  let keepUrl = process.env.KEEP_ALIVE_URL || process.env.APP_URL || '';
  if (!keepUrl && process.env.HEROKU_APP_NAME) keepUrl = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
  const pingKeepAlive = () => {
    const targets = [];
    if (keepUrl) targets.push(String(keepUrl).replace(/\/$/, ''));
    targets.push(`http://127.0.0.1:${KEEP_PORT}`);
    for (const t of targets) axios.get(t, { timeout: 10000, validateStatus: () => true }).catch(() => {});
  };
  setInterval(pingKeepAlive, 2 * 60 * 1000);
  setTimeout(pingKeepAlive, 15000);

  setInterval(() => {
    try { if (sock) sock.sendPresenceUpdate(presenceMap(config.PRESENCE) || 'available'); } catch {}
  }, 25000);

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
          const startFile = path.join(DATA_DIR, 'last_start.json');
          let last = 0;
          try { if (await fs.pathExists(startFile)) last = Number((await fs.readJson(startFile))?.at) || 0; } catch {}
          if (Date.now() - last < 24 * 60 * 60 * 1000) return;
          await sock.sendMessage(jid, { text: buildStartMessage() });
          try { await fs.writeJson(startFile, { at: Date.now() }, { spaces: 0 }); } catch {}
        } catch {}
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
          await sock.sendMessage(call.from, { text: `📞 *${config.BOT_NAME}*\n\n${config.ANTI_CALL_MSG}` }).catch(() => {});
        } catch {}
      }
    }
  });

  // ============ WELCOME / GOODBYE (REAL PHONE / USERNAME) ============
  sock.ev.on('group-participants.update', async (u) => {
    try {
      const { id, participants, action } = u;
      groupCache.del(id);
      const meta = await getMeta(id);
      const gname = meta?.subject || 'Group';

      for (const p of meta?.participants || []) {
        try {
          if (p.id?.includes('@lid') && p.phoneNumber) _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          if (p.lid?.includes('@lid') && p.phoneNumber) _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
        } catch {}
      }

      for (const p of participants) {
        let phone = null;
        const entry = (meta?.participants || []).find(x =>
          x.id === p || x.lid === p || dig(x.id) === dig(p) || dig(x.lid || '') === dig(p)
        );
        if (entry?.phoneNumber) phone = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        if (!phone) phone = await jidToPhoneAsync(p, null, id);
        if (!phone && !String(p).includes('@lid')) {
          const raw = String(p).split('@')[0].split(':')[0];
          if (/^\d{6,15}$/.test(raw)) phone = raw;
        }

        let displayName = null;
        try { displayName = entry?.name || (await sock.getName?.(p).catch(() => null)); } catch {}
        if (!displayName || displayName === 'User' || displayName === 'Unknown') displayName = null;

        let tag = phone ? '@' + phone : (displayName ? '@' + String(displayName).replace(/[@\n]/g, '').trim() : '@' + String(p).split('@')[0]);
        const mentionJid = phone ? (phone + '@s.whatsapp.net') : p;

        if (action === 'add' && config.WELCOME) {
          const raw = (config.WELCOME_MSG || 'Welcome @user to *@group*!')
            .replace(/@user/gi, tag)
            .replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: styleReplyText(raw), mentions: [mentionJid, p].filter(Boolean) });
        }
        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          const raw = (config.GOODBYE_MSG || 'Goodbye @user from *@group*.')
            .replace(/@user/gi, tag)
            .replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: styleReplyText(raw), mentions: [mentionJid, p].filter(Boolean) });
        }
      }
    } catch (e) { console.log('welcome/goodbye:', e.message); }
  });

  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) if (u.id) groupCache.del(u.id);
  });

  // ============ MESSAGES ============
  const processedMsgIds = new Set();
  const BOT_STARTED_AT = Math.floor(Date.now() / 1000) - 15;

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        if (!m?.key?.id) continue;
        if (processedMsgIds.has(m.key.id)) continue;
        processedMsgIds.add(m.key.id);
        if (processedMsgIds.size > 2000) {
          const first = processedMsgIds.values().next().value;
          processedMsgIds.delete(first);
        }
        const ts = Number(m.messageTimestamp || 0);
        if (ts && ts < BOT_STARTED_AT) continue;
        handleMessage(m).catch(e => console.log('msg err:', e?.message || e));
      } catch {}
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

  async function handleMessage(m) {
    try {
      if (!m?.message || !m?.key) return;

      // Cache with media buffer for anti-delete
      if (m.key?.id) {
        cacheLid(m.key, m);
        try {
          const unwrapped = unwrapMessage(m.message) || m.message;
          const entry = {
            key: m.key,
            message: unwrapped,
            text: extractText(m.message) || '',
            pushName: m.pushName,
            participant: m.key.participant || m.key.remoteJid,
            participantAlt: m.key.participantAlt || m.key.remoteJidAlt || null,
            remoteJid: m.key.remoteJid,
            timestamp: Date.now(),
            mediaBuffer: null,
            mediaType: null
          };
          const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
          for (const t of mediaTypes) {
            if (unwrapped?.[t]) {
              try {
                const dl = await downloadMediaMsg(unwrapped);
                if (dl?.buffer && dl.buffer.length > 200) {
                  entry.mediaBuffer = dl.buffer;
                  entry.mediaType = t;
                }
              } catch {}
              break;
            }
          }
          msgCache.set(m.key.id, entry);
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

      // Protocol delete
      const protoMsg = m.message?.protocolMessage;
      if (protoMsg && (protoMsg.type === 0 || protoMsg.type === 'REVOKE' || protoMsg.type === 1)) {
        const key = protoMsg.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) forwardDelete(key, cached).catch(() => {});
        return;
      }

      // Protocol edit
      if (protoMsg && (protoMsg.type === 14 || protoMsg.type === 'MESSAGE_EDIT' || protoMsg.editedMessage || m.message?.editedMessage)) {
        if (config.ANTI_EDIT && config.ANTI_EDIT !== 'off') {
          try {
            const key = protoMsg.key || m.message?.editedMessage?.key || m.key;
            const cached = key?.id ? msgCache.get(key.id) : null;
            const edited = protoMsg.editedMessage || m.message?.editedMessage?.message || m.message?.protocolMessage?.editedMessage || {};
            const newText = edited.conversation || edited.extendedTextMessage?.text || edited.imageMessage?.caption || edited.videoMessage?.caption || extractText(edited) || '';
            const oldText = cached?.text || cached?.message?.conversation || cached?.message?.extendedTextMessage?.text || (cached?.message ? extractText(cached.message) : '') || '[not cached]';
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            let target = config.ANTI_EDIT === 'chat' ? from : (getOwnerJid() || me);
            if (target) {
              const who = await whoLabel(key?.participant || sender || from, m, from, m.pushName);
              const body = `✏️ *${config.BOT_NAME} antiEdit*\n• By: ${who}\n• Chat: ${isGroup(from) ? 'Group' : 'DM'}\n\n📝 *Before:*\n${oldText}\n\n✏️ *After:*\n${newText || '[media/empty]'}`;
              await sock.sendMessage(target, { text: body }).catch(() => {});
            }
          } catch {}
        }
        return;
      }

      if (!isMe && from && !from.includes('status')) saveUser(sender).catch(() => {});

      // Status
      if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
        if (isMe) return;
        const statusKey = { remoteJid: 'status@broadcast', id: m.key.id, fromMe: false, participant: m.key.participant || m.key.participantAlt || undefined };
        cacheLid(m.key, m);
        if (config.AUTO_VIEW_STATUS) {
          try { await sock.readMessages([m.key]); } catch {}
          try { await sock.readMessages([statusKey]); } catch {}
        }
        if (config.AUTO_LIKE_STATUS) {
          const emoji = statusLikeEmoji();
          const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const statusJidList = [...new Set([m.key.participant, m.key.participantAlt, botJid].filter(Boolean))];
          try {
            await sock.sendMessage('status@broadcast', { react: { text: emoji, key: statusKey } }, { statusJidList });
          } catch {
            try { await sock.sendMessage('status@broadcast', { react: { text: emoji, key: m.key } }, { statusJidList }); } catch {}
          }
        }
        return;
      }

      // Anti view-once
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const unwrapped = unwrapMessage(m.message);
        const isVO = !!(m.message?.viewOnceMessage || m.message?.viewOnceMessageV2 || m.message?.viewOnceMessageV2Extension ||
          unwrapped?.imageMessage?.viewOnce || unwrapped?.videoMessage?.viewOnce || unwrapped?.audioMessage?.viewOnce);
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
              }
            }
          } catch {}
        }
      }

      const body = extractText(m.message);
      const cleanBody = (body || '').trim();
      const prefix = String(config.PREFIX || '.').trim() || '.';

      // Chatbot (English + Kiswahili only)
      if (config.CHATBOT && !isMe && !cleanBody.startsWith(prefix) && cleanBody) {
        const ans = await askAI(cleanBody, { userName: m.pushName || 'User' });
        if (ans) {
          await sock.sendMessage(from, { text: ans }).catch(() => {});
        }
        // if null → stay silent (no 404)
        return;
      }

      if (!cleanBody) return;
      if (!cleanBody.startsWith(prefix)) return;
      if (config.MODE === 'private' && !isOwner(sender, m) && !isMe) return;
      if (isBotExpired() && !isOwner(sender, m) && !isMe) {
        await sock.sendMessage(from, { text: config.EXPIRY_MSG || '⛔ Bot expired.' }).catch(() => {});
        return;
      }

      const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
      const cmd = (args.shift() || '').toLowerCase();
      const text = args.join(' ');
      console.log('CMD:', cmd, '| from:', String(from || '').split('@')[0]);

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
            let t = String(payload.text).trim();
            if (!t) delete payload.text;
            else { try { payload.text = styleReplyText(t); } catch { payload.text = t; } }
          }
          if (payload.caption != null) {
            let cap = String(payload.caption);
            try { cap = styleReplyText(cap); } catch {}
            if (foot && !/confronter|powered by/i.test(cap)) cap = cap.trimEnd() + foot;
            payload.caption = cap;
          }
          return await sock.sendMessage(from, payload);
        } catch {}
      }

      // ========== MENU (15 different emojis) ==========
      if (['menu', 'help', 'list'].includes(cmd)) {
        let userCount = 0;
        try { userCount = (await loadUsers()).length; } catch {}
        // React with 15 different emojis
        multiReact(from, m.key, MENU_EMOJIS).catch(() => {});
        await sendMenuWithMedia(from, m.pushName, userCount);
        return;
      }

      // ========== PING ==========
      if (['ping', 'p'].includes(cmd)) {
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const speed = Date.now() - t0;
        await reply(`❖ *𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥 𝐕𝟕 𝐩𝐢𝐧𝐠𝐢𝐧𝐠 𝐌𝐨𝐭𝐡𝐞𝐫𝐟𝐮𝐜𝐤𝐞𝐫..➣*\nSpeed*${speed}ms*`);
        return;
      }

      if (cmd === 'alive' || cmd === 'uptime') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), mn = Math.floor((up % 3600) / 60), s = up % 60;
        const mem = process.memoryUsage().heapUsed / 1024 / 1024;
        await reply(`✅ *${config.BOT_NAME}* is alive\n⛛ ${h}h ${mn}m ${s}s\n⟳ RAM: ${mem.toFixed(1)} MB\n☇ Mode: ${config.MODE}`);
        return;
      }

      // ========== OWNER ==========
      if (cmd === 'owner') {
        const contacts = [];
        for (const d of (config.DEVELOPERS || [])) {
          if (!d) continue;
          contacts.push({ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Owner - ${config.BOT_NAME}\nORG:Confronter\nTEL;type=CELL;type=VOICE;waid=${d}:+${d}\nEND:VCARD` });
        }
        if (config.OWNER_NUMBER && !(config.DEVELOPERS || []).includes(config.OWNER_NUMBER)) {
          contacts.push({ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:User\nORG:User\nTEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}\nEND:VCARD` });
        }
        if (contacts.length) {
          await sock.sendMessage(from, { contacts: { displayName: 'Owner', contacts } });
        } else await reply('👑 No owner configured.');
        return;
      }

      // ========== AI ==========
      if (['gpt', 'ai', 'ask', 'chatgpt'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}gpt <question>`); return; }
        await reply('🤖 Thinking…');
        const ans = await askAI(text, { userName: m.pushName });
        if (ans) await reply(`🤖 *${config.BOT_NAME} AI*\n\n${ans}`);
        else await reply('❌ AI is busy right now. Try again.');
        return;
      }

      // ========== LYRICS ==========
      if (['lyrics', 'lyric', 'lirik'].includes(cmd)) {
        if (!text) { await reply(`Usage: ${prefix}lyrics <song>`); return; }
        await reply('⏳ Searching lyrics…');
        const data = await getLyrics(text);
        if (data?.lyrics) {
          const header = `🎵 *${data.title || text}*${data.artist ? ' — ' + data.artist : ''}\n\n`;
          const full = String(data.lyrics).trim();
          if (full.length <= 3500) await reply(header + full);
          else {
            await reply(header + full.slice(0, 3500));
            for (let i = 3500; i < full.length; i += 3500) {
              await delay(600);
              await sock.sendMessage(from, { text: full.slice(i, i + 3500) }).catch(() => {});
            }
          }
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
        if (!text) { await reply(`Usage: ${prefix}video <url or name>`); return; }
        await reply('⏳ Downloading video…');
        const data = await downloadYouTube(text, false);
        if (!data?.buffer) { await reply('❌ Could not download video.'); return; }
        const ok = await sendAsVideo(sock, from, data);
        if (!ok) await reply('❌ Failed to send video.');
        return;
      }

      // ========== TEXTMAKER ==========
      const fx = ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'devil', 'sand', 'blackpink', 'metallic', 'light', 'hacker', 'naruto', 'luxury'];
      if (fx.includes(cmd)) {
        const q = (text || m.pushName || config.BOT_NAME).slice(0, 30);
        await reply(`🎨 Creating *${cmd}*…`);
        let buf = null;
        try {
          buf = await Promise.race([
            generateTextImage(cmd, q),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000))
          ]);
        } catch {}
        if (!buf || !Buffer.isBuffer(buf) || buf.length < 500) {
          await reply('❌ Effect service is down. Try later.');
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

      // ========== VV / SAVE ==========
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo') {
        try {
          const quoted = getCtx(m).quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage?.viewOnce || quoted.videoMessage?.viewOnce)) vo = quoted;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) vo = quoted;
          if (!vo) {
            await reply(`Reply to a view-once with ${prefix}vv`);
            return;
          }
          const ok = await forwardViewOnceToOwner(sock, m, from, sender, vo);
          react(from, m.key, ok ? '✅' : '❌');
        } catch (e) { await reply('❌ VV failed'); }
        return;
      }

      if (['save', 'sv', 'savestatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          if (!quoted) { await reply(`Reply to media with ${prefix}save`); return; }
          const ok = await saveQuotedMediaToOwner(sock, m, from, sender, quoted);
          react(from, m.key, ok ? '✅' : '❌');
        } catch { await reply('❌ Failed'); }
        return;
      }

      // ========== OWNER TOGGLES ==========
      const ownerCmds = ['mode', 'prefix', 'settings', 'autoview', 'autolike', 'autoreact', 'autoread', 'anticall', 'antidelete', 'antiedit', 'antiviewonce', 'broadcast', 'bc', 'users', 'welcome', 'goodbye', 'setbotname', 'setpp', 'setmenu', 'startmsg', 'font', 'die', 'shutdown', 'restart', 'update', 'antibug', 'antitoxic', 'reaction', 'pair', 'chatbot', 'getsession', 'session', 'presence', 'alwaysonline'];
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
      if (cmd === 'chatbot') {
        if (args[0] === 'on') { config.CHATBOT = true; await reply('✅ Chatbot ON (English + Kiswahili)'); }
        else if (args[0] === 'off') { config.CHATBOT = false; await reply('❌ Chatbot OFF'); }
        else await reply(`Chatbot: *${config.CHATBOT ? 'ON' : 'OFF'}*\nUsage: ${prefix}chatbot on/off`);
        return;
      }
      if (cmd === 'font') {
        const v = String(args[0] || '').toLowerCase();
        const allowed = ['normal', 'sans', 'bold', 'italic', 'double', 'script', 'tiny', 'random', 'off'];
        if (!v) return reply(`Font: *${config.FONT || 'random'}*\nOptions: ${allowed.join(', ')}`);
        if (!allowed.includes(v)) return reply(`Invalid. Use: ${allowed.join(', ')}`);
        config.FONT = v === 'off' ? 'normal' : v;
        await reply(`✅ Font → *${config.FONT}*`);
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
        await reply(`⚙️ *SETTINGS*\n• Prefix: ${config.PREFIX}\n• Mode: ${config.MODE}\n• Chatbot: ${on(config.CHATBOT)}\n• AutoView: ${on(config.AUTO_VIEW_STATUS)}\n• AutoLike: ${on(config.AUTO_LIKE_STATUS)}\n• AntiDelete: ${config.ANTI_DELETE}\n• Welcome: ${on(config.WELCOME)}\n• Goodbye: ${on(config.GOODBYE)}`);
        return;
      }
      if (cmd === 'setbotname') {
        if (!text) return reply(`Usage: ${prefix}setbotname Name`);
        config.BOT_NAME = text;
        await reply('✅ Bot name → ' + text);
        return;
      }
      if (cmd === 'startmsg') { await reply(buildStartMessage()); return; }
      if (cmd === 'reaction') {
        if (!args[0]) return reply(`Usage:\n${prefix}reaction 🌝\n${prefix}reaction random`);
        if (['random', 'default', 'off'].includes(args[0].toLowerCase())) {
          config.STATUS_LIKES = null;
          return reply('✅ Status likes → random');
        }
        config.STATUS_LIKES = args;
        return reply(`✅ Status likes set to: ${args.join(' ')}`);
      }
      if (cmd === 'die') {
        const users = getTargetUsers(m, text, from, isGroup(from));
        if (!users.length) return reply(`Tag someone\n${prefix}die @user`);
        let list = await loadBlacklist();
        for (const u of users) {
          const id = jidNormalizedUser(u);
          if (!list.includes(id)) list.push(id);
        }
        await saveBlacklist(list);
        await reply('ᴍᴏᴛʜᴇʀꜰᴜᴄᴋᴇʀ ɢᴏᴛ ɴᴏ ᴀᴄᴄᴇꜱꜱ ʜᴇʀᴇ ʜᴀᴠᴇ ʀᴇꜱᴘᴇᴄᴛ');
        return;
      }
      if (cmd === 'shutdown') {
        await reply('🛑 Shutting down...');
        setTimeout(() => process.exit(0), 1000);
        return;
      }
      if (cmd === 'restart') {
        await reply('🔄 Restarting...');
        setTimeout(() => process.exit(1), 1000);
        return;
      }
      if (cmd === 'update') {
        await reply('🔄 Update requested. Pull latest code & restart.');
        return;
      }
      if (cmd === 'pair') {
        const number = dig(args[0] || '');
        if (!number || number.length < 10) return reply(`Usage: ${prefix}pair 2547xxxxxxx`);
        try {
          const code = await sock.requestPairingCode(number);
          await reply('📲 *Pairing Code for +' + number + '*\n\n```' + code + '```\n\n1. Open WhatsApp → Linked Devices\n2. Link with phone number\n3. Enter the code');
        } catch (e) { await reply('❌ Pairing failed: ' + e.message); }
        return;
      }
      if (cmd === 'getsession' || cmd === 'session') {
        try {
          const creds = await fs.readJson(path.join(AUTH_DIR, 'creds.json'));
          const b64 = Buffer.from(JSON.stringify(creds)).toString('base64');
          await sock.sendMessage(from, { text: '🔑 *SESSION*\n\n' + b64 });
        } catch (e) { await reply('❌ No session yet'); }
        return;
      }

      // ========== GROUP COMMANDS ==========
      const groupCmds = ['promote', 'demote', 'kick', 'left', 'leave', 'approve', 'hidetag', 'tagall', 'mute', 'unmute', 'antilink', 'grouplink', 'groupinfo', 'warn', 'tagadmins', 'open', 'close', 'antibot', 'antiword'];
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

      if (['promote', 'demote', 'kick'].includes(cmd)) {
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin first.'); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const users = getTargetUsers(m, text, from, true);
        if (!users.length) { await reply(`Tag a user\n${prefix}${cmd} @user`); return; }
        const action = cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove';
        try {
          await sock.groupParticipantsUpdate(from, users, action);
          await sock.sendMessage(from, { text: styleReplyText(`✅ *${cmd.toUpperCase()}* done`), mentions: users });
        } catch (e) { await reply(`❌ Failed: ${e.message}`); }
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
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin.'); return; }
        await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
        await reply(cmd === 'mute' ? '🔇 Group muted' : '🔊 Group unmuted');
        return;
      }

      if (cmd === 'grouplink' || cmd === 'invite') {
        if (!(await isBotAdmin(from))) { await reply('❌ I need to be admin.'); return; }
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
          if (!bodyW || bodyW.startsWith('<!')) { await reply('❌ Weather error'); return; }
          await reply(`🌤️ ${bodyW}`);
        } catch { await reply('❌ Weather unavailable'); }
        return;
      }

      // ========== BLOCK / UNBLOCK ==========
      if (['block', 'unblock'].includes(cmd)) {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        let targets = [];
        const quotedP = getQuoted(m);
        if (quotedP) targets.push(quotedP);
        for (const j of getMentioned(m)) targets.push(j);
        if (text) {
          const nums = String(text).match(/\d{6,15}/g) || [];
          for (const n of nums) targets.push(n + '@s.whatsapp.net');
        }
        if (!targets.length && !isGroup(from) && from && !from.endsWith('@g.us')) targets.push(from);
        targets = [...new Set(targets.filter(Boolean))];
        if (!targets.length) { await reply(`Reply or tag\n${prefix}${cmd}`); return; }
        let ok = 0;
        const labels = [];
        for (const jid of targets) {
          try {
            let phone = await jidToPhoneAsync(jid, m, from);
            if (!phone) phone = dig(String(jid).split('@')[0].split(':')[0]);
            if (!/^\d{6,15}$/.test(phone || '')) continue;
            await sock.updateBlockStatus(phone + '@s.whatsapp.net', cmd === 'block' ? 'block' : 'unblock');
            labels.push('+' + phone);
            ok++;
          } catch {}
        }
        if (ok) await reply(`✅ *${cmd.toUpperCase()}*\n${labels.join(', ')}`);
        else await reply(`❌ ${cmd} failed`);
        return;
      }

    } catch (err) {
      console.log('Handler:', err.message);
    }
  }

  // Anti-delete via messages.update
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        if (u.update?.message === null) {
          const key = u.key;
          if (!key?.id) continue;
          const cached = msgCache.get(key.id);
          if (cached?.message) forwardDelete(key, cached);
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
