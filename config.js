// config.js — fill in your details here (or use Heroku / Railway / etc Config Vars)
module.exports = {
  BOT_NAME: 'Deadpool V7',
  PREFIX: '.',
  OWNER_NUMBER: '2547XXXXXXXX',      // <-- your number, digits only with country code (e.g. 254712345678)
  DEVELOPERS: ['254796283064'],                    // optional extra owner numbers: ['2547XXXX', '2557XXXX']
  MODE: 'public',                    // 'public' or 'private'
  SESSION: '',                       // base64 creds (paste here OR use env SESSION / SESSION_ID)
  POWERED_BY: 'Powered by Confronter',
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
  ANTI_VIEW_ONCE: 'dm',
  ANTI_CALL: true,
  ANTI_CALL_MSG: 'Calls are not allowed right now. Please text instead.',
  ANTILINK: false,
  ANTITOXIC: false,
  ANTIBUG: false,

  // Group
  WELCOME: true,
  GOODBYE: true,
  WELCOME_MSG: 'Welcome @user to *@group*!',
  GOODBYE_MSG: 'Goodbye @user from *@group*.',
  PRESENCE: 'unavailable',           // unavailable | available | composing | recording

  // Media / links
  MENU_MEDIA: '',                    // optional image/gif/video URL for .menu
  GROUP_INVITE: '120363430854781207@g.us',                  // optional auto-join group invite code or full link
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
