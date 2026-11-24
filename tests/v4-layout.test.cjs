"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
function load(file,globals={}){
 const ctx=vm.createContext({$:()=>({}),...globals});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../ui/js",file),"utf8"),ctx);
 return ctx;
}
test("layout presets preserve sizes and separate mixed size cards",()=>{
 const ctx=load("view/layout-presets.js",{undoLayout(){},redoLayout(){}});
 const items=[{x:10,y:20,w:100,h:200},{x:50,y:60,w:300,h:100}];
 const out=ctx.presetPositions(items,"horizontal");
 assert.equal(out[1].x,350);assert.equal(out[0].h,200);
 assert.equal(ctx.presetPositions(items,"vertical")[1].y,260);
});
test("project matching uses longest root and path boundaries",()=>{
 const c=load("model/monitor.js");
 const projects=[{id:"a",root:"C:/work"},{id:"b",root:"C:/work/sub"}];
 assert.equal(c.monitorProjectFor("c:/work/sub/src",projects).id,"b");
 assert.equal(c.monitorProjectFor("C:/work-other",projects),null);
});
