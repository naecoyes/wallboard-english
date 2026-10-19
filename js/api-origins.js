// Credentials are bound to a service's exact HTTPS endpoint. Synced settings cannot redirect them.
const ENDPOINTS = {
  mimo: 'https://api.xiaomimimo.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};
export function approvedEndpoint(provider, candidate) {
  const expected = ENDPOINTS[provider];
  if (!expected) throw new Error('Unknown API provider');
  const value = String(candidate || expected).replace(/\/$/, '');
  if (value !== expected) throw new Error(`Unapproved ${provider} API endpoint`);
  return expected;
}
