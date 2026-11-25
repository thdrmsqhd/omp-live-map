"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
function createActivityStore(dir,{maxTurns=20,maxBytes=8*1024*1024,maxNodes=100}={}){
 const file=path.join(dir,"chat-activity.json");let history={};try{const st=fs.statSync(file);if(st.size<=maxBytes)history=JSON.parse(fs.readFileSync(file,"utf8"));}catch{}
 const active=new Map();let dirty=false,timer=null,writing=null,revision=0;
 const key=n=>crypto.createHash("sha256").update(String(n)).digest("hex");
 function flush(){clearTimeout(timer);timer=null;if(!dirty)return true;try{fs.mkdirSync(dir,{recursive:true});let data=JSON.stringify(history);while(Buffer.byteLength(data)>maxBytes&&Object.keys(history).length){delete history[Object.keys(history)[0]];data=JSON.stringify(history);}fs.writeFileSync(file+".tmp",data,{mode:0o600});fs.renameSync(file+".tmp",file);dirty=false;return true;}catch{return false;}}
 async function flushAsync(){if(writing)return writing;if(!dirty)return true;const rev=revision;writing=(async()=>{try{let data=JSON.stringify(history);while(Buffer.byteLength(data)>maxBytes&&Object.keys(history).length){delete history[Object.keys(history)[0]];data=JSON.stringify(history);}await fs.promises.mkdir(dir,{recursive:true});await fs.promises.writeFile(file+".async.tmp",data,{mode:0o600});await fs.promises.rename(file+".async.tmp",file);if(revision===rev)dirty=false;return true;}catch{return false;}finally{writing=null;if(dirty&&!timer){timer=setTimeout(()=>{timer=null;void flushAsync();},1000);timer.unref?.();}}})();return writing;}
 function record(ev){if(!ev.node||!["tool","out","tool_end","sub","turn_end"].includes(ev.kind))return;const k=key(ev.node);let items=active.get(k);if(!items){items=[];active.set(k,items);if(active.size>maxNodes)active.delete(active.keys().next().value);}
 const id=String(ev.id||"");const t=items.find(x=>x.id===id&&x.kind==="tool");
 if(ev.kind==="tool"&&id){if(t){if(ev.args)t.args=String(ev.args).slice(0,4000);}else items.push({kind:"tool",id,name:String(ev.name||""),args:String(ev.args||"").slice(0,4000),startedAt:Number(ev.ts)||Date.now(),out:"",done:false});}
 if(ev.kind==="out"&&t)t.out=String(ev.text||"").slice(-12000);
 if(ev.kind==="tool_end"&&t)Object.assign(t,{done:true,error:!!ev.error,endedAt:Number(ev.ts)||Date.now()});
 if(ev.kind==="sub")items.push({kind:"sub",name:String(ev.name||"").slice(0,200),status:String(ev.status||"").slice(0,100)});
 if(items.length>200)items.splice(0,items.length-200);
 if(ev.kind==="turn_end"){active.delete(k);if(!items.length)return;const turns=(history[k]||[]).slice(-(maxTurns-1));turns.push({ts:Number(ev.ts)||Date.now(),items:items.map(x=>({...x,done:true}))});delete history[k];history[k]=turns;while(Object.keys(history).length>maxNodes)delete history[Object.keys(history)[0]];dirty=true;revision++;if(!timer){timer=setTimeout(()=>{timer=null;void flushAsync();},250);timer.unref?.();}}
 }
 return {record,flush,flushAsync,read:n=>history[key(n)]||[]};
}
module.exports={createActivityStore};
