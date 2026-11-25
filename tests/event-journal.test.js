"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),{createJournal}=require("../server/event-journal");
test("SSE journal replays after cursor and rejects expired or foreign epoch",()=>{const j=createJournal({maxEvents:2});const first=j.append({chat:{kind:"req"}}).split("\n")[0].slice(4);const second=j.append({chat:{kind:"delta",text:"한글"}});const third=j.append({queue:{items:[]}});assert.deepEqual(j.replay(first),[second,third]);j.append({chat:{kind:"done"}});assert.equal(j.replay(first),null);assert.equal(j.replay("foreign:1"),null);});
