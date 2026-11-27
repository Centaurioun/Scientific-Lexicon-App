/// <reference lib="webworker" />

import { WinkNlpEngine } from './wink-core';

const engine = new WinkNlpEngine();

interface WorkerRequestMessage {
  id: number;
  text: string;
}

self.addEventListener('message', (event: MessageEvent<WorkerRequestMessage>) => {
  const { id, text } = event.data;
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
