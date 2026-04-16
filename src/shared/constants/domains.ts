export const HOST_MATCH_PATTERNS = [
  '*://*.marktplaats.nl/*',
  '*://*.2dehands.be/*',
  '*://*.2ememain.be/*',
] as const;

export const HASH_URL_PATTERNS = [
  'https://www.marktplaats.nl/l/',
  'https://www.marktplaats.nl/q/',
  'https://www.2dehands.be/l/',
  'https://www.2dehands.be/q/',
  'https://www.2ememain.be/l/',
  'https://www.2ememain.be/q/',
] as const;

export const API_URL_PATTERNS = [
  'https://www.marktplaats.nl/lrp/api/search*',
  'https://www.2dehands.be/lrp/api/search*',
  'https://www.2ememain.be/lrp/api/search*',
] as const;

export const API_RULE_ID = 1;

export const WAKEUP_NAVIGATION_FILTERS = [
  { hostSuffix: 'marktplaats.nl' },
  { hostSuffix: '2dehands.be' },
  { hostSuffix: '2ememain.be' },
] as const;
