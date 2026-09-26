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
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const day = days[now.getDay()];
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
  const powered = config.POWERED_BY || 'Powered by Confronter';
  let foot = '\n\n▬▬▬▬▬▬▬▬▬▬▬▬\n';
  foot += '┃✦ ' + powered + ' ✦\n';
  if (config.SHOW_DATE_IN_FOOTER !== false) {
    foot += '📅 ' + day + ', ' + date + '\n';
    foot += time.toUpperCase() + ' EAT\n';
  }
  foot += '▬▬▬▬▬▬▬▬▬▬▬▬';
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

// ==================== MENU + TEXT STYLES ====================
const STYLE_MODES = ['normal', 'bold', 'italic', 'mono'];
let styleIndex = 0;

function nextStyleMode() {
  styleIndex = (styleIndex + 1) % STYLE_MODES.length;
  return STYLE_MODES[styleIndex];
}

function styleText(text, mode) {
  if (!text) return text;
  // Apply WhatsApp-supported styles (platform fonts like Roboto/Algerian are not available in WA)
  if (mode === 'bold') {
    return text.split('\n').map(line => {
      if (!line.trim() || line.includes('▬') || line.includes('━') || line.includes('┃')) return line;
      // avoid double-wrapping
      if (line.startsWith('*') || line.startsWith('_') || line.startsWith('```')) return line;
      return '*' + line + '*';
    }).join('\n');
  }
  if (mode === 'italic') {
    return text.split('\n').map(line => {
      if (!line.trim() || line.includes('▬') || line.includes('━') || line.includes('┃')) return line;
      if (line.startsWith('*') || line.startsWith('_') || line.startsWith('```')) return line;
      return '_' + line + '_';
    }).join('\n');
  }
  if (mode === 'mono') {
    // monospace block for whole menu body looks clean
    return '```\n' + text + '\n```';
  }
  return text;
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
  menu += '┃ ' + p + 'autoview on/off\n';
  menu += '┃ ' + p + 'autolike on/off\n';
  menu += '┃ ' + p + 'autoreact on/off\n';
  menu += '┃ ' + p + 'mode public/private\n';
  menu += '┃ ' + p + 'presence available/composing/recording/offline\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *🤖 AI & FUN* ━━━┓\n';
  menu += '┃ ' + p + 'gpt / ai <question>\n';
  menu += '┃ ' + p + 'dice / slot\n';
  menu += '┗━━━━━━━━━━━━━━━━┛\n\n';

  menu += '┏━━━ *👑 OWNER* ━━━┓\n';
  menu += '┃ ' + p + 'broadcast / bc\n';
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
  if (config.SESSION && config.SESSION.length > 10) {
    try {
      let raw = config.SESSION;
      if (raw.toLowerCase().startsWith('deadpool~')) {
        raw = raw.slice(raw.indexOf('~') + 1);
      }
      const creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      await fs.ensureDir(AUTH_DIR);
      await fs.writeJson(path.join(AUTH_DIR, 'creds.json'), creds, { spaces: 2 });
      console.log('✅ Session loaded (deadpool~ format)');
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
  const owner = getOwnerJid();
  if (!owner) return false;
  const n = jidNormalizedUser(jid);
  return n === owner || n.split('@')[0] === config.OWNER_NUMBER;
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
  const list = config.STATUS_LIKES;
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
  // audioOnly=true → MP3, false → MP4 video
  const endpoints = audioOnly
    ? [
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(query)}`,
        `https://api.agatz.xyz/api/ytmp3?url=${encodeURIComponent(query)}`,
        `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(query)}`
      ]
    : [
        `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(query)}`,
        `https://api.agatz.xyz/api/ytmp4?url=${encodeURIComponent(query)}`
      ];

  // If query is not a URL, try to resolve via search-style endpoints first
  const isUrl = /youtube\.com|youtu\.be/i.test(query);

  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep, { timeout: 30000, validateStatus: () => true });
      const d = res?.data?.data || res?.data?.result || res?.data;
      if (!d) continue;

      const url = d.url || d.dl || d.download || d.media || d.link || d.audio || d.mp3 || d.mp4;
      const title = d.title || d.filename || (audioOnly ? 'YouTube Audio' : 'YouTube Video');
      const thumbnail = d.thumbnail || d.thumb || d.cover;

      if (url && typeof url === 'string' && url.startsWith('http')) {
        return { title, url, thumbnail, isAudio: audioOnly };
      }
    } catch {}
  }

  // Extra fallback for non-URL search queries (play command)
  if (!isUrl && audioOnly) {
    try {
      const res = await axios.get(
        `https://api.siputzx.my.id/api/s/youtube?query=${encodeURIComponent(query)}`,
        { timeout: 20000, validateStatus: () => true }
      );
      const list = res?.data?.data || res?.data?.result || [];
      const first = Array.isArray(list) ? list[0] : null;
      const ytUrl = first?.url || first?.link || first?.videoId
        ? `https://www.youtube.com/watch?v=${first.videoId || first.id}`
        : null;
      if (ytUrl) {
        return await downloadYouTube(ytUrl, true);
      }
    } catch {}
  }

  return null;
}

