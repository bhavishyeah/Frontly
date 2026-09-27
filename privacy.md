# Privacy Policy for Frontly

**Last updated:** September 21, 2026

Frontly is a browser extension that replaces your new tab page with a customizable homepage for bookmarks, notes, tasks, and widgets. This policy explains what data the extension collects, how it is stored, and when it leaves your device.

---

## 1. Data We Collect and Store

### Stored Locally on Your Device

All core extension data is stored on your device using `chrome.storage.local`, `localStorage`, and IndexedDB. This includes:

- **Workspaces and boards** — names, layout, display settings
- **Link cards** — titles and URLs you save
- **Notes** — text content of your note boards
- **Todos** — task text, completion status, and optional due dates
- **App settings** — font, colors, opacity, search engine preference, and other visual customizations
- **Wallpapers** — image wallpapers are stored as data-URLs in `chrome.storage.local`; video wallpapers are stored as raw blobs in IndexedDB
- **Backups** — a rolling two-snapshot local backup of your workspace data is kept automatically for recovery purposes. Video wallpapers are excluded from backups.

None of this data is sold, shared with advertisers, or transmitted to us.

---

## 2. Data Synced Across Devices (via Chrome Sync)

If you are signed into a Google account in Chrome, the following data is synced across your devices using `chrome.storage.sync` (Google's own sync infrastructure):

- **App settings** — synced automatically whenever you change a setting
- **Workspaces and boards** — synced only if you explicitly enable "Sync boards across devices" in settings (off by default). Image and video wallpapers are excluded from sync.

This sync is handled entirely by Chrome's built-in infrastructure. We do not have access to your synced data.

---

## 3. External Network Requests

The extension makes outbound network requests only for specific features:

### Weather Widget
When the weather widget is active, your **geographic coordinates** (either from your browser's geolocation API or a manually configured location) are sent to [open-meteo.com](https://open-meteo.com) to fetch weather data. No API key or personal identifier is sent. Open-Meteo is a free, open-source weather service.

### Favicons
When you save links, the extension fetches favicon icons using **Google's Favicon Service** (`https://www.google.com/s2/favicons`). The domain of each link URL is sent to Google to retrieve the icon image.

### RSS Widget
If you configure an RSS widget, the extension fetches the RSS feed directly from the URL you provide. The request goes from your browser to that feed's server. No personal data is included in the request.

### Calendar Widget (optional)
If you use the Calendar widget and connect Google Calendar, the extension requests read-only access to your Google Calendar events using your Chrome Google account via `chrome.identity.getAuthToken`. A read-only OAuth token is obtained and used solely to fetch your calendar events for display. No calendar data is stored, modified, or shared — it is fetched on load and displayed in the widget only. You can disconnect Google Calendar at any time from the widget's settings, which revokes the token.

### VOLT Widget (optional)
If you use the VOLT widget and sign in with your VOLT credentials, the extension connects to VOLT's backend (hosted on Supabase) to display your incoming transfers. Your VOLT email and password are sent only to authenticate.

To keep you signed in across new tabs and extension reloads, your VOLT session tokens (access and refresh tokens) are stored on your device in `chrome.storage.local`. These tokens stay on your device, are refreshed automatically, and are removed when you sign out of the VOLT widget. Your password is never stored — only the session tokens issued after login.

---

## 4. Permissions Used

The extension requests the following browser permissions:

| Permission | Why it's needed |
|---|---|
| `storage` / `unlimitedStorage` | Save your boards, notes, todos, settings, and wallpapers locally |
| `tabs` / `activeTab` | Read the current tab's URL and title for the quick-save shortcut (Ctrl+Shift+Z) |
| `bookmarks` | Import your Chrome bookmarks into boards |
| `notifications` | Show a notification after quick-saving a tab |
| `identity` / `identity.email` | Detect if a Chrome account is signed in for cross-device sync, and authenticate with Google Calendar (read-only) if the Calendar widget is connected |
| `contextMenus` | Add a "Send to VOLT ⚡" right-click menu item so you can send any page, link, or selected text to a VOLT contact directly from any webpage |
| `host_permissions: <all_urls>` | Allow the RSS widget to fetch user-supplied feed URLs, which would otherwise be blocked by browser security policies |

---

## 5. No Analytics or Tracking

Frontly does **not** use any analytics, telemetry, tracking pixels, crash reporters, or third-party advertising services. No usage data is collected or transmitted to us.

---

## 6. Data Retention and Deletion

All locally stored data (boards, notes, todos, settings, wallpapers, backups, and VOLT session tokens) can be cleared at any time by removing the extension from Chrome. This permanently deletes all associated `chrome.storage.local`, `localStorage`, and IndexedDB data on your device. VOLT session tokens are also removed when you sign out of the VOLT widget.

Synced data in `chrome.storage.sync` is managed by Google and is cleared when you remove the extension or sign out of Chrome Sync.

---

## 7. Children's Privacy

Frontly is not directed at children under 13 and does not knowingly collect personal information from children.

---

## 8. Changes to This Policy

If we make material changes to this policy, we will update the "Last updated" date above. Continued use of the extension after changes are posted constitutes your acceptance of the updated policy.

---

## 9. Contact

If you have questions about this privacy policy, please open an issue at:
[https://github.com/bhavishyeah/Frontly/issues](https://github.com/bhavishyeah/Frontly/issues)
