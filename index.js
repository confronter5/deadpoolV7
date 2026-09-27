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
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const axios = require('axios');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const config = require('./config');

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
  const now = new Date();
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const powered = config.POWERED_BY || 'Powered by Confronter';
  let foot = '\n\n━━━━━━━━━━━━━━\n';
  foot += powered + '\n';
  if (config.SHOW_DATE_IN_FOOTER !== false) {
    foot += date + ' · ' + time + '\n';
  }
  foot += '━━━━━━━━━━━━━━';
  return foot;
}

function withFooter(content) {
  const foot = buildFooter();
  if (!foot) return content;
  if (typeof content === 'string') return content + foot;
  if (content && typeof content === 'object') {
    const c = { ...content };
    if (c.caption != null) c.caption = (c.caption || '') + foot;
    else if (c.text != null) c.text = (c.text || '') + foot;
    else c.text = foot.trim();
    return c;
  }
  return content;
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
  // Only transform letters/numbers; keep box lines & emojis intact
  return text.split('\n').map(line => {
    // keep pure border lines as-is
    if (/^[┏┓┗┛━┃▬─═\|\s]+$/.test(line)) return line;
    return applyUnicodeFont(line, style);
  }).join('\n');
}

function buildMainMenu(pushName, userCount) {
  const name = pushName || 'User';
  const expInfo = (config.BOT_EXPIRY_DAYS > 0)
    ? (config.BOT_EXPIRY_DAYS + ' days pass')
    : (config.BOT_EXPIRY_DATE || 'Unlimited');
  const p = config.PREFIX;

  let menu = '';
  menu += '▬▬▬▬▬▬▬▬▬▬▬▬\n';
  menu += '│➤ 💀 *' + config.BOT_NAME + '*\n';
  menu += '│➤ 👋 Hi welcome, *' + name + '*!\n';
  menu += '│➤ 👥 Users: *' + (userCount || 0) + '*\n';
  menu += '│➤ 🎉 Active: *' + expInfo + '*\n';
  if (config.BOT_EXPIRY_DATE) menu += '│➤ 📅 Expires: *' + config.BOT_EXPIRY_DATE + '*\n';
  menu += '│➤ ✅ Bot is online!\n';
  menu += '▬▬▬▬▬▬▬▬▬▬▬▬\n\n';

  menu += '┏━━━ *📥 DOWNLOADS* ━━━┓\n';
  menu += '┃ ' + p + 'video <name/url>\n';
  menu += '┃ ' + p + 'play <song>  → MP3\n';
  menu += '┃ ' + p + 'yt <url>\n';
  menu += '┃ ' + p + 'tiktok <url>\n';
  menu += '┃ ' + p + 'ig <url>\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *🎨 STICKER* ━━━┓\n';
  menu += '┃ ' + p + 'sticker / s\n';
  menu += '┃ ' + p + 'toimg\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *👥 GROUP* ━━━┓\n';
  menu += '┃ ' + p + 'promote @user\n';
  menu += '┃ ' + p + 'demote @user\n';
  menu += '┃ ' + p + 'kick @user\n';
  menu += '┃ ' + p + 'tagall / hidetag\n';
  menu += '┃ ' + p + 'left / join / approve\n';
  menu += '┃ ' + p + 'antilink on/off\n';
  menu += '┃ ' + p + 'welcome on/off\n';
  menu += '┃ ' + p + 'goodbye on/off\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *🛡️ PRIVACY* ━━━┓\n';
  menu += '┃ ' + p + 'antidelete off/pm/chat\n';
  menu += '┃ ' + p + 'antiviewonce off/pm/chat\n';
  menu += '┃ ' + p + 'anticall on/off\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *⚙️ SETTINGS* ━━━┓\n';
  menu += '┃ ' + p + 'settings\n';
  menu += '┃ ' + p + 'prefix <symbol>\n';
  menu += '┃ ' + p + 'mode public/private\n';
  menu += '┃ ' + p + 'presence online/typing/recording/offline\n';
  menu += '┃ ' + p + 'autoview on/off\n';
  menu += '┃ ' + p + 'autolike on/off\n';
  menu += '┃ ' + p + 'autoreact on/off\n';
  menu += '┃ ' + p + 'save (reply status)\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *🤖 AI & FUN* ━━━┓\n';
  menu += '┃ ' + p + 'gpt / ai <question>\n';
  menu += '┃ ' + p + 'dice / slot\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *👑 OWNER* ━━━┓\n';
  menu += '┃ ' + p + 'users\n';
  menu += '┃ ' + p + 'startmsg <text>\n';
  menu += '┃ ' + p + 'sendstart on/off\n';
  menu += '┃ ' + p + 'expiry\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *📌 GENERAL* ━━━┓\n';
  menu += '┃ ' + p + 'menu / alive / ping\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n';

  return menu;
}

