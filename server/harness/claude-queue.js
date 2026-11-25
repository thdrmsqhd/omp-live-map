"use strict";
const crypto=require("node:crypto");
function createQueue({start,busy,changed=()=>{},limit=20,bytes=4*1024*1024}){
 const queues=new Map();
 const state=key=>{if(!queues.has(key))queues.set(key,{items:[],paused:false,error:""});return queues.get(key);};
 const size=x=>Buffer.byteLength(JSON.stringify(x));
 function view(key){const q=state(key);return {paused:q.paused,error:q.error,items:q.items.map(({id,text,images})=>({id,text,attachments:images.length}))};}
 function drain(key){const q=state(key);if(q.paused||busy(key)||!q.items.length)return;const item=q.items[0];let r;try{r=start(key,item.text,item.images);}catch(e){r={ok:false,out:e.message};}if(r.ok){q.items.shift();q.error="";}else{q.paused=!r.retryable;q.error=r.out||"실행 실패";}}
 function enqueue(key,text,images=[]){const q=state(key);const item={id:crypto.randomUUID(),text,images};if(q.items.length>=limit||q.items.reduce((n,x)=>n+size(x),0)+size(item)>bytes)return {ok:false,out:"예약 대기열 한도 초과"};q.items.push(item);drain(key);changed(key,view(key));return {ok:true,...view(key)};}
 function change(key,action,id,text){const q=state(key),i=q.items.findIndex(x=>x.id===id);
 if(action==="pause")q.paused=true;
 else if(action==="resume"){q.paused=false;q.error="";drain(key);}
 else if(i<0)return {ok:false,out:"예약 항목 없음"};
 else if(action==="delete")q.items.splice(i,1);
 else if(action==="up"&&i>0)[q.items[i-1],q.items[i]]=[q.items[i],q.items[i-1]];
 else if(action==="down"&&i<q.items.length-1)[q.items[i+1],q.items[i]]=[q.items[i],q.items[i+1]];
 else if(action==="edit"){if(typeof text!=="string"||!text.trim()||Buffer.byteLength(text)>65536)return {ok:false,out:"잘못된 입력"};q.items[i].text=text;}
 changed(key,view(key));return {ok:true,...view(key)};}
 function done(key,ok){const q=state(key);if(!ok)q.paused=true;else drain(key);changed(key,view(key));}
 function retry(){for(const [key,q] of queues){if(q.paused||!q.items.length)continue;const before=q.items.length,error=q.error;drain(key);if(before!==q.items.length||error!==q.error)changed(key,view(key));}}
 return {enqueue,change,view,done,retry};
}
module.exports={createQueue};
