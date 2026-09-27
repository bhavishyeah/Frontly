import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,

  name: 'Frontly',
  short_name: 'Frontly',

  description:
  'Replace every new tab with a beautiful, customizable homepage for bookmarks, notes, tasks, and widgets.',
  
  version: '2.1.1',

  chrome_url_overrides: {
    newtab: 'index.html',
  },

  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },

  action: {
    default_title: 'Open Frontly',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },

  permissions: [
    'storage',
    'unlimitedStorage',
    'activeTab',
    'tabs',
    'bookmarks',
    'notifications',
    'identity',
    'contextMenus',
  ],

  // Needed so the RSS widget can fetch arbitrary user-supplied feed URLs
  // (which are otherwise blocked by CORS from the extension page).
  host_permissions: ['<all_urls>'],

  // Google Calendar (read-only) for the Calendar widget, via
  // chrome.identity.getAuthToken. Replace client_id with YOUR OAuth 2.0
  // Chrome-extension client ID from Google Cloud Console (see setup guide).
  // Until this is set to a real client ID, the "Connect Google Calendar"
  // button will fail gracefully and local events still work.
  oauth2: {
    client_id: '632016796250-otrg5amg8rp3usnoot19pnor94fjc8qc.apps.googleusercontent.com',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },

  commands: {
    'quick-save-tab': {
      suggested_key: {
        default: 'Ctrl+Shift+Z',
        mac: 'Command+Shift+Z',
      },
      description: 'Save current tab to Frontly',
    },
  },
})