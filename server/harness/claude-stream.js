"use strict";
// Bidirectional CLI transport. Feature-gated, no permission bypass, no credential handling.
const {randomUUID}=require("node:crypto");
const {StringDecoder}=require("node:string_decoder");
const MAX=8*1024*1024;
function transport(child,{frame,permission,closed,error,timeout=30000}){
 const decoder=new StringDecoder("utf8"),pending=new Map(),requests=new Map();let buf="",ended=false;
 function write(o){if(ended||!child.stdin?.writable)return false;try{child.stdin.write(JSON.stringify(o)+"\n");return true;}catch{return false;}}
 function control(request){return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error("CLI control timeout: "+request.subtype));},timeout);timer.unref?.();pending.set(id,{resolve,reject,timer});if(!write({type:"control_request",request_id:id,request})){clearTimeout(timer);pending.delete(id);reject(Error("CLI stdin closed"));}});}
 function respond(id,response){if(!requests.has(id))return false;clearTimeout(requests.get(id));requests.delete(id);return write({type:"control_response",response:{subtype:"success",request_id:id,response}});}
 function dispatch(o){
 if(o.type==="control_response"){const r=o.response||{},p=pending.get(r.request_id);if(!p)return;pending.delete(r.request_id);clearTimeout(p.timer);if(r.subtype==="success")p.resolve(r.response);else p.reject(Error(String(r.error||"control rejected")));return;}
 if(o.type==="control_request"){const id=o.request_id,r=o.request||{};if(typeof id!=="string"||requests.has(id))return;const timer=setTimeout(()=>respond(id,{behavior:"deny",message:"Approval timed out"}),120000);timer.unref?.();requests.set(id,timer);if(r.subtype!=="can_use_tool"){clearTimeout(timer);requests.delete(id);write({type:"control_response",response:{subtype:"error",request_id:id,error:"Unsupported control request"}});return;}try{permission(id,r,answer=>respond(id,answer));}catch{respond(id,{behavior:"deny",message:"Approval handler failed"});}return;}
 if(o.type==="control_cancel_request"){const id=o.request_id;clearTimeout(requests.get(id));requests.delete(id);}
 frame(o);
 }
 function feed(text){buf+=text;let i;while((i=buf.indexOf("\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(line.length>MAX){error(Error("Oversize CLI frame"));return;}if(line.trim())try{dispatch(JSON.parse(line));}catch(e){error(e);}}if(buf.length>MAX){buf="";error(Error("Oversize CLI frame"));}}
 child.stdout.on("data",d=>feed(typeof d==="string"?d:decoder.write(d)));
 child.stdin.on("error",error);child.on("error",error);
 child.on("close",(code,signal)=>{ended=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error("CLI closed"));}pending.clear();for(const t of requests.values())clearTimeout(t);requests.clear();closed(code,signal);});
 return {write,control,respond,close:()=>child.stdin.end(),get ended(){return ended;}};
}
module.exports={transport};
