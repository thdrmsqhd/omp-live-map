"use strict";
const fs=require("node:fs");
const {StringDecoder}=require("node:string_decoder");
const CHUNK=64*1024,MAX_LINE=8*1024*1024;
function reset(rec,stat,makeState){
  rec.offset=0;rec.pending="";rec.decoder=new StringDecoder("utf8");rec.discard=false;
  rec.identity=String(stat.dev)+":"+String(stat.ino);rec.st=makeState();rec.metaMtime=0;
}
function consume(rec,text,ingest){
  let from=0;
  for(let i=0;i<text.length;i++)if(text.charCodeAt(i)===10){
    const part=text.slice(from,i);from=i+1;
    if(!rec.discard&&rec.pending.length+part.length<=MAX_LINE){const line=rec.pending+part;if(line.trim())ingest(rec.st,line);}
    rec.pending="";rec.discard=false;
  }
  if(!rec.discard){rec.pending+=text.slice(from);if(rec.pending.length>MAX_LINE){rec.pending="";rec.discard=true;}}
}
function readIncremental(rec,makeState,ingest,budget=4*1024*1024){
  let fd;try{fd=fs.openSync(rec.st.file,"r");const stat=fs.fstatSync(fd);
    const identity=String(stat.dev)+":"+String(stat.ino);
    if(!rec.decoder||rec.identity!==identity||stat.size<rec.offset)reset(rec,stat,makeState);
    const buf=Buffer.allocUnsafe(CHUNK);let remaining=Math.min(budget,stat.size-rec.offset);
    while(remaining>0){const n=fs.readSync(fd,buf,0,Math.min(CHUNK,remaining),rec.offset);if(!n)break;rec.offset+=n;remaining-=n;consume(rec,rec.decoder.write(buf.subarray(0,n)),ingest);}
    if(!rec.st.lastTs)rec.st.lastTs=stat.mtimeMs;
    rec.touched=Date.now();
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function prune(cache,cutoff){for(const [file,rec] of cache){if((rec.touched||0)<cutoff)cache.delete(file);}}
module.exports={readIncremental,prune,CHUNK,MAX_LINE};
