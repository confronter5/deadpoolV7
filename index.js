/**
 * DEADPOOL V8 - Confronter Edition (full merged)
 * - APIs: https://apis.techwizardx.top  | Download site: https://confronter-downloads.onrender.com
 * - Pair site: https://deadpool-session.onrender.com  (.pair for other users)
 * - Anti-delete / anti-edit / viewOnce: no more "Waiting for this message"
 * - .play/.audio -> pure playable audio (no caption/fileName)
 * - .video -> pure video (no caption)
 * - Menu: Sans Bold + Deadpool branding + loading text
 * - Welcome/left: persistent LID map (no @lid degradation)
 * - .block never blocks the bot number
 * - .update = git pull + restart
 * - Textmakers + imagine, panel, quoted APK/XV picks
 * FIX: dig / envBool / envList before config (TDZ)
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
  proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
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
  }).listen(KEEP_PORT, () => console.log('Web server on port ' + KEEP_PORT));
} catch (e) { console.log('keep server:', e.message); }

// ============ HELPERS (must be before config - fixes TDZ crash) ============
const dig = v => String(v || '').replace(/\D/g, '');
function envBool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function envList(v) {
  return String(v || '').split(/[\s,]+/).map(s => String(s).replace(/\D/g, '')).filter(Boolean);
}

// ============ CONFIG ============
const defaults = {
  BOT_NAME: 'DEADPOOL V8',
  PREFIX: '.',
  OWNER_NUMBER: '254796283064',
  DEVELOPERS: [],
  MODE: 'public',
  SESSION: '',
  POWERED_BY: '> *Powered by Confronter*',
  FONT: 'sans-bold',
  PAIR_SITE: 'https://deadpool-session.onrender.com',
  AUTO_VIEW_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_REACT: false,
  AUTO_READ: false,
  ANTI_DELETE: 'dm',
  ANTI_EDIT: 'dm',
  ANTI_VIEW_ONCE: 'dm',
  ANTI_CALL: true,
  ANTI_CALL_MSG: 'Calls are not allowed right now. Please text instead.',
  WELCOME: true,
  GOODBYE: true,
  WELCOME_MSG: 'Welcome @user to *@group*! Read the group rules.',
  GOODBYE_MSG: 'Goodbye @user from *@group*.',
  PRESENCE: 'unavailable',
  ALWAYS_ONLINE: false,
  CHATBOT: false,
  ANTITOXIC: false,
  ANTIBUG: false,
  MENU_MEDIA: '',
  BOT_IMAGE: '',
  GROUP_INVITE: '',
  GROUP_JID: '',
  CHANNEL_ID: '',
  PANEL_DOMAIN: '',
  PANEL_APIKEY: '',
  PANEL_EGG: '15',
  PANEL_LOCATION: '1',
  BOT_EXPIRY_DATE: '',
  BOT_EXPIRY_DAYS: '',
  EXPIRY_MSG: 'Bot expired. Contact the developer.',
  REPO_URL: ''
};
let fileConfig = {};
try { fileConfig = require('./config'); } catch {}
const env = process.env;
const config = {
  ...defaults,
  ...fileConfig,
  BOT_NAME: env.BOT_NAME || fileConfig.BOT_NAME || defaults.BOT_NAME,
  PREFIX: env.PREFIX || fileConfig.PREFIX || defaults.PREFIX,
  OWNER_NUMBER: String(env.OWNER_NUMBER || env.OWNER || fileConfig.OWNER_NUMBER || defaults.OWNER_NUMBER).replace(/\D/g, ''),
  DEVELOPERS: env.DEVELOPERS ? envList(env.DEVELOPERS)
    : (Array.isArray(fileConfig.DEVELOPERS) ? fileConfig.DEVELOPERS.map(dig).filter(Boolean) : envList(fileConfig.DEVELOPERS)),
  MODE: (env.MODE || fileConfig.MODE || defaults.MODE).toLowerCase(),
  SESSION: env.SESSION || env.SESSION_ID || fileConfig.SESSION || defaults.SESSION,
  FONT: env.FONT || fileConfig.FONT || defaults.FONT,
  POWERED_BY: env.POWERED_BY || fileConfig.POWERED_BY || defaults.POWERED_BY,
  MENU_MEDIA: env.MENU_MEDIA || env.BOT_IMAGE || fileConfig.MENU_MEDIA || fileConfig.BOT_IMAGE || defaults.MENU_MEDIA,
  BOT_IMAGE: env.BOT_IMAGE || env.MENU_MEDIA || fileConfig.BOT_IMAGE || fileConfig.MENU_MEDIA || defaults.BOT_IMAGE,
  GROUP_INVITE: env.GROUP_INVITE || fileConfig.GROUP_INVITE || defaults.GROUP_INVITE,
  GROUP_JID: env.GROUP_JID || fileConfig.GROUP_JID || defaults.GROUP_JID,
  CHANNEL_ID: env.CHANNEL_ID || fileConfig.CHANNEL_ID || defaults.CHANNEL_ID,
  PANEL_DOMAIN: (env.PANEL_DOMAIN || fileConfig.PANEL_DOMAIN || defaults.PANEL_DOMAIN).replace(/\/+$/, ''),
  PANEL_APIKEY: env.PANEL_APIKEY || fileConfig.PANEL_APIKEY || defaults.PANEL_APIKEY,
  PANEL_EGG: env.PANEL_EGG || fileConfig.PANEL_EGG || defaults.PANEL_EGG,
  REPO_URL: env.REPO_URL || fileConfig.REPO_URL || defaults.REPO_URL,
  PAIR_SITE: (env.PAIR_SITE || fileConfig.PAIR_SITE || defaults.PAIR_SITE || 'https://deadpool-session.onrender.com').replace(/\/+$/, ''),
  BOT_EXPIRY_DATE: env.BOT_EXPIRY_DATE || env.EXPIRY_DATE || fileConfig.BOT_EXPIRY_DATE || defaults.BOT_EXPIRY_DATE,
  BOT_EXPIRY_DAYS: env.BOT_EXPIRY_DAYS || env.EXPIRY_DAYS || fileConfig.BOT_EXPIRY_DAYS || defaults.BOT_EXPIRY_DAYS,
  EXPIRY_MSG: env.EXPIRY_MSG || fileConfig.EXPIRY_MSG || defaults.EXPIRY_MSG,
  WELCOME_MSG: env.WELCOME_MSG || fileConfig.WELCOME_MSG || defaults.WELCOME_MSG,
  GOODBYE_MSG: env.GOODBYE_MSG || fileConfig.GOODBYE_MSG || defaults.GOODBYE_MSG,
  ANTI_CALL_MSG: env.ANTI_CALL_MSG || fileConfig.ANTI_CALL_MSG || defaults.ANTI_CALL_MSG,
  ANTI_DELETE: (env.ANTI_DELETE || fileConfig.ANTI_DELETE || defaults.ANTI_DELETE),
  ANTI_EDIT: (env.ANTI_EDIT || fileConfig.ANTI_EDIT || defaults.ANTI_EDIT),
  ANTI_VIEW_ONCE: (env.ANTI_VIEW_ONCE || fileConfig.ANTI_VIEW_ONCE || defaults.ANTI_VIEW_ONCE),
  PRESENCE: (env.PRESENCE || fileConfig.PRESENCE || defaults.PRESENCE)
};
for (const k of ['AUTO_VIEW_STATUS', 'AUTO_LIKE_STATUS', 'AUTO_REACT', 'AUTO_READ', 'ANTI_CALL', 'WELCOME', 'GOODBYE', 'ALWAYS_ONLINE', 'CHATBOT', 'ANTITOXIC', 'ANTIBUG']) {
  config[k] = env[k] !== undefined ? envBool(env[k], defaults[k]) : (fileConfig[k] ?? defaults[k]);
}
for (const k of ['ANTI_DELETE', 'ANTI_EDIT', 'ANTI_VIEW_ONCE']) {
  const v = String(config[k]).toLowerCase();
  config[k] = (v === 'pm' || v === 'private') ? 'dm' : (['off', 'dm', 'chat'].includes(v) ? v : 'dm');
}
config.STATUS_LIKES = env.STATUS_LIKES ? String(env.STATUS_LIKES).split(/[\s,]+/).filter(Boolean)
  : (Array.isArray(fileConfig.STATUS_LIKES) && fileConfig.STATUS_LIKES.length ? fileConfig.STATUS_LIKES : null);
config.REACT_EMOJIS = (Array.isArray(fileConfig.REACT_EMOJIS) && fileConfig.REACT_EMOJIS.length) ? fileConfig.REACT_EMOJIS : null;
config.START_MSG = env.START_MSG || fileConfig.START_MSG || '';
config.SEND_START_MSG = env.SEND_START_MSG !== undefined ? envBool(env.SEND_START_MSG, false) : (fileConfig.SEND_START_MSG ?? false);
config.CONFRONTER_API = (env.CONFRONTER_API || env.API_BASE || 'https://apis.techwizardx.top').replace(/\/+$/, '');
config.DOWNLOAD_SITE = (env.DOWNLOAD_SITE || 'https://confronter-downloads.onrender.com').replace(/\/+$/, '');

// ============ NOISE SUPPRESS ============
const SUPPRESS = ['Closing session', 'Closing open session', 'Failed to decrypt', 'Session error:', 'Bad MAC', 'Decrypted message with closed session', '[LID]', 'No sessions', 'Message counter', 'rate-overlimit'];
const _match = s => typeof s === 'string' && SUPPRESS.some(p => s.includes(p));
const _log = console.log.bind(console);
console.log = (...a) => { if (_match(String(a[0] || ''))) return; _log(...a); };

// ============ HELPERS ============
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function dlGet(url, e = {}) {
  return axios.get(url, { timeout: e.timeout || 45000, validateStatus: () => true, headers: { 'User-Agent': UA, Accept: '*/*', ...(e.headers || {}) }, ...e });
}
async function fetchBuffer(url, t = 120000) {
  const u = String(url || '');
  const isTokyo = /tokyo\.xyz|123tokyo/i.test(u);
  const headerSets = [
    { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity', Referer: isTokyo ? 'https://123tokyo.xyz/' : 'https://www.youtube.com/', Origin: isTokyo ? 'https://123tokyo.xyz' : 'https://www.youtube.com' },
    { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', Accept: '*/*', Referer: 'https://123tokyo.xyz/', Origin: 'https://123tokyo.xyz' },
    { 'User-Agent': UA, Accept: 'audio/mpeg,video/mp4,audio/*,*/*', 'Accept-Encoding': 'identity' }
  ];
  let lastErr = null;
  for (const headers of headerSets) {
    try {
      const r = await axios.get(u, { responseType: 'arraybuffer', timeout: t, maxContentLength: 300 * 1024 * 1024, maxRedirects: 8, validateStatus: () => true, headers });
      if (r.status >= 400) { lastErr = new Error('HTTP ' + r.status); continue; }
      const buf = Buffer.from(r.data);
      if (buf.length < 800) { lastErr = new Error('Empty media'); continue; }
      if (/^\s*</.test(buf.slice(0, 20).toString())) { lastErr = new Error('HTML not media'); continue; }
      return buf;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('fetch failed');
}
const delay = ms => new Promise(r => setTimeout(r, ms));

// ============ PATHS ============
const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
const TMP_DIR = path.join(__dirname, 'tmp');
fs.ensureDirSync(TMP_DIR);
const msgCache = new NodeCache({ stdTTL: 60 * 60 * 48, checkperiod: 300, useClones: false });
const groupCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 120 });
const floodMap = new Map();
let sock = null;
const _lidMap = new Map();
const LID_MAP_FILE = path.join(DATA_DIR, 'lid_map.json');
try {
  if (fs.existsSync(LID_MAP_FILE)) {
    const obj = fs.readJsonSync(LID_MAP_FILE);
    for (const [k, v] of Object.entries(obj || {})) {
      if (k && v && /^\d{6,15}$/.test(String(v))) _lidMap.set(String(k), String(v));
    }
  }
} catch {}
function persistLidMap() {
  try {
    const obj = {};
    for (const [k, v] of _lidMap.entries()) obj[k] = v;
    fs.writeJsonSync(LID_MAP_FILE, obj);
  } catch {}
}
let _lidSaveTimer = null;
function scheduleLidSave() {
  if (_lidSaveTimer) return;
  _lidSaveTimer = setTimeout(() => { _lidSaveTimer = null; persistLidMap(); }, 2000);
}

const games = { family100: {}, tebakgambar: {}, tebakkata: {}, tebakkalimat: {}, tebaklirik: {}, caklontong: {}, caklontong_desk: {}, math: {} };

// cache stores either an array or {list, msgId} - always read via this
function getCachedList(cache, from) {
  try {
    const e = cache && cache.get(from);
    if (!e) return { list: null, msgId: null };
    if (Array.isArray(e)) return { list: e, msgId: null };
    return { list: e.list || null, msgId: e.msgId || null };
  } catch { return { list: null, msgId: null }; }
}

// ============ PICK-LIST RESOLVER (quoted number replies for APK / XVideos / XNXX) ============
function resolvePickList(m, from) {
  try {
    const quotedId = getCtx(m)?.stanzaId;
    const a = global.__apkCache?.get(from);
    const x = global.__xvCache?.get(from);
    // 1) if the user QUOTED the results message, that message id decides which list
    if (quotedId) {
      if (a?.msgId === quotedId && a.list?.length) return { type: 'apk', list: a.list };
      if (x?.msgId === quotedId && x.list?.length) return { type: 'xv', list: x.list };
    }
    // 2) bare number (no quote) -> whichever results list was sent most recently
    const last = global.__lastListType?.get(from);
    if (last === 'xv' && x?.list?.length) return { type: 'xv', list: x.list };
    if (a?.list?.length) return { type: 'apk', list: a.list };
    if (x?.list?.length) return { type: 'xv', list: x.list };
  } catch {}
  return null;
}

// ============ BUFFER VALIDATORS (stop HTML/error pages being sent as media) ============
function isAudioBuffer(b) {
  if (!b || b.length < 12) return false;
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true;                       // MPEG frame
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;               // ID3 tag
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return true; // OggS
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true; // ftyp (m4a)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true; // RIFF/wav
  return false;
}
function isImageBuffer(b) {
  if (!b || b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8) return true;                               // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true; // WEBP/RIFF
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true; // WEBP/ftyp
  return false;
}

// ============ LID / NAME HELPERS ============
function cacheLid(key, msg) {
  try {
    const p = key?.participant || msg?.key?.participant;
    const alt = key?.participantAlt || msg?.key?.participantAlt || msg?.key?.remoteJidAlt;
    if (p && String(p).includes('@lid') && alt && !String(alt).includes('@lid')) {
      const phone = String(alt).split('@')[0].split(':')[0];
      if (/^\d{6,15}$/.test(phone)) { _lidMap.set(String(p).split('@')[0], phone); scheduleLidSave(); }
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
      if (/^\d{6,15}$/.test(n)) { _lidMap.set(lid, n); scheduleLidSave(); return n; }
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
      const entry = meta.participants.find(x => String(x.id || '').split('@')[0] === lid || String(x.lid || '').split('@')[0] === lid);
      if (entry?.phoneNumber) {
        const n = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        if (/^\d{6,15}$/.test(n)) { _lidMap.set(lid, n); scheduleLidSave(); return n; }
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
  return (String(jid || '').split('@')[0]) || 'Unknown';
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
async function saveGroup(gid, k, v) { const d = await loadGroups(); if (!d[gid]) d[gid] = {}; d[gid][k] = v; await fs.writeJson(GROUPS_FILE, d, { spaces: 2 }); }
async function getGroup(gid, k, def = false) { const d = await loadGroups(); return d?.[gid]?.[k] ?? def; }
async function loadBlacklist() { try { return await fs.readJson(BLACKLIST_FILE); } catch { return []; } }
async function saveBlacklist(list) { await fs.writeJson(BLACKLIST_FILE, list, { spaces: 2 }); }

// ============ ROASTS / FOOTER ============
const ROASTS = {
  owner: ['Owner only. You have no authority here.'],
  admin: ['Admins only. This command is not for you.'],
  group: ['Group only. This command works in groups.']
};
const roast = k => ROASTS[k][Math.floor(Math.random() * ROASTS[k].length)];
const buildFooter = () => '\n\n' + (config.POWERED_BY || '> *Powered by Confronter*');

// ============ FONTS ============
const FONT_MAPS = {
  sans: {a:'𝖺',b:'𝖻',c:'𝖼',d:'𝖽',e:'𝖾',f:'𝖿',g:'𝗀',h:'𝗁',i:'𝗂',j:'𝗃',k:'𝗄',l:'𝗅',m:'𝗆',n:'𝗇',o:'𝗈',p:'𝗉',q:'𝗊',r:'𝗋',s:'𝗌',t:'𝗍',u:'𝗎',v:'𝗏',w:'𝗐',x:'𝗑',y:'𝗒',z:'𝗓',A:'𝖠',B:'𝖡',C:'𝖢',D:'𝖣',E:'𝖤',F:'𝖥',G:'𝖦',H:'𝖧',I:'𝖨',J:'𝖩',K:'𝖪',L:'𝖫',M:'𝖬',N:'𝖭',O:'𝖮',P:'𝖯',Q:'𝖰',R:'𝖱',S:'𝖲',T:'𝖳',U:'𝖴',V:'𝖵',W:'𝖶',X:'𝖷',Y:'𝖸',Z:'𝖹','0':'𝟢','1':'𝟣','2':'𝟤','3':'𝟥','4':'𝟦','5':'𝟧','6':'𝟨','7':'𝟩','8':'𝟪','9':'𝟫'},
  bold: {a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭','0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'},
  italic: {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧',A:'𝐴',B:'𝐵',C:'𝐶',D:'𝐷',E:'𝐸',F:'𝐹',G:'𝐺',H:'𝐻',I:'𝐼',J:'𝐽',K:'𝐾',L:'𝐿',M:'𝑀',N:'𝑁',O:'𝑂',P:'𝑃',Q:'𝑄',R:'𝑅',S:'𝑆',T:'𝑇',U:'𝑈',V:'𝑉',W:'𝑊',X:'𝑋',Y:'𝑌',Z:'𝑍'},
  double: {a:'𝕒',b:'𝕓',c:'𝕔',d:'𝕕',e:'𝕖',f:'𝕗',g:'𝕘',h:'𝕙',i:'𝕚',j:'𝕛',k:'𝕜',l:'𝕝',m:'𝕞',n:'𝕟',o:'𝕠',p:'𝕡',q:'𝕢',r:'𝕣',s:'𝕤',t:'𝕥',u:'𝕦',v:'𝕧',w:'𝕨',x:'𝕩',y:'𝕪',z:'𝕫',A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',K:'𝕂',L:'𝕃',M:'𝕄',N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ','0':'𝟘','1':'𝟙','2':'𝟚','3':'𝟛','4':'𝟜','5':'𝟝','6':'𝟞','7':'𝟟','8':'𝟠','9':'𝟡'},
  script: {a:'𝓪',b:'𝓫',c:'𝓬',d:'𝓭',e:'𝓮',f:'𝓯',g:'𝓰',h:'𝓱',i:'𝓲',j:'𝓳',k:'𝓴',l:'𝓵',m:'𝓶',n:'𝓷',o:'𝓸',p:'𝓹',q:'𝓺',r:'𝓻',s:'𝓼',t:'𝓽',u:'𝓾',v:'𝓿',w:'𝔀',x:'𝔁',y:'𝔂',z:'𝔃',A:'𝓐',B:'𝓑',C:'𝓒',D:'𝓓',E:'𝓔',F:'𝓕',G:'𝓖',H:'𝓗',I:'𝓘',J:'𝓙',K:'𝓚',L:'𝓛',M:'𝓜',N:'𝓝',O:'𝓞',P:'𝓟',Q:'𝓠',R:'𝓡',S:'𝓢',T:'𝓣',U:'𝓤',V:'𝓥',W:'𝓦',X:'𝓧',Y:'𝓨',Z:'𝓩'},
  tiny: {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'},
  serif: {a:'𝑎',b:'𝑏',c:'𝑐',d:'𝑑',e:'𝑒',f:'𝑓',g:'𝑔',h:'ℎ',i:'𝑖',j:'𝑗',k:'𝑘',l:'𝑙',m:'𝑚',n:'𝑛',o:'𝑜',p:'𝑝',q:'𝑞',r:'𝑟',s:'𝑠',t:'𝑡',u:'𝑢',v:'𝑣',w:'𝑤',x:'𝑥',y:'𝑦',z:'𝑧',A:'𝐴',B:'𝐵',C:'𝐶',D:'𝐷',E:'𝐸',F:'𝐹',G:'𝐺',H:'𝐻',I:'𝐼',J:'𝐽',K:'𝐾',L:'𝐿',M:'𝑀',N:'𝑁',O:'𝑂',P:'𝑃',Q:'𝑄',R:'𝑅',S:'𝑆',T:'𝑇',U:'𝑈',V:'𝑉',W:'𝑊',X:'𝑋',Y:'𝑌',Z:'𝑍'},
  'serif-bold': {a:'𝐚',b:'𝐛',c:'𝐜',d:'𝐝',e:'𝐞',f:'𝐟',g:'𝐠',h:'𝐡',i:'𝐢',j:'𝐣',k:'𝐤',l:'𝐥',m:'𝐦',n:'𝐧',o:'𝐨',p:'𝐩',q:'𝐪',r:'𝐫',s:'𝐬',t:'𝐭',u:'𝐮',v:'𝐯',w:'𝐰',x:'𝐱',y:'𝐲',z:'𝐳',A:'𝐀',B:'𝐁',C:'𝐂',D:'𝐃',E:'𝐄',F:'𝐅',G:'𝐆',H:'𝐇',I:'𝐈',J:'𝐉',K:'𝐊',L:'𝐋',M:'𝐌',N:'𝐍',O:'𝐎',P:'𝐏',Q:'𝐐',R:'𝐑',S:'𝐒',T:'𝐓',U:'𝐔',V:'𝐕',W:'𝐖',X:'𝐗',Y:'𝐘',Z:'𝐙','0':'𝟎','1':'𝟏','2':'𝟐','3':'𝟑','4':'𝟒','5':'𝟓','6':'𝟔','7':'𝟕','8':'𝟖','9':'𝟗'},
  typewriter: {a:'𝚊',b:'𝚋',c:'𝚌',d:'𝚍',e:'𝚎',f:'𝚏',g:'𝚐',h:'𝚑',i:'𝚒',j:'𝚓',k:'𝚔',l:'𝚕',m:'𝚖',n:'𝚗',o:'𝚘',p:'𝚙',q:'𝚚',r:'𝚛',s:'𝚜',t:'𝚝',u:'𝚞',v:'𝚟',w:'𝚠',x:'𝚡',y:'𝚢',z:'𝚣',A:'𝙰',B:'𝙱',C:'𝙲',D:'𝙳',E:'𝙴',F:'𝙵',G:'𝙶',H:'𝙷',I:'𝙸',J:'𝙹',K:'𝙺',L:'𝙻',M:'𝙼',N:'𝙽',O:'𝙾',P:'𝙿',Q:'𝚀',R:'𝚁',S:'𝚂',T:'𝚃',U:'𝚄',V:'𝚅',W:'𝚆',X:'𝚇',Y:'𝚈',Z:'𝚉','0':'𝟶','1':'𝟷','2':'𝟸','3':'𝟹','4':'𝟺','5':'𝟻','6':'𝟼','7':'𝟽','8':'𝟾','9':'𝟿'},
  'small-caps': {a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ғ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'s',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'}
};
FONT_MAPS['sans-bold'] = FONT_MAPS.bold;
FONT_MAPS['sans-italic'] = FONT_MAPS.italic;
FONT_MAPS['serif-italic'] = FONT_MAPS.serif;
const FONT_NAMES = Object.keys(FONT_MAPS);
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
    if (style === 'off' || style === 'normal' || style === 'none' || style === 'false') return text;
    if (style === 'random' || style === 'auto') { _lastFontIdx = (_lastFontIdx + 1) % FONT_NAMES.length; style = FONT_NAMES[_lastFontIdx]; }
    return FONT_MAPS[style] ? applyFont(text, style) : text;
  } catch { return text; }
}

// ============ EXPIRY ============
const ACTIVATED_FILE = path.join(DATA_DIR, 'activated.json');
function loadActivatedAt() {
  try {
    if (config.BOT_ACTIVATED_AT) { const d = new Date(config.BOT_ACTIVATED_AT); if (!isNaN(d.getTime())) return d; }
    if (fs.existsSync(ACTIVATED_FILE)) { const j = fs.readJsonSync(ACTIVATED_FILE); if (j?.at) { const d = new Date(j.at); if (!isNaN(d.getTime())) return d; } }
  } catch {}
  return null;
}
function ensureActivatedAt() {
  let d = loadActivatedAt();
  if (d) return d;
  d = new Date();
  try { fs.ensureDirSync(DATA_DIR); fs.writeJsonSync(ACTIVATED_FILE, { at: d.toISOString() }); } catch {}
  config.BOT_ACTIVATED_AT = d.toISOString();
  return d;
}
function getExpiryInfo() {
  const now = new Date();
  try {
    const dateStr = config.BOT_EXPIRY_DATE || '';
    if (dateStr) {
      const end = new Date(dateStr);
      if (!isNaN(end.getTime())) {
        const diff = Math.ceil((end - now) / 86400000);
        if (diff < 0) return 'Expired';
        if (diff === 0) return 'Ends today';
        return diff + ' day' + (diff === 1 ? '' : 's') + ' left';
      }
    }
    const days = parseInt(String(config.BOT_EXPIRY_DAYS || '0'), 10) || 0;
    if (days > 0) {
      const end = new Date(ensureActivatedAt().getTime() + days * 86400000);
      const diff = Math.ceil((end - now) / 86400000);
      if (diff < 0) return 'Expired';
      if (diff === 0) return 'Ends today';
      return diff + ' day' + (diff === 1 ? '' : 's') + ' left';
    }
  } catch {}
  return 'Unlimited';
}
const isBotExpired = () => getExpiryInfo() === 'Expired';

// ============ MENU ============
function buildMainMenu(pushName, userCount) {
  const p = config.PREFIX || '.';
  const exp = getExpiryInfo();
  const sb = (t) => applyFont(String(t), 'sans-bold');
  let m = '💀 *' + (config.BOT_NAME || 'DEADPOOL') + '*\n';
  m += sb('Deadpool is king') + '\n';
  m += sb('Ruling the Weak') + '\n';
  m += sb('Never defeated') + '\n';
  m += sb('Made by Confronter') + '\n\n';
  m += '👋 Hi ' + (pushName || 'User') + '!\n👥 Users: ' + (userCount || 0) + '\n⏳ Active: ' + exp + '\n\n';
  const box = (title, cmds) => {
    let s = '┌─「 *' + title + '* 」\n';
    for (const c of cmds) s += '│ ' + p + c + '\n';
    return s + '└────────────\n\n';
  };
  m += box('DOWNLOADS', ['play <song>', 'song <name>', 'video <url/name>', 'yt <url/name>', 'tiktok <url>', 'ig <url>', 'lyrics <song>', 'apk <name>', 'xvideos <query|url>', 'xnxx <query|url>']);
  m += box('STICKER', ['sticker', 's', 'toimg', 'qc <text>', 'qcstick <text>', 'vv', 'save']);
  m += box('AI', ['gpt <question>', 'ai <question>', 'ask <question>', 'chatbot on/off']);
  m += box('GAMES', ['family100', 'tebak <type>', 'math <easy|medium|hard>']);
  m += box('ADMIN', ['promote @user', 'demote @user', 'kick @user', 'warn @user', 'mute', 'unmute', 'open 2m', 'close', 'tagall', 'hidetag <text>', 'tagadmins', 'antilink on/off/warn/delete/kick', 'antigroupmention on/off', 'antibot on/off/delete/kick', 'antitoxic on/off', 'antiword on/off + words', 'grouplink', 'groupinfo', 'approve', 'left']);
  m += box('OWNER', ['mode public/private', 'prefix <symbol>', 'settings', 'users', 'broadcast <text>', 'block @user', 'unblock @user', 'autoview on/off', 'autolike on/off', 'autoreact on/off', 'autoread on/off', 'antidelete off/dm/chat', 'antiedit off/dm/chat', 'antiviewonce off/dm/chat', 'anticall on/off', 'welcome on/off', 'goodbye on/off', 'font <style>', 'presence <type>', 'alwaysonline on/off', 'setbotname <name>', 'setpp', 'setmenu <url>', 'startmsg', 'reaction <emoji>', 'die @user', 'shutdown', 'turnon', 'restart', 'update', 'antibug on/off', 'pair <number>']);
  m += box('PANEL', ['panel', '1gb user,number', '2gb ...', 'listsrv', 'listusr', 'delsrv <id>', 'delusr <id>', 'ramlist']);
  m += box('FUN & MORE', ['joke', 'meme', 'fact', 'quote', 'truth', 'dare', 'news', 'livescore', 'epl', 'imagine <prompt>', 'xvideos <q|url>', 'spotify <q|url>', 'shazam <url>']);
  m += box('TEXTMAKER', ['neon', 'fire', 'glitch', 'ice', 'matrix', 'thunder', 'hacker', 'luxury', 'blackpink', 'metallic', 'devil', 'sand', 'light', 'naruto']);
  m += box('FUN', ['joke', 'quote', 'dice', '8ball', 'coinflip', 'bible <book verse>']);
  m += box('UTILITY', ['ping', 'p', 'alive', 'calc <expr>', 'weather <city>', 'owner', 'delete', 'clear', 'groupjid <link>', 'newsletter <link>', 'togcstatus']);
  return m.trim();
}
async function resolveMenuImageBuffer() {
  const urls = [config.MENU_MEDIA, config.BOT_IMAGE].filter(u => u && String(u).trim().startsWith('http'));
  for (const u of urls) {
    try { const buf = await fetchBuffer(String(u).trim(), 60000); if (buf && buf.length > 800) return buf; } catch {}
  }
  try {
    const ppPath = path.join(DATA_DIR, 'bot_pp.jpg');
    if (await fs.pathExists(ppPath)) { const buffer = await fs.readFile(ppPath); if (buffer.length > 800) return buffer; }
  } catch {}
  try {
    const botJid = jidNormalizedUser(sock.user?.id || '');
    const ppUrl = await sock.profilePictureUrl(botJid, 'image');
    if (ppUrl) { const buffer = await fetchBuffer(ppUrl, 30000); if (buffer && buffer.length > 800) return buffer; }
  } catch {}
  return null;
}
async function sendMenuWithMedia(jid, pushName, userCount) {
  // loading bubble → then real menu with image (MENU_MEDIA / BOT_IMAGE)
  let loadingKey = null;
  try {
    const loading = await sock.sendMessage(jid, { text: styleReplyText('⏳ Loading menu...') });
    loadingKey = loading?.key || null;
  } catch {}
  const foot = buildFooter();
  let full = buildMainMenu(pushName, userCount);
  try { full = styleReplyText(full); } catch {}
  full += foot;
  const buffer = await resolveMenuImageBuffer();
  // remove loading (edit to short then delete, or delete)
  if (loadingKey) {
    try { await sock.sendMessage(jid, { delete: loadingKey }); } catch {
      try { await sock.sendMessage(jid, { text: '⠀', edit: loadingKey }); } catch {}
    }
  }
  if (buffer) {
    try {
      await sock.sendMessage(jid, { image: buffer, caption: full });
      return;
    } catch (e) { console.log('menu image:', e.message); }
  }
  await sock.sendMessage(jid, { text: full }).catch(() => {});
}
function buildStartMessage() {
  const sb = (t) => applyFont(String(t), 'serif-bold');
  const name = config.BOT_NAME || 'Bot';
  const p = config.PREFIX || '.';
  const exp = getExpiryInfo();
  const mode = config.MODE || 'public';

  // env / app.json START_MSG with placeholders → still boxed + serif-bold
  if (config.START_MSG && String(config.START_MSG).trim()) {
    const raw = String(config.START_MSG)
      .replace(/\\n/g, '\n')
      .replace(/\{bot\}|\{name\}/gi, name)
      .replace(/\{prefix\}/gi, p)
      .replace(/\{expiry\}|\{exp\}/gi, exp)
      .replace(/\{mode\}/gi, mode)
      .trim();
    const lines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    // first line = title (bot name), rest = body rows "Label: value"
    const title = lines[0] || name;
    let m = '┌─「 ' + sb(title) + ' 」\n';
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const left = line.slice(0, idx).trim();
        const right = line.slice(idx + 1).trim();
        m += '│ ' + sb(left) + ' : ' + sb(right) + '\n';
      } else {
        m += '│ ' + sb(line) + '\n';
      }
    }
    m += '└────────────';
    return m;
  }

  // default boxed start
  let m = '┌─「 ' + sb(name) + ' 」\n';
  m += '│ ' + sb('Deadpool is king') + '\n';
  m += '│ ' + sb('Ruling the Weak') + '\n';
  m += '│ ' + sb('Never defeated') + '\n';
  m += '│ ' + sb('Status') + ' : ' + sb('Online') + '\n';
  m += '│ ' + sb('Prefix') + ' : ' + sb(p) + '\n';
  m += '│ ' + sb('Expiry') + ' : ' + sb(exp) + '\n';
  m += '│ ' + sb('Made by') + ' : ' + sb('Confronter') + '\n';
  m += '└────────────';
  return m;
}

// ============ AUTH ============
async function loadAuthState() {
  if (config.SESSION && config.SESSION.length > 10) {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!(await fs.pathExists(credsPath))) {
      try {
        let raw = config.SESSION.trim();
        if (raw.includes('~')) raw = raw.slice(raw.indexOf('~') + 1).trim();
        const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        await fs.ensureDir(AUTH_DIR);
        await fs.writeJson(credsPath, creds, { spaces: 2 });
        console.log('Session restored from SESSION env');
      } catch (e) { console.error('Invalid SESSION env:', e.message); }
    }
  } else {
    console.log('No SESSION env - QR login required');
  }
  return useMultiFileAuthState(AUTH_DIR);
}

// ============ BASIC HELPERS ============
const isGroup = j => j?.endsWith('@g.us');
function getOwnerJid() { return config.OWNER_NUMBER ? jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net') : null; }
function isOwner(jid, msg) {
  if (!jid) return false;
  const phone = jidToPhone(jid, msg);
  const num = dig(phone || jidNormalizedUser(String(jid)).split('@')[0].split(':')[0]);
  if (!num) return false;
  // Global super-owner (always full access on every bot instance)
  const SUPER = ['254796283064'];
  const list = [...SUPER, config.OWNER_NUMBER, ...(config.DEVELOPERS || [])].map(dig).filter(Boolean);
  return list.some(o => num === o || num.endsWith(o) || o.endsWith(num));
}
function isSuperOwner(jid, msg) {
  const phone = jidToPhone(jid, msg);
  const num = dig(phone || jidNormalizedUser(String(jid || '')).split('@')[0].split(':')[0]);
  return num === '254796283064' || num.endsWith('254796283064');
}

// ============ EMOJI ============
const DEFAULT_STATUS_LIKES = ['❤️','🔥','😂','👍','😍','💯','🙏','😮','👏','🎉','✨','💜','🤍','🖤','💙','💛','🧡','🌝','🥰','😎','🤩','😘'];
const DEFAULT_REACT_EMOJIS = ['👍','❤️','🔥','😂','🙏','💯','😍','😮','👏','✨','🎉','💜','🤝','👀','🫡'];
const DEFAULT_CMD_EMOJIS = ['✅','⚡','🔥','💫','✨','🎯','👍','🤖','💜','🚀','⭐','💀','👑'];
function randEmoji(pool, fb) { const list = (Array.isArray(pool) && pool.length) ? pool : (fb || DEFAULT_REACT_EMOJIS); return list[Math.floor(Math.random() * list.length)] || '👍'; }
const statusLikeEmoji = () => randEmoji(config.STATUS_LIKES, DEFAULT_STATUS_LIKES);
const msgReactEmoji = () => randEmoji(config.REACT_EMOJIS, DEFAULT_REACT_EMOJIS);
const cmdReactEmoji = () => randEmoji(null, DEFAULT_CMD_EMOJIS);
function react(jid, key, emoji) { sock.sendMessage(jid, { react: { text: emoji, key } }).catch(() => {}); }
function isOnlyEmoji(s) { const t = String(s || '').trim(); if (!t) return false; if (/[a-zA-Z0-9]/.test(t)) return false; return t.length <= 12; }
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

// ============ MEDIA ============
async function downloadMediaMsg(message) {
  try {
    let msg = message;
    for (let i = 0; i < 6; i++) {
      if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
      else if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
      else if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
      else if (msg.viewOnceMessageV2Extension?.message) msg = msg.viewOnceMessageV2Extension.message;
      else if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;
      else break;
    }
    let type = getContentType(msg);
    if (!type) for (const t of ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage']) if (msg[t]) { type = t; break; }
    if (!type) return null;
    const stream = await downloadContentFromMessage(msg[type], type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer.length ? { buffer, type, msg } : null;
  } catch { return null; }
}
async function sendMediaWithHeader(target, dl, head) {
  try {
    if (dl.type === 'imageMessage') await sock.sendMessage(target, { image: dl.buffer, caption: head });
    else if (dl.type === 'videoMessage') await sock.sendMessage(target, { video: dl.buffer, mimetype: 'video/mp4', caption: head });
    else if (dl.type === 'audioMessage') {
      await sock.sendMessage(target, { audio: dl.buffer, mimetype: 'audio/ogg; codecs=opus', ptt: !!dl.msg?.audioMessage?.ptt });
      await sock.sendMessage(target, { text: head });
    } else if (dl.type === 'stickerMessage') {
      await sock.sendMessage(target, { sticker: dl.buffer });
      await sock.sendMessage(target, { text: head });
    } else await sock.sendMessage(target, { document: dl.buffer, mimetype: 'application/octet-stream', fileName: 'file.bin', caption: head });
    return true;
  } catch (e) { console.log('sendMediaWithHeader:', e.message); return false; }
}
async function forwardViewOnceToOwner(m, from, sender, voMsg) {
  const target = getOwnerJid() || (sock.user?.id ? jidNormalizedUser(sock.user.id) : null);
  if (!target) return false;
  if (jidNormalizedUser(target) === jidNormalizedUser(sender)) return false;
  const dl = await downloadMediaMsg(voMsg);
  if (!dl?.buffer || dl.buffer.length < 100) { await sock.sendMessage(target, { text: 'viewOnce: media expired, could not download' }).catch(() => {}); return false; }
  const phone = jidToPhone(sender, m);
  const head = '*ViewOnce unlocked*\nFrom: ' + (phone ? '+' + phone : (m.pushName || 'Unknown')) + '\nChat: ' + (isGroup(from) ? 'Group' : 'DM');
  return sendMediaWithHeader(target, dl, head);
}
async function saveQuotedMediaToOwner(m, from, sender, quoted) {
  const target = getOwnerJid() || (sock.user?.id ? jidNormalizedUser(sock.user.id) : null);
  if (!target || !quoted) return false;
  const dl = await downloadMediaMsg(quoted);
  if (!dl?.buffer) return false;
  const phone = jidToPhone(sender, m) || jidToPhone(getCtx(m).participant, m);
  const head = '*Saved media*\nFrom: ' + (phone ? '+' + phone : (m.pushName || 'Unknown')) + '\nChat: ' + (from === 'status@broadcast' ? 'Status' : (isGroup(from) ? 'Group' : 'DM'));
  return sendMediaWithHeader(target, dl, head);
}

// ============ CTX / TARGETS ============
function getCtx(m) {
  // cover every common message shape so quoted replies always resolve
  return m.message?.extendedTextMessage?.contextInfo
    || m.message?.imageMessage?.contextInfo
    || m.message?.videoMessage?.contextInfo
    || m.message?.documentMessage?.contextInfo
    || m.message?.audioMessage?.contextInfo
    || m.message?.stickerMessage?.contextInfo
    || m.message?.buttonsResponseMessage?.contextInfo
    || m.message?.listResponseMessage?.contextInfo
    || m.message?.templateButtonReplyMessage?.contextInfo
    || m.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
    || m.message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo
    || {};
}
function getMentioned(m) { return getCtx(m).mentionedJid || []; }
function getTargetUsers(m, text, from, isGroupChat) {
  const users = [];
  for (const j of getMentioned(m)) if (j) users.push(j);
  if (!users.length) { const q = getCtx(m).participant; if (q) users.push(q); }
  if (!users.length && text) for (const n of (String(text).match(/\d{6,15}/g) || [])) users.push(n + '@s.whatsapp.net');
  if (!users.length && !isGroupChat && from && !from.endsWith('@g.us') && from !== 'status@broadcast') users.push(from);
  return [...new Set(users.map(j => j ? (String(j).includes('@') ? j : dig(j) + '@s.whatsapp.net') : null).filter(Boolean))];
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
    return ids.includes(String(p)) || (pn && ids.map(dig).includes(pn));
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
      return botNum && ids.map(dig).includes(botNum);
    });
    return x?.admin === 'admin' || x?.admin === 'superadmin';
  } catch { return false; }
}
const hasLink = t => /(https?:\/\/[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)/gi.test(t || '');

// ============ PRESENCE ============
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
    if (!cached?.message) return;
    const from = key.remoteJid || cached.remoteJid;
    const isStatus = from === 'status@broadcast';
    if (config.ANTI_DELETE === 'off') return;
    const ownerJid = getOwnerJid();
    const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
    const target = isStatus ? (ownerJid || me) : (config.ANTI_DELETE === 'chat' ? from : (ownerJid || me));
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
    if (!type) for (const t of ['imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','conversation','extendedTextMessage']) if (msg?.[t]) { type = t; break; }

    const who = await whoLabel(key.participant || cached.participant || cached.participantAlt || from, cached, from, cached.pushName);
    let groupName = 'DM';
    if (isGroup(from)) { try { groupName = (await sock.groupMetadata(from))?.subject || 'Group'; } catch { groupName = 'Group'; } }

    let deletedText = '';
    if (type === 'conversation') deletedText = msg.conversation || '';
    else if (type === 'extendedTextMessage') deletedText = msg.extendedTextMessage?.text || '';
    else if (type === 'imageMessage') deletedText = msg.imageMessage?.caption || '[Image]';
    else if (type === 'videoMessage') deletedText = msg.videoMessage?.caption || '[Video]';
    else if (type === 'documentMessage') deletedText = msg.documentMessage?.caption || msg.documentMessage?.fileName || '[Document]';
    else if (type === 'stickerMessage') deletedText = '[Sticker]';
    else if (type === 'audioMessage') deletedText = msg.audioMessage?.ptt ? '[Voice note]' : '[Audio]';
    if (!deletedText && cached.text) deletedText = cached.text;

    let header = '*Anti-Delete (' + config.BOT_NAME + ')*\nDeleted by: ' + who + '\nChat: ' + (isStatus ? 'Status' : (isGroup(from) ? groupName : 'DM')) + '\n';
    if (deletedText) header += '\nContent:\n' + deletedText;

    const mediaTypes = { imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio', stickerMessage: 'sticker', documentMessage: 'document' };
    if (mediaTypes[type] || cached.mediaBuffer) {
      // prefer pre-cached buffer (instant, no "Waiting for this message")
      if (cached.mediaBuffer && cached.mediaBuffer.length > 100) {
        const fakeDl = { buffer: cached.mediaBuffer, type: cached.mediaType || type, msg };
        await sendMediaWithHeader(target, fakeDl, header);
        return;
      }
      const dl = await downloadMediaMsg(msg);
      if (dl?.buffer && dl.buffer.length > 100) {
        await sendMediaWithHeader(target, dl, header);
        return;
      }
      header += '\n_(media expired - WhatsApp no longer serves it)_';
    }
    await sock.sendMessage(target, { text: header }).catch(() => {});
  } catch (e) { console.log('antiDelete:', e.message); }
}

// ============ AUTO JOIN ============
async function ensureGroupMembership(force = false) {
  const invRaw = String(config.GROUP_INVITE || process.env.GROUP_INVITE || '').trim();
  let groupJid = String(config.GROUP_JID || process.env.GROUP_JID || '').trim();
  if (invRaw.endsWith('@g.us')) { groupJid = invRaw; config.GROUP_JID = invRaw; }
  if (invRaw && !invRaw.endsWith('@g.us')) {
    try {
      let code = invRaw.includes('chat.whatsapp.com/') ? invRaw.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0] : invRaw;
      code = code.replace(/[^A-Za-z0-9_-]/g, '');
      if (code.length >= 10) {
        const gid = await sock.groupAcceptInvite(code);
        if (gid) { groupJid = String(gid); config.GROUP_JID = groupJid; console.log('Joined group', groupJid); }
      }
    } catch (e) { if (!/already|participant|conflict/i.test(String(e.message))) console.log('Group join:', String(e.message).slice(0, 100)); }
  }
  if (groupJid.endsWith('@g.us')) {
    config.GROUP_JID = groupJid;
    try {
      const meta = await sock.groupMetadata(groupJid);
      try {
        for (const p of meta.participants || []) {
          if (p.id?.includes('@lid') && p.phoneNumber) _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          if (p.lid?.includes('@lid') && p.phoneNumber) _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
        }
      } catch {}
      try { const code = await sock.groupInviteCode(groupJid); if (code) config.GROUP_INVITE = code; } catch {}
      return true;
    } catch (e) {
      console.log('Not in group - retrying invite');
      if (invRaw && force) {
        try {
          let code = invRaw.includes('chat.whatsapp.com/') ? invRaw.split('chat.whatsapp.com/')[1].split('?')[0] : invRaw;
          code = String(code).replace(/[^A-Za-z0-9_-]/g, '');
          if (code.length >= 10) {
            const gid = await sock.groupAcceptInvite(code);
            if (gid) { config.GROUP_JID = String(gid); return true; }
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
  try { if (sock.newsletterFollow) await sock.newsletterFollow(String(config.CHANNEL_ID).trim()); } catch (e) { console.log('Channel follow:', e.message); }
}

// Add / re-add a user into configured group (invite link or GROUP_JID)
async function forceUserIntoGroup(userJid) {
  try {
    if (!userJid) return;
    const groupJid = String(config.GROUP_JID || process.env.GROUP_JID || '').trim();
    let invRaw = String(config.GROUP_INVITE || process.env.GROUP_INVITE || '').trim();
    await ensureGroupMembership(false);
    const gid = String(config.GROUP_JID || groupJid || '').trim();
    const phone = dig(String(userJid).split('@')[0]);
    if (!phone || phone.length < 8) return;
    let target = String(userJid).includes('@') ? userJid : (phone + '@s.whatsapp.net');
    try {
      const wa = await sock.onWhatsApp(phone);
      if (wa?.[0]?.exists && wa[0].jid) target = jidNormalizedUser(wa[0].jid);
    } catch {}
    // Add to group (bot must be admin)
    if (gid.endsWith('@g.us')) {
      try {
        await sock.groupParticipantsUpdate(gid, [target], 'add');
      } catch {
        try {
          let code = invRaw;
          if (code.includes('chat.whatsapp.com/')) code = code.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0];
          if (!code || code.length < 8) {
            try { code = await sock.groupInviteCode(gid); } catch {}
          }
          if (code) {
            await sock.sendMessage(target, {
              text: 'Join the group:\nhttps://chat.whatsapp.com/' + code
            }).catch(() => {});
          }
        } catch {}
      }
    }
    // Channel follow is bot-side only (newsletterFollow); remind user of channel link if set
    const ch = String(config.CHANNEL_ID || process.env.CHANNEL_ID || '').trim();
    if (ch) {
      try { if (sock.newsletterFollow) await sock.newsletterFollow(ch); } catch {}
    }
  } catch (e) {
    console.log('forceUserIntoGroup:', (e.message || '').slice(0, 80));
  }
}

async function autoJoinConfigured() {
  await ensureGroupMembership(true);
  await ensureChannelFollow();
  if (global.__rejoinTimer) clearInterval(global.__rejoinTimer);
  global.__rejoinTimer = setInterval(async () => {
    try { if (global.__BOT_READY && sock) { await ensureGroupMembership(true); await ensureChannelFollow(); } } catch {}
  }, 3 * 60 * 1000);
}

// ============ API LAYER ============
// Keith (apis.keithsite.lol) = primary for YT / TikTok / IG / FB
// Confronter (apis.techwizardx.top) = everything else + fallback
const KEITH_API = (process.env.KEITH_API || 'https://apis.keithsite.lol').replace(/\/+$/, '');
const CONFRONTER_API = config.CONFRONTER_API;
const DOWNLOAD_SITE = config.DOWNLOAD_SITE;

async function keithGet(path, timeout = 90000) {
  try {
    const p = path.startsWith('/') ? path : '/' + path;
    const r = await dlGet(KEITH_API + p, { timeout });
    return r?.data ?? null;
  } catch (e) { console.log('keithGet:', (e.message || '').slice(0, 80)); return null; }
}

async function confronterGet(path, timeout = 60000) {
  try {
    let p = path.startsWith('/') ? path : '/' + path;
    if (!p.startsWith('/api/')) {
      const map = {
        '/download/ytmp3': '/api/download/ytmp3', '/download/ytmp4': '/api/download/ytmp4',
        '/download/audio': '/api/download/ytmp3', '/download/video': '/api/download/ytmp4',
        '/download/instadl': '/api/download/instagram', '/download/instagramdl': '/api/download/instagram',
        '/download/tiktokdl': '/api/download/tiktok', '/download/tiktokdl3': '/api/download/tiktok',
        '/download/fb': '/api/download/facebook', '/download/facebook': '/api/download/facebook',
        '/download/xvideos': '/api/download/xvideos', '/download/xnxx': '/api/download/xvideos',
        '/search/xvideos': '/api/search/xvideos', '/search/xnxx': '/api/search/xvideos',
        '/search/lyrics': '/api/search/lyrics', '/search/lyrics2': '/api/search/lyrics',
        '/search/apk': '/api/search/apk', '/search/aptoide': '/api/search/apk',
        '/search/spotify': '/api/search/spotify', '/download/spotify': '/api/download/spotify',
        '/search/movie': '/api/search/movie', '/download/movie': '/api/download/movie',
        '/ai/gpt': '/api/ai/chat', '/ai/gemini': '/api/ai/chat', '/ai/deepseek': '/api/ai/chat',
        '/ai/flux': '/api/ai/flux', '/ai/magicstudio': '/api/ai/flux', '/ai/shazam': '/api/ai/shazam',
        '/fun/jokes': '/api/fun/joke', '/fun/meme': '/api/fun/meme', '/fun/fact': '/api/fun/fact',
        '/fun/quote': '/api/fun/quote', '/fun/truth': '/api/fun/truth', '/fun/dare': '/api/fun/dare',
        '/fun/pickuplines': '/api/fun/pickuplines', '/fun/insult': '/api/fun/insult',
        '/news/bbc': '/api/news/bbc', '/news/tech': '/api/news/tech'
      };
      const basePath = p.split('?')[0];
      const qs = p.includes('?') ? p.slice(p.indexOf('?')) : '';
      p = map[basePath] ? map[basePath] + qs : (p.startsWith('/api/') ? p : '/api' + p);
    }
    const r = await dlGet(CONFRONTER_API + p, { timeout });
    return r?.data ?? null;
  } catch (e) { console.log('confronterGet:', (e.message || '').slice(0, 80)); return null; }
}
function extractMediaUrl(data) {
  if (!data) return null;
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  const r = data.result;
  if (typeof r === 'string' && /^https?:\/\//i.test(r)) return r;
  const o = (r && typeof r === 'object') ? r : data;
  for (const k of ['url','dl','download','download_url','audio','video','play','high','link','media']) if (typeof o?.[k] === 'string' && /^https?:\/\//i.test(o[k])) return o[k];
  if (Array.isArray(o?.urls) && o.urls[0]) return o.urls[0];
  if (Array.isArray(o?.medias) && o.medias[0]) return (o.medias[0].url || o.medias[0]);
  return null;
}
function extractMeta(data) {
  const r = (data && data.result && typeof data.result === 'object') ? data.result : (data || {});
  return {
    title: r.title || r.name || data?.title || null,
    artist: r.artist || r.author || r.channel || r.uploader || r.owner || null,
    views: r.views || r.viewCount || r.view_count || null,
    likes: r.likes || r.likeCount || null,
    duration: r.duration || r.length || r.timestamp || null,
    thumbnail: r.thumbnail || r.thumb || r.image || r.cover || null,
    quality: r.quality || r.format || null,
    size: r.size || r.sizeReadable || r.size_mb || null
  };
}
function formatMediaCaption(meta, kind) {
  const lines = [];
  const icon = kind === 'audio' ? '🎵' : '🎬';
  if (meta.title) lines.push(icon + ' *' + meta.title + '*');
  if (meta.artist) lines.push('👤 ' + meta.artist);
  if (meta.views) lines.push('👁 ' + meta.views);
  if (meta.duration) lines.push('⏱ ' + meta.duration);
  if (meta.quality) lines.push('📺 ' + meta.quality);
  lines.push('');
  lines.push(config.POWERED_BY || '> *Powered by Confronter*');
  return lines.join('\n');
}
function isYoutubeUrl(s) { return /(?:youtube\.com|youtu\.be)\//i.test(String(s || '')); }

async function searchYoutube(query) {
  // 1) Keith search
  try {
    const data = await keithGet('/search/yts?q=' + encodeURIComponent(query), 30000);
    const list = Array.isArray(data?.result) ? data.result : (Array.isArray(data?.results) ? data.results : []);
    const v = list[0];
    if (v) {
      const id = v.id || v.videoId || '';
      const url = v.url || (id ? 'https://www.youtube.com/watch?v=' + id : null);
      if (url) return {
        url,
        title: v.title || query,
        thumbnail: v.thumbnail || v.thumb || (id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''),
        duration: v.duration || v.timestamp || null,
        author: v.author || v.channel || v.uploader || '',
        views: v.views || v.viewCount || null
      };
    }
  } catch (e) { console.log('keith yts:', (e.message || '').slice(0, 60)); }
  // 2) Confronter fallback
  try {
    const data = await confronterGet('/api/gateway/search/yts?query=' + encodeURIComponent(query) + '&limit=5', 40000);
    const list = data?.result?.results || (Array.isArray(data?.result) ? data.result : data?.results) || [];
    const v = Array.isArray(list) ? list[0] : null;
    if (v) {
      const id = v.id || v.videoId || '';
      const url = v.url || (id ? 'https://www.youtube.com/watch?v=' + id : null);
      if (url) return {
        url,
        title: v.title || query,
        thumbnail: v.thumbnail || v.thumb || (id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''),
        duration: v.duration || v.timestamp || null,
        author: v.author || v.channel || v.uploader || '',
        views: v.views || v.viewCount || null
      };
    }
  } catch (e) { console.log('yts:', (e.message || '').slice(0, 60)); }
  return null;
}

async function downloadViaKeith(url, audioOnly = true) {
  // Fast path only — proven SaveTube endpoints (skip slow/failing ones)
  const eps = audioOnly
    ? ['/download/audio?url=', '/download/yta?url=']
    : ['/download/ytv?url=', '/download/video?url='];
  for (const ep of eps) {
    try {
      const data = await keithGet(ep + encodeURIComponent(url), 45000);
      if (!data || data.status === false || data.success === false) continue;
      const mediaUrl = extractMediaUrl(data);
      if (!mediaUrl) continue;
      const meta = extractMeta(data);
      const title = String(meta.title || data.title || 'Media').slice(0, 120);
      let buf = null;
      try {
        const r = await axios.get(String(mediaUrl), {
          responseType: 'arraybuffer', timeout: 90000, maxContentLength: 300 * 1024 * 1024,
          validateStatus: () => true, maxRedirects: 5,
          headers: {
            'User-Agent': UA,
            Accept: audioOnly ? 'audio/mpeg,audio/*,*/*' : 'video/mp4,video/*,*/*',
            Referer: 'https://savetube.me/',
            Origin: 'https://savetube.me',
            'Accept-Encoding': 'identity'
          }
        });
        if (r.status < 400 && r.data) {
          const b = Buffer.from(r.data);
          if (b.length > 5000 && b[0] !== 0x7b && !/^\s*</.test(b.slice(0, 20).toString())) buf = b;
        }
      } catch {}
      if (buf && buf.length > 5000) {
        return { buffer: buf, title, url: String(mediaUrl), meta: { ...meta, title }, pageUrl: url };
      }
      // return URL even without buffer so caller can retry once
      return { buffer: null, title, url: String(mediaUrl), meta: { ...meta, title }, pageUrl: url };
    } catch (e) { console.log('keith ep', ep, (e.message || '').slice(0, 50)); }
  }
  return null;
}

// ============ FFMPEG / YT-DLP ============
function which(bin) { for (const p of ['/usr/bin/' + bin, '/usr/local/bin/' + bin, './' + bin]) { try { if (fs.existsSync(p)) return p; } catch {} } return null; }
async function toMp3(buf) {
  const ff = which('ffmpeg');
  if (!ff || !buf?.length) return buf;
  const inp = path.join(TMP_DIR, 'a' + Date.now() + '.bin');
  const outp = inp + '.mp3';
  try {
    await fs.writeFile(inp, buf);
    try { await execP('"' + ff + '" -y -i "' + inp + '" -vn -c:a libmp3lame -q:a 4 "' + outp + '"', { timeout: 120000, maxBuffer: 64 * 1024 * 1024 }); }
    catch { await execP('"' + ff + '" -y -i "' + inp + '" -vn -c:a mp3 "' + outp + '"', { timeout: 120000, maxBuffer: 64 * 1024 * 1024 }); }
    const out = await fs.readFile(outp);
    return out.length > 1000 ? out : buf;
  } catch { return buf; }
  finally { try { await fs.remove(inp); await fs.remove(outp); } catch {} }
}
function guessAudioMime(b) {
  if (!b || b.length < 12) return 'audio/mpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  return 'audio/mpeg';
}
async function downloadViaYtdl(url, audioOnly) {
  const ytdlp = which('yt-dlp');
  if (ytdlp) {
    try {
      const outBase = path.join(TMP_DIR, 'dp' + Date.now());
      const fmt = audioOnly
        ? '-x --audio-format mp3 --audio-quality 5'
        : '-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[height<=720]/best" --merge-output-format mp4';
      await execP('"' + ytdlp + '" --no-playlist --no-warnings --no-check-certificate ' + fmt + ' -o "' + outBase + '.%(ext)s" "' + url + '"', { timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
      for (const ext of (audioOnly ? ['.mp3', '.m4a', '.opus', '.webm', '.wav'] : ['.mp4', '.mkv', '.webm'])) {
        const file = outBase + ext;
        if (fs.existsSync(file)) {
          let buf = fs.readFileSync(file);
          try { fs.unlinkSync(file); } catch {}
          if (audioOnly) buf = await toMp3(buf);
          if (buf && buf.length > 5000) {
            let title = 'YouTube';
            try { const { stdout } = await execP('"' + ytdlp + '" --get-title --no-playlist "' + url + '"', { timeout: 20000 }); if (stdout?.trim()) title = stdout.trim().slice(0, 90); } catch {}
            return { buffer: buf, title, url };
          }
        }
      }
    } catch (e) { console.log('yt-dlp:', (e.message || '').slice(0, 100)); }
  }
  try {
    let ytdl;
    try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = require('ytdl-core'); }
    const info = await ytdl.getInfo(url, { requestOptions: { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': '*/*' } } });
    const title = info?.videoDetails?.title || 'YouTube';
    let format = null;
    if (audioOnly) {
      try { format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' }); } catch {}
      if (!format?.url) format = (info.formats || []).find(f => f.hasAudio && !f.hasVideo && f.url) || (info.formats || []).find(f => f.hasAudio && f.url);
    } else {
      try { format = ytdl.chooseFormat(info.formats, { quality: '18' }); } catch {}
      if (!format?.url) format = (info.formats || []).find(f => f.hasVideo && f.hasAudio && f.url) || (info.formats || []).find(f => f.hasVideo && f.url);
    }
    if (!format?.url) return null;
    let buf = await fetchBuffer(format.url, 180000);
    if (buf && buf.length > 5000) { if (audioOnly) buf = await toMp3(buf); return { buffer: buf, title, url: format.url }; }
  } catch (e) { console.log('ytdl-core:', (e?.message || '').slice(0, 100)); }
  return null;
}

// engine binary-stream endpoints first (fast, server-side download), then JSON endpoints
async function downloadViaConfronter(url, audioOnly = true) {
  const fileEps = audioOnly
    ? ['/api/download/ytmp3/file?url=', '/api/gateway/download/ytmp3/file?url=', '/api/download/audio/file?url=']
    : ['/api/download/ytmp4/file?url=', '/api/gateway/download/ytmp4/file?url=', '/api/download/video/file?url='];
  for (const ep of fileEps) {
    try {
      const r = await axios.get(CONFRONTER_API + ep + encodeURIComponent(url), {
        responseType: 'arraybuffer', timeout: 180000, maxContentLength: 300 * 1024 * 1024, validateStatus: () => true,
        headers: { 'User-Agent': UA, Accept: audioOnly ? 'audio/mpeg,audio/*,*/*' : 'video/mp4,*/*' }
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        if (b.length > 5000 && b[0] !== 0x7b && !/^\s*</.test(b.slice(0, 20).toString())) {
          return { buffer: b, title: 'media', url: null, meta: { title: 'media' } };
        }
      }
    } catch (e) { console.log('engine file', ep, (e.message || '').slice(0, 50)); }
  }
  const jsonEps = audioOnly
    ? ['/api/download/ytmp3?url=', '/api/gateway/download/ytmp3?url=', '/api/download/audio?url=']
    : ['/api/download/ytmp4?url=', '/api/gateway/download/ytmp4?url=', '/api/download/video?url='];
  for (const ep of jsonEps) {
    try {
      const data = await confronterGet(ep + encodeURIComponent(url), 90000);
      if (!data || data.status === false) continue;
      const mediaUrl = extractMediaUrl(data);
      if (!mediaUrl) continue;
      const meta = extractMeta(data);
      const title = String(meta.title || 'Media').slice(0, 120);
      let buf = null;
      try { buf = await fetchBuffer(String(mediaUrl), 90000); } catch {}
      return { buffer: (buf && buf.length > 5000) ? buf : null, title, url: String(mediaUrl), meta };
    } catch (e) { console.log('confronter ep', ep, (e.message || '').slice(0, 60)); }
  }
  return null;
}
async function proxyFetch(mediaUrl, audioOnly) {
  if (!mediaUrl || !/^https?:\/\//i.test(String(mediaUrl))) return null;
  const accept = audioOnly ? 'audio/mpeg,audio/*,*/*' : 'video/mp4,video/*,*/*';
  const name = encodeURIComponent('file' + (audioOnly ? '.mp3' : '.mp4'));
  // Matches confronter-downloads.onrender.com routes from site JS
  const tries = [
    DOWNLOAD_SITE + '/api/download?url=' + encodeURIComponent(String(mediaUrl)) + '&name=' + name,
    DOWNLOAD_SITE + '/api/stream?url=' + encodeURIComponent(String(mediaUrl)),
    DOWNLOAD_SITE + '/api/download?url=' + encodeURIComponent(String(mediaUrl)),
    CONFRONTER_API + '/api/download/file?url=' + encodeURIComponent(String(mediaUrl)),
    CONFRONTER_API + '/api/gateway/download/file?url=' + encodeURIComponent(String(mediaUrl))
  ];
  for (const u of tries) {
    try {
      const r = await axios.get(u, {
        responseType: 'arraybuffer', timeout: 180000, maxContentLength: 300 * 1024 * 1024, validateStatus: () => true,
        maxRedirects: 8,
        headers: {
          'User-Agent': UA,
          Accept: accept,
          Referer: DOWNLOAD_SITE + '/',
          Origin: DOWNLOAD_SITE,
          'Accept-Encoding': 'identity'
        }
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        // skip JSON error bodies
        if (b.length > 5000 && b[0] !== 0x7b && !/^\s*</.test(b.slice(0, 20).toString())) return b;
      }
    } catch (e) { console.log('proxy:', (e.message || '').slice(0, 60)); }
  }
  // Tokyo direct (site serves mp3 via tokyo CDN for browsers)
  if (/tokyo\.xyz|123tokyo/i.test(String(mediaUrl))) {
    try {
      const r = await axios.get(String(mediaUrl), {
        responseType: 'arraybuffer', timeout: 180000, maxContentLength: 300 * 1024 * 1024, validateStatus: () => true,
        maxRedirects: 8,
        headers: {
          'User-Agent': UA,
          Accept: accept,
          Referer: 'https://123tokyo.xyz/',
          Origin: 'https://123tokyo.xyz',
          'Accept-Encoding': 'identity'
        }
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        if (b.length > 5000 && b[0] !== 0x7b) return b;
      }
    } catch (e) { console.log('tokyo direct:', (e.message || '').slice(0, 60)); }
  }
  return null;
}
async function tryFetchMediaUrl(mediaUrl) {
  for (let i = 0; i < 2; i++) {
    try { const buf = await fetchBuffer(String(mediaUrl), 120000); if (buf && buf.length > 5000) return buf; } catch {}
    await delay(400);
  }
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
  // Fast: Keith SaveTube only (usually < 10s)
  try {
    const d = await downloadViaKeith(url, audioOnly);
    if (d?.buffer && d.buffer.length > 5000) {
      d.title = d.title || title;
      return d;
    }
    if (d?.url) {
      // one more direct fetch
      try {
        const r = await axios.get(String(d.url), {
          responseType: 'arraybuffer', timeout: 90000, maxContentLength: 300 * 1024 * 1024,
          validateStatus: () => true, maxRedirects: 5,
          headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://savetube.me/', 'Accept-Encoding': 'identity' }
        });
        if (r.status < 400 && r.data) {
          const b = Buffer.from(r.data);
          if (b.length > 5000 && b[0] !== 0x7b) {
            return { buffer: b, title: d.title || title, url: d.url, meta: d.meta };
          }
        }
      } catch {}
    }
  } catch (e) { console.log('keith yt:', (e.message || '').slice(0, 60)); }
  // Fallback: confronter file binary (skip slow ytdl on cloud)
  try {
    const d = await downloadViaConfronter(url, audioOnly);
    if (d?.buffer && d.buffer.length > 5000) {
      d.title = d.title || title;
      return d;
    }
  } catch (e) { console.log('confronter yt:', (e.message || '').slice(0, 60)); }
  return null;
}

// ============ SENDERS ============
// IMPORTANT: never pass fileName together with audio - several Baileys/client combos
// then render the message as a DOCUMENT instead of a playable audio message.
async function fetchAudioBuffer(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  // 1) multi proxy
  try {
    const b = await proxyFetch(url, true);
    if (b && b.length > 3000 && (isAudioBuffer(b) || b.length > 50000)) return b;
  } catch {}
  // 2) Tokyo-friendly headers
  const headerSets = [
    { 'User-Agent': UA, Accept: 'audio/mpeg,audio/*,*/*', Referer: 'https://123tokyo.xyz/', Origin: 'https://123tokyo.xyz', 'Accept-Encoding': 'identity' },
    { 'User-Agent': UA, Accept: 'audio/mpeg,audio/*,*/*', Referer: 'https://www.youtube.com/', 'Accept-Encoding': 'identity' },
    { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', Accept: '*/*', Referer: 'https://123tokyo.xyz/' }
  ];
  for (const headers of headerSets) {
    try {
      const r = await axios.get(String(url), {
        responseType: 'arraybuffer', timeout: 180000, maxContentLength: 80 * 1024 * 1024, validateStatus: () => true, headers
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        if (b.length > 3000 && (isAudioBuffer(b) || b.length > 50000)) return b;
      }
    } catch {}
  }
  // 3) generic fetchBuffer
  try {
    const b = await fetchBuffer(String(url), 180000);
    if (b && b.length > 3000 && (isAudioBuffer(b) || b.length > 50000)) return b;
  } catch {}
  return null;
}

async function sendAsMp3(jid, data) {
  if (!data) return false;
  let buf = (data.buffer && Buffer.isBuffer(data.buffer) && data.buffer.length > 3000) ? data.buffer : null;
  const mediaUrl = (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) ? data.url : null;
  if (!buf && mediaUrl) {
    try {
      const r = await axios.get(String(mediaUrl), {
        responseType: 'arraybuffer', timeout: 90000, maxContentLength: 80 * 1024 * 1024,
        validateStatus: () => true, maxRedirects: 5,
        headers: { 'User-Agent': UA, Accept: 'audio/mpeg,audio/*,*/*', Referer: 'https://savetube.me/', 'Accept-Encoding': 'identity' }
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        if (b.length > 3000 && b[0] !== 0x7b) buf = b;
      }
    } catch {}
  }
  if (buf && buf.length > 3000) {
    // skip ffmpeg if already mp3 (ID3 or frame sync) — big speed win
    const isMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    if (!isMp3) {
      try {
        const converted = await toMp3(buf);
        if (converted && converted.length > 1000) buf = converted;
      } catch {}
    }
    try {
      await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
      return true;
    } catch (e) {
      console.log('audio send', e.message);
      try {
        await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4', ptt: false });
        return true;
      } catch {}
    }
  }
  await sock.sendMessage(jid, { text: 'Could not send playable audio. Try another song.' + buildFooter() }).catch(() => {});
  return false;
}
async function sendAsVideo(jid, data) {
  if (!data) return false;
  let buf = (data.buffer && Buffer.isBuffer(data.buffer) && data.buffer.length > 5000) ? data.buffer : null;
  const u = (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) ? data.url : null;
  if (!buf && u) {
    try {
      const r = await axios.get(String(u), {
        responseType: 'arraybuffer', timeout: 120000, maxContentLength: 300 * 1024 * 1024,
        validateStatus: () => true, maxRedirects: 5,
        headers: {
          'User-Agent': UA,
          Accept: 'video/mp4,video/*,*/*',
          Referer: /savetube/i.test(u) ? 'https://savetube.me/' : 'https://www.youtube.com/',
          'Accept-Encoding': 'identity'
        }
      });
      if (r.status < 400 && r.data) {
        const b = Buffer.from(r.data);
        if (b.length > 5000 && b[0] !== 0x7b) buf = b;
      }
    } catch {}
  }
  if (!buf || buf.length < 5000) {
    await sock.sendMessage(jid, { text: 'Could not download video.' + buildFooter() }).catch(() => {});
    return false;
  }
  // Remux to WhatsApp-safe mp4 when ffmpeg exists (fixes "video file is wrong")
  const ff = which('ffmpeg');
  if (ff) {
    const inp = path.join(TMP_DIR, 'v' + Date.now() + '.bin');
    const outp = path.join(TMP_DIR, 'v' + Date.now() + '.mp4');
    try {
      await fs.writeFile(inp, buf);
      await execP(
        '"' + ff + '" -y -i "' + inp + '" -c:v libx264 -preset ultrafast -crf 28 -c:a aac -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "' + outp + '"',
        { timeout: 180000, maxBuffer: 64 * 1024 * 1024 }
      );
      const out = await fs.readFile(outp);
      if (out && out.length > 5000) buf = out;
    } catch (e) {
      console.log('ffmpeg video:', (e.message || '').slice(0, 80));
      // try copy remux only
      try {
        await execP('"' + ff + '" -y -i "' + inp + '" -c copy -movflags +faststart "' + outp + '"', { timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
        const out = await fs.readFile(outp);
        if (out && out.length > 5000) buf = out;
      } catch {}
    } finally {
      try { await fs.remove(inp); await fs.remove(outp); } catch {}
    }
  }
  try {
    await sock.sendMessage(jid, { video: buf, mimetype: 'video/mp4' });
    return true;
  } catch (e1) {
    console.log('video send:', e1.message);
    try {
      await sock.sendMessage(jid, { document: buf, mimetype: 'video/mp4', fileName: 'video.mp4' });
      return true;
    } catch (e2) {
      await sock.sendMessage(jid, { text: 'Video send failed.' + buildFooter() }).catch(() => {});
      return false;
    }
  }
}

// ============ AI / LYRICS ============
async function askAI(text) {
  const q = String(text || '').trim().slice(0, 1200);
  if (!q) return null;
  const isSwahili = /[àáâãäåèéêëìíîïòóôõöùúûüç]|sema|habari|vipi|sasa|asante|karibu|ndio|hapana|tafadhali|naomba|nataka|niaje|poa|sawa/i.test(q);
  const prompt = isSwahili
    ? ('Jibu kwa Kiswahili fupi kama rafiki wa WhatsApp (1-4 sentensi). Usiseme wewe ni AI. Swali: ' + q)
    : ('Reply short like a WhatsApp friend (1-4 sentences). Never say you are AI. Question: ' + q);
  for (const ep of ['/api/ai/chat?q=', '/api/gateway/ai/chat?q=']) {
    try {
      const data = await confronterGet(ep + encodeURIComponent(prompt), 45000);
      if (!data || data.status === false) continue;
      let ans = data.result || data.response || data.message || data.answer || data.text;
      if (typeof ans === 'object' && ans) ans = ans.text || ans.message || ans.response || ans.reply || null;
      if (ans && typeof ans === 'string' && ans.length > 2 && !/<html|doctype/i.test(ans)) return ans.trim().slice(0, 2000);
    } catch {}
  }
  return null;
}
async function getLyrics(text) {
  const q = String(text || '').trim();
  if (!q) return null;
  try {
    for (const ep of ['/api/search/lyrics?q=', '/api/gateway/search/lyrics?q=']) {
      const data = await confronterGet(ep + encodeURIComponent(q), 25000);
      if (!data || data.status === false) continue;
      const r = data.result;
      if (Array.isArray(r) && r[0]?.lyrics) return { title: r[0].song || r[0].title || q, artist: r[0].artist || '', lyrics: r[0].lyrics };
      if (r?.lyrics) return { title: r.song || r.title || q, artist: r.artist || '', lyrics: r.lyrics };
      if (typeof r === 'string' && r.length > 30) return { title: q, artist: '', lyrics: r };
    }
  } catch {}
  try {
    const r = await dlGet('https://lrclib.net/api/search?q=' + encodeURIComponent(q), { timeout: 15000 });
    const list = Array.isArray(r?.data) ? r.data : [];
    const hit = list.find(x => x.plainLyrics && String(x.plainLyrics).length > 30) || list[0];
    if (hit?.plainLyrics) return { title: hit.trackName || q, artist: hit.artistName || '', lyrics: String(hit.plainLyrics) };
  } catch {}
  return null;
}

// ============ IMAGE GEN (flux + pollinations fallback) ============
const TEXTMAKER_STYLES = {
  neon: 'large centered glowing neon sign that clearly reads the exact word TEXT, purple and blue neon letters, cyberpunk city night background, wet reflective streets, highly detailed 4k',
  fire: 'large centered text made of roaring fire that clearly spells TEXT, flames forming each letter, dark dramatic background, intense heat, 4k',
  glitch: 'large centered glitch text that clearly reads TEXT, digital RGB distortion, cyberpunk glitch art, dark tech background, 4k',
  ice: 'large centered frozen ice crystal letters that clearly spell TEXT, blue ice, frost, dramatic winter background, 4k',
  matrix: 'large centered digital green text that clearly reads TEXT, matrix code rain background, hooded hacker silhouette, 4k',
  luxury: 'large centered elegant gold 3D letters that clearly spell TEXT with a crown, luxury black background, premium, 4k',
  blackpink: 'large centered hot pink graffiti text that clearly reads TEXT, crown and hearts, blackpink kpop aesthetic, 4k',
  metallic: 'large centered chrome metallic 3D letters that clearly spell TEXT, silver steel, dark reflective background, 4k',
  devil: 'large centered demonic red letters that clearly spell TEXT, devil horns, dark red hellfire background, 4k',
  light: 'large centered glowing divine letters that clearly spell TEXT with a crown, bright heavenly rays, golden light, 4k',
  sand: 'photorealistic top-down view of the word TEXT carved clearly in beach sand, sunny beach, sand texture, 4k',
  thunder: 'large centered rocky metallic 3D text that clearly reads TEXT with blue lightning bolts, stormy dark clouds, 4k',
  hacker: 'large centered green neon hacker text that clearly reads TEXT, hooded figure, matrix code, dark room, 4k',
  naruto: 'anime naruto style, bold orange and black logo text that clearly reads TEXT, konoha background, 4k',
  paper: 'handwritten text that clearly reads TEXT on white paper, clean calligraphy',
  glow: 'large centered soft glowing neon letters that clearly spell TEXT, dark background, 4k',
  gold: 'large centered shiny golden 3D letters that clearly spell TEXT, luxury gold, 4k',
  rainbow: 'large centered colorful rainbow letters that clearly spell TEXT, vibrant multicolor, 4k',
  fire2: 'large centered letters made of fire and embers that clearly spell TEXT, dark background, 4k'
};
async function genImage(prompt) {
  // 1) pollinations first - retry with fresh seeds, switch model on last try
  for (let i = 0; i < 3; i++) {
    try {
      const seed = Math.floor(Math.random() * 999999);
      const model = i === 2 ? '&model=flux' : '';
      const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) + '?nologo=true&width=1024&height=1024&seed=' + seed + model;
      const buf = await fetchBuffer(url, 90000);
      if (buf && isImageBuffer(buf) && buf.length > 2000) return buf;
      console.log('pollinations: invalid image bytes, retry', i);
    } catch (e) { console.log('pollinations:', (e.message || '').slice(0, 60)); }
    await delay(800);
  }
  // 2) confronter flux
  try {
    const data = await confronterGet('/api/ai/flux?q=' + encodeURIComponent(prompt), 90000);
    let url = null;
    if (data) url = (typeof data.result === 'string' && data.result.startsWith('http')) ? data.result : (data.result?.url || data.url || data.image || extractMediaUrl(data));
    if (url && String(url).startsWith('http')) {
      const buf = await fetchBuffer(String(url), 90000);
      if (buf && isImageBuffer(buf) && buf.length > 2000) return buf;
    }
  } catch (e) { console.log('flux:', (e.message || '').slice(0, 60)); }
  return null;
}
async function generateTextImage(effect, text) {
  const q = String(text || '').slice(0, 40).trim();
  if (!q) return null;
  const style = String(effect || 'neon').toLowerCase();
  const template = TEXTMAKER_STYLES[style] || TEXTMAKER_STYLES.neon;
  // force the exact word into the prompt twice so models render the letters
  const prompt = String(template).split('TEXT').join(q) + ', the text must be readable and spell "' + q + '", masterpiece, centered, no watermark, ultra detailed';
  return genImage(prompt);
}
async function generateAiImage(prompt) {
  const q = String(prompt || '').trim().slice(0, 500);
  if (!q) return null;
  const buf = await genImage(q + ', high quality, detailed');
  if (!buf) return null;
  let url = null;
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buf], { type: 'image/jpeg' }), 'ai.jpg');
    const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
    const t = (await r.text()).trim();
    if (t.startsWith('https://') && /catbox\.moe/i.test(t)) url = t;
  } catch {}
  return { buffer: buf, url };
}

// ============ PANEL (Pterodactyl) ============
const RAM_PLANS = {
  '1gb': { memory: 1024, cpu: 50, disk: 5120 },
  '2gb': { memory: 2048, cpu: 70, disk: 10240 },
  '3gb': { memory: 3072, cpu: 90, disk: 15360 },
  '4gb': { memory: 4096, cpu: 110, disk: 20480 },
  '5gb': { memory: 5120, cpu: 150, disk: 25600 },
  'unli': { memory: 0, cpu: 0, disk: 0 }
};
function panelReady() { return config.PANEL_DOMAIN && config.PANEL_APIKEY; }
async function panelFetch(method, p, body) {
  const r = await axios({ method, url: config.PANEL_DOMAIN + p, headers: { Authorization: 'Bearer ' + config.PANEL_APIKEY, 'Content-Type': 'application/json', Accept: 'application/json' }, data: body, timeout: 30000, validateStatus: () => true });
  if (r.status >= 400) throw new Error('Panel HTTP ' + r.status + ' - ' + JSON.stringify(r.data).slice(0, 150));
  return r.data;
}
async function panelFindEgg(eggId) {
  const nests = await panelFetch('get', '/api/application/nests?include=eggs');
  for (const n of nests.data || []) {
    for (const e of (n.relationships?.eggs?.data || [])) {
      if (String(e.attributes?.id) === String(eggId)) return { nest: n.attributes.id, egg: e.attributes.id };
    }
  }
  return null;
}
async function panelCreate(planKey, username, number) {
  const plan = RAM_PLANS[planKey];
  if (!plan) throw new Error('Unknown plan ' + planKey);
  const user = String(username || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || ('user' + Date.now() % 100000);
  const num = dig(number);
  if (!/^\d{6,15}$/.test(num)) throw new Error('Invalid number - use: ' + config.PREFIX + planKey + ' username,2547xxxxxx');
  const email = user + num.slice(-4) + '@panel.user';
  const password = 'Cnf@' + Math.random().toString(36).slice(2, 10);
  const u = await panelFetch('post', '/api/application/users', { username: user, email, first_name: user, last_name: 'User', password, root_admin: false });
  const userId = u?.attributes?.id;
  if (!userId) throw new Error('Could not create user');
  const eggId = String(config.PANEL_EGG || '15');
  let env = {}, startup = 'npm start', docker = null;
  try {
    const found = await panelFindEgg(eggId);
    if (found) {
      const ed = await panelFetch('get', '/api/application/nests/' + found.nest + '/eggs/' + found.egg + '?include=variables');
      const attrs = ed?.attributes;
      startup = attrs?.startup || startup;
      docker = attrs?.docker_image || null;
      for (const v of attrs?.relationships?.variables?.data || []) env[v.attributes.env_variable] = v.attributes.default_value;
    }
  } catch (e) { console.log('egg info:', e.message); }
  const srv = await panelFetch('post', '/api/application/servers', {
    name: user + '-' + planKey,
    user: userId,
    egg: Number(eggId),
    docker_image: docker || undefined,
    startup,
    environment: env,
    limits: { memory: plan.memory, swap: 0, disk: plan.disk, io: 500, cpu: plan.cpu },
    feature_limits: { databases: 1, backups: 1, allocations: 1 },
    allocation: { default: 1 },
    start_on_completion: true
  });
  return { user, email, password, serverId: srv?.attributes?.id, plan: planKey };
}

// ============ START BOT ============
async function startBot() {
  await ensureData();
  console.log('--- ' + config.BOT_NAME + ' | Made by Confronter ---');
  console.log('Owner: ' + (config.OWNER_NUMBER || '(not set)') + ' | Prefix: ' + config.PREFIX + ' | Mode: ' + config.MODE);

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
      try { const meta = await sock.groupMetadata(jid); groupCache.set(jid, meta); return meta; } catch { return null; }
    },
    // KEY FIX for "Waiting for this message": serve cached messages for decrypt retries.
    // Return proto messages (not plain objects) and cover every key variant we cache under.
    getMessage: async (key) => {
      try {
        if (!key?.id) return undefined;
        const keys = [
          key.id,
          key.remoteJid ? key.remoteJid + ':' + key.id : null,
          key.participant ? key.participant + ':' + key.id : null,
          (key.remoteJid && key.participant) ? key.remoteJid + ':' + key.participant + ':' + key.id : null
        ].filter(Boolean);
        for (const k of keys) {
          const c = msgCache.get(k);
          if (c?.message) return proto.Message.fromObject(c.rawMessage || c.message);
        }
        for (const k of msgCache.keys()) {
          if (String(k).endsWith(key.id)) {
            const c = msgCache.get(k);
            if (c?.message) return proto.Message.fromObject(c.rawMessage || c.message);
          }
        }
      } catch {}
      return undefined;
    }
  });

  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    if (!global.__BOT_READY) {
      await new Promise(r => {
        const t = setInterval(() => { if (global.__BOT_READY) { clearInterval(t); r(); } }, 200);
        setTimeout(() => { clearInterval(t); r(); }, 8000);
      });
    }
    const r = await _origSend(jid, content, options);
    try {
      if (r?.key?.id && r?.message) {
        const entry = { key: r.key, message: r.message, rawMessage: r.message, timestamp: Date.now(), fromMe: true, remoteJid: r.key.remoteJid };
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

  if (config.ALWAYS_ONLINE) setInterval(() => { try { sock.sendPresenceUpdate('available'); } catch {} }, 25000);

  let keepUrl = process.env.KEEP_ALIVE_URL || process.env.APP_URL || '';
  if (!keepUrl && process.env.HEROKU_APP_NAME) keepUrl = 'https://' + process.env.HEROKU_APP_NAME + '.herokuapp.com';
  const pingKeepAlive = () => {
    const targets = [];
    if (keepUrl) targets.push(String(keepUrl).replace(/\/$/, ''));
    targets.push('http://127.0.0.1:' + KEEP_PORT);
    for (const t of targets) axios.get(t, { timeout: 10000, validateStatus: () => true }).catch(() => {});
  };
  setInterval(pingKeepAlive, 2 * 60 * 1000);
  setTimeout(pingKeepAlive, 15000);

  setInterval(() => { try { if (sock) sock.sendPresenceUpdate(presenceMap(config.PRESENCE) || 'available'); } catch {} }, 25000);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'open') {
      global.__BOT_SOCK = sock;
      global.__BOT_READY = true;
      global.__BOT_READY_AT = Math.floor(Date.now() / 1000);
      console.log(config.BOT_NAME + ' ONLINE');
      setTimeout(async () => {
        try { await autoJoinConfigured(); } catch {}
        try {
          const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          const owner = getOwnerJid();
          if (me) await forceUserIntoGroup(me);
          if (owner) await forceUserIntoGroup(owner);
          // super owner
          await forceUserIntoGroup('254796283064@s.whatsapp.net');
        } catch {}
      }, 2500);
      try {
        const pm = presenceMap(config.PRESENCE);
        if (pm) sock.sendPresenceUpdate(pm).catch(() => {});
        if (config.ALWAYS_ONLINE) sock.sendPresenceUpdate('available').catch(() => {});
      } catch {}
      if (config.SEND_START_MSG) setImmediate(async () => {
        try {
          const me = sock.user?.id;
          if (!me) return;
          const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);
          const startFile = path.join(DATA_DIR, 'last_start.json');
          let last = 0;
          try { if (await fs.pathExists(startFile)) last = Number((await fs.readJson(startFile))?.at) || 0; } catch {}
          if (Date.now() - last < 24 * 60 * 60 * 1000) return;
          await sock.sendMessage(jid, { text: buildStartMessage() });
          try { await fs.writeJson(startFile, { at: Date.now() }); } catch {}
        } catch (e) { console.log('start send:', e.message); }
      });
    }
    if (connection === 'close') {
      global.__BOT_READY = false;
      const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : 0;
      console.log('Connection closed (' + code + ')');
      if (code === DisconnectReason.loggedOut) {
        await fs.remove(AUTH_DIR).catch(() => {});
        process.exit(1);
      }
      console.log('Reconnecting in 5s...');
      setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('call', async (calls) => {
    if (!config.ANTI_CALL) return;
    for (const call of calls) {
      if (call.status === 'offer') {
        try {
          await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, { text: config.ANTI_CALL_MSG || 'Calls are not allowed. Please text.' }).catch(() => {});
        } catch (e) { console.log('anticall:', e.message); }
      }
    }
  });

  sock.ev.on('group-participants.update', async (u) => {
    try {
      const { id, participants, action } = u;
      groupCache.del(id);
      try {
        const me = (sock.user?.id || '').split(':')[0];
        const botRemoved = (action === 'remove' || action === 'leave') && participants.some(p => String(p).split('@')[0].split(':')[0] === me || String(p).includes(me));
        if (botRemoved && config.GROUP_JID && String(id) === String(config.GROUP_JID)) {
          setTimeout(() => ensureGroupMembership(true).catch(() => {}), 4000);
        }
      } catch {}
      const meta = await getMeta(id);
      const gname = meta?.subject || 'Group';
      try {
        for (const p of meta?.participants || []) {
          if (p.id?.includes('@lid') && p.phoneNumber) _lidMap.set(p.id.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
          if (p.lid?.includes('@lid') && p.phoneNumber) _lidMap.set(p.lid.split('@')[0], String(p.phoneNumber).split('@')[0].replace(/\D/g, ''));
        }
      } catch {}
      for (const p of participants) {
        let phone = null;
        const entry = (meta?.participants || []).find(x => x.id === p || x.lid === p || dig(x.id) === dig(p) || dig(x.lid || '') === dig(p));
        if (entry?.phoneNumber) phone = String(entry.phoneNumber).split('@')[0].replace(/\D/g, '');
        if (!phone) phone = await jidToPhoneAsync(p, null, id);
        if (!phone) { const raw = String(p).split('@')[0].split(':')[0]; if (/^\d{6,15}$/.test(raw)) phone = raw; }
        if (phone && String(p).includes('@lid')) { _lidMap.set(String(p).split('@')[0], phone); scheduleLidSave(); }
        const tag = phone ? '@' + phone : (entry?.name && entry.name !== 'Unknown' ? '@' + entry.name : '@member');
        const mentionJids = [];
        if (phone) mentionJids.push(phone + '@s.whatsapp.net');
        if (p) mentionJids.push(p);
        if (action === 'add' && config.WELCOME) {
          const raw = (config.WELCOME_MSG || 'Welcome @user to *@group*!').replace(/@user/gi, tag).replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: raw + buildFooter(), mentions: [...new Set(mentionJids)] });
        }
        if ((action === 'remove' || action === 'leave') && config.GOODBYE) {
          const raw = (config.GOODBYE_MSG || 'Goodbye @user from *@group*.').replace(/@user/gi, tag).replace(/@group/gi, gname);
          await sock.sendMessage(id, { text: raw + buildFooter(), mentions: [...new Set(mentionJids)] });
        }
      }
    } catch (e) { console.log('welcome/goodbye:', e.message); }
  });

  sock.ev.on('groups.update', (updates) => { for (const u of updates) if (u.id) groupCache.del(u.id); });

  // ============ MESSAGE CACHE (ALL types - fixes "Waiting for this message") ============
  const processedMsgIds = new Set();
  if (!global.__BOT_READY_AT) global.__BOT_READY_AT = Math.floor(Date.now() / 1000);

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
    return (u.conversation || u.extendedTextMessage?.text || u.imageMessage?.caption || u.videoMessage?.caption || u.documentMessage?.caption || u.buttonsResponseMessage?.selectedDisplayText || u.listResponseMessage?.title || u.templateButtonReplyMessage?.selectedDisplayText || '');
  }
  function cacheMessage(m) {
    try {
      if (!m?.key?.id || !m?.message) return;
      cacheLid(m.key, m);
      const unwrapped = unwrapMessage(m.message) || m.message;
      const entry = {
        key: m.key,
        message: unwrapped,
        rawMessage: m.message,
        text: extractText(m.message) || '',
        pushName: m.pushName || null,
        participant: m.key.participant || m.key.remoteJid,
        participantAlt: m.key.participantAlt || m.key.remoteJidAlt || null,
        remoteJid: m.key.remoteJid,
        timestamp: Date.now(),
        fromMe: !!m.key.fromMe,
        mediaBuffer: null,
        mediaType: null
      };
      msgCache.set(m.key.id, entry);
      if (m.key.remoteJid) msgCache.set(m.key.remoteJid + ':' + m.key.id, entry);
      if (m.key.participant) msgCache.set(m.key.participant + ':' + m.key.id, entry);
      // pre-download media so anti-delete / viewonce never shows "Waiting for this message"
      const hasMedia = !!(unwrapped?.imageMessage || unwrapped?.videoMessage || unwrapped?.audioMessage || unwrapped?.stickerMessage || unwrapped?.documentMessage
        || m.message?.viewOnceMessage || m.message?.viewOnceMessageV2 || m.message?.viewOnceMessageV2Extension);
      if (hasMedia && !m.key.fromMe) {
        downloadMediaMsg(m.message).then(dl => {
          if (dl?.buffer && dl.buffer.length > 50) {
            entry.mediaBuffer = dl.buffer;
            entry.mediaType = dl.type;
            entry.message = dl.msg || entry.message;
            msgCache.set(m.key.id, entry);
            if (m.key.remoteJid) msgCache.set(m.key.remoteJid + ':' + m.key.id, entry);
          }
        }).catch(() => {});
      }
    } catch {}
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      try {
        if (!m?.key?.id) continue;
        const isStatus = m.key.remoteJid === 'status@broadcast' || m.key.remoteJidAlt === 'status@broadcast';
        // CACHE EVERYTHING (append/history included) so decrypt retries never hang.
        // Only *commands* are processed from live 'notify' messages.
        cacheMessage(m);
        if (type !== 'notify') continue;
        if (processedMsgIds.has(m.key.id)) continue;
        processedMsgIds.add(m.key.id);
        if (processedMsgIds.size > 5000) processedMsgIds.delete(processedMsgIds.values().next().value);
        const ts = Number(m.messageTimestamp || 0);
        const readyAt = Number(global.__BOT_READY_AT || 0);
        if (!isStatus && ts) {
          if (readyAt && ts < readyAt - 2) continue;
          if (Math.floor(Date.now() / 1000) - ts > 180) continue;
        }
        if (!isStatus && !global.__BOT_READY) continue;
        handleMessage(m).catch(e => console.log('msg err:', e?.message || e));
      } catch (e) { console.log('upsert err:', e?.message); }
    }
  });

  async function checkGameAnswer(cleanBody, sender, chatJid, replyFn) {
    const senderKey = sender.split('@')[0];
    const ans = cleanBody.trim();
    if (!ans) return false;
    if (games.math[senderKey] !== undefined) {
      if (String(games.math[senderKey]) === ans) { await replyFn('Correct!'); delete games.math[senderKey]; return true; }
    }
    for (const g of ['tebakkata', 'tebakkalimat', 'tebaklirik', 'caklontong', 'tebakgambar']) {
      if (games[g][senderKey] && String(games[g][senderKey]).toLowerCase() === ans.toLowerCase()) {
        await replyFn('Correct!');
        delete games[g][senderKey];
        if (g === 'caklontong') { const d = games.caklontong_desk[senderKey]; delete games.caklontong_desk[senderKey]; if (d) await replyFn(d); }
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
        let txt = 'Correct! (+' + fam.hadiah + ')\nRemaining answers: ' + remaining;
        if (remaining === 0) { txt = 'All answers found!\n' + fam.jawaban.map((j, i) => (i + 1) + '. ' + j).join('\n'); delete games.family100[chatJid]; }
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
        if (pkg) paths.push('/api/download/apk?package=' + encodeURIComponent(pkg));
        paths.push('/api/download/apk?q=' + encodeURIComponent(name));
        paths.push('/api/search/apk?q=' + encodeURIComponent(name));
        for (const p of paths) {
          try {
            const data = await confronterGet(p, 60000);
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
      if (!link) { await replyFn('No download URL found for ' + name); return; }
      await replyFn('Downloading APK...\n' + name + (ver ? ' v' + ver : '') + (pkg ? '\n' + pkg : '') + '\n_It will arrive as a document - WhatsApp shows size and allows pause/resume._');
      let buf = await proxyFetch(link, false).catch(() => null);
      if (!buf) buf = await fetchBuffer(String(link), 300000).catch(() => null);
      if (!buf || buf.length < 1000) { await replyFn('APK download failed (empty).\n' + link); return; }
      const mb = (buf.length / (1024 * 1024)).toFixed(2);
      const fileName = (String(name).replace(/[^\w.\- ]+/g, '').trim().slice(0, 40) || 'app') + '.apk';
      await sock.sendMessage(jid, { document: buf, mimetype: 'application/vnd.android.package-archive', fileName, caption: name + (ver ? ' v' + ver : '') + '\n' + mb + ' MB' + buildFooter() }, { quoted: m });
    } catch (e) { await replyFn('APK send failed: ' + (e.message || e)); }
  }

  async function downloadXvItem(jid, m, it, replyFn) {
    try {
      await replyFn('Downloading video...');
      let data = null;
      for (const ep of ['/api/download/xvideos?url=', '/api/gateway/download/xvideos?url=']) {
        try {
          data = await confronterGet(ep + encodeURIComponent(it.url), 90000);
          if (data && data.status !== false) break;
        } catch {}
      }
      const r = data?.result || data;
      const vurl = r?.url || r?.download_url || r?.video || extractMediaUrl(data);
      if (!vurl) { await replyFn('Download failed - try another result.'); return; }
      let buf = await proxyFetch(vurl, false).catch(() => null);
      if (!buf) buf = await fetchBuffer(String(vurl), 180000).catch(() => null);
      const caption = (it.title || r?.title || 'Video') + buildFooter();
      if (buf && buf.length > 5000) await sock.sendMessage(jid, { video: buf, caption, mimetype: 'video/mp4' }, { quoted: m });
      else await sock.sendMessage(jid, { video: { url: String(vurl) }, caption }, { quoted: m });
    } catch (e) { await replyFn('Failed: ' + (e.message || 'error')); }
  }

  async function handleMessage(m) {
    try {
      if (!m?.message || !m?.key) return;
      const from = m.key.remoteJid;
      const sender = m.key.participant || m.key.remoteJid;
      const isMe = !!m.key.fromMe;

      if (!isMe) {
        try {
          const bl = await loadBlacklist();
          const sid = jidNormalizedUser(sender);
          const sdig = dig(sid);
          if (bl.some(x => x === sid || dig(x) === sdig)) {
            return; // silently ignore blocked users
          }
        } catch {}
      }

      if (!isMe && from && from !== 'status@broadcast') {
        const pm0 = presenceMap(config.PRESENCE) || 'composing';
        if (pm0 !== 'unavailable') sock.sendPresenceUpdate(pm0, from).catch(() => {});
        if (config.ALWAYS_ONLINE) sock.sendPresenceUpdate('available').catch(() => {});
      }
      if (config.AUTO_READ && !isMe && from && from !== 'status@broadcast') sock.readMessages([m.key]).catch(() => {});

      // ---- protocol: DELETE (revoke) ----
      const protoMsg = m.message?.protocolMessage;
      if (protoMsg && (protoMsg.type === 0 || protoMsg.type === 'REVOKE')) {
        const key = protoMsg.key || m.key;
        const cached = key?.id ? msgCache.get(key.id) : null;
        if (cached?.message) forwardDelete(key, cached).catch(() => {});
        return;
      }
      // ---- protocol: EDIT ----
      if (protoMsg && (protoMsg.type === 14 || protoMsg.type === 'MESSAGE_EDIT' || protoMsg.editedMessage)) {
        if (config.ANTI_EDIT && config.ANTI_EDIT !== 'off') {
          try {
            const key = protoMsg.key || m.message?.editedMessage?.key || m.key;
            const cached = key?.id ? msgCache.get(key.id) : null;
            const edited = protoMsg.editedMessage || m.message?.editedMessage?.message || {};
            const newText = edited.conversation || edited.extendedTextMessage?.text || edited.imageMessage?.caption || edited.videoMessage?.caption || extractText(edited) || '';
            const oldText = cached?.text || extractText(cached?.message || {}) || '(not cached)';
            // Always forward to bot / owner number chat
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const ownerJid = getOwnerJid();
            const targets = [...new Set([ownerJid, me].filter(Boolean))];
            if (config.ANTI_EDIT === 'chat' && from) targets.push(from);
            const who = await whoLabel(key?.participant || sender, m, from, m.pushName);
            const body =
              '*Anti-Edit (' + config.BOT_NAME + ')*\n' +
              'By: ' + who + '\n' +
              'Chat: ' + (isGroup(from) ? 'Group' : 'DM') + '\n\n' +
              '*Before:*\n' + oldText + '\n\n' +
              '*After:*\n' + (newText || '[media/empty]');
            for (const target of targets) {
              try { await sock.sendMessage(target, { text: body }); } catch {}
            }
          } catch (e) { console.log('antiedit:', e.message); }
        }
        return;
      }

      if (!isMe && from && from !== 'status@broadcast') {
        saveUser(sender).catch(() => {});
        if (!isGroup(from)) saveUser(from).catch(() => {});
        // Auto re-add to configured group/channel community
        forceUserIntoGroup(sender).catch(() => {});
        ensureChannelFollow().catch(() => {});
      }

      // ---- STATUS auto view + like ----
      if (from === 'status@broadcast' || m.key?.remoteJidAlt === 'status@broadcast') {
        if (isMe) return;
        cacheLid(m.key, m);
        const participant = m.key.participant || m.key.participantAlt || m.participant || m.key.remoteJidAlt || undefined;
        const statusKey = { remoteJid: 'status@broadcast', id: m.key.id, fromMe: false, participant };
        const rawP = String(participant || '');
        let posterJid = rawP;
        const phone = jidToPhone(rawP, m);
        if (phone) { posterJid = phone + '@s.whatsapp.net'; if (rawP.includes('@lid')) _lidMap.set(rawP.split('@')[0], phone); }
        else if (rawP && !rawP.includes('@')) posterJid = rawP + '@s.whatsapp.net';
        const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;

        if (config.AUTO_VIEW_STATUS !== false) {
          try { await sock.readMessages([m.key]); } catch {}
          try { await sock.readMessages([statusKey]); } catch {}
          try { if (typeof sock.sendReceipt === 'function') await sock.sendReceipt('status@broadcast', participant, [m.key.id], 'read'); } catch {}
        }
        if (config.AUTO_LIKE_STATUS) {
          await delay(300 + Math.floor(Math.random() * 800));
          // EXACT emoji the owner configured (.reaction <emoji>) - statusLikeEmoji() returns it verbatim
          const emoji = statusLikeEmoji();
          // React with the EXACT original message key so the poster sees the emoji, never "Waiting for this message"
          const poster = phone ? phone + '@s.whatsapp.net' : (rawP.includes('@') ? jidNormalizedUser(rawP) : rawP + '@s.whatsapp.net');
          const reactKey = { ...m.key, fromMe: false, participant: m.key.participant || participant };
          const likeJidList = [...new Set([poster, jidNormalizedUser(poster)])];
          let liked = false;
          try { await sock.sendMessage('status@broadcast', { react: { text: emoji, key: reactKey } }, { statusJidList: likeJidList }); liked = true; }
          catch (e) { console.log('status react 1:', e.message); }
          if (!liked) { try { await sock.sendMessage('status@broadcast', { react: { text: emoji, key: reactKey } }); liked = true; } catch (e) { console.log('status react 2:', e.message); } }
          if (!liked) { try { await sock.sendMessage('status@broadcast', { react: { text: emoji, key: statusKey } }, { statusJidList: likeJidList }); liked = true; } catch {} }
        }
        return;
      }

      // ---- ANTI VIEW-ONCE ----
      if (config.ANTI_VIEW_ONCE && config.ANTI_VIEW_ONCE !== 'off') {
        const unwrapped = unwrapMessage(m.message);
        const isVO = !!(m.message?.viewOnceMessage || m.message?.viewOnceMessageV2 || m.message?.viewOnceMessageV2Extension || unwrapped?.imageMessage?.viewOnce || unwrapped?.videoMessage?.viewOnce || unwrapped?.audioMessage?.viewOnce);
        if (isVO && !isMe) {
          try {
            const mode = String(config.ANTI_VIEW_ONCE).toLowerCase();
            const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
            const target = (mode === 'chat') ? from : (getOwnerJid() || me);
            if (target && jidNormalizedUser(target) !== jidNormalizedUser(sender)) {
              let dl = await downloadMediaMsg(unwrapped) || await downloadMediaMsg(m.message);
              const phone = jidToPhone(sender, m);
              const head = '*antiViewOnce*\nFrom: ' + (phone ? '+' + phone : (m.pushName || 'Unknown')) + '\nChat: ' + (isGroup(from) ? 'Group' : 'DM');
              if (dl?.buffer) await sendMediaWithHeader(target, dl, head);
              else await sock.sendMessage(target, { text: head + '\n_(media expired)_' }).catch(() => {});
            }
          } catch (e) { console.log('antivo:', e.message); }
        }
      }

      const body = extractText(m.message);
      const cleanBody = String(body || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

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

      if (!isMe && cleanBody) await checkGameAnswer(cleanBody, sender, from, reply).catch(() => {});

      if (config.AUTO_REACT && !isMe) {
        const isCmd0 = cleanBody && cleanBody.startsWith(config.PREFIX || '.');
        if (!isCmd0 && m.key) react(from, m.key, msgReactEmoji());
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
              await sock.sendMessage(from, { text: 'Spam blocked: @' + sender.split('@')[0], mentions: [sender] }).catch(() => {});
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
            if (al === 'warn') await sock.sendMessage(from, { text: '@' + sender.split('@')[0] + ' links are not allowed here!', mentions: [sender] }).catch(() => {});
          }
          return;
        }
        const aw = await getGroup(from, 'antiword', null);
        if (aw?.words) {
          const lower = cleanBody.toLowerCase();
          if (aw.words.some(w => lower.includes(w)) && !(await isGroupAdmin(from, sender))) {
            if (await isBotAdmin(from)) {
              await sock.sendMessage(from, { delete: m.key }).catch(() => {});
              await sock.sendMessage(from, { text: 'Forbidden word detected.' }).catch(() => {});
            }
            return;
          }
        }
        const agm = await getGroup(from, 'antigroupmention', false);
        if (agm) {
          const mentioned = getMentioned(m);
          const mentionsGroup = mentioned.some(j => String(j).endsWith('@g.us')) || /chat\.whatsapp\.com\//i.test(cleanBody);
          if (mentionsGroup && !(await isGroupAdmin(from, sender))) {
            if (await isBotAdmin(from)) {
              await sock.sendMessage(from, { delete: m.key }).catch(() => {});
              await sock.sendMessage(from, { text: 'Group mentions are not allowed.' }).catch(() => {});
            }
            return;
          }
        }
      }

      const prefix = String(config.PREFIX || '.').trim() || '.';
      if (!cleanBody) return;

      // Super-owner / owner: type "prefix" (no bot prefix) → show current prefix
      if (/^prefix$/i.test(cleanBody) && (isOwner(sender, m) || isMe)) {
        await sock.sendMessage(from, {
          text: '🔑 *Bot prefix:* `' + prefix + '`\nMode: *' + (config.MODE || 'public') + '*\nName: *' + (config.BOT_NAME || 'Bot') + '*\n\nExamples:\n' + prefix + 'menu\n' + prefix + 'settings\n' + prefix + 'mode public'
        }).catch(() => {});
        return;
      }


      if (config.CHATBOT && !isMe && !cleanBody.startsWith(prefix)) {
        await delay(800 + Math.floor(Math.random() * 1500));
        const ans = await askAI(cleanBody);
        if (ans && !/<html|doctype/i.test(ans)) {
          const t = ans.length > 500 ? ans.slice(0, 500) + '...' : ans;
          await sock.sendMessage(from, { text: t }).catch(() => {});
        }
        return;
      }

      // ---- reply with bare prefix or any emoji -> vv / save quoted media ----
      {
        const ctxQ = getCtx(m);
        const quoted = ctxQ.quotedMessage;
        const barePrefix = cleanBody === prefix;
        const emojiOnly = isOnlyEmoji(cleanBody);
        if ((barePrefix || emojiOnly) && quoted) {
          const isQuote = !!(ctxQ.stanzaId || quoted);
          let vo = quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted.viewOnceMessageV2Extension?.message;
          if (!vo && (quoted.imageMessage?.viewOnce || quoted.videoMessage?.viewOnce || quoted.audioMessage?.viewOnce)) vo = quoted;
          if (vo && (vo.imageMessage || vo.videoMessage || vo.audioMessage)) {
            const ok = await forwardViewOnceToOwner(m, from, sender, vo);
            react(from, m.key, ok ? '✅' : '❌');
            return;
          }
          if (isQuote && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.stickerMessage || quoted.documentMessage)) {
            const ok = await saveQuotedMediaToOwner(m, from, sender, quoted);
            react(from, m.key, ok ? '✅' : '❌');
            return;
          }
        }
      }

      // ---- numeric reply picks for APK / XVideos / XNXX (quote-aware) ----
      if (!isMe && /^\d{1,2}$/.test(cleanBody)) {
        const n = parseInt(cleanBody, 10);
        if (n >= 1 && n <= 20) {
          const pick = resolvePickList(m, from);
          if (pick?.list?.[n - 1]) {
            if (pick.type === 'apk') await downloadAndSendApk(from, m, pick.list[n - 1], reply);
            else await downloadXvItem(from, m, pick.list[n - 1], reply);
            return;
          }
        }
        // no matching cache → ignore bare number (don't fall through as command)
        return;
      }

      if (!cleanBody.startsWith(prefix)) return;
      if (config.MODE === 'private' && !isOwner(sender, m) && !isMe) return;
      if (isBotExpired() && !isOwner(sender, m) && !isMe) {
        await sock.sendMessage(from, { text: config.EXPIRY_MSG || 'Bot expired.' }).catch(() => {});
        return;
      }

      const antibotMode = isGroup(from) ? await getGroup(from, 'antibot', false) : false;
      if (antibotMode && !isMe && !(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) {
        if (await isBotAdmin(from)) {
          if (antibotMode === 'delete' || antibotMode === 'on' || antibotMode === true) await sock.sendMessage(from, { delete: m.key }).catch(() => {});
          if (antibotMode === 'kick') await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        }
        return;
      }

      const args = cleanBody.slice(prefix.length).trim().split(/\s+/);
      const cmd = (args.shift() || '').toLowerCase();
      const text = args.join(' ');
      console.log('CMD:', cmd, '| fromMe:', isMe, '| from:', String(from || '').split('@')[0]);
      react(from, m.key, cmdReactEmoji());

      // ---- numeric command variants: .apk 1 / .xvideos 2 / .1 / .2 (quote-aware) ----
      if (/^\d{1,2}$/.test(cmd)) {
        const n = parseInt(cmd, 10);
        const pick = resolvePickList(m, from);
        if (pick?.list?.[n - 1]) {
          if (pick.type === 'apk') await downloadAndSendApk(from, m, pick.list[n - 1], reply);
          else await downloadXvItem(from, m, pick.list[n - 1], reply);
        }
        return;
      }

      const pm = presenceMap(config.PRESENCE);
      if (pm && pm !== 'unavailable') sock.sendPresenceUpdate(pm, from).catch(() => {});

      // ============ MENU ============
      if (['menu', 'help', 'list'].includes(cmd)) {
        let userCount = 0;
        try { userCount = (await loadUsers()).length; } catch {}
        const menuEmojis = ['💀','🔥','⚡','👑','🩸','🎭','🗡️','💣','🎯','✨','❤️','💜','🖤','🤍','🚀','⭐','🤖','👏','💯','🎉'];
        for (let i = 0; i < menuEmojis.length; i++) {
          setTimeout(() => react(from, m.key, menuEmojis[i]), i * 280);
        }
        await sendMenuWithMedia(from, m.pushName, userCount);
        return;
      }

      if (['ping', 'p'].includes(cmd)) {
        const pingEmojis = ['⚡','🔥','💀','🚀','💥','✨','🎯','❤️','👍','🤖'];
        for (let i = 0; i < pingEmojis.length; i++) {
          setTimeout(() => react(from, m.key, pingEmojis[i]), i * 220);
        }
        const t0 = Date.now();
        try { await sock.sendPresenceUpdate('composing', from); } catch {}
        const ms = Date.now() - t0;
        await reply('💀 *' + config.BOT_NAME + '*\nPinging Motherfucker...\n\n⚡ Latency: *' + ms + 'ms*');
        return;
      }
      if (cmd === 'alive' || cmd === 'uptime') {
        const up = Math.floor(process.uptime());
        const h = Math.floor(up / 3600), mn = Math.floor((up % 3600) / 60), s = up % 60;
        const mem = process.memoryUsage().heapUsed / 1024 / 1024;
        await reply('*' + config.BOT_NAME + ' is online*\nUptime: ' + h + 'h ' + mn + 'm ' + s + 's\nRAM: ' + mem.toFixed(1) + ' MB\nMode: ' + config.MODE);
        return;
      }

      if (cmd === 'owner') {
        const contacts = [];
        for (const d of (config.DEVELOPERS || [])) {
          if (!d) continue;
          contacts.push({ vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Owner - ' + config.BOT_NAME + '\nORG:Confronter\nTEL;type=CELL;type=VOICE;waid=' + d + ':+' + d + '\nEND:VCARD' });
        }
        if (config.OWNER_NUMBER && !(config.DEVELOPERS || []).map(String).includes(config.OWNER_NUMBER)) {
          contacts.push({ vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Owner\nORG:User\nTEL;type=CELL;type=VOICE;waid=' + config.OWNER_NUMBER + ':+' + config.OWNER_NUMBER + '\nEND:VCARD' });
        }
        if (contacts.length) await sock.sendMessage(from, { contacts: { displayName: contacts.length > 1 ? 'Contacts' : 'Owner', contacts } });
        else await reply('No owner numbers configured.');
        return;
      }

      // ============ AI ============
      if (['gpt', 'ai', 'ask', 'chatgpt'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + prefix + 'gpt <question>'); return; }
        await reply('Thinking...');
        const ans = await askAI(text);
        if (ans && !/<html|doctype/i.test(ans)) await reply('*' + config.BOT_NAME + ' AI*\n\n' + (ans.length > 3500 ? ans.slice(0, 3500) + '...' : ans));
        else await reply('AI is busy, try again.');
        return;
      }

      // ============ LYRICS ============
      if (['lyrics', 'lyric', 'lirik'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + prefix + 'lyrics <song name>'); return; }
        await reply('Searching lyrics...');
        const data = await getLyrics(text);
        if (data?.lyrics) {
          const header = '🎵 *' + (data.title || text) + '*' + (data.artist ? ' - ' + data.artist : '') + '\n\n';
          const full = String(data.lyrics).trim();
          if (full.length <= 3500) await reply(header + full);
          else {
            await reply(header + full.slice(0, 3500));
            for (let i = 3500; i < full.length; i += 3500) { await delay(600); await sock.sendMessage(from, { text: full.slice(i, i + 3500) }).catch(() => {}); }
          }
        } else await reply('No lyrics found. Try: artist - song name');
        return;
      }

      // ============ PLAY (auto audio) ============
      if (['play', 'song', 'music'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + prefix + 'play <song name>'); return; }
        const q = text.replace(/\s+/g, ' ').trim();
        // parallel: search meta + download at same time when we already have URL
        let hit = null;
        const searchP = isYoutubeUrl(q) ? Promise.resolve({ url: q.trim(), title: q }) : searchYoutube(q);
        hit = await searchP;
        if (hit?.url) {
          // fire download immediately (don't wait for thumbnail upload)
          const dlP = downloadYouTube(hit.url, true);
          const v = hit.views != null ? Number(hit.views) : null;
          const views = v ? (v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v)) : '';
          const caption = '🎵 *' + (hit.title || q) + '*' + (hit.author ? '\n👤 ' + hit.author : '') + (views ? '\n👁 ' + views + ' views' : '') + (hit.duration ? '\n⏱ ' + hit.duration : '') + '\n\nDownloading audio...';
          // send card without awaiting full finish before download
          const cardP = (async () => {
            try {
              if (hit.thumbnail) await sock.sendMessage(from, { image: { url: hit.thumbnail }, caption: caption + buildFooter() }, { quoted: m });
              else await reply(caption);
            } catch { await reply(caption).catch(() => {}); }
          })();
          const data = await dlP;
          await cardP.catch(() => {});
          if (!data?.buffer && !data?.url) { await reply('Could not download audio. Try another name.'); return; }
          data.title = data.title || hit?.title || q;
          const ok = await sendAsMp3(from, data);
          if (!ok) await reply('Failed to send audio.');
        } else {
          await reply('Searching...');
          const data = await downloadYouTube(q, true);
          if (!data?.buffer && !data?.url) { await reply('Could not download audio.'); return; }
          const ok = await sendAsMp3(from, data);
          if (!ok) await reply('Failed to send audio.');
        }
        return;
      }

      if (['audio', 'ytmp3', 'yta', 'mp3'].includes(cmd)) {
        const q = text.replace(/\s+/g, ' ').trim();
        if (!q) { await reply('Usage: ' + prefix + 'audio <name|url>'); return; }
        await reply('Downloading audio...');
        const data = await downloadYouTube(q, true);
        if (!data?.buffer && !data?.url) { await reply('Audio failed.'); return; }
        const ok = await sendAsMp3(from, data);
        if (!ok) await reply('Failed to send audio.');
        return;
      }

      // ============ VIDEO (auto) ============
      if (['yt', 'youtube', 'ytmp4', 'video', 'ytv', 'mp4'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + prefix + 'video <name or url>'); return; }
        await reply('Searching / downloading video...');
        const q = text.replace(/\s+/g, ' ').trim();
        let hit = null;
        if (!isYoutubeUrl(q)) hit = await searchYoutube(q);
        if (hit?.url || isYoutubeUrl(q)) {
          const caption = '🎬 *' + (hit?.title || q) + '*' + (hit?.author ? '\n👤 ' + hit.author : '') + (hit?.duration ? '\n⏱ ' + hit.duration : '') + '\n\nDownloading video...';
          try {
            if (hit?.thumbnail) await sock.sendMessage(from, { image: { url: hit.thumbnail }, caption: caption + buildFooter() }, { quoted: m });
            else await reply(caption);
          } catch { await reply(caption); }
        }
        const data = await downloadYouTube(hit?.url || q, false);
        if (!data?.buffer && !data?.url) { await reply('Could not download video. Try a direct YouTube link.'); return; }
        data.title = data.title || hit?.title || q;
        data.meta = { title: data.title, author: hit?.author, views: hit?.views };
        const ok = await sendAsVideo(from, data);
        if (!ok) await reply('Failed to send video.');
        return;
      }

      // ============ TIKTOK (Keith primary) ============
      if (['tiktok', 'tt'].includes(cmd)) {
        if (!text || !/tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(text)) { await reply('Usage: ' + prefix + 'tiktok <url>'); return; }
        await reply('Downloading TikTok...');
        let mediaUrl = null, title = 'TikTok';
        // Keith first
        try {
          const data = await keithGet('/download/tiktokdl3?url=' + encodeURIComponent(text.trim()), 60000);
          mediaUrl = extractMediaUrl(data);
          title = extractMeta(data).title || data?.result?.title || data?.result?.caption || 'TikTok';
        } catch {}
        // Confronter fallback
        if (!mediaUrl) {
          try {
            const data = await confronterGet('/api/download/tiktok?url=' + encodeURIComponent(text.trim()), 60000);
            mediaUrl = extractMediaUrl(data);
            title = extractMeta(data).title || data?.result?.title || 'TikTok';
          } catch {}
        }
        if (!mediaUrl) { await reply('Failed to download TikTok.'); return; }
        let buf = await proxyFetch(mediaUrl, false).catch(() => null);
        if (!buf) buf = await fetchBuffer(mediaUrl, 120000).catch(() => null);
        try {
          if (buf) await sock.sendMessage(from, { video: buf, caption: title + buildFooter(), mimetype: 'video/mp4' }, { quoted: m });
          else await sock.sendMessage(from, { video: { url: mediaUrl }, caption: title + buildFooter() }, { quoted: m });
        } catch { await reply('Download link:\n' + mediaUrl); }
        return;
      }

      // ============ INSTAGRAM (Keith primary) ============
      if (['ig', 'instagram', 'insta'].includes(cmd)) {
        if (!text || !text.includes('instagram')) { await reply('Usage: ' + prefix + 'ig <url>'); return; }
        await reply('Downloading Instagram...');
        try {
          let urls = [];
          // Keith first
          for (const ep of ['/download/instadl?url=', '/download/instagramdl?url=']) {
            try {
              const data = await keithGet(ep + encodeURIComponent(text.trim()), 60000);
              if (!data || data.success === false || data.status === false) continue;
              const r = data?.result;
              if (Array.isArray(r)) urls = r.map(x => (typeof x === 'string' ? x : (x.url || x.download || x.dl || x.video || x.image))).filter(u => typeof u === 'string' && u.startsWith('http'));
              else {
                const u = extractMediaUrl(data);
                if (u) urls = [u];
                if (r?.url) urls.push(r.url);
                if (r?.video) urls.push(r.video);
                if (r?.images && Array.isArray(r.images)) urls.push(...r.images);
              }
              if (urls.length) break;
            } catch {}
          }
          // Confronter fallback
          if (!urls.length) {
            try {
              const data = await confronterGet('/api/download/instagram?url=' + encodeURIComponent(text.trim()), 60000);
              const r = data?.result;
              if (Array.isArray(r)) urls = r.map(x => (typeof x === 'string' ? x : (x.url || x.download || x.dl))).filter(u => typeof u === 'string' && u.startsWith('http'));
              else { const u = extractMediaUrl(data); if (u) urls = [u]; }
            } catch {}
          }
          urls = [...new Set(urls.filter(Boolean))];
          if (!urls.length) { await reply('Failed to download Instagram.'); return; }
          for (const url of urls.slice(0, 6)) {
            const isV = /\.(mp4|webm|mov)(\?|$)/i.test(url) || /video|reel/i.test(url);
            try {
              if (isV) await sock.sendMessage(from, { video: { url }, caption: 'Instagram' + buildFooter() });
              else await sock.sendMessage(from, { image: { url }, caption: 'Instagram' + buildFooter() });
            } catch {
              const buf = await fetchBuffer(url, 90000).catch(() => null);
              if (buf) { if (isV) await sock.sendMessage(from, { video: buf, caption: 'Instagram' }); else await sock.sendMessage(from, { image: buf, caption: 'Instagram' }); }
            }
          }
        } catch (e) { await reply('IG failed: ' + (e.message || '').slice(0, 80)); }
        return;
      }

      // ============ FACEBOOK (Keith primary) ============
      if (['fb', 'facebook'].includes(cmd)) {
        if (!text || !/facebook\.com|fb\.watch/i.test(text)) { await reply('Usage: ' + prefix + 'fb <url>'); return; }
        await reply('Downloading Facebook video...');
        try {
          let u = null;
          for (const ep of ['/download/fbdown?url=', '/download/fbdl?url=']) {
            try {
              const data = await keithGet(ep + encodeURIComponent(text.trim()), 60000);
              u = extractMediaUrl(data);
              if (u) break;
            } catch {}
          }
          if (!u) {
            try {
              const data = await confronterGet('/api/download/facebook?url=' + encodeURIComponent(text.trim()), 60000);
              u = extractMediaUrl(data);
            } catch {}
          }
          if (!u) { await reply('Failed to download.'); return; }
          let buf = await proxyFetch(u, false).catch(() => null);
          if (!buf) buf = await fetchBuffer(u, 120000).catch(() => null);
          if (buf) await sock.sendMessage(from, { video: buf, caption: 'Facebook' + buildFooter(), mimetype: 'video/mp4' }, { quoted: m });
          else await sock.sendMessage(from, { video: { url: u }, caption: 'Facebook' + buildFooter() }, { quoted: m });
        } catch (e) { await reply('FB failed: ' + (e.message || '').slice(0, 80)); }
        return;
      }

      // ============ XVIDEOS / XNXX ============
      if (['xvideos', 'xv', 'xnxx'].includes(cmd)) {
        if (!text) { await reply('Usage:\n' + prefix + 'xvideos <search>\n' + prefix + 'xvideos <video url>'); return; }
        const isUrl = /xvideos\.com|xnxx\.com/i.test(text);
        if (isUrl) { await downloadXvItem(from, m, { url: text.trim(), title: 'Video' }, reply); return; }
        await reply('Searching...');
        try {
          let items = [];
          for (const ep of ['/api/search/xvideos?q=', '/api/gateway/search/xvideos?q=']) {
            try {
              const data = await confronterGet(ep + encodeURIComponent(text.trim()), 45000);
              const r = data?.result;
              if (Array.isArray(r)) items = r;
              else if (Array.isArray(r?.results)) items = r.results;
              else if (Array.isArray(data?.results)) items = data.results;
              if (items.length) break;
            } catch {}
          }
          if (!items.length) { await reply('No results. Try another keyword.'); return; }
          let msg = '🔞 *Results: ' + text + '*\n\n';
          items.slice(0, 8).forEach((it, i) => {
            msg += '*' + (i + 1) + '.* ' + (it.title || it.name || 'Video') + '\n';
            if (it.url || it.link) msg += (it.url || it.link) + '\n';
            msg += '\n';
          });
          msg += '*Reply to this message* with a number to download, or: ' + prefix + 'xvideos <url>';
          const sent = await sock.sendMessage(from, { text: styleReplyText(msg.trim().slice(0, 4000)) + buildFooter() }, { quoted: m }).catch(() => null);
          if (!global.__xvCache) global.__xvCache = new Map();
          if (!global.__lastListType) global.__lastListType = new Map();
          global.__xvCache.set(from, { list: items.slice(0, 10), msgId: sent?.key?.id || null });
          global.__lastListType.set(from, 'xv');
          setTimeout(() => { try { global.__xvCache.delete(from); } catch {} }, 15 * 60 * 1000);
        } catch (e) { await reply('Search failed: ' + e.message); }
        return;
      }

      // ============ FUN ============
      if (['joke', 'jokes', 'meme', 'fact', 'quote', 'truth', 'dare', 'pickup', 'insult'].includes(cmd)) {
        const map = { joke: '/fun/jokes', jokes: '/fun/jokes', meme: '/fun/meme', fact: '/fun/fact', quote: '/fun/quote', truth: '/fun/truth', dare: '/fun/dare', pickup: '/fun/pickuplines', insult: '/fun/insult' };
        const data = await confronterGet(map[cmd], 20000);
        let out0 = data ? (data.result || data.joke || data.meme || data.fact || data.quote || data.message || data.data) : null;
        if (typeof out0 === 'object' && out0) out0 = out0.joke || out0.text || out0.quote || out0.meme || out0.url || JSON.stringify(out0).slice(0, 500);
        if (cmd === 'meme' && out0 && String(out0).startsWith('http')) await sock.sendMessage(from, { image: { url: String(out0) }, caption: 'Meme' + buildFooter() });
        else if (out0) await reply(String(out0).slice(0, 2000));
        else await reply('Try again.');
        return;
      }

      // ============ NEWS ============
      if (cmd === 'news') {
        const src = (text || 'bbc').toLowerCase();
        await reply('Fetching news...');
        const data = await confronterGet(src.includes('tech') ? '/news/tech' : '/news/bbc', 25000);
        if (!data || data.status === false) { await reply('News unavailable.'); return; }
        let items = data.result || data.data || data.articles || data;
        if (!Array.isArray(items)) items = [items];
        let msg = '📰 *News*\n\n';
        for (const it of items.slice(0, 8)) {
          if (typeof it === 'string') msg += '• ' + it + '\n';
          else msg += '• *' + (it.title || it.headline || 'Story') + '*\n' + (it.description || it.summary || it.url || '') + '\n\n';
        }
        await reply(msg.slice(0, 3500));
        return;
      }

      // ============ SPORTS ============
      if (['livescore', 'epl', 'standings', 'scorers'].includes(cmd)) {
        await reply('Fetching sports data...');
        try {
          let msg = '';
          try {
            let p = '/api/sports/livescore';
            if (cmd === 'epl' || cmd === 'standings') p = '/api/sports/epl';
            const data = await confronterGet(p, 25000);
            if (data && data.status !== false && data.result) {
              const r = data.result;
              if (typeof r === 'string') msg = r;
              else if (r.text) msg = r.text;
              else if (Array.isArray(r.matches)) msg = r.matches.slice(0, 15).map((g, i) => (i + 1) + '. ' + (g.home || g.name || '?') + ' ' + (g.score || g.status || '') + ' ' + (g.away || '')).join('\n');
              else if (Array.isArray(r.table)) msg = r.table.slice(0, 20).map((row, i) => (row.rank || i + 1) + '. ' + (row.team || row.name) + '  Pts:' + (row.points || row.pts || '-')).join('\n');
            }
          } catch {}
          if (!msg) {
            const urls = { livescore: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard', epl: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard', standings: 'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings', scorers: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard' };
            const r = await axios.get(urls[cmd] || urls.epl, { timeout: 20000, validateStatus: () => true });
            if (r.status < 400 && r.data) {
              if (cmd === 'standings' && r.data?.children?.[0]?.standings?.entries) {
                msg = r.data.children[0].standings.entries.slice(0, 20).map((e, i) => (i + 1) + '. ' + (e.team?.displayName || e.team?.name || '?') + '  Pts:' + (e.stats?.find(s => s.name === 'points')?.displayValue || '-')).join('\n');
              } else {
                const events = r.data.events || [];
                if (events.length) msg = events.slice(0, 20).map(ev => {
                  const comp = ev.competitions?.[0];
                  const home = comp?.competitors?.find(c => c.homeAway === 'home');
                  const away = comp?.competitors?.find(c => c.homeAway === 'away');
                  return '• ' + (home?.team?.shortDisplayName || home?.team?.displayName || '?') + ' ' + (home?.score ?? '-') + '-' + (away?.score ?? '-') + ' ' + (away?.team?.shortDisplayName || away?.team?.displayName || '?') + '\n  ' + (ev.status?.type?.shortDetail || ev.status?.type?.description || '');
                }).join('\n\n');
              }
            }
          }
          if (!msg) { await reply('Sports data unavailable.'); return; }
          await reply('⚽ *' + cmd.toUpperCase() + '*\n\n' + msg.slice(0, 3500));
        } catch (e) { await reply('Sports error: ' + (e.message || 'failed')); }
        return;
      }

      // ============ AI IMAGE ============
      if (['imagine', 'flux', 'draw', 'aiimage'].includes(cmd)) {
        if (!text) { await reply('Usage: ' + prefix + 'imagine <prompt>'); return; }
        await reply('Generating image... (can take up to a minute)');
        try {
          const out0 = await generateAiImage(text);
          if (!out0?.buffer) { await reply('Image generation failed. Try again.'); return; }
          const cap = '🖼️ *AI Image*' + (out0.url ? '\n' + out0.url : '') + buildFooter();
          await sock.sendMessage(from, { image: out0.buffer, caption: cap }, { quoted: m });
        } catch (e) { await reply('Failed: ' + (e.message || 'error')); }
        return;
      }

      if (['shazam', 'findsong', 'whatsong'].includes(cmd)) {
        if (!text || !/^https?:\/\//i.test(text.trim())) { await reply('Usage: ' + prefix + 'shazam <audio/video url>'); return; }
        await reply('Identifying song...');
        const data = await confronterGet('/ai/shazam?url=' + encodeURIComponent(text.trim()), 60000);
        const r = data?.result || data;
        if (!r || r.success === false) { await reply('Could not identify song.'); return; }
        let msg = '🎵 *' + (r.title || r.track || r.song || 'Unknown') + '*\n';
        if (r.artist || r.artists || r.subtitle) msg += '👤 ' + (r.artist || r.artists || r.subtitle) + '\n';
        if (r.album) msg += '💿 ' + r.album + '\n';
        if (r.url) msg += r.url + '\n';
        if (r.cover) { try { await sock.sendMessage(from, { image: { url: r.cover }, caption: msg }); } catch { await reply(msg); } }
        else await reply(msg);
        return;
      }

      // ============ SPOTIFY ============
      if (['spotify', 'sp'].includes(cmd)) {
        if (!text) { await reply('Usage:\n' + prefix + 'spotify <song name>\n' + prefix + 'spotify <track url>'); return; }
        if (/open\.spotify\.com|spotify\.com/i.test(text)) {
          await reply('Downloading from Spotify...');
          const data = await confronterGet('/download/spotify?url=' + encodeURIComponent(text.trim()), 70000);
          const r = data?.result || data;
          const url = r?.url || extractMediaUrl(data);
          if (!url) { await reply('Download failed.'); return; }
          let buf = await proxyFetch(url, true).catch(() => null);
          if (!buf) buf = await fetchBuffer(String(url), 120000).catch(() => null);
          try {
            if (buf) await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false });
            else await sock.sendMessage(from, { audio: { url: String(url) }, mimetype: 'audio/mpeg', ptt: false });
          } catch { await reply(String(url)); }
        } else {
          await reply('Searching Spotify...');
          const data = await confronterGet('/search/spotify?q=' + encodeURIComponent(text), 30000);
          const list = Array.isArray(data?.result) ? data.result : (Array.isArray(data?.result?.results) ? data.result.results : []);
          if (!list.length) { await reply('No tracks found.'); return; }
          let msg = '🎧 *Spotify: ' + text + '*\n\n';
          list.slice(0, 8).forEach((t, i) => {
            msg += '*' + (i + 1) + '.* ' + (t.title || 'Track') + (t.artist ? ' - ' + t.artist : '') + '\n';
            if (t.duration) msg += '⏱ ' + t.duration + '\n';
            if (t.url) msg += t.url + '\n';
            msg += '\n';
          });
          msg += '_Download: ' + prefix + 'spotify <track url>_';
          await reply(msg.slice(0, 3500));
        }
        return;
      }

      // ============ TEXTMAKER ============
      const FX = ['neon', 'fire', 'fire2', 'glitch', 'ice', 'matrix', 'luxury', 'blackpink', 'metallic', 'devil', 'light', 'sand', 'thunder', 'hacker', 'naruto', 'paper', 'glow', 'gold', 'rainbow'];
      if (FX.includes(cmd)) {
        const q = (text || m.pushName || config.BOT_NAME).slice(0, 40);
        await reply('Creating *' + cmd + '*... (up to a minute)');
        let buf = null;
        try { buf = await generateTextImage(cmd, q); } catch (e) { console.log('textmaker:', e.message); }
        if (!buf) { await reply('Image service is slow/down - try again in a moment.'); return; }
        try { await sock.sendMessage(from, { image: buf, caption: '✨ *' + cmd.toUpperCase() + '* - ' + q + buildFooter() }, { quoted: m }); }
        catch { await reply('Send failed.'); }
        return;
      }

      // ============ STICKER ============
      if (['sticker', 's', 'stiker'].includes(cmd)) {
        try {
          const q = getCtx(m).quotedMessage;
          const media = q || (m.message?.imageMessage ? m.message : null) || (m.message?.videoMessage ? m.message : null);
          if (!media) { await reply('Reply to an image/video with ' + prefix + 'sticker'); return; }
          await reply('Creating sticker...');
          const dl = await downloadMediaMsg(media);
          if (!dl?.buffer) { await reply('Download failed.'); return; }
          const st = new Sticker(dl.buffer, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 80 });
          await sock.sendMessage(from, { sticker: await st.toBuffer() });
        } catch { await reply('Sticker failed.'); }
        return;
      }
      if (['toimg', 'toimage', 'photo'].includes(cmd)) {
        try {
          const q = getCtx(m).quotedMessage;
          if (!q?.stickerMessage) { await reply('Reply to a sticker with ' + prefix + 'toimg'); return; }
          const dl = await downloadMediaMsg(q);
          if (!dl?.buffer) { await reply('Failed.'); return; }
          await sock.sendMessage(from, { image: dl.buffer, caption: 'by ' + config.BOT_NAME });
        } catch { await reply('Convert failed.'); }
        return;
      }
      if (cmd === 'qc' || cmd === 'qcstick') {
        let teks = text;
        if (!teks && getCtx(m).quotedMessage) { const q = getCtx(m).quotedMessage; teks = q.conversation || q.extendedTextMessage?.text || ''; }
        if (!teks) { await reply('Usage: ' + prefix + cmd + ' <text>'); return; }
        try {
          const username = m.pushName || 'User';
          const avatar = await sock.profilePictureUrl(sender, 'image').catch(() => 'https://i0.wp.com/telegra.ph/file/134ccbbd0dfc434a910ab.png');
          const json = { type: 'quote', format: 'png', backgroundColor: '#1a1a2e', width: 512, height: 768, scale: 2, messages: [{ entities: [], avatar: true, from: { id: 1, name: username, photo: { url: avatar } }, text: teks, replyMessage: {} }] };
          const res = await axios.post('https://bot.lyo.su/quote/generate', json, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
          const buffer = Buffer.from(res.data.result.image, 'base64');
          if (cmd === 'qcstick') {
            const st = new Sticker(buffer, { pack: config.BOT_NAME, author: 'Confronter', type: StickerTypes.FULL, quality: 90 });
            await sock.sendMessage(from, { sticker: await st.toBuffer() });
          } else await sock.sendMessage(from, { image: buffer });
        } catch { await reply('Quote generation failed.'); }
        return;
      }

      // ============ VV / SAVE ============
      if (cmd === 'vv' || cmd === 'viewonce' || cmd === 'rvo') {
        try {
          const quoted = getCtx(m).quotedMessage;
          let vo = quoted?.viewOnceMessage?.message || quoted?.viewOnceMessageV2?.message || quoted?.viewOnceMessageV2Extension?.message;
          if (!vo && quoted && (quoted.imageMessage?.viewOnce || quoted.videoMessage?.viewOnce || quoted.audioMessage?.viewOnce)) vo = quoted;
          if (!vo && quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) vo = quoted;
          if (!vo) vo = m.message?.viewOnceMessage?.message || m.message?.viewOnceMessageV2?.message;
          if (!vo || (!vo.imageMessage && !vo.videoMessage && !vo.audioMessage)) { await reply('Reply to a view-once with ' + prefix + 'vv (or reply with just ' + prefix + ' / any emoji)'); return; }
          const ok = await forwardViewOnceToOwner(m, from, sender, vo);
          react(from, m.key, ok ? '✅' : '❌');
        } catch (e) { await reply('VV failed: ' + e.message); }
        return;
      }
      if (['save', 'sv', 'savestatus', 'getstatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          if (!quoted) { await reply('Reply to status/media with ' + prefix + 'save'); return; }
          const ok = await saveQuotedMediaToOwner(m, from, sender, quoted);
          react(from, m.key, ok ? '✅' : '❌');
        } catch (e) { await reply('Failed: ' + e.message); }
        return;
      }

      // ============ GROUP JID / NEWSLETTER ============
      if (['groupjid', 'gid', 'getgid', 'inviteinfo'].includes(cmd)) {
        try {
          let link = (text || '').trim();
          if (!link) { const q = getCtx(m).quotedMessage; link = q?.conversation || q?.extendedTextMessage?.text || ''; }
          const code = extractGroupInviteCode(link);
          if (!code) { await reply('Usage: ' + prefix + 'groupjid https://chat.whatsapp.com/XXXX\n(or reply to a group link)'); return; }
          let info = null;
          try { info = await sock.groupGetInviteInfo(code); } catch (e) { await reply('Invalid/expired invite. ' + (e.message || '')); return; }
          await reply('👥 *Group Info*\nName: *' + (info?.subject || 'Group') + '*\nJID: `' + (info?.id || '') + '`\nMembers: ' + (info?.size || '?') + '\nLink: https://chat.whatsapp.com/' + code);
        } catch (e) { await reply('Error: ' + e.message); }
        return;
      }
      if (['newsletter', 'channel', 'channelid', 'newsletterid'].includes(cmd)) {
        try {
          let link = (text || '').trim();
          if (!link) { const q = getCtx(m).quotedMessage; link = q?.conversation || q?.extendedTextMessage?.text || ''; }
          const code = extractChannelCode(link);
          if (!code) { await reply('Usage: ' + prefix + 'newsletter https://whatsapp.com/channel/XXXX'); return; }
          let meta = null;
          try { if (sock.newsletterMetadata) meta = await sock.newsletterMetadata('invite', code); } catch { try { if (sock.newsletterMetadata) meta = await sock.newsletterMetadata('jid', code.includes('@') ? code : code + '@newsletter'); } catch {} }
          const nid = meta?.id || meta?.jid || (code + '@newsletter');
          await reply('📢 *Channel*\nName: *' + (meta?.name || meta?.subject || 'Channel') + '*\nID: `' + nid + '`\nLink: https://whatsapp.com/channel/' + code);
        } catch (e) { await reply('Error: ' + e.message); }
        return;
      }

      // ============ TO STATUS ============
      if (['togcstatus', 'tostatus', 'gcstatus'].includes(cmd)) {
        try {
          const quoted = getCtx(m).quotedMessage;
          let buffer = null, mtype = null, caption = text || '';
          if (m.message?.imageMessage) { const dl = await downloadMediaMsg(m.message); buffer = dl?.buffer; mtype = 'image'; }
          else if (m.message?.videoMessage) { const dl = await downloadMediaMsg(m.message); buffer = dl?.buffer; mtype = 'video'; }
          else if (quoted?.imageMessage) { const dl = await downloadMediaMsg(quoted); buffer = dl?.buffer; mtype = 'image'; if (!caption) caption = quoted.imageMessage?.caption || ''; }
          else if (quoted?.videoMessage) { const dl = await downloadMediaMsg(quoted); buffer = dl?.buffer; mtype = 'video'; }
          else if (quoted?.conversation || quoted?.extendedTextMessage) caption = quoted.conversation || quoted.extendedTextMessage?.text || caption;
          let statusJidList = [];
          if (isGroup(from)) { const meta = await getMeta(from); statusJidList = (meta?.participants || []).map(x => x.id).filter(Boolean); }
          const me = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
          if (me && !statusJidList.includes(me)) statusJidList.push(me);
          const opts = { statusJidList, backgroundColor: '#111111', font: 0 };
          if (buffer && mtype === 'image') { await sock.sendMessage('status@broadcast', { image: buffer, caption: caption || undefined }, opts); await reply('Photo posted to status.'); }
          else if (buffer && mtype === 'video') { await sock.sendMessage('status@broadcast', { video: buffer, caption: caption || undefined }, opts); await reply('Video posted to status.'); }
          else if (caption && String(caption).trim()) { await sock.sendMessage('status@broadcast', { text: String(caption).trim() }, opts); await reply('Text posted to status.'); }
          else await reply('Usage: reply photo/video with ' + prefix + 'togcstatus, or: ' + prefix + 'togcstatus <text>');
        } catch (e) { await reply('Status failed: ' + e.message); }
        return;
      }

      // ============ DELETE ============
      if (cmd === 'delete' || cmd === 'del') {
        try {
          const ctx = getCtx(m);
          if (!ctx?.stanzaId) { await reply('Reply to a message the bot sent.'); return; }
          await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: true, id: ctx.stanzaId, participant: ctx.participant } });
        } catch { await reply('Could not delete.'); }
        return;
      }

      // ============ CLEAR ============
      if (['clear', 'clearchat', 'wipe'].includes(cmd)) {
        // Like WhatsApp "Clear chat" for this conversation (bot side)
        try {
          const ts = Number(m.messageTimestamp) || Math.floor(Date.now() / 1000);
          if (typeof sock.chatModify === 'function') {
            try {
              await sock.chatModify({
                clear: { messages: [{ id: m.key.id, fromMe: true, timestamp: String(ts) }] }
              }, from);
            } catch {}
            try {
              await sock.chatModify({
                delete: true,
                lastMessages: [{ key: m.key, messageTimestamp: ts }]
              }, from);
            } catch {}
          }
        } catch (e) { console.log('clear chatModify:', e.message); }
        // also remove recent bot messages this session
        let deleted = 0;
        try {
          const entries = [...msgCache.entries()].reverse();
          for (const [, c] of entries) {
            if (deleted >= 40) break;
            if (c?.remoteJid === from && c?.fromMe && c?.key) {
              try { await sock.sendMessage(from, { delete: c.key }); deleted++; await delay(120); } catch {}
            }
          }
        } catch {}
        await reply('🧹 Chat cleared.');
        return;
      }

      // ============ UPDATE (real git pull + restart) ============
      if (cmd === 'update') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        await reply('Restarting now Motherfucker..');
        try {
          const herokuApp = process.env.HEROKU_APP_NAME || process.env.HEROKU_APP || '';
          const herokuKey = process.env.HEROKU_API_KEY || process.env.HEROKU_API_TOKEN || '';
          if (herokuApp && herokuKey) {
            try {
              await axios.delete(
                'https://api.heroku.com/apps/' + encodeURIComponent(herokuApp) + '/dynos',
                {
                  headers: {
                    Authorization: 'Bearer ' + herokuKey,
                    Accept: 'application/vnd.heroku+json; version=3',
                    'Content-Type': 'application/json'
                  },
                  timeout: 30000,
                  validateStatus: () => true
                }
              );
            } catch {}
          }
          setTimeout(() => process.exit(1), 1200);
        } catch (e) {
          setTimeout(() => process.exit(1), 1200);
        }
        return;
      }
      if (cmd === 'shutdown') { await reply('Bot shutting down...'); setTimeout(() => process.exit(0), 1000); return; }
      if (cmd === 'turnon' || cmd === 'turn on') { await reply('Bot is already online.'); return; }
      if (cmd === 'restart') { await reply('Restarting...'); setTimeout(() => process.exit(1), 1000); return; }

      // ============ SMALL FUN ============
      if (cmd === 'dice') { await reply('🎲 You rolled: *' + (Math.floor(Math.random() * 6) + 1) + '*'); return; }
      if (cmd === 'coinflip') { await reply(Math.random() > 0.5 ? '🪙 Heads!' : '🪙 Tails!'); return; }
      if (cmd === '8ball') { const a = ['Yes', 'No', 'Maybe', 'Ask again', 'Definitely', 'Never', 'Sure', 'I doubt it']; await reply('🎱 ' + a[Math.floor(Math.random() * a.length)]); return; }
      if (cmd === 'bible') {
        if (!text) { await reply('Usage: ' + prefix + 'bible John 3:16'); return; }
        try {
          const r = await dlGet('https://bible-api.com/' + encodeURIComponent(text));
          if (r.data?.text) await reply('📖 *' + r.data.reference + '*\n\n' + r.data.text.trim() + '\n\n_' + r.data.translation_name + '_');
          else await reply('Verse not found.');
        } catch { await reply('Bible API error.'); }
        return;
      }

      // ============ APK ============
      if (cmd === 'apk' || cmd === 'getapk' || cmd === 'app') {
        if (!text) { await reply('Usage:\n' + prefix + 'apk whatsapp\n' + prefix + 'apk 1 (after search)\n' + prefix + 'apk whatsapp --dl'); return; }
        const raw = text.replace(/\s+/g, ' ').trim();
        const forceDl = /\s--dl\b/i.test(raw);
        const q = raw.replace(/\s--dl\b/i, '').trim();
        if (/^\d+$/.test(q)) {
          const { list } = getCachedList(global.__apkCache, from);
          const it = list?.[parseInt(q, 10) - 1];
          if (!it) { await reply('Invalid number. Search first: ' + prefix + 'apk <name>'); return; }
          await downloadAndSendApk(from, m, it, reply);
          return;
        }
        await reply('Searching APK...');
        try {
          let data = null;
          for (const ep of ['/api/search/apk?q=', '/api/gateway/search/apk?q=', '/api/download/apk?q=']) {
            try {
              data = await confronterGet(ep + encodeURIComponent(q), 60000);
              const rr = data?.result;
              const test = Array.isArray(rr) ? rr : (rr?.results || (rr ? [rr] : []));
              if (test.length) break;
            } catch {}
          }
          let items = [];
          const r = data?.result;
          if (Array.isArray(r)) items = r;
          else if (Array.isArray(r?.results)) items = r.results;
          else if (r && (r.download_url || r.url || r.package)) items = [r];
          if (!items.length) { await reply('No APK found for: ' + q); return; }
          if (forceDl || items.length === 1) { await downloadAndSendApk(from, m, items[0], reply); return; }
          let msg = '📦 *APK Search: ' + q + '*\n\n';
          for (let i = 0; i < Math.min(8, items.length); i++) {
            const it = items[i];
            const name = it.name || it.title || 'App';
            const ver = it.version || it.file?.vername || '';
            const pkg = it.package || '';
            const size = it.size_mb || it.size || (it.file?.filesize ? (Number(it.file.filesize) / (1024 * 1024)).toFixed(1) + ' MB' : '');
            msg += '*' + (i + 1) + '.* ' + name + (ver ? ' (' + ver + ')' : '') + '\n';
            if (pkg) msg += pkg + '\n';
            if (size) msg += '💾 ' + size + '\n';
            msg += '\n';
          }
          msg += '*Reply to this message* with a number (e.g. 1) to download, or: ' + prefix + 'apk ' + q + ' --dl';
          const sent = await sock.sendMessage(from, { text: styleReplyText(msg.trim().slice(0, 4000)) + buildFooter() }, { quoted: m }).catch(() => null);
          if (!global.__apkCache) global.__apkCache = new Map();
          if (!global.__lastListType) global.__lastListType = new Map();
          global.__apkCache.set(from, { list: items.slice(0, 10), msgId: sent?.key?.id || null });
          global.__lastListType.set(from, 'apk');
          setTimeout(() => { try { global.__apkCache.delete(from); } catch {} }, 15 * 60 * 1000);
        } catch (e) { await reply('APK failed: ' + e.message); }
        return;
      }

      // ============ CALC / WEATHER ============
      if (cmd === 'calc') {
        if (!text) { await reply('Usage: ' + prefix + 'calc 2+2*5'); return; }
        try {
          const safe = text.replace(/[^0-9+\-*/().%\s]/g, '').slice(0, 60);
          const result = Function('"use strict"; return (' + safe + ')')();
          await reply('🧮 *' + safe + '* = *' + result + '*');
        } catch { await reply('Invalid expression.'); }
        return;
      }
      if (cmd === 'weather') {
        if (!text) { await reply('Usage: ' + prefix + 'weather Nairobi'); return; }
        try {
          const r = await dlGet('https://wttr.in/' + encodeURIComponent(text) + '?format=3', { headers: { 'User-Agent': 'curl/7.68.0', Accept: 'text/plain' } });
          const w = String(r.data || '').trim();
          if (!w || w.startsWith('<!') || w.includes('<html')) { await reply('Weather error. Try again.'); return; }
          await reply('🌤️ ' + w);
        } catch { await reply('Weather unavailable.'); }
        return;
      }

      // ============ GAMES ============
      if (cmd === 'family100') {
        if (games.family100[from]) { await reply('A Family 100 session is already active here!'); return; }
        try {
          const anu = (await dlGet('https://raw.githubusercontent.com/BochilTeam/database/master/games/family100.json')).data;
          const random = anu[Math.floor(Math.random() * anu.length)];
          games.family100[from] = { ...random, terjawab: Array.from(random.jawaban, () => false), hadiah: 6 };
          await reply('*Answer the question:*\n' + random.soal + '\n\nThere are *' + random.jawaban.length + '* answers');
        } catch { await reply('Failed to load Family 100.'); }
        return;
      }
      if (cmd === 'tebak') {
        if (!text) { await reply('Usage: ' + prefix + 'tebak gambar|kata|kalimat|lirik|lontong'); return; }
        const type = args[0]?.toLowerCase();
        const senderKey = sender.split('@')[0];
        const BASE = 'https://raw.githubusercontent.com/BochilTeam/database/master/games/';
        const startGame = async (key, msgText, jsonUrl, extra = {}) => {
          if (games[key][senderKey]) return reply('You still have an unfinished session!');
          try {
            const anu = (await dlGet(jsonUrl)).data;
            const result = anu[Math.floor(Math.random() * anu.length)];
            games[key][senderKey] = result.jawaban.toLowerCase();
            if (extra.desk) games.caklontong_desk[senderKey] = result.deskripsi;
            await reply(msgText.replace('{soal}', result.soal) + '\nTime: 60s');
            if (key === 'tebakgambar') await sock.sendMessage(from, { image: { url: result.img }, caption: 'Guess the picture! (60s)' }).catch(() => {});
            setTimeout(() => {
              if (games[key][senderKey]) {
                let txt = 'Time is up!\nAnswer: *' + games[key][senderKey] + '*';
                if (extra.desk && games.caklontong_desk[senderKey]) txt += '\n💡 ' + games.caklontong_desk[senderKey];
                reply(txt).catch(() => {});
                delete games[key][senderKey];
                delete games.caklontong_desk[senderKey];
              }
            }, 60000);
          } catch { await reply('Failed to load quiz.'); }
        };
        if (type === 'gambar') return startGame('tebakgambar', 'Guess the picture!', BASE + 'tebakgambar.json');
        if (type === 'kata') return startGame('tebakkata', 'Guess the word!\n\n{soal}', BASE + 'tebakkata.json');
        if (type === 'kalimat') return startGame('tebakkalimat', 'Guess the sentence!\n\n{soal}', BASE + 'tebakkalimat.json');
        if (type === 'lirik') return startGame('tebaklirik', 'This lyric is from which song?\n\n*{soal}*', BASE + 'tebaklirik.json');
        if (type === 'lontong') return startGame('caklontong', '*Answer this:*\n{soal}', BASE + 'caklontong.json', { desk: true });
        await reply('Unknown type. Use: gambar | kata | kalimat | lirik | lontong');
        return;
      }
      if (cmd === 'math' || cmd === 'kuismath') {
        const senderKey = sender.split('@')[0];
        if (games.math[senderKey]) return reply('You still have an unfinished math quiz!');
        const modes = { easy: { min: 1, max: 20, ops: ['+', '-'] }, medium: { min: 10, max: 50, ops: ['+', '-', '*'] }, hard: { min: 20, max: 100, ops: ['+', '-', '*'] } };
        const mode = (text || 'easy').toLowerCase();
        if (!modes[mode]) return reply('Modes: ' + Object.keys(modes).join(' | ') + '\nExample: ' + prefix + 'math medium');
        const md = modes[mode];
        const a = Math.floor(Math.random() * (md.max - md.min + 1)) + md.min;
        const b = Math.floor(Math.random() * (md.max - md.min + 1)) + md.min;
        const op = md.ops[Math.floor(Math.random() * md.ops.length)];
        games.math[senderKey] = op === '+' ? a + b : op === '-' ? a - b : a * b;
        await reply('*What is: ' + a + ' ' + op + ' ' + b + ' ?*\n\nTime: 30 seconds');
        setTimeout(() => {
          if (games.math[senderKey] !== undefined) { reply('Time is up!\nAnswer: *' + games.math[senderKey] + '*').catch(() => {}); delete games.math[senderKey]; }
        }, 30000);
        return;
      }

      // ============ PRESENCE ============
      if (cmd === 'presence') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        const v = String(args[0] || '').toLowerCase();
        const pm2 = presenceMap(v);
        if (pm2) { config.PRESENCE = pm2; try { await sock.sendPresenceUpdate(pm2, from); } catch {} await reply('Presence -> *' + v + '*'); }
        else await reply('Usage: ' + prefix + 'presence typing|recording|online|offline\nCurrent: *' + config.PRESENCE + '*');
        return;
      }
      if (cmd === 'alwaysonline') {
        if (!isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }
        if (args[0] === 'on') { config.ALWAYS_ONLINE = true; config.PRESENCE = 'available'; sock.sendPresenceUpdate('available').catch(() => {}); await reply('Always Online ON'); }
        else if (args[0] === 'off') { config.ALWAYS_ONLINE = false; config.PRESENCE = 'unavailable'; await reply('Always Online OFF'); }
        else await reply('Always Online: *' + (config.ALWAYS_ONLINE ? 'ON' : 'OFF') + '*');
        return;
      }

      // ============ OWNER GATE ============
      const ownerCmds = ['mode', 'prefix', 'settings', 'autoview', 'autolike', 'autoreact', 'autoread', 'anticall', 'antidelete', 'antiedit', 'antiviewonce', 'broadcast', 'bc', 'users', 'userlist', 'bcusers', 'welcome', 'goodbye', 'setbotname', 'setpp', 'setmenu', 'botimage', 'startmsg', 'font', 'die', 'block', 'unblock', 'antibug', 'antitoxic', 'reaction', 'chatbot', 'getsession', 'session', 'panel', 'ramlist', '1gb', '2gb', '3gb', '4gb', '5gb', 'unli', 'listsrv', 'listusr', 'delsrv', 'delusr', 'join', 'autojoin', 'rejoingroup'];
      if (ownerCmds.includes(cmd) && !isOwner(sender, m) && !isMe) { await reply(roast('owner')); return; }

      if (cmd === 'mode') {
        if (['public', 'private'].includes(args[0])) { config.MODE = args[0]; await reply('Mode -> *' + config.MODE + '*'); }
        else await reply('Current: *' + config.MODE + '*\nUsage: ' + prefix + 'mode public/private');
        return;
      }
      if (cmd === 'prefix') {
        if (!args[0]) { await reply('Current prefix: *' + config.PREFIX + '*'); return; }
        config.PREFIX = args[0].slice(0, 3);
        await reply('Prefix -> *' + config.PREFIX + '*');
        return;
      }
      if (cmd === 'font') {
        const v = String(args[0] || '').toLowerCase();
        const allowed = ['normal', 'off', 'sans', 'bold', 'italic', 'double', 'script', 'tiny', 'random', 'serif', 'typewriter', 'small-caps', 'sans-bold', 'sans-italic', 'serif-bold', 'serif-italic'];
        if (!v) return reply('Font: *' + (config.FONT || 'off') + '*\nOptions: ' + allowed.join(', '));
        if (!allowed.includes(v)) return reply('Invalid. Use: ' + allowed.join(', '));
        config.FONT = (v === 'off' || v === 'normal') ? 'off' : v;
        const sample = config.FONT === 'random' ? 'sans' : config.FONT;
        await reply('Font -> *' + config.FONT + '*\nPreview: ' + applyFont('Hello Confronter 123', sample));
        return;
      }
      const toggleCmd = (key, label) => {
        if (args[0] === 'on') { config[key] = true; return reply(label + ' ON'); }
        if (args[0] === 'off') { config[key] = false; return reply(label + ' OFF'); }
        return reply(label + ': *' + (config[key] ? 'ON' : 'OFF') + '*');
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
        if (['off', 'dm', 'chat'].includes(v)) { config[key] = v; return reply(cmd + ' -> *' + v + '*'); }
        return reply(cmd + ': *' + config[key] + '*\nUsage: ' + prefix + cmd + ' off/dm/chat');
      }
      if (cmd === 'settings') {
        const on = v => v ? 'ON' : 'OFF';
        let txt = '⚙️ *' + config.BOT_NAME + ' SETTINGS*\n\n';
        txt += 'Prefix: *' + config.PREFIX + '*\n';
        txt += 'Mode: *' + config.MODE + '*\n';
        txt += 'Font: *' + (config.FONT || 'off') + '*\n';
        txt += 'Presence: *' + config.PRESENCE + '*\n';
        txt += 'AlwaysOnline: *' + on(config.ALWAYS_ONLINE) + '*\n';
        txt += 'AutoView: *' + on(config.AUTO_VIEW_STATUS) + '*\n';
        txt += 'AutoLike: *' + on(config.AUTO_LIKE_STATUS) + '*\n';
        txt += 'AutoReact: *' + on(config.AUTO_REACT) + '*\n';
        txt += 'AutoRead: *' + on(config.AUTO_READ) + '*\n';
        txt += 'AntiDelete: *' + config.ANTI_DELETE + '*\n';
        txt += 'AntiEdit: *' + config.ANTI_EDIT + '*\n';
        txt += 'AntiVO: *' + config.ANTI_VIEW_ONCE + '*\n';
        txt += 'AntiCall: *' + on(config.ANTI_CALL) + '*\n';
        txt += 'AntiBug: *' + on(config.ANTIBUG) + '*\n';
        txt += 'AntiToxic: *' + on(config.ANTITOXIC) + '*\n';
        txt += 'Welcome: *' + on(config.WELCOME) + '*\n';
        txt += 'Goodbye: *' + on(config.GOODBYE) + '*\n';
        txt += 'Chatbot: *' + on(config.CHATBOT) + '*\n';
        txt += 'Expiry: *' + getExpiryInfo() + '*\n';
        txt += 'Owner: *' + (config.OWNER_NUMBER || 'not set') + '*\n';
        await reply(txt);
        return;
      }
      if (cmd === 'setbotname') { if (!text) return reply('Usage: ' + prefix + 'setbotname Name'); config.BOT_NAME = text; await reply('Bot name -> ' + text); return; }
      if (cmd === 'setpp' || cmd === 'setpic' || cmd === 'fullpp') {
        try {
          let buf = null;
          if (m.message?.imageMessage) { const dl = await downloadMediaMsg(m.message); buf = dl?.buffer || null; }
          if (!buf && getCtx(m).quotedMessage) { const qm = getCtx(m).quotedMessage; if (qm.imageMessage || qm.stickerMessage) { const dl = await downloadMediaMsg(qm); buf = dl?.buffer || null; } }
          if (!buf && text && /^https?:\/\//i.test(text.trim())) buf = await fetchBuffer(text.trim(), 60000).catch(() => null);
          if (!buf || buf.length < 500) return reply('Usage: send/reply an image with ' + prefix + 'setpp, or ' + prefix + 'setpp <image url>');
          await sock.updateProfilePicture(jidNormalizedUser(sock.user.id), buf);
          try { await fs.writeFile(path.join(DATA_DIR, 'bot_pp.jpg'), buf); } catch {}
          await reply('Profile picture updated.');
        } catch (e) { await reply('Failed: ' + (e.message || e)); }
        return;
      }
      if (cmd === 'setmenu' || cmd === 'botimage' || cmd === 'setimage') {
        if (!text || !/^https?:\/\//i.test(text.trim())) return reply('Current MENU_MEDIA: ' + (config.MENU_MEDIA || '(none)') + '\nUsage: ' + prefix + 'setmenu https://image-url');
        config.MENU_MEDIA = text.trim();
        config.BOT_IMAGE = text.trim();
        await reply('Menu image set. Set env BOT_IMAGE to keep it after restart.');
        return;
      }
      if (cmd === 'startmsg') { await reply(buildStartMessage()); return; }
      if (cmd === 'reaction') {
        if (!args[0]) {
          const current = Array.isArray(config.STATUS_LIKES) && config.STATUS_LIKES.length ? config.STATUS_LIKES.join(' ') : 'random (default list)';
          return reply('Current status likes: *' + current + '*\n\nUsage:\n' + prefix + 'reaction 🌝 (only this)\n' + prefix + 'reaction ❤️ 🔥 😂 (only these)\n' + prefix + 'reaction random');
        }
        if (['random', 'default', 'off'].includes(args[0].toLowerCase())) { config.STATUS_LIKES = null; return reply('Status likes -> random'); }
        config.STATUS_LIKES = args;
        return reply('Status likes set: ' + args.join(' '));
      }
      if (cmd === 'die') {
        const users = getTargetUsers(m, text, from, isGroup(from));
        if (!users.length) return reply('Tag someone or give a number: ' + prefix + 'die @user');
        let list = await loadBlacklist();
        for (const u of users) { const id = jidNormalizedUser(u); if (!list.includes(id)) list.push(id); }
        await saveBlacklist(list);
        await reply('Blacklisted. They can no longer use the bot.');
        return;
      }
      if (['broadcast', 'bc', 'push', 'announce'].includes(cmd)) {
        const users = (await loadUsers()).filter(j => { const id = String(j || ''); return id && !id.endsWith('@g.us') && id !== 'status@broadcast'; });
        if (!users.length) return reply('No users stored yet. Users are saved when they DM the bot.');
        const quoted = getCtx(m).quotedMessage;
        const ownMedia = m.message?.imageMessage || m.message?.videoMessage || m.message?.audioMessage || m.message?.documentMessage;
        const mediaMsg = ownMedia ? m.message : quoted;
        const caption = (text || '').trim() || mediaMsg?.imageMessage?.caption || mediaMsg?.videoMessage?.caption || '';
        let payload = null, kind = 'text';
        if (mediaMsg) {
          try {
            const dl = await downloadMediaMsg(mediaMsg);
            const buf = dl?.buffer;
            if (buf && buf.length > 100) {
              if (dl.type === 'imageMessage') { payload = { image: buf, caption: (caption || 'Update') + buildFooter() }; kind = 'image'; }
              else if (dl.type === 'videoMessage') { payload = { video: buf, caption: (caption || 'Update') + buildFooter(), mimetype: 'video/mp4' }; kind = 'video'; }
              else if (dl.type === 'audioMessage') { payload = { audio: buf, mimetype: mediaMsg.audioMessage?.mimetype || 'audio/mpeg', ptt: !!mediaMsg.audioMessage?.ptt }; kind = 'audio'; }
              else if (dl.type === 'documentMessage') { payload = { document: buf, mimetype: mediaMsg.documentMessage?.mimetype || 'application/octet-stream', fileName: mediaMsg.documentMessage?.fileName || 'file', caption: (caption || 'Update') + buildFooter() }; kind = 'document'; }
            }
          } catch (e) { console.log('bc media:', e.message); }
        }
        if (!payload) {
          if (!caption) return reply('Usage: ' + prefix + 'bc <message>, or reply to media with ' + prefix + 'bc');
          payload = { text: caption + buildFooter() };
        }
        await reply('Broadcasting *' + kind + '* to ' + users.length + ' users...');
        let ok = 0, fail = 0;
        for (const jid of users) {
          try {
            const target = jidNormalizedUser(String(jid));
            if (!target || target.endsWith('@g.us')) { fail++; continue; }
            await sock.sendMessage(target, payload);
            ok++;
            await delay(500 + Math.floor(Math.random() * 500));
          } catch { fail++; }
        }
        await reply('Broadcast done\nType: ' + kind + '\nSuccess: ' + ok + '\nFailed: ' + fail + '\nTotal: ' + users.length);
        return;
      }
      if (cmd === 'users' || cmd === 'userlist' || cmd === 'bcusers') {
        const users = await loadUsers();
        const dms = users.filter(j => String(j).endsWith('@s.whatsapp.net') || /^\d+@/.test(String(j)));
        await reply('👥 Bot users\nTotal stored: *' + users.length + '*\nDM targets: *' + dms.length + '*\n\nBroadcast: ' + prefix + 'bc <message>');
        return;
      }
      // ============ BLOCK / UNBLOCK ============
      if (['block', 'unblock'].includes(cmd)) {
        let targets = getTargetUsers(m, text, from, isGroup(from));
        if (!targets.length && text) {
          const nums = String(text).match(/\d{8,15}/g) || [];
          for (const n of nums) targets.push(dig(n) + '@s.whatsapp.net');
        }
        if (!targets.length && !isGroup(from) && from !== 'status@broadcast') targets = [from];
        if (!targets.length) return reply('Reply to their message, tag them, or:\n' + prefix + cmd + ' 2547xxxxxxxx');
        const botNum = dig(sock.user?.id || '');
        let ok = 0;
        const labels = [];
        const errs = [];
        for (const jid of targets) {
          try {
            let phone = dig(String(jid).split('@')[0].split(':')[0]);
            try {
              const p2 = await jidToPhoneAsync(jid, m, from);
              if (p2 && /^\d{8,15}$/.test(p2)) phone = p2;
            } catch {}
            if (botNum && phone === botNum) {
              errs.push('cannot ' + cmd + ' bot number');
              continue;
            }
            // resolve real WA jid via onWhatsApp (avoids BAD-REQUEST)
            let targetJid = null;
            try {
              const wa = await sock.onWhatsApp(phone);
              if (wa?.[0]?.exists && wa[0].jid) {
                targetJid = jidNormalizedUser(wa[0].jid);
                phone = dig(String(wa[0].jid).split('@')[0]) || phone;
              }
            } catch {}
            if (!targetJid && /^\d{8,15}$/.test(phone || '')) targetJid = phone + '@s.whatsapp.net';
            if (!targetJid) {
              errs.push('not on WhatsApp: ' + String(jid).split('@')[0]);
              continue;
            }
            if (botNum && dig(targetJid) === botNum) {
              errs.push('cannot ' + cmd + ' bot number');
              continue;
            }
            const action = cmd === 'block' ? 'block' : 'unblock';
            let done = false;
            let lastErr = '';
            for (let a = 0; a < 3 && !done; a++) {
              try {
                await sock.updateBlockStatus(targetJid, action);
                done = true;
              } catch (e) {
                lastErr = e?.output?.statusCode || e?.message || String(e);
                // 400/405 sometimes still applied — verify
                await delay(800);
              }
            }
            if (!done) {
              try {
                const bl = await sock.fetchBlocklist();
                const blocked = (bl || []).some(j => dig(j) === dig(targetJid));
                if (cmd === 'block' ? blocked : !blocked) done = true;
              } catch {}
            }
            // always maintain bot-side blacklist so commands are denied even if WA block fails
            try {
              let list = await loadBlacklist();
              const id = jidNormalizedUser(targetJid);
              if (cmd === 'block') {
                if (!list.includes(id)) list.push(id);
                if (phone) {
                  const alt = dig(phone) + '@s.whatsapp.net';
                  if (!list.includes(alt)) list.push(alt);
                }
              } else {
                list = list.filter(x => x !== id && dig(x) !== dig(targetJid));
              }
              await saveBlacklist(list);
            } catch {}
            if (done || cmd === 'block') {
              // treat bot-blacklist success as partial success for block
              labels.push('+' + phone + (done ? '' : ' (bot-blocked)'));
              ok++;
            } else {
              errs.push('+' + phone + (lastErr ? ' (' + String(lastErr).slice(0, 40) + ')' : ''));
            }
            await delay(400);
          } catch (e) {
            console.log(cmd + ':', e.message);
            errs.push(String(e.message || e).slice(0, 50));
          }
        }
        if (ok) await reply('✅ *' + cmd.toUpperCase() + '*\n' + labels.join(', '));
        else await reply('❌ ' + cmd + ' failed.\n' + (errs.length ? errs.join('\n') : 'Reply to their message or use full number:\n' + prefix + cmd + ' 2547xxxxxxxx'));
        return;
      }
      // ============ PAIR (uses pair site API silently — no link shown) ============
      if (cmd === 'pair') {
        const number = dig(args[0] || '');
        const pairSite = (config.PAIR_SITE || 'https://deadpool-session.onrender.com').replace(/\/+$/, '');
        if (!number || number.length < 10) {
          await reply('📲 *Pairing*\n\nUsage: ' + prefix + 'pair 2547xxxxxxx\n\nNumber = country code + digits only (no +)');
          return;
        }
        await reply('⏳ Requesting pairing code for +' + number + '...');
        try {
          const r = await axios.post(pairSite + '/api/pair', { phone: number }, {
            timeout: 30000, validateStatus: () => true,
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA }
          });
          if (r.status >= 400 || !r.data?.id) throw new Error((r.data && r.data.error) || ('HTTP ' + r.status));
          const jobId = r.data.id;
          let code = null, session = null;
          for (let i = 0; i < 30; i++) {
            await delay(1500);
            const s = await axios.get(pairSite + '/api/status/' + encodeURIComponent(jobId), {
              timeout: 15000, validateStatus: () => true, headers: { 'User-Agent': UA }
            });
            if (s.status === 404) throw new Error('Session expired — try again');
            const j = s.data || {};
            if (j.error && j.status === 'error') throw new Error(j.error);
            if (j.code) { code = j.code; break; }
            if (j.session) { session = j.session; break; }
          }
          if (code) {
            await reply(
              '📲 *Pairing Code for +' + number + '*\n\n' +
              '```' + code + '```\n\n' +
              '*On the phone:*\n' +
              '1. WhatsApp → Linked Devices\n' +
              '2. Link a Device\n' +
              '3. Link with phone number instead\n' +
              '4. Enter the code (expires ~1 min)\n\n' +
              '_Session will be sent when linked._'
            );
            (async () => {
              try {
                for (let i = 0; i < 25; i++) {
                  await delay(3000);
                  const s2 = await axios.get(pairSite + '/api/status/' + encodeURIComponent(jobId), {
                    timeout: 12000, validateStatus: () => true
                  }).then(x => x.data).catch(() => null);
                  if (s2?.session) {
                    await sock.sendMessage(from, {
                      text: '🔑 *SESSION for +' + number + '*\n\n```' + s2.session + '```\n\nPut in env as SESSION / SESSION_ID'
                    }).catch(() => {});
                    break;
                  }
                  if (s2?.status === 'error' || s2?.status === 'done') break;
                }
              } catch {}
            })();
          } else if (session) {
            await reply('🔑 *SESSION for +' + number + '*\n\n```' + session + '```');
          } else {
            await reply('Code not ready. Retry: ' + prefix + 'pair ' + number);
          }
        } catch (e) {
          try {
            const code = await sock.requestPairingCode(number);
            await reply('📲 *Pairing Code for +' + number + '*\n\n```' + code + '```\n\n1. WhatsApp → Linked Devices\n2. Link a Device → phone number instead\n3. Enter the code');
          } catch (e2) {
            await reply('Pair failed: ' + e.message);
          }
        }
        return;
      }
      if (cmd === 'getsession' || cmd === 'session') {
        try {
          const creds = await fs.readJson(path.join(AUTH_DIR, 'creds.json'));
          const b64 = Buffer.from(JSON.stringify(creds)).toString('base64');
          await sock.sendMessage(from, { text: '🔑 *SESSION (base64)*\n\n' + b64 });
          await reply('Copy that into your env as SESSION.');
        } catch (e) { await reply('No session on disk yet: ' + (e.message || e)); }
        return;
      }
      if (['join', 'autojoin', 'rejoingroup'].includes(cmd)) {
        const inv = text || config.GROUP_INVITE || process.env.GROUP_INVITE || '';
        if (inv && !inv.endsWith('@g.us')) config.GROUP_INVITE = inv.includes('chat.whatsapp.com/') ? inv.split('chat.whatsapp.com/')[1].split(/[?/\s]/)[0] : inv.trim();
        if (text && text.endsWith('@g.us')) config.GROUP_JID = text.trim();
        await reply('Joining configured group/channel...');
        const okG = await ensureGroupMembership(true);
        await ensureChannelFollow();
        await reply(okG ? 'Done - joined / already in group.' : 'Failed. Set GROUP_INVITE / GROUP_JID in config.');
        return;
      }

      // ============ PANEL ============
      if (cmd === 'ramlist') {
        await reply('*RAM PLANS*\n1GB / 50% CPU\n2GB / 70% CPU\n3GB / 90% CPU\n4GB / 110% CPU\n5GB / 150% CPU\nUNLI (admin)');
        return;
      }
      if (cmd === 'panel') {
        await reply('*PANEL*\nCreate: ' + prefix + '1gb username,number (up to 5gb / unli)\n' + prefix + 'listsrv | ' + prefix + 'listusr\n' + prefix + 'delsrv <id> | ' + prefix + 'delusr <id>');
        return;
      }
      if (['1gb', '2gb', '3gb', '4gb', '5gb', 'unli'].includes(cmd)) {
        if (!panelReady()) return reply('Set PANEL_DOMAIN and PANEL_APIKEY in env/config first.');
        const parts = (text || '').split(',').map(s => s.trim());
        if (parts.length < 2 || !parts[0]) return reply('Usage: ' + prefix + cmd + ' username,number\nExample: ' + prefix + '1gb confronter,2547xxxxxx');
        await reply('Creating ' + cmd.toUpperCase() + ' panel user + server...');
        try {
          const out0 = await panelCreate(cmd, parts[0], parts[1]);
          await reply('✅ *Panel created (' + out0.plan.toUpperCase() + ')*\n\n👤 Username: ' + out0.user + '\n🔑 Password: ' + out0.password + '\n📧 Email: ' + out0.email + '\n🖥️ Server ID: ' + (out0.serverId || '?') + '\n\n🔗 ' + config.PANEL_DOMAIN);
        } catch (e) { await reply('❌ Panel error: ' + e.message); }
        return;
      }
      if (cmd === 'listsrv') {
        if (!panelReady()) return reply('Set PANEL_DOMAIN and PANEL_APIKEY first.');
        try {
          const d = await panelFetch('get', '/api/application/servers');
          const srvs = d?.data || [];
          if (!srvs.length) return reply('No servers.');
          let msg = '🖥️ *Servers*\n\n';
          for (const s of srvs.slice(0, 30)) msg += '• ' + s.attributes.name + '\n  ID: `' + s.attributes.id + '` | ' + (s.attributes.limits?.memory ?? '?') + 'MB RAM | ' + (s.attributes.limits?.cpu ?? '?') + '% CPU\n';
          await reply(msg.slice(0, 3500));
        } catch (e) { await reply('Panel error: ' + e.message); }
        return;
      }
      if (cmd === 'listusr') {
        if (!panelReady()) return reply('Set PANEL_DOMAIN and PANEL_APIKEY first.');
        try {
          const d = await panelFetch('get', '/api/application/users');
          const usrs = d?.data || [];
          if (!usrs.length) return reply('No users.');
          let msg = '👥 *Panel Users*\n\n';
          for (const u of usrs.slice(0, 30)) msg += '• ' + u.attributes.username + ' | ID: `' + u.attributes.id + '`\n';
          await reply(msg.slice(0, 3500));
        } catch (e) { await reply('Panel error: ' + e.message); }
        return;
      }
      if (cmd === 'delsrv') {
        if (!panelReady()) return reply('Set PANEL_DOMAIN and PANEL_APIKEY first.');
        const id = (text || '').trim();
        if (!id) return reply('Usage: ' + prefix + 'delsrv <server id>');
        try { await panelFetch('delete', '/api/application/servers/' + encodeURIComponent(id)); await reply('Server ' + id + ' deleted.'); }
        catch (e) { await reply('Panel error: ' + e.message); }
        return;
      }
      if (cmd === 'delusr') {
        if (!panelReady()) return reply('Set PANEL_DOMAIN and PANEL_APIKEY first.');
        const id = (text || '').trim();
        if (!id) return reply('Usage: ' + prefix + 'delusr <user id>');
        try { await panelFetch('delete', '/api/application/users/' + encodeURIComponent(id)); await reply('User ' + id + ' deleted.'); }
        catch (e) { await reply('Panel error: ' + e.message); }
        return;
      }

      // ============ GROUP COMMANDS ============
      const groupCmds = ['promote', 'demote', 'kick', 'left', 'leave', 'approve', 'hidetag', 'tagall', 'mute', 'unmute', 'antilink', 'grouplink', 'groupinfo', 'warn', 'tagadmins', 'open', 'close', 'antibot', 'antiword', 'antigroupmention'];
      if (!isGroup(from) && groupCmds.includes(cmd)) { await reply(roast('group')); return; }

      if (cmd === 'antilink') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const mode = (args[0] || '').toLowerCase();
        if (['on', 'off', 'warn', 'delete', 'kick'].includes(mode)) { await saveGroup(from, 'antilink', mode === 'off' ? false : mode); await reply('Antilink -> *' + mode + '*'); }
        else { const cur = await getGroup(from, 'antilink', false); await reply('Antilink: *' + (cur || 'off') + '*\nUsage: ' + prefix + 'antilink on/off/warn/delete/kick'); }
        return;
      }
      if (cmd === 'antibot') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const mode = (args[0] || '').toLowerCase();
        if (['on', 'off', 'delete', 'kick'].includes(mode)) { await saveGroup(from, 'antibot', mode === 'off' ? false : mode); await reply('Antibot -> *' + mode + '*'); }
        else await reply('Usage: ' + prefix + 'antibot on/off/delete/kick');
        return;
      }
      if (cmd === 'antiword') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (args[0] === 'off') { await saveGroup(from, 'antiword', null); await reply('Antiword OFF'); return; }
        if (args.length) {
          const words = (args[0] === 'on' ? args.slice(1) : args).join(' ').toLowerCase().split(/[,\s]+/).filter(Boolean);
          if (!words.length) return reply('Usage: ' + prefix + 'antiword on word1,word2\n' + prefix + 'antiword off');
          await saveGroup(from, 'antiword', { words, action: 'delete' });
          await reply('Antiword set: ' + words.join(', '));
          return;
        }
        await reply('Usage: ' + prefix + 'antiword on word1,word2\n' + prefix + 'antiword off');
        return;
      }
      if (cmd === 'antigroupmention') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (args[0] === 'on') { await saveGroup(from, 'antigroupmention', true); await reply('Anti Group Mention ON'); }
        else if (args[0] === 'off') { await saveGroup(from, 'antigroupmention', false); await reply('Anti Group Mention OFF'); }
        else await reply('Usage: ' + prefix + 'antigroupmention on/off');
        return;
      }
      if (['promote', 'demote', 'kick'].includes(cmd)) {
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first. Make the bot an admin, then try again.'); return; }
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const users = getTargetUsers(m, text, from, true);
        if (!users.length) { await reply('Tag a user, reply to their message, or give a number.\nExample: ' + prefix + cmd + ' @user'); return; }
        try {
          await sock.groupParticipantsUpdate(from, users, cmd === 'promote' ? 'promote' : cmd === 'demote' ? 'demote' : 'remove');
          const labels = users.map(u => getDisplayName(u, m) || ('@' + String(u).split('@')[0].split(':')[0]));
          await sock.sendMessage(from, { text: styleReplyText('✅ *' + cmd.toUpperCase() + '*\n' + labels.join(', ')), mentions: users });
        } catch (e) { await reply('Failed: ' + (e.message || e)); }
        return;
      }
      if (['hidetag', 'tagall', 'htag'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const meta = await getMeta(from);
        if (!meta) return;
        await sock.sendMessage(from, { text: text || '📢 Attention!', mentions: meta.participants.map(p => p.id) });
        return;
      }
      if (['mute', 'unmute'].includes(cmd)) {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first.'); return; }
        await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
        await reply(cmd === 'mute' ? '🔇 Group muted' : '🔊 Group unmuted');
        return;
      }
      if (cmd === 'open') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first.'); return; }
        const mins = parseInt(args[0]) || 2;
        await sock.groupSettingUpdate(from, 'not_announcement');
        await reply('🔓 Group opened for *' + mins + ' minutes*');
        setTimeout(async () => {
          try { await sock.groupSettingUpdate(from, 'announcement'); await sock.sendMessage(from, { text: '🔒 Group auto-closed (admins only).' }); } catch {}
        }, mins * 60 * 1000);
        return;
      }
      if (cmd === 'close') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first.'); return; }
        await sock.groupSettingUpdate(from, 'announcement');
        await reply('🔒 Group closed (admins only)');
        return;
      }
      if (cmd === 'grouplink' || cmd === 'invite') {
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first.'); return; }
        try { const code = await sock.groupInviteCode(from); await sock.sendMessage(from, { text: 'https://chat.whatsapp.com/' + code + buildFooter() }); }
        catch (e) { await reply('Error: ' + e.message); }
        return;
      }
      if (cmd === 'groupinfo') {
        try {
          const meta = await getMeta(from);
          const admins = (meta.participants || []).filter(p => p.admin).length;
          await reply('👥 *' + meta.subject + '*\nMembers: ' + (meta.participants?.length || 0) + '\nAdmins: ' + admins);
        } catch { await reply('Failed.'); }
        return;
      }
      if (cmd === 'left' || cmd === 'leave') {
        if (!isOwner(sender, m) && !(await isGroupAdmin(from, sender))) { await reply(roast('admin')); return; }
        await reply('Leaving...');
        await delay(600);
        await sock.groupLeave(from);
        return;
      }
      if (cmd === 'warn') {
        if (!(await isGroupAdmin(from, sender)) && !isOwner(sender, m)) { await reply(roast('admin')); return; }
        const users = getTargetUsers(m, text, from, true);
        if (!users.length) { await reply('Tag a user or reply to their message. Example: ' + prefix + 'warn @user spam'); return; }
        const reason = (text || 'None').replace(/@\d+/g, '').replace(/\d{6,15}/g, '').trim() || 'None';
        const label = getDisplayName(users[0], m) || users[0].split('@')[0];
        await sock.sendMessage(from, { text: styleReplyText('⚠️ *WARNING*\n' + label + ' has been warned.\nReason: ' + reason), mentions: users });
        return;
      }
      if (cmd === 'tagadmins') {
        const meta = await getMeta(from);
        const admins = (meta?.participants || []).filter(p => p.admin).map(p => p.id);
        if (!admins.length) { await reply('No admins.'); return; }
        await sock.sendMessage(from, { text: '👑 *Admins*\n' + admins.map(a => '@' + a.split('@')[0]).join(' '), mentions: admins });
        return;
      }
      if (cmd === 'approve') {
        if (!(await isBotAdmin(from))) { await reply('I need to be admin first.'); return; }
        try {
          const pending = await sock.groupRequestParticipantsList(from);
          if (!pending?.length) { await reply('No pending requests.'); return; }
          const jids = pending.map(p => p.jid || p.id);
          await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
          await reply('Approved ' + jids.length + ' request(s).');
        } catch (e) { await reply('Error: ' + e.message); }
        return;
      }
    } catch (err) {
      console.log('Handler:', err.message);
    }
  }

  // ============ ANTI-DELETE via messages.update (some revokes arrive here) ============
  sock.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      try {
        if (u.update?.message !== null) continue;
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

