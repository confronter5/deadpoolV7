const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  Browsers,
  delay,
  proto,
  generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const config = require('./config');
const axios = require('axios');
let searchSong = null; try { searchSong = require('./apis').searchSong; } catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const DEV_LINK = process.env.DEV_LINK || config.DEV_LINK || 'https://wa.me/254796283064';
const PAIR_CODE = 'DEADPOOL'; // always fixed — never random

// Deadpool group auto-join: put full invite link or just the code (e.g. AbCdEfGhIjKlMnOp)
// Example: https://chat.whatsapp.com/AbCdEfGhIjKlMnOp  OR  AbCdEfGhIjKlMnOp
const GROUP_INVITE = process.env.GROUP_INVITE || config.GROUP_INVITE || '';
const GROUP_JID = process.env.GROUP_JID || config.GROUP_JID || '120363430854781207@g.us';

const SESSIONS_DIR = path.join(__dirname, 'sessions');
fs.ensureDirSync(SESSIONS_DIR);

function makeShortId(len = 5) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
async function saveShortSession(b64) {
  await fs.ensureDir(SESSIONS_DIR);
  let id = makeShortId(5);
  while (await fs.pathExists(path.join(SESSIONS_DIR, id + '.json'))) id = makeShortId(6);
  await fs.writeJson(path.join(SESSIONS_DIR, id + '.json'), { id, createdAt: new Date().toISOString(), data: b64 }, { spaces: 0 });
  return id;
}

function extractInviteCode(linkOrCode) {
  if (!linkOrCode) return null;
  const s = String(linkOrCode).trim();
  // full link with optional query params
  const m = s.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  // raw invite code
  const clean = s.replace(/[^A-Za-z0-9_-]/g, '');
  if (clean.length >= 10) return clean;
  return null;
}

