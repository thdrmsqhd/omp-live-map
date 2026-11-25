"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),{makeDelta,applyDelta}=require("../server/graph-delta");
test("session delta handles updates, removals and reordering",()=>{const a={generatedAt:1,sessions:[{key:"a",title:"old"},{key:"b"},{key:"c"}]},b={generatedAt:2,sessions:[{key:"c"},{key:"a",title:"new"},{key:"d"}]};const d=makeDelta(a,b);assert.equal(d.upsert.length,2);assert.deepEqual(d.remove,["b"]);assert.deepEqual(applyDelta(a,d),b);});