async function sendAsMp3(sock, jid, data, quoted) {
  const safeName = (data.title || 'audio')
    .replace(/[^a-zA-Z0-9 \-_]/g, '')
    .slice(0, 60)
    .trim() || 'audio';

  // Prefer sending as document so it appears as a downloadable .mp3 file
  try {
    await sock.sendMessage(jid, {
      document: { url: data.url },
      mimetype: 'audio/mpeg',
      fileName: `${safeName}.mp3`,
      caption: `🎵 *${data.title}*\n\n${config.BOT_NAME}`
    }, { quoted });
    return true;
  } catch {}

  // Fallback: audio message
  try {
    await sock.sendMessage(jid, {
      audio: { url: data.url },
      mimetype: 'audio/mpeg',
      fileName: `${safeName}.mp3`,
      ptt: false
    }, { quoted });
    return true;
  } catch {}

  // Last resort: download buffer then send
  try {
    const bufRes = await axios.get(data.url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024
    });
    const buffer = Buffer.from(bufRes.data);
    await sock.sendMessage(jid, {
      document: buffer,
      mimetype: 'audio/mpeg',
      fileName: `${safeName}.mp3`,
      caption: `🎵 *${data.title}*\n\n${config.BOT_NAME}`
    }, { quoted });
    return true;
  } catch {}

  return false;
}


async function sendAsVideo(sock, jid, data, quoted) {
  const safeName = (data.title || 'video')
    .replace(/[^a-zA-Z0-9 \-_]/g, '')
    .slice(0, 60)
    .trim() || 'video';

  // Prefer normal video message
  try {
    await sock.sendMessage(jid, {
      video: { url: data.url },
      caption: `🎬 *${data.title}*\n\n${config.BOT_NAME}`,
      mimetype: 'video/mp4',
      fileName: `${safeName}.mp4`
    }, { quoted });
    return true;
  } catch {}

  // Fallback: document .mp4
  try {
    await sock.sendMessage(jid, {
      document: { url: data.url },
      mimetype: 'video/mp4',
      fileName: `${safeName}.mp4`,
      caption: `🎬 *${data.title}*\n\n${config.BOT_NAME}`
    }, { quoted });
    return true;
  } catch {}

  // Last resort: buffer
  try {
    const bufRes = await axios.get(data.url, {
      responseType: 'arraybuffer',
      timeout: 90000,
      maxContentLength: 80 * 1024 * 1024
    });
    const buffer = Buffer.from(bufRes.data);
    await sock.sendMessage(jid, {
      video: buffer,
      caption: `🎬 *${data.title}*\n\n${config.BOT_NAME}`,
      mimetype: 'video/mp4',
      fileName: `${safeName}.mp4`
    }, { quoted });
    return true;
  } catch {}

  return false;
}

