const ORIGIN = 'https://gardeliss.github.io';
const REPO = 'https://api.github.com/repos/gardeliss/themidos/contents/';
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function unbase64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
const url64 = bytes => base64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromUrl64 = text => unbase64(text.replace(/-/g, '+').replace(/_/g, '/'));
async function sessionKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
async function issueSession(env) {
  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const payload = url64(encoder.encode(JSON.stringify({exp: expiresAt, nonce: crypto.randomUUID()})));
  const signature = url64(new Uint8Array(await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(payload))));
  return {session: payload + '.' + signature, expiresAt};
}
async function authorize(request, env) {
  try {
    const token = request.headers.get('Authorization') || '';
    if (!token.startsWith('Bearer ') || token.length > 1024) throw Error();
    const parts = token.slice(7).split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await sessionKey(env), fromUrl64(parts[1]), encoder.encode(parts[0]))) throw Error();
    const payload = JSON.parse(new TextDecoder().decode(fromUrl64(parts[0])));
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now() || payload.exp > Date.now() + SESSION_SECONDS * 1000 + 60000) throw Error();
  } catch { fail(401, 'Η σύνδεση έληξε. Συνδεθείτε ξανά με τον κωδικό σας.'); }
}
async function passwordMatches(input, expected) {
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function bodyBytes(request, maximum) {
  if (Number(request.headers.get('Content-Length')) > maximum) fail(413, 'Το αρχείο ή τα στοιχεία είναι πολύ μεγάλα.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Λείπουν τα στοιχεία.');
  const chunks = []; let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) { await reader.cancel(); fail(413, 'Το αρχείο ή τα στοιχεία είναι πολύ μεγάλα.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function jsonBody(request, maximum = 256 * 1024) {
  const bytes = await bodyBytes(request, maximum);
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { fail(400, 'Τα στοιχεία δεν είναι έγκυρα.'); }
}
function validateData(data) {
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const str = (x, max, required = false) => typeof x === 'string' && x.length <= max && (!required || x.trim().length > 0);
  const optional = (x, max) => x === undefined || str(x, max);
  const safeUrl = x => str(x, 2000) && (!x || /^https:\/\/[^\s<>]+$/i.test(x) || /^(?!\/\/)(?![a-z][a-z0-9+.-]*:)[^\\<>\s]+$/i.test(x));
  const date = x => /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x)) && new Date(x + 'T12:00:00Z').toISOString().slice(0, 10) === x;
  const list = (key, test) => Array.isArray(data[key]) && data[key].length <= 500 && data[key].every(x => object(x) && test(x));
  if (!object(data) || !str(data.name, 80, true) || !str(data.subtitle, 160) || !safeUrl(data.image) || !str(data.imageCaption, 200) ||
      !list('events', x => str(x.title, 120, true) && str(x.date, 10, true) && date(x.date) && optional(x.description, 250) && (x.time === undefined || x.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))) ||
      !list('contacts', x => str(x.name, 80, true) && str(x.type, 80, true) && [x.landline, x.mobile, x.phone].every(v => v === undefined || v === '' || typeof v === 'string' && /^[+0-9 ()-]{3,30}$/.test(v)) && !!(x.landline || x.mobile || x.phone)) ||
      !list('notices', x => str(x.title, 120, true) && str(x.body, 2000, true)) ||
      !list('documents', x => str(x.title, 120, true) && optional(x.category, 80) && !!x.url && safeUrl(x.url))) fail(422, 'Ελέγξτε τα πεδία και τα μήκη των στοιχείων.');
}
async function github(env, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(REPO + path, {...options, signal: controller.signal, headers: {
      Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      'User-Agent': 'themidos-admin', 'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? {'Content-Type': 'application/json'} : {})
    }});
  } catch { fail(502, 'Δεν απάντησε το GitHub. Ανανεώστε τα στοιχεία πριν δοκιμάσετε ξανά.'); }
  finally { clearTimeout(timer); }
  if (!response.ok) {
    if (response.status === 409) fail(409, 'Έγινε άλλη αλλαγή. Ανανεώστε τα κοινά στοιχεία πριν αποθηκεύσετε.');
    if (response.status === 401 || response.status === 403) fail(503, 'Το κλειδί GitHub της υπηρεσίας χρειάζεται έλεγχο: λήξη και Contents: Read and write.');
    fail(502, 'Το GitHub δεν ολοκλήρωσε την ενέργεια. Ανανεώστε και δοκιμάστε ξανά.');
  }
  return response.json();
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'};
    if (origin === ORIGIN) headers['Access-Control-Allow-Origin'] = ORIGIN;
    const reply = (value, status = 200) => new Response(JSON.stringify(value), {status, headers});
    try {
      if (origin && origin !== ORIGIN) fail(403, 'Η πρόσβαση δεν επιτρέπεται από αυτή τη σελίδα.');
      if (request.method === 'OPTIONS') {
        if (origin !== ORIGIN) fail(403, 'Η πρόσβαση δεν επιτρέπεται.');
        return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Filename', 'Access-Control-Max-Age': '600'}});
      }
      const configured = typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= 16 && env.ADMIN_PASSWORD.length <= 256 &&
        typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32 && !!env.GITHUB_TOKEN && !!env.LOGIN_LIMITER;
      const path = new URL(request.url).pathname;
      if (path === '/' && request.method === 'GET') return reply({service: 'ΘΕΜΙΔΟΣ 18-20', ready: !!configured});
      if (!configured) fail(503, 'Η υπηρεσία χρειάζεται την αρχική ρύθμιση στο Cloudflare.');
      if (request.method !== 'GET' && origin !== ORIGIN) fail(403, 'Η πρόσβαση δεν επιτρέπεται.');
      if (path === '/login' && request.method === 'POST') {
        const {success} = await env.LOGIN_LIMITER.limit({key: 'login:' + (request.headers.get('CF-Connecting-IP') || 'unknown')});
        if (!success) fail(429, 'Πολλές προσπάθειες σύνδεσης. Περιμένετε ένα λεπτό.');
        const {password} = await jsonBody(request, 2048);
        if (typeof password !== 'string' || password.length > 256 || !await passwordMatches(password, env.ADMIN_PASSWORD)) fail(401, 'Ο κωδικός δεν είναι σωστός.');
        return reply(await issueSession(env));
      }
      if (path === '/data' && request.method === 'GET') {
        const file = await github(env, 'data.json?ref=main&t=' + Date.now());
        const data = JSON.parse(new TextDecoder().decode(unbase64(file.content.replace(/\s/g, ''))));
        return reply({data, sha: file.sha});
      }
      if (path === '/data' && request.method === 'PUT') {
        await authorize(request, env);
        const {data, sha} = await jsonBody(request);
        if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) fail(400, 'Ανανεώστε τα κοινά στοιχεία πριν αποθηκεύσετε.');
        validateData(data);
        const result = await github(env, 'data.json', {method: 'PUT', body: JSON.stringify({
          message: 'Update building information', branch: 'main', sha,
          content: base64(encoder.encode(JSON.stringify(data, null, 2) + '\n'))
        })});
        return reply({sha: result.content.sha});
      }
      if (path === '/upload' && request.method === 'POST') {
        await authorize(request, env);
        let filename;
        try { filename = decodeURIComponent(request.headers.get('X-Filename') || ''); } catch { fail(400, 'Μη έγκυρο όνομα αρχείου.'); }
        if (filename.length > 200 || !/\.(pdf|png|jpe?g|docx|xlsx|txt)$/i.test(filename)) fail(422, 'Επιλέξτε PDF, εικόνα, DOCX, XLSX ή TXT.');
        const bytes = await bodyBytes(request, 1024 * 1024);
        if (!bytes.length) fail(422, 'Το αρχείο είναι κενό.');
        const path = 'documents/' + crypto.randomUUID() + '-' + filename.replace(/[^A-Za-z0-9._-]/g, '_');
        await github(env, path, {method: 'PUT', body: JSON.stringify({message: 'Add building document', branch: 'main', content: base64(bytes)})});
        return reply({path}, 201);
      }
      fail(404, 'Η διεύθυνση δεν βρέθηκε.');
    } catch (error) {
      return reply({error: error instanceof HttpError ? error.message : 'Η υπηρεσία δεν ολοκλήρωσε την ενέργεια. Δοκιμάστε ξανά.'}, error instanceof HttpError ? error.status : 500);
    }
  }
};
