// config.js — fill in your details here (or use Heroku / Railway / etc Config Vars)
module.exports = {
  BOT_NAME: 'Deadpool V7',
  PREFIX: '.',
  OWNER_NUMBER: '2547XXXXXXXX',      // <-- your number, digits only with country code (e.g. 254712345678)
  DEVELOPERS: ['254796283064'],                    // optional extra owner numbers: ['2547XXXX', '2557XXXX']
  MODE: 'public',                    // 'public' or 'private'
  SESSION: '',                       // base64 creds (paste here OR use env SESSION / SESSION_ID)
  POWERED_BY: '> Powered by Confronter',
  FONT: 'random',                    // random | normal | sans | bold | italic | double | script | tiny | off

  // Auto features
  AUTO_VIEW_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_REACT: false,
  AUTO_READ: false,
  ALWAYS_ONLINE: false,
  CHATBOT: false,

  // Anti features (off | dm | chat)
  ANTI_DELETE: 'dm',
  ANTI_EDIT: 'dm',
  ANTI_VIEW_ONCE: 'false',
  ANTI_CALL: true,
  ANTI_CALL_MSG: 'Calls are not allowed right now. Please text instead.',
  ANTILINK: false,
  ANTITOXIC: false,
  ANTIBUG: false,

  // Group
  WELCOME: true,
  GOODBYE: true,
  WELCOME_MSG: '♻𝐖𝐞𝐥𝐜𝐨𝐦𝐞 @user to *@group* 𝐓𝐡𝐢𝐬 𝐢𝐬 𝐧𝐨𝐭 𝐭𝐨𝐢𝐥𝐞𝐭 𝐨𝐫 𝐝𝐮𝐦𝐩𝐢𝐧𝐠 𝐬𝐢𝐭𝐞 𝐫𝐞𝐚𝐝 𝐠𝐫𝐨𝐮𝐩 𝐫𝐮𝐥𝐞𝐬 𝐚𝐧𝐝 𝐨𝐛𝐞𝐲 𝐧𝐨𝐛𝐨𝐝𝐲 𝐜𝐚𝐫𝐞𝐬 𝐰𝐡𝐨 𝐲𝐨𝐮 𝐚𝐫𝐞!',
  GOODBYE_MSG: '⚗ 𝐆𝐨𝐨𝐝𝐛𝐲𝐞 @user from *@group* 𝐖𝐞 𝐜𝐚𝐧𝐭 𝐦𝐢𝐬𝐬 𝐲𝐨𝐮 𝐠𝐨 𝐫𝐨𝐭 𝐭𝐨 𝐡𝐞𝐥𝐥 𝐰𝐞 𝐝𝐨𝐧𝐭 𝐧𝐞𝐞𝐝 𝐬𝐧𝐢𝐭𝐜𝐡𝐞𝐬 𝐡𝐞𝐫𝐞!.',
  PRESENCE: 'unavailable',           // unavailable | available | composing | recording

  // Media / links
  MENU_MEDIA: '',                    // optional image/gif/video URL for .menu
  GROUP_INVITE: 'CdNXFhb1Wqp7fqJsA42UuE',                  // optional auto-join group invite code or full link
  CHANNEL_ID: '',                    // optional newsletter/channel id

  // Pterodactyl panel (optional)
  PANEL_DOMAIN: '',                  // e.g. https://panel.yoursite.com
  PANEL_APIKEY: '',
  PANEL_CLIENT_APIKEY: '',
  PANEL_EGG: '15',
  PANEL_LOCATION: '1',

  // Expiry (optional)
  BOT_EXPIRY_DATE: '',               // e.g. '2026-12-31'
  BOT_EXPIRY_DAYS: 0,                // or days from activation
  EXPIRY_MSG: '⛔ Bot has expired. Contact the owner.'
};
