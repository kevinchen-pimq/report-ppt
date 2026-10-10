// Unzips map archives off the main thread, so loading a big map doesn't freeze the
// game (in VR a frozen main thread means dropped frames). fflate's own async unzip
// still inflates every file under 512 KB on the calling thread; here all of it runs
// in this worker and the files come back as transferred buffers.
// (Workers don't see the page's import map, hence the relative path.)
import { unzipSync } from '../vendor/fflate.module.min.js';

self.onmessage = (e) => {
  const { id, buffer } = e.data;
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const transfer = [];
    const seen = new Set();
    for (const k of Object.keys(files)) {
      let f = files[k];
      // every file needs its own buffer to be transferable
      if (f.byteOffset !== 0 || f.byteLength !== f.buffer.byteLength || seen.has(f.buffer)) f = files[k] = f.slice();
      seen.add(f.buffer);
      transfer.push(f.buffer);
    }
    self.postMessage({ id, files }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