async function getGroupSetting(gid, key, fallback = false) {
  const data = await loadGroupSettings();
  return data[gid]?.[key] ?? fallback;
}

// ==================== SESSION ====================
async function loadAuthState() {
  if (config.SESSION && config.SESSION.length > 5) {
    try {
      let raw = config.SESSION.trim();
      if (raw.toLowerCase().startsWith('deadpool~')) {
        raw = raw.slice(raw.indexOf('~') + 1).trim();
      }

      let creds = null;

      // Short ID: deadpool~sxjrk  (no base64 — fetch from pair server)
      const isShort = raw.length <= 16 && /^[a-z0-9]+$/i.test(raw);
      if (isShort) {
        const base = (process.env.SESSION_SERVER || config.SITE_URL || '').replace(/\/$/, '');
        if (!base) {
          throw new Error('Short session needs SESSION_SERVER or SITE_URL (pair site URL)');
        }
        console.log('🔑 Short session', raw, '→ fetching from', base);
        const res = await axios.get(base + '/api/session/' + raw, { timeout: 20000 });
        const full = res.data?.session || '';
        let b64 = full;
        if (b64.toLowerCase().startsWith('deadpool~')) b64 = b64.slice(b64.indexOf('~') + 1);
        creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
        console.log('✅ Short session resolved:', raw);
      } else {
        // Long form: deadpool~BASE64CREDS
        creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        console.log('✅ Session loaded (full deadpool~ format)');
      }

      await fs.ensureDir(AUTH_DIR);
      await fs.writeJson(path.join(AUTH_DIR, 'creds.json'), creds, { spaces: 2 });
    } catch (e) {
      console.error('❌ Invalid SESSION:', e.message);
    }
  }
  return useMultiFileAuthState(AUTH_DIR);
}

// ==================== HELPERS ====================
function getOwnerJid() {
  if (!config.OWNER_NUMBER) return null;
  return jidNormalizedUser(config.OWNER_NUMBER + '@s.whatsapp.net');
}

function isOwner(jid) {
  if (!jid) return false;
  const num = jidNormalizedUser(jid).split('@')[0];
  if (config.OWNER_NUMBER && num === config.OWNER_NUMBER) return true;
  return isDeveloper(jid);
}

function isDeveloper(jid) {
  if (!jid) return false;
  const num = jidNormalizedUser(jid).split('@')[0];
  const list = config.DEVELOPERS || [];
  if (list.includes(num)) return true;
  if (config.OWNER_NUMBER && num === config.OWNER_NUMBER) return true;
  return false;
}

function isGroup(jid) {
  return jid?.endsWith('@g.us');
}

async function downloadMediaMsg(message) {
  try {
    const type = getContentType(message);
    if (!type) return null;
    const media = message[type];
    if (!media) return null;
    const stream = await downloadContentFromMessage(media, type.replace('Message', ''));
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return { buffer, type, media };
  } catch {
    return null;
  }
}

