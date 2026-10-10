(function(root){
'use strict';
const KEYS=['events','contacts','notices','documents'];
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
   const required={events:['title','date'],contacts:['name','type'],notices:['title','body'],documents:['title']}[key];
   if(!required.every(field=>typeof item[field]==='string'))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
   const optional={events:['time','description'],contacts:['landline','mobile','phone'],documents:['url','category','fileData','fileName'],notices:[]}[key];
   if(!optional.every(field=>item[field]===undefined||typeof item[field]==='string'))throw new Error('Τα κοινά στοιχεία δεν είναι έγκυρα.');
  }
 }
 return result;
}
class FirebaseBuildingStore{
 constructor(url,fetcher=fetch){this.url=url.replace(/\/$/,'')+'/building.json';this.fetcher=fetcher.bind(root);this.snapshot=null;this.busy=false;}
 static normalize(value){return normalize(value);}
 static canonical(value){return canonical(normalize(value));}
 async request(options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let response;
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
   const response=await this.request({method:'PUT',headers:{'Content-Type':'application/json','if-match':current.etag},body:JSON.stringify(candidate)});
   const saved=normalize(await response.json());this.snapshot=canonical(saved);return saved;
  }finally{this.busy=false;}
 }
}
if(typeof module!=='undefined'&&module.exports)module.exports=FirebaseBuildingStore;else root.FirebaseBuildingStore=FirebaseBuildingStore;
})(globalThis);
