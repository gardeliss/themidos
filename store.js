(function(root){
'use strict';
class LegacyBuildingStore {
 constructor(fetcher=fetch){this.fetcher=fetcher.bind(root);this.token='';this.base='https://api.github.com/repos/gardeliss/themidos';this.sha=null;this.snapshot=null;this.busy=false;}
 headers(){return {Accept:'application/vnd.github+json',...(this.token?{Authorization:'Bearer '+this.token}:{})};}
 async request(path,options={}){let r;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);try{r=await this.fetcher(this.base+path,{cache:'no-store',...options,signal:controller.signal,headers:{...this.headers(),...options.headers}});}catch(e){throw new Error(e.name==='AbortError'?'Το GitHub δεν απάντησε μέσα σε 15 δευτερόλεπτα. Δοκιμάστε ξανά. Αν συνέβη κατά την αποθήκευση, ανανεώστε πρώτα τα κοινά στοιχεία.':'Η επικοινωνία με το GitHub απέτυχε πριν ληφθεί απάντηση. Το κλειδί δεν ελέγχθηκε. Δοκιμάστε ξανά ή άλλο δίκτυο.');}finally{clearTimeout(timeout);}if(!r.ok){const messages={401:'Το κλειδί πρόσβασης δεν ισχύει ή έχει λήξει.',403:'Δεν επιτρέπεται η ενέργεια. Ελέγξτε Contents: Read and write ή δοκιμάστε αργότερα.',409:'Έγινε άλλη αλλαγή. Ανανεώστε πριν αποθηκεύσετε.',422:'Το GitHub απέρριψε την αποθήκευση.'};throw new Error(messages[r.status]||'Δεν ολοκληρώθηκε η ενέργεια (HTTP '+r.status+').');}return r.json();}
 decode(content){return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
 encode(text){const bytes=new TextEncoder().encode(text);let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
 async read(){const file=await this.request('/contents/data.json?ref=main&t='+Date.now());const value=JSON.parse(this.decode(file.content));if(!value||!['events','contacts','notices','documents'].every(k=>Array.isArray(value[k])))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');return {value,sha:file.sha};}
 accept(record){this.sha=record.sha;this.snapshot=JSON.stringify(record.value);return record.value;}
 async load(){if(this.token)return this.accept(await this.read());let r;try{r=await this.fetcher('./data.json?t='+Date.now(),{cache:'no-store'});}catch(e){throw new Error('Δεν υπάρχει σύνδεση για φόρτωση των κοινών στοιχείων.');}if(!r.ok)throw new Error('Δεν φορτώθηκαν τα κοινά στοιχεία. Δοκιμάστε ανανέωση.');const value=await r.json();if(!value||!['events','contacts','notices','documents'].every(k=>Array.isArray(value[k])))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');return this.accept({value,sha:null});}
 async connect(token){if(!/^github_pat_[A-Za-z0-9_]+$/.test(token))throw new Error('Χρησιμοποιήστε fine-grained personal access token από το GitHub.');this.token=token;try{await this.read();}catch(e){this.token='';throw e;}}
 async save(value){if(!this.token)throw new Error('Συνδεθείτε ως διαχειριστής.');if(this.busy)throw new Error('Μια αποθήκευση είναι σε εξέλιξη.');this.busy=true;try{const current=await this.read();if(this.snapshot===null||JSON.stringify(current.value)!==this.snapshot)throw new Error('Τα κοινά στοιχεία άλλαξαν. Πατήστε ανανέωση και ξανακάντε την αλλαγή.');const result=await this.request('/contents/data.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Update building information',branch:'main',sha:current.sha,content:this.encode(JSON.stringify(value,null,2)+'\n')})});this.sha=result.content.sha;this.snapshot=JSON.stringify(value);return value;}finally{this.busy=false;}}
 async upload(file){if(!this.token)throw new Error('Συνδεθείτε ως διαχειριστής.');if(file.size>5*1024*1024)throw new Error('Μέγιστο μέγεθος αρχείου: 5 MB.');if(!/\.(pdf|png|jpe?g|docx|xlsx|txt)$/i.test(file.name))throw new Error('Επιλέξτε PDF, εικόνα, DOCX, XLSX ή TXT.');const clean=file.name.replace(/[^A-Za-z0-9._-]/g,'_');const path='documents/'+crypto.randomUUID()+'-'+clean;const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));await this.request('/contents/'+path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Add building document',branch:'main',content:btoa(binary)})});return path;}
}
class BuildingStore extends LegacyBuildingStore {
 constructor(fetcher=fetch){
  super(fetcher);
  this.apiUrl=(root.BUILDING_CONFIG?.apiUrl||'').replace(/\/$/,'');
  if(this.apiUrl){const url=new URL(this.apiUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Η διεύθυνση της υπηρεσίας πρέπει να είναι HTTPS.');}
  this.passwordMode=!!this.apiUrl;this.sessionKey='themidos-session:'+this.apiUrl;
  if(this.passwordMode){try{const session=JSON.parse(root.sessionStorage.getItem(this.sessionKey));if(session&&typeof session.session==='string'&&session.expiresAt>Date.now())this.token=session.session;else root.sessionStorage.removeItem(this.sessionKey);}catch{}}
 }
 disconnect(){this.token='';if(this.passwordMode)try{root.sessionStorage.removeItem(this.sessionKey);}catch{}}
 async apiRequest(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);let response;
  try{response=await this.fetcher(this.apiUrl+path,{...options,cache:'no-store',signal:controller.signal,headers:{...(this.token?{Authorization:'Bearer '+this.token}:{}),...options.headers}});}
  catch{throw new Error('Η υπηρεσία δεν απάντησε. Αν αποθηκεύατε, ανανεώστε τα κοινά στοιχεία πριν ξαναδοκιμάσετε.');}
  finally{clearTimeout(timer);}
  let value;try{value=await response.json();}catch{throw new Error('Η υπηρεσία επέστρεψε μη έγκυρη απάντηση.');}
  if(!response.ok){if(response.status===401&&path!=='/login')this.disconnect();throw new Error(value.error||'Δεν ολοκληρώθηκε η ενέργεια.');}
  return value;
 }
 async load(){
  if(!this.passwordMode)return super.load();
  const result=await this.apiRequest('/data');
  if(!result.data||!['events','contacts','notices','documents'].every(k=>Array.isArray(result.data[k]))||typeof result.sha!=='string')throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
  return this.accept({value:result.data,sha:result.sha});
 }
 async connect(password){
  if(!this.passwordMode)return super.connect(password.trim());
  this.disconnect();
  const result=await this.apiRequest('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  if(typeof result.session!=='string'||!Number.isFinite(result.expiresAt))throw new Error('Δεν ολοκληρώθηκε η σύνδεση.');
  this.token=result.session;try{root.sessionStorage.setItem(this.sessionKey,JSON.stringify(result));}catch{}
 }
 async save(value){
  if(!this.passwordMode)return super.save(value);
  if(!this.token)throw new Error('Συνδεθείτε ως διαχειριστής.');
  if(this.busy)throw new Error('Μια αποθήκευση είναι σε εξέλιξη.');
  if(!this.sha)throw new Error('Ανανεώστε τα κοινά στοιχεία πριν αποθηκεύσετε.');
  this.busy=true;
  try{const result=await this.apiRequest('/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:value,sha:this.sha})});this.sha=result.sha;this.snapshot=JSON.stringify(value);return value;}finally{this.busy=false;}
 }
 async upload(file){
  if(!this.passwordMode)return super.upload(file);
  if(!this.token)throw new Error('Συνδεθείτε ως διαχειριστής.');
  if(file.size>1024*1024)throw new Error('Μέγιστο μέγεθος αρχείου: 1 MB. Για μεγαλύτερο αρχείο βάλτε HTTPS σύνδεσμο.');
  if(!/\.(pdf|png|jpe?g|docx|xlsx|txt)$/i.test(file.name))throw new Error('Επιλέξτε PDF, εικόνα, DOCX, XLSX ή TXT.');
  const result=await this.apiRequest('/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});
  return result.path;
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports=BuildingStore;else root.BuildingStore=BuildingStore;
})(globalThis);