function randomEmoji() {
  const list = (config.STATUS_LIKES && config.STATUS_LIKES.length)
    ? config.STATUS_LIKES
    : ['❤️', '🔥', '💯', '😂', '👍', '😍', '🫡', '🙏', '🎉', '✨'];
  return list[Math.floor(Math.random() * list.length)] || '❤️';
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

  // Resolve search → first YouTube URL
  if (!videoUrl) {
    const searchApis = [
      `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(q)}`,
      `https://vreden.my.id/api/ytsearch?query=${encodeURIComponent(q)}`,
      `https://api.agatz.xyz/api/ytsearch?message=${encodeURIComponent(q)}`
    ];
    for (const ep of searchApis) {
      try {
        const res = await axios.get(ep, { timeout: 20000, validateStatus: () => true });
        const list = res?.data?.data || res?.data?.result || res?.data?.videos || res?.data || [];
        const arr = Array.isArray(list) ? list : (list?.data || []);
        const first = arr[0];
        if (!first) continue;
        videoUrl = first.url || first.link || first.video_url ||
          (first.videoId ? `https://www.youtube.com/watch?v=${first.videoId}` : null) ||
          (first.id ? `https://www.youtube.com/watch?v=${first.id}` : null);
        if (videoUrl) break;
      } catch {}
    }
  }
  if (!videoUrl) return null;

  // Download endpoints (y2mate-style / public DL APIs)
  const endpoints = audioOnly
    ? [
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://vreden.my.id/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://api.agatz.xyz/api/ytmp3?url=${encodeURIComponent(videoUrl)}`,
        `https://yt-download.org/api/button/mp3/${encodeURIComponent(videoUrl)}`,
        `https://api.nyxs.pw/dl/yt-mp3?url=${encodeURIComponent(videoUrl)}`
      ]
    : [
        `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://vreden.my.id/api/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.agatz.xyz/api/ytmp4?url=${encodeURIComponent(videoUrl)}`,
        `https://api.nyxs.pw/dl/yt-mp4?url=${encodeURIComponent(videoUrl)}`
      ];

  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep, {
        timeout: 45000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const d = res?.data?.data || res?.data?.result || res?.data?.download || res?.data;
      if (!d || typeof d !== 'object') continue;

      const url =
        d.url || d.dl || d.download || d.media || d.link ||
        d.audio || d.mp3 || d.mp4 || d.dl_url || d.download_url ||
        d.medias?.[0]?.url || d.formats?.[0]?.url;

      const title = d.title || d.filename || d.name || (audioOnly ? 'YouTube Audio' : 'YouTube Video');
      const thumbnail = d.thumbnail || d.thumb || d.cover || d.image;

      if (url && typeof url === 'string' && url.startsWith('http')) {
        return { title, url, thumbnail, isAudio: audioOnly, source: videoUrl };
      }
    } catch {}
  }

  // Cobalt-style POST APIs
  const cobaltHosts = ['https://api.cobalt.tools', 'https://cobalt-api.kwiatekmiki.com'];
  for (const host of cobaltHosts) {
    try {
      const res = await axios.post(
        host + '/api/json',
        {
          url: videoUrl,
          filenameStyle: 'pretty',
          downloadMode: audioOnly ? 'audio' : 'auto',
          audioFormat: 'mp3',
          videoQuality: '720'
        },
        {
          timeout: 45000,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0'
          },
          validateStatus: () => true
        }
      );
      const d = res.data || {};
      const url = d.url || d.download || d.audio;
      if (url && url.startsWith('http')) {
        return {
          title: d.filename || (audioOnly ? 'YouTube Audio' : 'YouTube Video'),
          url,
          isAudio: audioOnly,
          source: videoUrl
        };
      }
    } catch {}
  }

  return null;
}

async function downloadTikTok(url) {
  const endpoints = [
    `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
    `https://vreden.my.id/api/tiktok?url=${encodeURIComponent(url)}`,
    `https://api.agatz.xyz/api/tiktok?url=${encodeURIComponent(url)}`,
    `https://api.nyxs.pw/dl/tiktok?url=${encodeURIComponent(url)}`,
    `https://tikwm.com/api/?url=${encodeURIComponent(url)}`
  ];
  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep, {
        timeout: 35000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const d = res?.data?.data || res?.data?.result || res?.data;
      if (!d) continue;
      const mediaUrl =
        d.play || d.hdplay || d.wmplay || d.video || d.url || d.download ||
        d.nwm_video_url || d.playAddr || d.medias?.[0]?.url || d.links?.[0];
      const title = d.title || d.desc || 'TikTok Video';
      if (mediaUrl && String(mediaUrl).startsWith('http')) {
        return { title, url: mediaUrl, thumbnail: d.cover || d.thumbnail };
      }
    } catch {}
  }
  // Cobalt
  try {
    const res = await axios.post(
      'https://api.cobalt.tools/api/json',
      { url, filenameStyle: 'pretty' },
      {
        timeout: 40000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        validateStatus: () => true
      }
    );
    const u = res.data?.url;
    if (u) return { title: 'TikTok Video', url: u };
  } catch {}
  return null;
}