async function autoJoinGroup(sock, jobId) {
  // Prefer stable GROUP_JID; mint a fresh invite code when possible (links rotate)
  const jid = String(GROUP_JID || '').trim();
  const codeFromEnv = extractInviteCode(GROUP_INVITE);

  if (codeFromEnv && !String(GROUP_INVITE).includes('@g.us')) {
    log(jobId, 'auto-join: accepting invite code', codeFromEnv);
    try {
      await delay(2000);
      const gid = await sock.groupAcceptInvite(codeFromEnv);
      log(jobId, 'auto-joined group OK:', gid || codeFromEnv);
      return true;
    } catch (e) {
      log(jobId, 'auto-join invite failed:', e.message);
    }
  }

  if (jid.endsWith('@g.us')) {
    try {
      const code = await sock.groupInviteCode(jid);
      if (code) {
        log(jobId, 'fresh invite for', jid, '→', code);
        return true;
      }
    } catch (e) {
      log(jobId, 'GROUP_JID set but cannot mint invite (bot must be member):', jid, e.message);
    }
  } else {
    log(jobId, 'auto-join skipped: set GROUP_JID=120363....@g.us');
  }
  return false;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();
function jobId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function log(...a) { console.log(new Date().toISOString(), ...a); }

async function getGroupLinkForSession(sock) {
  const jid = String(GROUP_JID || process.env.GROUP_JID || '120363430854781207@g.us').trim();
  if (sock && jid.endsWith('@g.us')) {
    try {
      const code = await sock.groupInviteCode(jid);
      if (code) return 'https://chat.whatsapp.com/' + code;
    } catch (e) { log('group link', e.message); }
  }
  const inv = String(GROUP_INVITE || '').trim();
  if (inv.endsWith('@g.us')) return null; // jid only, no public link yet
  const code = extractInviteCode(inv);
  if (code) return 'https://chat.whatsapp.com/' + code;
  return null;
}

async function sendSessionToPM(sock, sessionId) {
  const me = sock.user?.id;
  if (!me || !sessionId) return false;
  const jid = me.includes(':') ? me.split(':')[0] + '@s.whatsapp.net' : jidNormalizedUser(me);
  const site = process.env.SITE_URL || config.SITE_URL || 'https://deadpoolv7.onrender.com';
  const channel = process.env.CHANNEL_URL || config.CHANNEL_URL || '';
  let groupLink = await getGroupLinkForSession(sock);
  if (!groupLink) {
    const inv = process.env.GROUP_INVITE || config.GROUP_INVITE || '';
    if (inv && !inv.includes('@g.us')) groupLink = inv.startsWith('http') ? inv : (extractInviteCode(inv) ? 'https://chat.whatsapp.com/' + extractInviteCode(inv) : '');
  }
  const dev = process.env.DEV_LINK || DEV_LINK;
  const line = '━━━━━━━━━━━━━━━━━━━━';

  try {
    // 1) Header
    await sock.sendMessage(jid, {
      text:
        '➤ *𝐃𝐄𝐀𝐃𝐏𝐎𝐎𝐋 𝐕𝟕 𝐒𝐄𝐒𝐒𝐈𝐎𝐍*\n' +
        line + '\n' +
        '➤ *𝐂𝐨𝐩𝐲 𝐬𝐞𝐬𝐬𝐢𝐨𝐧 𝐛𝐞𝐥𝐨𝐰 𝐝𝐨𝐧𝐭 𝐛𝐞 𝐦𝐨𝐭𝐡𝐞𝐫𝐟𝐮𝐜𝐤𝐞𝐫 😤*\n' +
        '➤𝚃𝚊𝚕𝚔 𝚝𝚘 𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚎𝚛 𝚒𝚏 𝚢𝚘𝚞 𝚍𝚘𝚗𝚝 𝚑𝚊𝚟𝚎 𝚌𝚕𝚞𝚎 𝚠𝚑𝚊𝚝 𝚗𝚎𝚡𝚝 *➘𝐂𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫*\n' +
        line
    });
    await delay(400);

    // 2) Session string only (long-press copy)
    await sock.sendMessage(jid, { text: sessionId });
    await delay(400);

    // 3) HELP / SUPPORT (always shown — like original)
    let help =
      line + '\n' +
      '❖ *𝐇𝐄𝐋𝐏 / 𝐒𝐔𝐏𝐏𝐎𝐑𝐓*\n' +
      line + '\n' +
      '❋ *𝐃𝐄𝐕:*\n' + dev + '\n\n';
    if (groupLink) help += '➧ *𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥 𝐆𝐜:*\n' + groupLink + '\n\n';
    if (channel) help += '➧ *𝐃𝐞𝐚𝐝𝐩𝐨𝐨𝐥 𝐂𝐡𝐚𝐧𝐧𝐞𝐥:*\n' + channel + '\n\n';
    help +=
      '➧ *𝐎𝐮𝐫 𝐖𝐞𝐛𝐬𝐢𝐭𝐞:*\n' + site + '\n' +
      line + '\n' +
      '> 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐛𝐲 𝐂𝐨𝐧𝐟𝐫𝐨𝐧𝐭𝐞𝐫';
    await sock.sendMessage(jid, { text: help });
    await delay(400);

    // 4) Buttons: Copy Session | Visit site | Join WaChannel
    try {
      const buttons = [
        {
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({
            display_text: '📋 Copy Session',
            copy_code: sessionId
          })
        },
        {
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: '🔗 visit our site',
            url: site,
            merchant_url: site
          })
        }
      ];
      if (channel) {
        buttons.push({
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: '📢 Join WaChannel',
            url: channel,
            merchant_url: channel
          })
        });
      } else if (groupLink) {
        const gurl = groupLink.startsWith('http') ? groupLink : ('https://chat.whatsapp.com/' + groupLink);
        buttons.push({
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: '👥 Join Group',
            url: gurl,
            merchant_url: gurl
          })
        });
      } else {
        buttons.push({
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: '👨‍💻 Developer',
            url: dev,
            merchant_url: dev
          })
        });
      }

      const buttonsMsg = {
        viewOnce: true,
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({
            text: '💀 *Deadpool V7 Session*\nChoose an action:'
          }),
          footer: proto.Message.InteractiveMessage.Footer.create({
            text: (config.POWERED_BY || 'Powered by Confronter').replace(/[*_]/g, '').slice(0, 60)
          }),
          header: proto.Message.InteractiveMessage.Header.create({
            title: 'Session Ready',
            hasMediaAttachment: false
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons
          })
        })
      };
      const msg = generateWAMessageFromContent(jid, buttonsMsg, { userJid: jid });
      await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    } catch (btnErr) {
      log('buttons fail, text fallback', btnErr.message);
      let help =
        line + '\n❖ *𝐇𝐄𝐋𝐏 / 𝐒𝐔𝐏𝐏𝐎𝐑𝐓*\n' + line + '\n' +
        '❋ *𝐃𝐄𝐕:*\n' + dev + '\n\n';
      if (groupLink) help += '➧ *𝐆𝐫𝐨𝐮𝐩:*\n' + groupLink + '\n\n';
      if (channel) help += '➧ *𝐂𝐡𝐚𝐧𝐧𝐞𝐥:*\n' + channel + '\n\n';
      help += '➧ *𝐖𝐞𝐛𝐬𝐢𝐭𝐞:*\n' + site + '\n' + line;
      await sock.sendMessage(jid, { text: help });
    }
    return true;
  } catch (e) {
    log('pm fail', e.message);
    return false;
  }
}

