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
  /** Optional injectable worker factory for deterministic lifecycle and failure-mode testing. */
  workerFactory?: () => Worker;
}

interface PendingWorkerRequest {
  id: number;
  text: string;
  signal?: AbortSignal;
  resolve: (tokens: Token[]) => void;
  reject: (reason: unknown) => void;
  onAbort?: () => void;
}

/**
 * Browser-local NLP engine that prefers a dedicated Web Worker to avoid blocking
 * the UI thread. Falls back to local in-thread Wink execution only for small inputs
 * (<= LARGE_INPUT_WORKER_REQUIRED_CHARS) or headless Node test runtimes. On large
 * browser inputs, fails closed explicitly instead of freezing the main thread.
 * Tracks all pending requests so cancellation, errors, and terminate() always settle
 * promises deterministically with zero leaked event listeners.
 * Never downloads external models or sends data over the network.
 */
export class BrowserLocalNlpEngine implements NlpEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingWorkerRequest>();
  private readonly fallback = new WinkNlpEngine();
  private readonly requireWorkerAboveChars: number;
  private readonly simulateBrowserWithoutWorker: boolean;
  private readonly workerFactory?: () => Worker;

  private readonly boundHandleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
    this.handleWorkerMessage(event);
  };
  private readonly boundHandleError = () => {
    this.handleWorkerFailure('error');
  };
  private readonly boundHandleMessageError = () => {
    this.handleWorkerFailure('messageerror');
  };

  constructor(options: BrowserLocalNlpEngineOptions = {}) {
    this.requireWorkerAboveChars =
      options.requireWorkerAboveChars ?? LARGE_INPUT_WORKER_REQUIRED_CHARS;
    this.simulateBrowserWithoutWorker = options.simulateBrowserWithoutWorker ?? false;
    this.workerFactory = options.workerFactory;
  }

  private isBrowserContext(): boolean {
    return (
      this.simulateBrowserWithoutWorker ||
      Boolean(this.workerFactory) ||
      typeof window !== 'undefined'
    );
  }

  private detachAndTerminateWorker(): void {
    const active = this.worker;
    if (!active) return;
    this.worker = null;
    active.removeEventListener('message', this.boundHandleMessage as EventListener);
    active.removeEventListener('error', this.boundHandleError as EventListener);
    active.removeEventListener('messageerror', this.boundHandleMessageError as EventListener);
    active.terminate();
  }

  private ensureWorker(): Worker | null {
    if (this.simulateBrowserWithoutWorker) {
      return null;
    }
    if (!this.workerFactory && (typeof Worker === 'undefined' || typeof window === 'undefined')) {
      return null;
    }
    if (this.worker) return this.worker;
    try {
      const nextWorker = this.workerFactory
        ? this.workerFactory()
        : new Worker(new URL('./extraction.worker.ts', import.meta.url), {
            type: 'module',
          });
      nextWorker.addEventListener('message', this.boundHandleMessage as EventListener);
      nextWorker.addEventListener('error', this.boundHandleError as EventListener);
      nextWorker.addEventListener('messageerror', this.boundHandleMessageError as EventListener);
      this.worker = nextWorker;
      return nextWorker;
    } catch {
      this.worker = null;
      return null;
    }
  }

  private detachAbortListener(req: PendingWorkerRequest): void {
    if (req.signal && req.onAbort) {
      req.signal.removeEventListener('abort', req.onAbort);
    }
    req.onAbort = undefined;
  }

  private settlePendingViaFallbackOrFail(
    req: PendingWorkerRequest,
    reason: 'error' | 'messageerror' | 'postMessage',
  ): void {
    this.detachAbortListener(req);
    if (req.signal?.aborted) {
      req.reject(new DOMException('Analysis aborted', 'AbortError'));
      return;
    }
    if (this.isBrowserContext() && req.text.length > this.requireWorkerAboveChars) {
      req.reject(new WorkerUnavailableForLargeInputError(req.text.length, this.requireWorkerAboveChars));
      return;
    }
    if (reason === 'messageerror') {
      req.reject(
        new OffsetReconstructionError('Worker NLP response message deserialization failed.'),
      );
      return;
    }
    // Small-input fallback only; never silently blocks main thread on large documents
    this.fallback.analyze(req.text, req.signal).then(req.resolve, req.reject);
  }

  private handleWorkerMessage(event: MessageEvent<WorkerResponseMessage>): void {
    const msg = event.data;
    if (!msg || typeof msg.id !== 'number') return;
    const req = this.pending.get(msg.id);
    if (!req) return; // Ignore stale or already-cancelled message IDs
    this.pending.delete(msg.id);
    this.detachAbortListener(req);
    if (req.signal?.aborted) {
      req.reject(new DOMException('Analysis aborted', 'AbortError'));
      return;
    }
    if (msg.ok && Array.isArray(msg.tokens)) {
      req.resolve(msg.tokens);
    } else {
      req.reject(new OffsetReconstructionError(msg.error ?? 'Worker NLP analysis failed.'));
    }
  }

  private handleWorkerFailure(reason: 'error' | 'messageerror'): void {
    this.detachAndTerminateWorker();
    const orphaned = Array.from(this.pending.values());
    this.pending.clear();
    for (const req of orphaned) {
      this.settlePendingViaFallbackOrFail(req, reason);
    }
  }

  private redispatchRemainingPending(): void {
    const remaining = Array.from(this.pending.values()).filter((req) => !req.signal?.aborted);
    // Reject any remaining requests whose signal also aborted
    for (const [id, req] of this.pending.entries()) {
      if (req.signal?.aborted) {
        this.pending.delete(id);
        this.detachAbortListener(req);
        req.reject(new DOMException('Analysis aborted', 'AbortError'));
      }
    }
    if (remaining.length === 0) return;

    const freshWorker = this.ensureWorker();
    if (!freshWorker) {
      this.pending.clear();
      for (const req of remaining) {
        this.settlePendingViaFallbackOrFail(req, 'error');
      }
      return;
    }

    for (const req of remaining) {
      try {
        freshWorker.postMessage({ id: req.id, text: req.text });
      } catch {
        this.pending.delete(req.id);
        this.detachAndTerminateWorker();
        this.settlePendingViaFallbackOrFail(req, 'postMessage');
        // Settle any other pending requests cleanly too since worker failed
        const rest = Array.from(this.pending.values());
        this.pending.clear();
        for (const other of rest) {
          this.settlePendingViaFallbackOrFail(other, 'postMessage');
        }
        return;
      }
    }
  }

  terminate(): void {
    this.detachAndTerminateWorker();
    const orphaned = Array.from(this.pending.values());
    this.pending.clear();
    for (const req of orphaned) {
      this.detachAbortListener(req);
      req.reject(new DOMException('Local NLP worker terminated.', 'AbortError'));
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
      return this.fallback.analyze(text, signal);
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<Token[]>((resolve, reject) => {
      const req: PendingWorkerRequest = {
        id: requestId,
        text,
        signal,
        resolve,
        reject,
      };

      const handleAbort = () => {
        if (!this.pending.has(requestId)) return;
        this.pending.delete(requestId);
        this.detachAbortListener(req);
        // Terminate worker immediately so cancelled heavy analysis stops CPU work,
        // then re-dispatch any remaining active concurrent requests onto a fresh worker.
        this.detachAndTerminateWorker();
        req.reject(new DOMException('Analysis aborted', 'AbortError'));
        this.redispatchRemainingPending();
      };

      req.onAbort = handleAbort;
      this.pending.set(requestId, req);
      signal?.addEventListener('abort', handleAbort, { once: true });

      try {
        worker.postMessage({ id: requestId, text });
      } catch {
        this.pending.delete(requestId);
        this.detachAndTerminateWorker();
        this.settlePendingViaFallbackOrFail(req, 'postMessage');
        const rest = Array.from(this.pending.values());
        this.pending.clear();
        for (const other of rest) {
          this.settlePendingViaFallbackOrFail(other, 'postMessage');
        }
      }
    });
  }
}
