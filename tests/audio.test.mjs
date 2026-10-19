import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmFromChannels, planChunks, wavBytes, base64, prepareAudio, RATE } from '../js/lessons/audio.js';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { once } from 'node:events';

test('PCM mixes channels and clamps peaks', () => {
  assert.deepEqual([...pcmFromChannels([new Float32Array([-2, -1, 0, 1, 2])])], [-32768, -32767, 0, 32767, 32767]);
  assert.deepEqual([...pcmFromChannels([new Float32Array([1, -1]), new Float32Array([-1, 1])])], [0, 0]);
});

test('chunk boundaries cover audio once and remain positive for short targets', () => {
  for (const seconds of [0.01, 1, 90, 300]) {
    const pcm = new Int16Array(RATE * 601);
    const chunks = planChunks(pcm, seconds);
    assert.equal(chunks[0][0], 0);
    assert.equal(chunks.at(-1)[1], 601);
    chunks.forEach(([a, b], i) => {
      assert.ok(b > a);
      if (i) assert.equal(a, chunks[i - 1][1]);
    });
  }
  assert.deepEqual(planChunks(new Int16Array()), []);
  assert.throws(() => planChunks(new Int16Array(1), 0), RangeError);
});

test('WAV header, clipped subrange, and base64 remain compatible', () => {
  const pcm = new Int16Array([-32768, 0, 32767]);
  const bytes = wavBytes(pcm, -1, 10);
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(24, true), RATE);
  assert.equal(view.getUint32(40, true), 6);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(base64(bytes), Buffer.from(bytes).toString('base64'));
});

test('actual audio module worker converts transferred channels and encodes requested ranges', async () => {
  const moduleUrl = new URL('../js/lessons/audio-worker.js', import.meta.url).href;
  const worker = new ThreadWorker(`
    const { parentPort } = await import('node:worker_threads');
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    await import(${JSON.stringify(moduleUrl)});
    parentPort.on('message', data => self.onmessage({ data }));
    parentPort.postMessage({ ready: true });
  `, { eval: true });
  try {
    await once(worker, 'message');
    const channels = [new Float32Array([0, 1, -1, 0.5])];
    const expected = pcmFromChannels(channels);
    let reply = once(worker, 'message');
    worker.postMessage({ id: 1, type: 'prepare', channels, chunkSec: 90 }, [channels[0].buffer]);
    assert.equal(channels[0].byteLength, 0, 'float buffer should transfer without a copy');
    const [{ result }] = await reply;
    assert.equal(result.duration, 4 / RATE);
    assert.deepEqual(result.chunks, [[0, 4 / RATE]]);
    assert.ok(!('pcm' in result));
    reply = once(worker, 'message');
    worker.postMessage({ id: 2, type: 'wavBase64', start: 1 / RATE, end: 4 / RATE });
    assert.equal((await reply)[0].result, base64(wavBytes(expected, 1 / RATE, 4 / RATE)));
  } finally { await worker.terminate(); }
});

test('prepareAudio transfers channels, encodes lazily and disposes on abort', async () => {
  const oldWorker = globalThis.Worker, oldContext = globalThis.OfflineAudioContext;
  const channels = [new Float32Array([0, 1, -1])];
  let instance;
  class FakeWorker {
    constructor() { instance = this; this.calls = []; }
    postMessage(data, transfers) {
      this.calls.push({ data, transfers });
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result: data.type === 'prepare' ? { duration: 3 / RATE, chunks: [[0, 3 / RATE]] } : 'encoded' } }));
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() { return { numberOfChannels: 1, getChannelData: i => channels[i] }; }
  };
  try {
    const ctl = new AbortController();
    const audio = await prepareAudio(new Blob(), { signal: ctl.signal });
    assert.equal(instance.calls.length, 1);
    assert.equal(instance.calls[0].transfers[0], channels[0].buffer);
    assert.equal(await audio.wavBase64(0, 1), 'encoded');
    ctl.abort();
    assert.ok(instance.terminated);
    await assert.rejects(audio.wavBase64(0, 1), { name: 'AbortError' });
    await assert.rejects(prepareAudio(new Blob(), { signal: ctl.signal }), { name: 'AbortError' });
  } finally { globalThis.Worker = oldWorker; globalThis.OfflineAudioContext = oldContext; }
});