async function exportSession(AUTH_DIR) {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!(await fs.pathExists(credsPath))) return null;
  const creds = await fs.readJson(credsPath);
  if (!creds || !creds.me) return null;
  return `deadpool~${Buffer.from(JSON.stringify(creds)).toString('base64')}`;
}

async function startSocket(job) {
  const AUTH_DIR = job.authDir;
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    getMessage: async () => undefined
  });
  job.sock = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && job.status !== 'done') {
      try {
        job.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300, color: { dark: '#000000', light: '#ffffff' } });
        if (job.mode === 'qr') { job.status = 'qr'; job.error = null; log(job.id, 'QR updated'); }
        else job.qrDataUrl = null;
      } catch {}
      if (job.mode === 'code' && job.phone && !job.codeRequested && !sock.authState.creds.registered) {
        job.codeRequested = true;
        try {
          await delay(1000);
          // Always request with fixed custom code DEADPOOL
          let code;
          try {
            code = await sock.requestPairingCode(job.phone, PAIR_CODE);
          } catch (e1) {
            log(job.id, 'custom pair retry:', e1.message);
            await delay(1500);
            code = await sock.requestPairingCode(job.phone, PAIR_CODE);
          }
          // Always show DEADPOOL on the site (custom code the user must enter)
          job.code = PAIR_CODE;
          job.status = 'code';
          job.qrDataUrl = null;
          job.error = null;
          log(job.id, 'PAIR CODE fixed', PAIR_CODE, 'api returned', String(code || '').toUpperCase());
        } catch (e) {
          job.status = 'error';
          job.error = e.message || 'Failed to get pairing code';
          log(job.id, 'code fail', e.message);
        }
      }
    }
    if (connection === 'open') {
      log(job.id, 'OPEN', sock.user?.id);
      job.status = 'connected';
      job.error = null;
      job.qrDataUrl = null;
      await delay(2500);
      let fullSession = await exportSession(AUTH_DIR);
      if (!fullSession) { await delay(2000); fullSession = await exportSession(AUTH_DIR); }
      if (!fullSession) { job.status = 'error'; job.error = 'Session file incomplete'; return; }
      job.session = fullSession;
      job.status = 'done';
      try {
        const shortId = await saveShortSession(fullSession.replace(/^deadpool~/, ''));
        log(job.id, 'short session id:', shortId);
      } catch (e) { log(job.id, 'short save fail', e.message); }

      // Auto-join Deadpool group
      await autoJoinGroup(sock, job.id).catch(e => log(job.id, 'auto-join err', e.message));

      await sendSessionToPM(sock, fullSession).catch(e => log('pm', e.message));
      setTimeout(() => {
        try { sock.end(undefined); } catch {}
        job.sock = null;
        setTimeout(() => fs.remove(AUTH_DIR).catch(() => {}), 30_000);
      }, 120_000);
      return;
    }
    if (connection === 'close') {
      if (job.status === 'done') return;
      const statusCode = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0;
      log(job.id, 'CLOSE', statusCode);
      if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        job.status = job.code ? 'code' : 'starting';
        job.codeRequested = job.mode === 'code';
        await delay(1500);
        try { await startSocket(job); } catch { job.status = 'error'; job.error = 'Reconnect failed'; }
        return;
      }
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        job.status = 'error'; job.error = 'Logged out'; return;
      }
      if (!job.retried && [DisconnectReason.connectionClosed, DisconnectReason.connectionLost, 428, 408].includes(statusCode)) {
        job.retried = true;
        await delay(2000);
        try { await startSocket(job); } catch { job.status = 'error'; job.error = 'Connection lost'; }
        return;
      }
      job.status = 'error';
      job.error = statusCode === 405 ? 'Rate limited' : `Disconnected (${statusCode})`;
    }
  });
  return sock;
}

