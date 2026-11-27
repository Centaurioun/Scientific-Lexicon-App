import type { NlpEngine, Token } from '@/domain/extraction';
import {
  OffsetReconstructionError,
  WinkNlpEngine,
  mapWinkPosToCanonical,
  reconstructTokenSpans,
  type RawWinkToken,
} from './wink-core';

export {
  OffsetReconstructionError,
  WinkNlpEngine,
  mapWinkPosToCanonical,
  reconstructTokenSpans,
  type RawWinkToken,
};

interface WorkerResponseMessage {
  id: number;
  ok: boolean;
  tokens?: Token[];
  error?: string;
}

/**
 * Browser-local NLP engine that prefers a dedicated Web Worker to avoid blocking
 * the UI thread, falling back cleanly to local in-thread Wink execution if Workers
 * are unavailable in the runtime. Never downloads external models or sends data over the network.
 */
export class BrowserLocalNlpEngine implements NlpEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly fallback = new WinkNlpEngine();

  private ensureWorker(): Worker | null {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') {
      return null;
    }
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('./extraction.worker.ts', import.meta.url), {
        type: 'module',
      });
      return this.worker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  async analyze(text: string, signal?: AbortSignal): Promise<Token[]> {
    if (signal?.aborted) {
      throw new DOMException('Analysis aborted', 'AbortError');
    }
    if (text.trim().length === 0) {
      return [];
    }

    const worker = this.ensureWorker();
    if (!worker) {
      return this.fallback.analyze(text);
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<Token[]>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = () => {
        cleanup();
        // Terminate worker immediately so cancelled heavy analysis stops CPU work
        this.terminate();
        reject(new DOMException('Analysis aborted', 'AbortError'));
      };

      const handleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const msg = event.data;
        if (!msg || msg.id !== requestId) return;
        cleanup();
        if (msg.ok && msg.tokens) {
          resolve(msg.tokens);
        } else {
          reject(new OffsetReconstructionError(msg.error ?? 'Worker NLP analysis failed.'));
        }
      };

      const handleError = () => {
        cleanup();
        this.terminate();
        // Fallback to local in-thread Wink if worker failed to load in preview bundler
        this.fallback.analyze(text).then(resolve, reject);
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      signal?.addEventListener('abort', handleAbort, { once: true });
      worker.postMessage({ id: requestId, text });
    });
  }
}
