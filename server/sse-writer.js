"use strict";
// Slow clients reconnect via the bounded event journal instead of accumulating unbounded writes.
function writeFrame(res,frame,max=1024*1024){if(res.destroyed||res.writableEnded)return false;try{if((res.writableLength||0)+Buffer.byteLength(frame)>max){res.destroy();return false;}res.write(frame);return true;}catch{try{res.destroy();}catch{}return false;}}
module.exports={writeFrame};
