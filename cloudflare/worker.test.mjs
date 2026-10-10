import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from './worker.mjs';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', {value:webcrypto});
const ORIGIN = 'https://gardeliss.github.io';
const password = 'test-password-ONLY-12345';
const env = {ADMIN_PASSWORD: password, SESSION_SECRET: 'test-only-session-secret-with-at-least-32-characters', GITHUB_TOKEN: 'test-private-token', LOGIN_LIMITER: {async limit() {return {success: true};}}};
let data = {name:'ΘΕΜΙΔΟΣ 18-20', subtitle:'Ενημέρωση', image:'', imageCaption:'', demo:false, events:[], contacts:[], notices:[], documents:[]};
let sha = 'a'.repeat(40), writes = 0, githubStatus = 0;
const uploads = [];
globalThis.fetch = async (url, options) => {
  assert(url.startsWith('https://api.github.com/repos/gardeliss/themidos/contents/'));
  assert.equal(options.headers.Authorization, 'Bearer test-private-token');
  if (githubStatus) return Response.json({}, {status: githubStatus});
  if (options.method === 'PUT') {
    const body = JSON.parse(options.body);
    if (url.endsWith('/data.json')) {
      if (body.sha !== sha) return Response.json({}, {status:409});
      data = JSON.parse(Buffer.from(body.content, 'base64').toString());
      writes++; sha = String(writes).padStart(40,'0');
    } else uploads.push({url, body});
    return Response.json({content:{sha}});
  }
  return Response.json({content:Buffer.from(JSON.stringify(data)).toString('base64'), sha});
};
const request = (path, method='GET', body, token, origin=ORIGIN, extra={}) => worker.fetch(new Request('https://themidos-admin.example.workers.dev'+path,{
  method, headers:{...(origin?{Origin:origin}:{}), ...(token?{Authorization:'Bearer '+token}:{}), ...extra},
  ...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})
}),env);
assert.equal((await request('/', 'GET')).status,200);
assert.equal((await request('/data')).status,200);
assert.equal((await request('/data','PUT',{data,sha})).status,401);
assert.equal(writes,0);
assert.equal((await request('/login','POST',{password:'wrong'})).status,401);
assert.equal((await request('/login','POST',{password},null,'https://evil.example')).status,403);
assert.equal((await request('/login','POST',{password},null,null)).status,403);
assert.equal((await request('/data','OPTIONS')).status,204);
assert.equal((await request('/data','OPTIONS',undefined,undefined,'https://evil.example')).status,403);
env.LOGIN_LIMITER = {async limit(){return {success:false};}};
assert.equal((await request('/login','POST',{password})).status,429);
env.LOGIN_LIMITER = {async limit(){return {success:true};}};
const loginResponse = await request('/login','POST',{password});
const login = await loginResponse.json();
assert.equal(loginResponse.status,200);
assert(login.session && login.expiresAt > Date.now());
assert(!JSON.stringify(login).includes(password));
assert(!JSON.stringify(login).includes(env.GITHUB_TOKEN));
const token=login.session;
assert.equal((await request('/data','PUT',{data,sha},token+'invalid')).status,401);
const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
const expiredPayload=Buffer.from(JSON.stringify({exp:Date.now()-1000})).toString('base64url');
const expiredSignature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(expiredPayload))).toString('base64url');
assert.equal((await request('/data','PUT',{data,sha},expiredPayload+'.'+expiredSignature)).status,401);
const staleSha=sha;
const changed=structuredClone(data);
changed.events.push({title:'Απεντόμωση',date:'2026-10-13',time:'18:00',description:''});
assert.equal((await request('/data','PUT',{data:changed,sha},token)).status,200);
assert.equal(data.events[0].title,'Απεντόμωση');
assert.equal((await request('/data','PUT',{data:changed,sha:staleSha},token)).status,409);
const invalid=structuredClone(data);invalid.events[0].date='2026-02-31';
assert.equal((await request('/data','PUT',{data:invalid,sha},token)).status,422);
invalid.events[0].date='2026-10-13';invalid.documents=[{title:'Unsafe',url:'javascript:alert(1)'}];
assert.equal((await request('/data','PUT',{data:invalid,sha},token)).status,422);
assert.equal((await request('/upload','POST','test',null,ORIGIN,{'X-Filename':'test.pdf'})).status,401);
assert.equal((await request('/upload','POST','test',token,ORIGIN,{'X-Filename':'test.html'})).status,422);
assert.equal((await request('/upload','POST','x'.repeat(1024*1024+1),token,ORIGIN,{'X-Filename':'test.pdf'})).status,413);
const uploaded=await request('/upload','POST','PDF sample',token,ORIGIN,{'X-Filename':encodeURIComponent('Κανονισμός.pdf')});
assert.equal(uploaded.status,201);assert((await uploaded.json()).path.startsWith('documents/'));
assert.equal(Buffer.from(uploads[0].body.content,'base64').toString(),'PDF sample');
githubStatus=403;
assert.equal((await request('/data')).status,503);
githubStatus=0;
const missing=await worker.fetch(new Request('https://worker.example/'),{});
assert.equal((await missing.json()).ready,false);
// Exercise the browser store against the Worker, including session restoration.
const memory=new Map();
globalThis.sessionStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
globalThis.BUILDING_CONFIG={apiUrl:'https://themidos-admin.example.workers.dev'};
const require=createRequire(import.meta.url), Store=require('../store.js');
const adapter=async function(url,options={}) {
  assert.equal(this,globalThis); // Native fetch must receive the correct receiver.
  return worker.fetch(new Request(url,{...options,headers:{Origin:ORIGIN,...options.headers}}),env);
};
const store=new Store(adapter);
await store.load();
await store.connect(password);
assert(![...memory.values()].some(x=>x.includes(password)||x.includes(env.GITHUB_TOKEN)));
const restored=new Store(adapter);assert.equal(restored.token,store.token);
const candidate=await restored.load();
candidate.notices.push({title:'Ενημέρωση',body:'Αποθηκεύτηκε'});
await restored.save(candidate);
assert.equal(data.notices[0].body,'Αποθηκεύτηκε');
const another=new Store(adapter);const old=await another.load();
candidate.subtitle='Νέα ενημέρωση';await restored.save(candidate);
await assert.rejects(()=>another.save(old),/άλλη αλλαγή/);
another.token='invalid';
await assert.rejects(()=>another.save(old),/σύνδεση έληξε/);
assert.equal(another.token,'');assert.equal(memory.size,0);
restored.disconnect();assert.equal(restored.token,'');
// The existing GitHub mode remains available until the public API URL is set.
globalThis.BUILDING_CONFIG={apiUrl:''};
const legacy=new Store(async function(url){assert.equal(this,globalThis);assert(url.startsWith('./data.json?'));return Response.json(data);});
assert.equal(legacy.passwordMode,false);assert.equal((await legacy.load()).name,'ΘΕΜΙΔΟΣ 18-20');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if(match[0].includes('application/json')) JSON.parse(match[1]);else new vm.Script(match[1]);
}
JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
console.log('PASS: login, CORS, throttling, expiry, unauthorized writes, validation, conflict, upload limits, Greek text, session restoration, legacy mode and HTML syntax.');
