"use strict";
const {randomUUID}=require("node:crypto");
function createJournal({maxEvents=4096,maxBytes=8*1024*1024}={}){
 const epoch=randomUUID();let seq=0,bytes=0;const entries=[];
 function append(payload){const id=epoch+":"+(++seq);const frame="id: "+id+"\ndata: "+JSON.stringify(payload)+"\n\n";const size=Buffer.byteLength(frame);entries.push({seq,frame,size});bytes+=size;while(entries.length>maxEvents||bytes>maxBytes){bytes-=entries.shift().size;}return frame;}
 function replay(id){const [e,n]=String(id||"").split(":");const offset=Number(n);if(e!==epoch||!Number.isSafeInteger(offset)||offset<0||offset>seq||offset<(entries[0]?.seq||seq+1)-1)return null;return entries.filter(x=>x.seq>offset).map(x=>x.frame);}
 return {append,replay};
}
module.exports={createJournal};
