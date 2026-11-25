"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {readIncremental,CHUNK}=require("../server/harness/jsonl-reader");
test("Claude JSONL retains UTF8 split boundaries, resets after truncation, honors read budget",t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cc-jsonl-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,"a.jsonl");
 const make=()=>({file,rows:[]});const rec={st:make()};const ingest=(st,line)=>st.rows.push(JSON.parse(line));
 const line=JSON.stringify({text:"a".repeat(CHUNK-10)+"한글"})+"\n";fs.writeFileSync(file,line);
 readIncremental(rec,make,ingest,CHUNK);assert.equal(rec.st.rows.length,0);
 readIncremental(rec,make,ingest);assert.deepEqual(rec.st.rows,[JSON.parse(line)]);
 fs.writeFileSync(file,'{"text":"new"}\n');readIncremental(rec,make,ingest);assert.deepEqual(rec.st.rows,[{text:"new"}]);
});
