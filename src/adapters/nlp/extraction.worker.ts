/// <reference lib="webworker" />

import { WinkNlpEngine } from './wink-core';

const engine = new WinkNlpEngine();

interface WorkerRequestMessage {
  id: number;
  text: string;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequestMessage>) => {
  const payload = event.data;
  if (!payload || typeof payload.id !== 'number' || typeof payload.text !== 'string') {
    return;
  }
  const { id, text } = payload;
  engine
    .analyze(text)
    .then((tokens) => {
      self.postMessage({ id, ok: true, tokens });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ id, ok: false, error: message });
    });
});