async function downloadTikTok(url) {
  try {
    const res = await axios.get(
      `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
      { timeout: 25000, validateStatus: () => true }
    ).catch(() => null);

    if (res?.data?.data || res?.data?.status) {
      const d = res.data.data || res.data;
      return {
        title: d.title || 'TikTok',
        url: d.video || d.url || d.play || d.download,
        thumbnail: d.cover || d.thumbnail
      };
    }

    const res2 = await axios.get(
      `https://api.agatz.xyz/api/tiktok?url=${encodeURIComponent(url)}`,
      { timeout: 25000, validateStatus: () => true }
    ).catch(() => null);

    if (res2?.data?.data) {
      const d = res2.data.data;
      return {
        title: d.title || 'TikTok',
        url: d.url || d.play || d.video,
        thumbnail: d.cover
      };
    }
  } catch {}
  return null;
}

async function downloadInstagram(url) {
  try {
    const res = await axios.get(
      `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(url)}`,
      { timeout: 25000, validateStatus: () => true }
    ).catch(() => null);

    if (res?.data?.data) {
      const d = Array.isArray(res.data.data) ? res.data.data[0] : res.data.data;
      return {
        url: d.url || d.download || d.media,
        type: d.type || 'video'
      };
    }

    const res2 = await axios.get(
      `https://api.agatz.xyz/api/instagram?url=${encodeURIComponent(url)}`,
      { timeout: 25000, validateStatus: () => true }
    ).catch(() => null);

    if (res2?.data?.data) {
      const d = Array.isArray(res2.data.data) ? res2.data.data[0] : res2.data.data;
      return { url: d.url || d.download, type: 'video' };
    }
  } catch {}
  return null;
}

