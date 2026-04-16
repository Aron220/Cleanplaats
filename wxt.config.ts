import { defineConfig } from 'wxt';

const HOST_MATCH_PATTERNS = [
  '*://*.marktplaats.nl/*',
  '*://*.2dehands.be/*',
  '*://*.2ememain.be/*',
];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'Cleanplaats - Marktplaats zonder spam',
    version: '2.0.7',
    description: 'Zelf in de hand wat je wel én niet wil zien op Marktplaats door te filteren',
    permissions: [
      'storage',
      'scripting',
      'tabs',
      'webNavigation',
      'declarativeNetRequest',
      'alarms',
    ],
    host_permissions: HOST_MATCH_PATTERNS,
    action: {
      default_title: 'Cleanplaats',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    web_accessible_resources: [
      {
        resources: ['icons/*', 'dark-mode.css'],
        matches: HOST_MATCH_PATTERNS,
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'cleanplaats@cleanplaats.dev',
        strict_min_version: '121.0',
      },
      gecko_android: {
        strict_min_version: '121.0',
      },
    },
  },
});