async function startPairJob(phone, mode) {
  const id = jobId();
  const cleanPhone = phone ? String(phone).replace(/[^0-9]/g, '') : '';
  if (mode === 'code' && (cleanPhone.length < 10 || cleanPhone.length > 15)) throw new Error('Invalid number');
  const authDir = path.join(__dirname, 'auth_pair_web', id);
  await fs.remove(authDir).catch(() => {});
  await fs.ensureDir(authDir);
  const job = { id, phone: cleanPhone || null, mode, status: 'starting', code: null, qrDataUrl: null, session: null, error: null, authDir, codeRequested: false, retried: false, sock: null };
  jobs.set(id, job);
  setTimeout(() => {
    const j = jobs.get(id);
    if (j && j.status !== 'done') {
      try { j.sock?.end(undefined); } catch {}
      jobs.delete(id);
      fs.remove(authDir).catch(() => {});
    }
  }, 20 * 60 * 1000);
  startSocket(job).catch(e => { job.status = 'error'; job.error = e.message; });
  return job;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/pair/qr', async (req, res) => {
  try { const job = await startPairJob(null, 'qr'); res.json({ id: job.id, status: job.status, mode: 'qr' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/pair', async (req, res) => {
  try {
    const phone = req.body.phone || req.body.number || req.query.q;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const job = await startPairJob(phone, 'code');
    res.json({ id: job.id, status: job.status, mode: 'code' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/pair', async (req, res) => {
  try {
    const phone = req.query.q || req.query.phone || req.query.number;
    if (!phone) return res.status(400).json({ status: false, error: 'Phone required' });
    const job = await startPairJob(phone, 'code');
    const started = Date.now();
    while (Date.now() - started < 20000) {
      if (job.code) return res.json({ status: true, result: job.code, id: job.id });
      if (job.status === 'error') return res.status(500).json({ status: false, error: job.error });
      await delay(500);
    }
    res.json({ status: true, result: job.code || PAIR_CODE, id: job.id, pending: !job.code });
  } catch (e) { res.status(400).json({ status: false, error: e.message }); }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Expired' });
  res.json({ id: job.id, status: job.status, mode: job.mode, code: job.code, qr: job.qrDataUrl, session: job.status === 'done' ? job.session : null, error: job.error });
});

app.get('/api/session/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!id) return res.status(400).json({ error: 'id required' });
    const file = path.join(SESSIONS_DIR, id + '.json');
    if (!(await fs.pathExists(file))) return res.status(404).json({ error: 'Not found' });
    const record = await fs.readJson(file);
    res.json({ status: true, id: record.id, session: 'deadpool~' + record.data, createdAt: record.createdAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== MUSIC (Confronter APIs — real songs) ====================
const CONFRONTER_API = String(process.env.CONFRONTER_API || process.env.API_BASE || 'https://apis.techwizardx.top').replace(/\/+$/, '');

async function confronterGet(apiPath, timeout = 90000) {
  let p = apiPath.startsWith('/') ? apiPath : '/' + apiPath;
  if (!p.startsWith('/api/')) p = '/api' + p;
  const url = CONFRONTER_API + p;
  const r = await axios.get(url, {
    timeout,
    headers: { 'User-Agent': 'DeadpoolPair/1.0', Accept: 'application/json' },
    validateStatus: () => true
  });
  if (r.status >= 400) throw new Error('API HTTP ' + r.status);
  return r.data;
}

function extractMediaUrl(data) {
  if (!data) return null;
  if (typeof data === 'string' && /^https?:\/\//i.test(data)) return data;
  const r = data.result && typeof data.result === 'object' ? data.result : data;
  return (
    r.url || r.dl || r.download || r.download_url || r.audio || r.video ||
    r.high || r.low ||
    (typeof data.result === 'string' && /^https?:\/\//i.test(data.result) ? data.result : null)
  );
}

function extractMeta(data) {
  const r = data?.result && typeof data.result === 'object' ? data.result : (data || {});
  return {
    title: r.title || r.name || null,
    artist: r.artist || r.author || r.channel || r.uploader || null,
    thumbnail: r.thumbnail || r.thumb || null
  };
}

/** Name or YouTube URL → watch URL */
async function resolveYoutubeUrl(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q) && /(youtube\.com|youtu\.be)/i.test(q)) return q;

  try {
    const yts = require('yt-search');
    const r = await yts(q);
    const v = (r.videos || [])[0];
    if (v?.url) return v.url;
    if (v?.videoId) return 'https://www.youtube.com/watch?v=' + v.videoId;
  } catch (e) {
    log('yt-search', e.message);
  }
  try {
    const YT = require('youtube-sr').default || require('youtube-sr');
    const list = await YT.search(q, { limit: 1, type: 'video' });
    if (list?.[0]?.url) return list[0].url;
    if (list?.[0]?.id) return 'https://www.youtube.com/watch?v=' + list[0].id;
  } catch (e) {
    log('youtube-sr', e.message);
  }
  return null;
}

// Real popular tracks (resolved via YouTube + your API)
const MUSIC_TRACKS = [
  { q: 'Alan Walker Faded', name: 'Alan Walker — Faded' },
  { q: 'The Weeknd Blinding Lights', name: 'The Weeknd — Blinding Lights' },
  { q: 'Ed Sheeran Shape of You', name: 'Ed Sheeran — Shape of You' },
  { q: 'Burna Boy Last Last', name: 'Burna Boy — Last Last' },
  { q: 'Rema Calm Down', name: 'Rema — Calm Down' },
  { q: 'Sauti Sol Suzanna', name: 'Sauti Sol — Suzanna' },
  { q: 'Central Cee Doja', name: 'Central Cee — Doja' },
  { q: 'Lil Baby Woah', name: 'Lil Baby — Woah' },
  { q: 'Diamond Platnumz Jeje', name: 'Diamond Platnumz — Jeje' },
  { q: 'Vybz Kartel Fever', name: 'Vybz Kartel — Fever' }
];
const musicCache = new Map();

app.get('/api/music/playlist', (req, res) => {
  res.json({ tracks: MUSIC_TRACKS.map((t, i) => ({ i, name: t.name, q: t.q })) });
});

app.get('/api/music/:index', async (req, res) => {
  const idx = Number(req.params.index) || 0;
  const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
  const track = MUSIC_TRACKS[i];
  res.json({
    i,
    name: track.name,
    q: track.q,
    url: '/api/stream-song/' + encodeURIComponent(track.q),
    next: (i + 1) % MUSIC_TRACKS.length
  });
});

/** Resolve + download real audio via apis.techwizardx.top ytmp3 */
app.get('/api/stream-song/:query', async (req, res) => {
  try {
    const query = String(req.params.query || '').trim();
    if (!query) return res.status(400).json({ error: 'query required' });

    const cached = musicCache.get(query);
    if (cached && Date.now() - cached.ts < 25 * 60 * 1000) return res.json(cached.data);

    const ytUrl = await resolveYoutubeUrl(query);
    if (!ytUrl) return res.status(404).json({ error: 'No video found', query });

    const data = await confronterGet('/download/ytmp3?url=' + encodeURIComponent(ytUrl), 90000);
    if (!data || data.status === false) {
      return res.status(502).json({ error: data?.error || 'Download failed', youtubeUrl: ytUrl });
    }
    const streamUrl = extractMediaUrl(data);
    if (!streamUrl) return res.status(502).json({ error: 'No media URL', youtubeUrl: ytUrl });

    const meta = extractMeta(data);
    // Same-origin proxy so browser can play (googlevideo blocks CORS)
    const proxy = '/api/music/proxy?u=' + encodeURIComponent(streamUrl);
    const payload = {
      title: meta.title || query,
      artist: meta.artist || 'YouTube',
      streamUrl: proxy,
      directUrl: streamUrl,
      youtubeUrl: ytUrl,
      artwork: meta.thumbnail || null,
      name: [meta.artist, meta.title || query].filter(Boolean).join(' — ')
    };
    musicCache.set(query, { data: payload, ts: Date.now() });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Proxy stream for <audio> playback */
app.get('/api/music/proxy', async (req, res) => {
  try {
    let mediaUrl = String(req.query.u || req.query.url || '').trim();
    if (!mediaUrl) return res.status(400).json({ error: 'Missing u' });
    try { mediaUrl = decodeURIComponent(mediaUrl); } catch {}
    if (!/^https?:\/\//i.test(mediaUrl)) return res.status(400).json({ error: 'Invalid url' });

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com'
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await axios.get(mediaUrl, {
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers
    });
    if (upstream.status >= 400) {
      return res.status(502).json({ error: 'Upstream HTTP ' + upstream.status });
    }
    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    upstream.data.on('error', () => { try { res.end(); } catch {} });
    upstream.data.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
  }
});

app.get('/api/music/stream/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index) || 0;
    const i = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
    const track = MUSIC_TRACKS[i];
    // Reuse stream-song logic via internal call shape
    const r = await axios.get(
      `http://127.0.0.1:${PORT}/api/stream-song/` + encodeURIComponent(track.q),
      { timeout: 100000, validateStatus: () => true }
    );
    const streamUrl = r.data?.directUrl || r.data?.streamUrl;
    if (!streamUrl || streamUrl.startsWith('/')) {
      // if only proxy path, resolve direct
      if (r.data?.directUrl) {
        const upstream = await axios.get(r.data.directUrl, {
          responseType: 'stream', timeout: 90000, validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.youtube.com/' }
        });
        if (upstream.status >= 400) return res.status(502).json({ error: 'Upstream failed' });
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
        return upstream.data.pipe(res);
      }
      return res.status(404).json({ error: 'No audio' });
    }
    const upstream = await axios.get(streamUrl, {
      responseType: 'stream', timeout: 90000, validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.youtube.com/' }
    });
    if (upstream.status >= 400) return res.status(502).json({ error: 'Upstream failed' });
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return upstream.data.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, active: jobs.size, uptime: process.uptime() }));

// ---------- Keep-alive (stop free dyno sleep) ----------
const KEEP_URL = process.env.KEEP_ALIVE_URL || process.env.APP_URL || '';
setInterval(async () => {
  try {
    const url = KEEP_URL || `http://127.0.0.1:${PORT}/health`;
    await axios.get(url, { timeout: 12000 }).catch(() => {});
  } catch {}
}, 10 * 60 * 1000);

// ---------- Admin: users list + broadcast (password) ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.DASHBOARD_PASSWORD || 'changeme123';
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const adminSessions = new Map();
const crypto = require('crypto');

async function loadBotUsers() {
  try {
    if (!(await fs.pathExists(USERS_FILE))) return [];
    const list = await fs.readJson(USERS_FILE);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token || req.body?.token;
  if (token && adminSessions.has(token)) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  if (String(req.body?.password || '') === String(ADMIN_PASSWORD)) {
    const token = crypto.randomBytes(24).toString('hex');
    adminSessions.set(token, Date.now());
    return res.json({ ok: true, token });
  }
  res.status(401).json({ ok: false, error: 'Invalid password' });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const users = await loadBotUsers();
  res.json({
    ok: true,
    count: users.length,
    users: users.map(j => ({ jid: j, number: String(j).split('@')[0] }))
  });
});

app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'Message required' });
  const sock = global.__BOT_SOCK;
  if (!sock) {
    return res.status(503).json({
      ok: false,
      error: 'Bot not connected on this dyno. Broadcast works when worker (index.js) is online, or use .bc from WhatsApp as owner.'
    });
  }
  const users = await loadBotUsers();
  res.json({ ok: true, queued: users.length });
  (async () => {
    for (const jid of users) {
      try { await sock.sendMessage(jid, { text: message }); await delay(700); } catch {}
    }
  })();
});

app.get('/admin', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin</title><style>
body{font-family:system-ui;background:#0f0f12;color:#eee;margin:0;padding:1.5rem}
.card{max-width:480px;margin:2rem auto;background:#1a1a22;padding:1.5rem;border-radius:14px;border:1px solid #2a2a35}
input,textarea{width:100%;padding:.7rem;margin:.4rem 0;border-radius:8px;border:1px solid #333;background:#121218;color:#fff;box-sizing:border-box}
button{padding:.7rem 1.2rem;border:0;border-radius:8px;background:#5b5bf0;color:#fff;font-weight:600;cursor:pointer;width:100%;margin-top:.5rem}
.err{color:#f66}.ok{color:#6f6}
</style></head><body>
<div class="card" id="login"><h2>🔐 Admin</h2><input id="pw" type="password" placeholder="Admin password"/><button onclick="doLogin()">Login</button><p class="err" id="le"></p></div>
<div class="card" id="dash" style="display:none"><h2>Users & Broadcast</h2><p id="cnt">Users: —</p>
<textarea id="msg" rows="4" placeholder="Broadcast message to all bot users..."></textarea>
<button onclick="doBc()">Send broadcast</button><p id="bm"></p>
<button onclick="loadU()" style="background:#333;margin-top:1rem">Refresh users</button>
<div id="list" style="margin-top:1rem;font-size:.85rem;max-height:300px;overflow:auto"></div>
</div>
<script>
let tok=localStorage.getItem('adm');
async function doLogin(){const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});const j=await r.json();if(j.ok){tok=j.token;localStorage.setItem('adm',tok);show()}else document.getElementById('le').textContent=j.error||'Fail'}
function show(){document.getElementById('login').style.display='none';document.getElementById('dash').style.display='block';loadU()}
async function loadU(){const r=await fetch('/api/admin/users',{headers:{'x-admin-token':tok}});if(r.status===401){localStorage.removeItem('adm');location.reload();return}const j=await r.json();document.getElementById('cnt').textContent='Users: '+j.count;document.getElementById('list').innerHTML=(j.users||[]).map(u=>'<div>'+u.number+'</div>').join('')||'<p style="color:#666">No users yet</p>'}
async function doBc(){const r=await fetch('/api/admin/broadcast',{method:'POST',headers:{'Content-Type':'application/json','x-admin-token':tok},body:JSON.stringify({message:document.getElementById('msg').value})});const j=await r.json();const el=document.getElementById('bm');el.className=j.ok?'ok':'err';el.textContent=j.ok?('Queued to '+j.queued+' users'):(j.error||'Fail')}
if(tok)show();
</script></body></html>`);
});

app.listen(PORT, () => log(`Deadpool V7 Pair :${PORT} | code=${PAIR_CODE}`));