// ==================== START ====================
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

      const ownerJid = getOwnerJid();
      if (ownerJid) {
        try {
          await sock.sendMessage(ownerJid, {
            text: `🚀 *${config.BOT_NAME}* is online!\n\n` +
                  `Mode: *${config.MODE}*\n` +
                  `Anti-Delete: *${config.ANTI_DELETE}*\n` +
                  `Anti-ViewOnce: *${config.ANTI_VIEW_ONCE}*\n` +
                  `Presence: *${config.PRESENCE}*\n\n` +
                  `Type ${config.PREFIX}menu`
          });
        } catch {}
      }

      // Send editable startup message to all active users (bot-side, not from owner number)
      if (config.SEND_START_MSG) {
        try {
          const users = await loadUsers();
          if (users.length) {
            console.log(`📢 Sending start message to ${users.length} users...`);
            let ok = 0;
            for (const jid of users) {
              try {
                await sock.sendMessage(jid, { text: config.START_MSG });
                ok++;
                await delay(900);
              } catch {}
            }
            console.log(`✅ Start message sent to ${ok} users`);
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
          const ownerJid = getOwnerJid();
          if (ownerJid) {
            await sock.sendMessage(ownerJid, {
              text: `📞 *Anti-Call*\nRejected call from: ${call.from.split('@')[0]}`
            });
          }
        } catch {}
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
    if (type !== 'notify') return;

    for (const m of messages) {
      try {
        if (!m.message || m.key.remoteJid === 'status@broadcast') {
          // still handle status below
        }

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

        // ===== STATUS =====
        if (from === 'status@broadcast' && !isMe) {
          if (config.AUTO_VIEW_STATUS) {
            try {
              await sock.readMessages([m.key]);
              await delay(500 + Math.random() * 800);
            } catch {}
          }
          if (config.AUTO_LIKE_STATUS) {
            try {
              await sock.sendMessage('status@broadcast', {
                react: { text: randomEmoji(), key: m.key }
              });
            } catch {}
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


        // ===== AUTO-REACT to messages =====
        if (config.AUTO_REACT && !isMe && body && !body.startsWith(config.PREFIX)) {
          try {
            const emojis = config.REACT_EMOJIS;
            const emoji = emojis[Math.floor(Math.random() * emojis.length)] || '👍';
            await sock.sendMessage(from, {
              react: { text: emoji, key: m.key }
            });
          } catch {}
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
          let payload = typeof content === 'string' ? { text: content } : content;
          // rotate WA text style for plain text replies
          if (payload && typeof payload.text === 'string' && !payload.image && !payload.video && !payload.document && !payload.sticker && !payload.audio) {
            const mode = nextStyleMode();
            if (mode !== 'normal' && mode !== 'mono') {
              payload = { ...payload, text: styleText(payload.text, mode) };
            }
          }
          payload = withFooter(payload);
          return sock.sendMessage(from, payload, { quoted: m });
        };

        if (config.PRESENCE === 'composing') {
          await sock.sendPresenceUpdate('composing', from).catch(() => {});
        } else if (config.PRESENCE === 'recording') {
          await sock.sendPresenceUpdate('recording', from).catch(() => {});
        }

        // ===================== MENU =====================
        if (['menu', 'help', 'list'].includes(cmd)) {
          let userCount = 0;
          try { userCount = (await loadUsers()).length; } catch {}
          let menuText = buildMainMenu(m.pushName, userCount);
          const mode = nextStyleMode();
          menuText = styleText(menuText, mode);

          if (config.MENU_MEDIA) {
            const url = (config.MENU_MEDIA || '').toLowerCase();
            const isVideo = url.includes('.mp4') || url.includes('.mkv') || url.includes('.mov') ||
                            url.includes('.webm') || url.includes('video') || url.includes('gif');
            try {
              if (isVideo) {
                await sock.sendMessage(from, {
                  video: { url: config.MENU_MEDIA },
                  caption: withFooter(menuText),
                  gifPlayback: true,
                  mimetype: 'video/mp4'
                }, { quoted: m });
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
          'mode', 'presence', 'anticall', 'autoview', 'autolike',
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
          const val = args[0];
          if (['available', 'composing', 'recording', 'offline', 'unavailable'].includes(val)) {
            config.PRESENCE = val === 'offline' ? 'unavailable' : val;
            try { await sock.sendPresenceUpdate(config.PRESENCE); } catch {}
            await reply(`✅ Presence → *${config.PRESENCE}*`);
          } else await reply(`Current: *${config.PRESENCE}*\nUsage: ${config.PREFIX}presence available/composing/recording/offline`);
          continue;
        }

        // ----- ANTICALL -----
        if (cmd === 'anticall') {
          if (args[0] === 'on') { config.ANTI_CALL = true; await reply('✅ Anti-Call ON'); }
          else if (args[0] === 'off') { config.ANTI_CALL = false; await reply('❌ Anti-Call OFF'); }
          else await reply(`Current: *${config.ANTI_CALL ? 'ON' : 'OFF'}*`);
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
          if (['off', 'pm', 'chat'].includes(args[0])) {
            config.ANTI_DELETE = args[0];
            await reply(`✅ Anti-Delete → *${config.ANTI_DELETE}*`);
          } else await reply(`Current: *${config.ANTI_DELETE}*\nUsage: ${config.PREFIX}antidelete off/pm/chat`);
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
          else await reply(`Current: *${config.SEND_START_MSG ? 'ON' : 'OFF'}*\nWhen ON, bot sends start message to all users on connect.`);
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

        // ===================== BROADCAST (OWNER) =====================
        if (['broadcast', 'bc'].includes(cmd)) {
          if (!text) {
            await reply(`Usage: ${config.PREFIX}broadcast <message>\nSends to all users who have interacted with the bot.`);
            continue;
          }
          const users = await loadUsers();
          if (!users.length) {
            await reply('No users stored yet.');
            continue;
          }
          await reply(`📢 Broadcasting to *${users.length}* users...`);
          let success = 0;
          let fail = 0;
          for (const jid of users) {
            try {
              await sock.sendMessage(jid, {
                text: `📢 *Broadcast from ${config.BOT_NAME}*\n\n${text}`
              });
              success++;
              await delay(800); // avoid spam detection
            } catch {
              fail++;
            }
          }
          await reply(`✅ Broadcast done\nSuccess: ${success}\nFailed: ${fail}`);
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

          const header =
            `🗑 *ANTI-DELETE*\n` +
            `From: ${sender.split('@')[0]}\n` +
            `Chat: ${isGroup(from) ? 'Group' : 'Private'}\n` +
            `────────────────\n`;

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