async function downloadInstagram(url) {
  const endpoints = [
    `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(url)}`,
    `https://vreden.my.id/api/igdownload?url=${encodeURIComponent(url)}`,
    `https://api.agatz.xyz/api/instagram?url=${encodeURIComponent(url)}`,
    `https://api.nyxs.pw/dl/ig?url=${encodeURIComponent(url)}`
  ];
  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep, {
        timeout: 35000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const d = res?.data?.data || res?.data?.result || res?.data;
      if (!d) continue;
      let mediaUrl = null;
      if (Array.isArray(d)) mediaUrl = d[0]?.url || d[0]?.download_link || d[0];
      else if (Array.isArray(d?.media)) mediaUrl = d.media[0]?.url || d.media[0];
      else mediaUrl = d.url || d.video || d.image || d.download || d.media;
      if (mediaUrl && String(mediaUrl).startsWith('http')) {
        return { url: mediaUrl, title: d.title || 'Instagram Media' };
      }
    } catch {}
  }
  try {
    const res = await axios.post(
      'https://api.cobalt.tools/api/json',
      { url, filenameStyle: 'pretty' },
      {
        timeout: 40000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        validateStatus: () => true
      }
    );
    if (res.data?.url) return { url: res.data.url, title: 'Instagram Media' };
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

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: !config.SESSION,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: config.ALWAYS_ONLINE || config.PRESENCE === 'available',
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      const c = msgCache.get(key.id);
      return c?.message || undefined;
    }
  });

  sock.ev.on('creds.update', saveCreds);

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

      // Owner only: bot is online (NOT mass-forward START_MSG)
      const ownerJid = getOwnerJid();
      if (ownerJid) {
        try {
          await sock.sendMessage(ownerJid, {
            text:
              `🚀 *${config.BOT_NAME}* is online!\n\n` +
              `Mode: *${config.MODE}*\n` +
              `Prefix: *${config.PREFIX}*\n` +
              `Users tracked: *${(await loadUsers()).length}*\n\n` +
              `Broadcast to all users:\n${config.PREFIX}broadcast <message>\n` +
              `Type ${config.PREFIX}menu`
          });
        } catch {}
      }
      // Optional: only if SEND_START_MSG=true in env (default false)
      if (config.SEND_START_MSG) {
        try {
          const users = await loadUsers();
          console.log(`📢 SEND_START_MSG on → ${users.length} users`);
          for (const jid of users) {
            try {
              await sock.sendMessage(jid, { text: config.START_MSG });
              await delay(800);
            } catch {}
          }
        } catch (e) {
          console.log('Start broadcast error:', e.message);
        }
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
    if (type !== 'notify' && type !== 'append') return;

    for (const m of messages) {
      try {
        if (!m.message) continue;
        if (m.key?.id) msgCache.set(m.key.id, m);

        const from = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const isMe = m.key.fromMe;

        // Track users who interact (for broadcast)
        if (!isMe && from && !from.endsWith('@g.us') && !from.includes('status')) {
          await saveUser(sender);
        }
        if (!isMe && from?.endsWith('@g.us')) {
          await saveUser(sender);
        }

        // ===== STATUS: auto-view + auto-like (different emojis) =====
        if (from === 'status@broadcast') {
          if (isMe) continue;
          try {
            if (config.AUTO_VIEW_STATUS) {
              // Mark status as viewed
              await sock.readMessages([m.key]).catch(() => {});
              // Extra view path used by many Baileys bots
              try {
                const statusId = m.key.participant || m.key.remoteJid;
                await sock.sendMessage(statusId, { text: '' }, {
                  // noop — view is mainly readMessages
                }).catch(() => {});
              } catch {}
              await delay(400 + Math.random() * 600);
            }
            if (config.AUTO_LIKE_STATUS) {
              const emoji = randomEmoji();
              // Correct status reaction format
              await sock.sendMessage(
                'status@broadcast',
                { react: { text: emoji, key: m.key } },
                { statusJidList: m.key.participant ? [m.key.participant] : undefined }
              ).catch(async () => {
                // Fallback
                try {
                  await sock.sendMessage(m.key.participant || from, {
                    react: { text: emoji, key: m.key }
                  });
                } catch {}
              });
            }
          } catch (e) {
            console.log('status handler:', e.message);
          }
          continue;
        }

        // ===== ANTI VIEW-ONCE =====
        if (config.ANTI_VIEW_ONCE !== 'off') {
          const contentType = getContentType(m.message);
          const isVO =
            ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'].includes(contentType) ||
            m.message?.viewOnceMessage ||
            m.message?.viewOnceMessageV2;

          if (isVO && !isMe) {
            try {
              const voMsg =
                m.message.viewOnceMessage?.message ||
                m.message.viewOnceMessageV2?.message ||
                m.message.viewOnceMessageV2Extension?.message ||
                m.message;
              const mediaType = getContentType(voMsg);
              const target = config.ANTI_VIEW_ONCE === 'chat' ? from : getOwnerJid();
              if (target) {
                const dl = await downloadMediaMsg(voMsg);
                const caption = `🔓 *ViewOnce Unlocked*\nFrom: ${m.pushName || sender.split('@')[0]}`;
                if (dl && mediaType === 'imageMessage') {
                  await sock.sendMessage(target, { image: dl.buffer, caption });
                } else if (dl && mediaType === 'videoMessage') {
                  await sock.sendMessage(target, { video: dl.buffer, caption });
                }
              }
            } catch {}
          }
        }

        const body =
          m.message.conversation ||
          m.message.extendedTextMessage?.text ||
          m.message.imageMessage?.caption ||
          m.message.videoMessage?.caption ||
          '';


        // ===== AUTO-REACT to messages (text + media) =====
        if (config.AUTO_REACT && !isMe) {
          const isCmd = body && body.startsWith(config.PREFIX);
          if (!isCmd) {
            try {
              const emojis = (config.REACT_EMOJIS && config.REACT_EMOJIS.length)
                ? config.REACT_EMOJIS
                : ['👍', '❤️', '🔥', '😂', '🙏', '💯', '😍', '🫡'];
              const emoji = emojis[Math.floor(Math.random() * emojis.length)] || '👍';
              await sock.sendMessage(from, {
                react: { text: emoji, key: m.key }
              });
            } catch (e) {
              console.log('autoreact:', e.message);
            }
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

        if (!body.startsWith(config.PREFIX)) continue;

        // Mode check
        if (config.MODE === 'private' && !isOwner(sender) && !isMe) continue;

        const args = body.slice(config.PREFIX.length).trim().split(/\s+/);
        const cmd = (args.shift() || '').toLowerCase();
        const text = args.join(' ');

        const reply = async (content) => {
          let payload = typeof content === 'string' ? { text: content } : { ...content };
          // Do NOT apply random styles — breaks rendering ("Waiting for this message")
          payload = withFooter(payload);
          try {
            return await sock.sendMessage(from, payload, { quoted: m });
          } catch (e) {
            // fallback without quote / without footer if needed
            try {
              const plain = typeof content === 'string' ? { text: content } : content;
              return await sock.sendMessage(from, plain);
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
            const url = (config.MENU_MEDIA || '').toLowerCase();
            const isGif = url.includes('.gif');
            const isVideo = url.includes('.mp4') || url.includes('.mkv') || url.includes('.mov') ||
                            url.includes('.webm') || url.includes('video') || isGif;
            try {
              if (isVideo) {
                const vidMsg = {
                  video: { url: config.MENU_MEDIA },
                  caption: withFooter(menuText),
                  mimetype: isGif ? 'video/mp4' : 'video/mp4'
                };
                // Only loop as GIF when URL is actually a gif — real mp4 plays as video
                if (isGif) vidMsg.gifPlayback = true;
                await sock.sendMessage(from, vidMsg, { quoted: m });
              } else {
                await sock.sendMessage(from, {
                  image: { url: config.MENU_MEDIA },
                  caption: withFooter(menuText)
                }, { quoted: m });
              }
            } catch (e) {
              console.log('Menu media error:', e.message);
              await reply(menuText);
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

        // ----- GPT / AI (simple public API fallback) -----
        if (['gpt', 'ai', 'ask'].includes(cmd)) {
          if (!text) {
            await reply(`Usage: ${config.PREFIX}gpt <your question>`);
            continue;
          }
          await reply('🤖 Thinking...');
          try {
            const res = await axios.get(
              `https://api.siputzx.my.id/api/ai/gpt3?prompt=${encodeURIComponent(text)}`,
              { timeout: 30000, validateStatus: () => true }
            );
            const answer = res?.data?.data || res?.data?.result || res?.data?.response || res?.data?.message;
            if (answer && typeof answer === 'string') {
              await reply(`🤖 *AI*\n\n${answer}`);
            } else {
              await reply('❌ AI unavailable right now. Try again later.');
            }
          } catch {
            await reply('❌ AI service error.');
          }
          continue;
        }

        // Owner-only config commands
        const ownerCmds = [
          'mode', 'presence', 'anticall', 'autoview', 'autolike', 'prefix', 'settings', 'save',
          'antidelete', 'antiviewonce', 'antibot', 'broadcast', 'bc', 'users',
          'welcome', 'goodbye', 'autoreact', 'startmsg', 'sendstart', 'expiry'
        ];
        if (ownerCmds.includes(cmd) && !isOwner(sender)) {
          await reply('🚫 Owner only.');
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
          const lines = [
            `⚙️ *${config.BOT_NAME} SETTINGS*`,
            `━━━━━━━━━━━━━━`,
            `Prefix: *${config.PREFIX}*`,
            `Mode: *${config.MODE}*`,
            `Presence: *${config.PRESENCE}*`,
            `AutoView: *${config.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}*`,
            `AutoLike: *${config.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}*`,
            `AutoReact: *${config.AUTO_REACT ? 'ON' : 'OFF'}*`,
            `AntiDelete: *${config.ANTI_DELETE}*`,
            `AntiDelete Status: *${config.ANTI_DELETE_STATUS ? 'ON' : 'OFF'}*`,
            `AntiViewOnce: *${config.ANTI_VIEW_ONCE}*`,
            `AntiCall: *${config.ANTI_CALL ? 'ON' : 'OFF'}*`,
            `Antilink: *${config.ANTILINK ? 'ON' : 'OFF'}*`,
            `Welcome: *${config.WELCOME ? 'ON' : 'OFF'}*`,
            `Goodbye: *${config.GOODBYE ? 'ON' : 'OFF'}*`,
            `SendStart: *${config.SEND_START_MSG ? 'ON' : 'OFF'}*`,
            `Expiry: *${exp.expired ? 'EXPIRED' : (config.BOT_EXPIRY_DAYS || config.BOT_EXPIRY_DATE || 'unlimited')}*`,
            `━━━━━━━━━━━━━━`
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
          if (args[0] === 'on') { config.AUTO_VIEW_STATUS = true; await reply('✅ Auto View ON'); }
          else if (args[0] === 'off') { config.AUTO_VIEW_STATUS = false; await reply('❌ Auto View OFF'); }
          else await reply(`Current: *${config.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}*`);
          continue;
        }
        if (cmd === 'autolike') {
          if (args[0] === 'on') { config.AUTO_LIKE_STATUS = true; await reply('✅ Auto Like ON'); }
          else if (args[0] === 'off') { config.AUTO_LIKE_STATUS = false; await reply('❌ Auto Like OFF'); }
          else await reply(`Current: *${config.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ----- ANTIDELETE / ANTIVIEWONCE -----
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
        if (cmd === 'antiviewonce') {
          if (['off', 'pm', 'chat'].includes(args[0])) {
            config.ANTI_VIEW_ONCE = args[0];
            await reply(`✅ Anti-ViewOnce → *${config.ANTI_VIEW_ONCE}*`);
          } else await reply(`Current: *${config.ANTI_VIEW_ONCE}*\nUsage: ${config.PREFIX}antiviewonce off/pm/chat`);
          continue;
        }

        // ----- WELCOME / GOODBYE -----
        if (cmd === 'welcome') {
          if (args[0] === 'on') { config.WELCOME = true; await reply('✅ Welcome ON'); }
          else if (args[0] === 'off') { config.WELCOME = false; await reply('❌ Welcome OFF'); }
          else await reply(`Current: *${config.WELCOME ? 'ON' : 'OFF'}*`);
          continue;
        }

        if (cmd === 'goodbye') {
          if (args[0] === 'on') { config.GOODBYE = true; await reply('✅ Goodbye ON'); }
          else if (args[0] === 'off') { config.GOODBYE = false; await reply('❌ Goodbye OFF'); }
          else await reply(`Current: *${config.GOODBYE ? 'ON' : 'OFF'}*`);
          continue;
        }

        // ----- AUTO-REACT -----
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
              await reply('❌ Admin only.');
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
            await sock.sendMessage(from, {
              video: { url: data.url },
              caption: `🎵 ${data.title || 'TikTok'}\n\n${config.BOT_NAME}`
            }, { quoted: m });
          } catch {
            await reply(`✅ ${data.url}`);
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
          await reply('⚠️ Group only.');
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
            await reply('❌ Admin / Owner only.');
            continue;
          }
          await reply('👋 Leaving...');
          await delay(600);
          await sock.groupLeave(from);
          continue;
        }

        if (cmd === 'join') {
          if (!isOwner(sender)) {
            await reply('🚫 Owner only.');
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
            await reply('❌ Admin only.');
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
            await reply('❌ Admin only.');
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

      } catch (err) {
        console.log('Handler:', err.message);
      }
    }
  });

  // ==================== ANTI-DELETE ====================
  sock.ev.on('messages.update', async (updates) => {
    if (config.ANTI_DELETE === 'off') return;

    for (const u of updates) {
      try {
        if (u.update?.message === null || u.update?.messageStubType === 1 || u.update?.messageStubType === 2) {
          const key = u.key;
          const cached = msgCache.get(key.id);
          if (!cached?.message) continue;

          const from = key.remoteJid;
          const sender = key.participant || key.remoteJid;
          const target = config.ANTI_DELETE === 'chat' ? from : getOwnerJid();
          if (!target) continue;

          const msg = cached.message;
          const type = getContentType(msg);
          let textContent = '';

          if (type === 'conversation') textContent = msg.conversation;
          else if (type === 'extendedTextMessage') textContent = msg.extendedTextMessage?.text || '';
          else if (type === 'imageMessage') textContent = '[Image] ' + (msg.imageMessage?.caption || '');
          else if (type === 'videoMessage') textContent = '[Video] ' + (msg.videoMessage?.caption || '');
          else if (type === 'stickerMessage') textContent = '[Sticker]';
          else if (type === 'audioMessage') textContent = '[Audio]';
          else textContent = `[${type || 'Media'}]`;

          const deletedAt = new Date().toLocaleString(undefined, {
            weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          });
          const whoName = cached.pushName || sender.split('@')[0];
          const whoNum = sender.split('@')[0];
          const header =
            `🗑️ *ANTI-DELETE*\n` +
            `👤 Name: *${whoName}*\n` +
            `📱 Number: *${whoNum}*\n` +
            `💬 Chat: ${isGroup(from) ? 'Group' : 'Private'}\n` +
            `🕒 Time: ${deletedAt}\n` +
            `━━━━━━━━━━━━━━\n`;

          if (['imageMessage', 'videoMessage'].includes(type)) {
            try {
              const dl = await downloadMediaMsg(msg);
              if (dl) {
                const mediaKey = type === 'imageMessage' ? 'image' : 'video';
                await sock.sendMessage(target, {
                  [mediaKey]: dl.buffer,
                  caption: header + textContent
                });
                continue;
              }
            } catch {}
          }
          await sock.sendMessage(target, { text: header + textContent });
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
