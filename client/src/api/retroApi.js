// Small fetch-based client for the SurfArr server (replaces axios).
// In dev: Vite proxy forwards /api/* to localhost:8888
// In production: same origin (React is served by Express)
// Same shape as before: retroApi.get/post/put/patch/delete resolve to { data, status }
// and reject with an Error carrying err.response = { status, data }.
const BASE = '/api';
const TIMEOUT_MS = 10_000;

// Admin key (only needed when the server sets ADMIN_TOKEN). Stored per
// browser; sent on every API call so settings/plugins/channel edits work.
export const ADMIN_KEY_STORAGE = 'retroarr.adminKey';
export function getAdminKey() {
  try { return localStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch { return ''; }
}
export function setAdminKey(key) {
  try { key ? localStorage.setItem(ADMIN_KEY_STORAGE, key) : localStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* private mode */ }
}

async function request(method, path, { params, body } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = BASE + path + (qs.toString() ? `?${qs}` : '');
  const headers = { Accept: 'application/json' };
  const key = getAdminKey();
  if (key) headers['X-Admin-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? 'The SurfArr server took too long to answer.' : 'Network error');
  }

  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!res.ok) {
    // Turn the server's admin refusals into readable errors
    let message = (data && typeof data === 'object' && data.error) || `Request failed with status code ${res.status}`;
    if (data?.code === 'ADMIN_KEY') message = 'Admin key required — add it under Settings → Access.';
    const err = new Error(message);
    err.response = { status: res.status, data };
    throw err;
  }
  return { data, status: res.status };
}

const retroApi = {
  get: (path, opts = {}) => request('GET', path, { params: opts.params }),
  delete: (path, opts = {}) => request('DELETE', path, { params: opts.params }),
  post: (path, body, opts = {}) => request('POST', path, { body, params: opts.params }),
  put: (path, body, opts = {}) => request('PUT', path, { body, params: opts.params }),
  patch: (path, body, opts = {}) => request('PATCH', path, { body, params: opts.params }),
};

export default retroApi;
