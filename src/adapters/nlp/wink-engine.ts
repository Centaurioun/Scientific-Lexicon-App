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

export const LARGE_INPUT_WORKER_REQUIRED_CHARS = 20_000;

export class WorkerUnavailableForLargeInputError extends Error {
  readonly inputLength: number;
  readonly threshold: number;

  constructor(inputLength: number, threshold: number = LARGE_INPUT_WORKER_REQUIRED_CHARS) {
    super(
      `Local NLP Web Worker is unavailable for a large document (${inputLength.toLocaleString('en-US')} UTF-16 code units; main-thread fallback cap is ${threshold.toLocaleString('en-US')}). Analysis stopped to avoid freezing the browser UI; reduce the input or reload in a Worker-capable browser.`,
    );
    this.name = 'WorkerUnavailableForLargeInputError';
    this.inputLength = inputLength;
    this.threshold = threshold;
  }
}

export interface BrowserLocalNlpEngineOptions {
  requireWorkerAboveChars?: number;
  /** Test-only switch to verify browser worker-unavailability guard in Node unit tests. */
  simulateBrowserWithoutWorker?: boolean;
}

/**
 * Browser-local NLP engine that prefers a dedicated Web Worker to avoid blocking
 * the UI thread. Falls back to local in-thread Wink execution only for small inputs
 * (<= LARGE_INPUT_WORKER_REQUIRED_CHARS) or headless Node test runtimes. On large
 * browser inputs, fails closed explicitly instead of freezing the main thread.
 * Never downloads external models or sends data over the network.
 */
export class BrowserLocalNlpEngine implements NlpEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly fallback = new WinkNlpEngine();
  private readonly requireWorkerAboveChars: number;
  private readonly simulateBrowserWithoutWorker: boolean;

  constructor(options: BrowserLocalNlpEngineOptions = {}) {
    this.requireWorkerAboveChars =
      options.requireWorkerAboveChars ?? LARGE_INPUT_WORKER_REQUIRED_CHARS;
    this.simulateBrowserWithoutWorker = options.simulateBrowserWithoutWorker ?? false;
  }

  private isBrowserContext(): boolean {
    return this.simulateBrowserWithoutWorker || typeof window !== 'undefined';
  }

  private ensureWorker(): Worker | null {
    if (this.simulateBrowserWithoutWorker) {
      return null;
    }
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
      if (this.isBrowserContext() && text.length > this.requireWorkerAboveChars) {
        throw new WorkerUnavailableForLargeInputError(text.length, this.requireWorkerAboveChars);
      }
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
        if (this.isBrowserContext() && text.length > this.requireWorkerAboveChars) {
          reject(new WorkerUnavailableForLargeInputError(text.length, this.requireWorkerAboveChars));
          return;
        }
        // Small-input fallback only; never silently blocks main thread on large documents
        this.fallback.analyze(text).then(resolve, reject);
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);
      signal?.addEventListener('abort', handleAbort, { once: true });
      worker.postMessage({ id: requestId, text });
    });
  }
}
