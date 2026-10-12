(function(root){
'use strict';
const KEYS=['events','contacts','notices','documents'];
// Base64 expands a 10 MB file beyond Firebase's 10 MB string limit.
// Keep each stored piece below that limit; the UI still receives one data URI.
const FILE_CHUNK_SIZE=4*1024*1024;
function encodeFiles(value){
 return {...value,documents:value.documents.map(item=>{
  if(!item.fileData||item.fileData.length<=FILE_CHUNK_SIZE)return item;
  const result={...item,fileDataChunks:[]};
  for(let i=0;i<item.fileData.length;i+=FILE_CHUNK_SIZE)result.fileDataChunks.push(item.fileData.slice(i,i+FILE_CHUNK_SIZE));
  delete result.fileData;return result;
 })};
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function normalize(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string')throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
 const result=structuredClone(value);
 for(const key of ['subtitle','image','imageCaption'])if(result[key]===undefined)result[key]='';else if(typeof result[key]!=='string')throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
 for(const key of KEYS){
  const list=result[key];
  if(list==null)result[key]=[];
  else if(Array.isArray(list))result[key]=list.filter(item=>item!=null);
  else if(typeof list==='object'&&Object.keys(list).every(key=>/^\d+$/.test(key)))result[key]=Object.keys(list).sort((a,b)=>Number(a)-Number(b)).map(index=>list[index]);
  else throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
  for(const item of result[key]){
   if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
   if(key==='documents'&&item.fileDataChunks!==undefined){
    let chunks=item.fileDataChunks;
    if(!Array.isArray(chunks)&&chunks&&typeof chunks==='object'&&Object.keys(chunks).every(key=>/^\d+$/.test(key)))chunks=Object.keys(chunks).sort((a,b)=>Number(a)-Number(b)).map(index=>chunks[index]);
    if(!Array.isArray(chunks)||!chunks.length||!chunks.every(chunk=>typeof chunk==='string'&&chunk.length>0&&chunk.length<=FILE_CHUNK_SIZE)||item.fileData!==undefined)throw new Error('Το αποθηκευμένο αρχείο δεν είναι έγκυρο.');
    item.fileData=chunks.join('');delete item.fileDataChunks;
   }
   const required={events:['title','date'],contacts:['name','type'],notices:['title','body'],documents:['title']}[key];
   if(!required.every(field=>typeof item[field]==='string'))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
   const optional={events:['time','description'],contacts:['landline','mobile','phone'],documents:['url','category','fileData','fileName'],notices:[]}[key];
   if(!optional.every(field=>item[field]===undefined||typeof item[field]==='string'))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
  }
 }
 if(result.apartments==null)result.apartments=Array.from({length:10},(_,i)=>({id:String(i+1),label:'Διαμέρισμα '+(i+1),floor:'',status:'',owners:[],tenants:[]}));
 else if(!Array.isArray(result.apartments)&&typeof result.apartments==='object'&&Object.keys(result.apartments).every(key=>/^\d+$/.test(key)))result.apartments=Object.keys(result.apartments).sort((a,b)=>Number(a)-Number(b)).map(key=>result.apartments[key]);
 if(!Array.isArray(result.apartments)||result.apartments.length!==10)throw new Error('Χρειάζονται 10 διαμερίσματα.');
 const ids=new Set();
 for(const apartment of result.apartments){
  if(!apartment||typeof apartment!=='object'||!['id','label','floor','status'].every(key=>typeof apartment[key]==='string')||!apartment.id||!apartment.label.trim()||ids.has(apartment.id)||!['','Ιδιοκατοίκηση','Μισθωμένο','Κενό'].includes(apartment.status))throw new Error('Τα στοιχεία διαμερίσματος δεν είναι έγκυρα.');
  ids.add(apartment.id);
  for(const key of ['owners','tenants']){
   let people=apartment[key];
   if(people==null)people=[];
   else if(!Array.isArray(people)&&typeof people==='object'&&Object.keys(people).every(key=>/^\d+$/.test(key)))people=Object.keys(people).sort((a,b)=>Number(a)-Number(b)).map(index=>people[index]);
   if(!Array.isArray(people)||!people.every(p=>p&&typeof p.name==='string'&&p.name.trim()&&(p.phone===undefined||typeof p.phone==='string')))throw new Error('Τα στοιχεία προσώπου δεν είναι έγκυρα.');
   apartment[key]=people.map(p=>({...p,phone:p.phone||''}));
  }
 }
 return result;
}
class FirebaseBuildingStore{
 constructor(url,fetcher=fetch){this.url=url.replace(/\/$/,'')+'/building.json';this.fetcher=fetcher.bind(root);this.snapshot=null;this.busy=false;}
 static normalize(value){return normalize(value);}
 static canonical(value){return canonical(normalize(value));}
 async request(options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);let response;
  try{response=await this.fetcher(this.url,{cache:'no-store',...options,signal:controller.signal});}
  catch{throw new Error('Δεν ολοκληρώθηκε η επικοινωνία με τη βάση. Η φόρμα διατηρήθηκε. Ανανεώστε τα κοινά στοιχεία πριν ξαναδοκιμάσετε.');}
  finally{clearTimeout(timer);}
  if(!response.ok){
   if(response.status===412)throw new Error('Έγινε άλλη αλλαγή. Φορτώστε τα κοινά στοιχεία και ξανακάντε την αλλαγή.');
   if(response.status===401||response.status===403)throw new Error('Η βάση δεν επιτρέπει πρόσβαση. Ελέγξτε τους κανόνες για τον χώρο building στο Firebase.');
   throw new Error('Η βάση δεν ολοκλήρωσε την ενέργεια (HTTP '+response.status+').');
  }
  return response;
 }
 async read(){
  const response=await this.request({headers:{'X-Firebase-ETag':'true'}});
  const raw=await response.json();
  if(raw===null)throw new Error('Δεν βρέθηκαν κοινά στοιχεία στη βάση. Η αρχική έκδοση παραμένει διαθέσιμη για ανάγνωση.');
  const etag=response.headers.get('ETag');
  if(!etag)throw new Error('Δεν επιβεβαιώθηκε η έκδοση των κοινών στοιχείων. Δοκιμάστε ανανέωση.');
  return {value:normalize(raw),etag};
 }
 async load(){const current=await this.read();this.snapshot=canonical(current.value);return current.value;}
 async save(value){
  if(this.busy)throw new Error('Μια αποθήκευση είναι σε εξέλιξη.');
  if(this.snapshot===null)throw new Error('Φορτώστε πρώτα τα κοινά στοιχεία.');
  this.busy=true;
  try{
   const candidate=normalize(value),current=await this.read();
   if(canonical(current.value)!==this.snapshot)throw new Error('Τα κοινά στοιχεία άλλαξαν. Φορτώστε τα κοινά στοιχεία και ξανακάντε την αλλαγή.');
   const response=await this.request({method:'PUT',headers:{'Content-Type':'application/json','if-match':current.etag},body:JSON.stringify(encodeFiles(candidate))});
   const saved=normalize(await response.json());this.snapshot=canonical(saved);return saved;
  }finally{this.busy=false;}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports=FirebaseBuildingStore;else root.FirebaseBuildingStore=FirebaseBuildingStore;
})(globalThis);


