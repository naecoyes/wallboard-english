// Dedicated per-recording worker; PCM never crosses back to the main thread.
import { pcmFromChannels, planChunks, wavBytes, base64, RATE } from './audio.js';

let pcm;
self.onmessage = ({ data }) => {
  const { id, type } = data;
  try {
    let result;
    if (type === 'prepare') {
      pcm = pcmFromChannels(data.channels);
      data.channels = null; // Release transferred float decode buffers before planning/encoding.
      result = { duration: pcm.length / RATE, chunks: planChunks(pcm, data.chunkSec) };
    } else if (type === 'wavBase64') {
      if (!pcm) throw new Error('Audio has not been prepared');
      result = base64(wavBytes(pcm, data.start, data.end));
    } else throw new Error(`Unknown audio operation: ${type}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
