"use strict";
// Slow clients reconnect via the bounded event journal instead of accumulating unbounded writes.
function writeFrame(res, frame, max = 1024 * 1024, { allowLarge = false } = {}) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    const queued = res.writableLength || 0;
    if (queued + Buffer.byteLength(frame) > max && !(allowLarge && queued === 0)) {
      res.destroy();
      return false;
    }
    res.write(frame);
    return true;
  } catch {
    try { res.destroy(); } catch { /* already closed */ }
    return false;
  }
}
module.exports={writeFrame};
