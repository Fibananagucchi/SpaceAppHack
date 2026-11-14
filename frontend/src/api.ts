import { isObject } from './contract';
import type { AnalysisRequest, ApiResponse } from './contract';

export class ConnectionError extends Error {
  constructor(public readonly kind: 'unavailable' | 'timeout' | 'invalid_response') {
    super(kind);
    this.name = 'ConnectionError';
  }
}

/** Never expose raw upstream text or exception messages in the interface. */
export async function apiRequest(path: string, options: { signal: AbortSignal; body?: AnalysisRequest | {analysis_id:string;change_id:string}; timeout?: number }): Promise<ApiResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal.aborted) controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeout ?? 20000);
  try {
    const response = await fetch(`/api/v1${path}`, {
      method: options.body ? 'POST' : 'GET',
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      if (response.status >= 500) throw new ConnectionError('unavailable');
      throw new ConnectionError('invalid_response');
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new ConnectionError('invalid_response'); }
    if (!isObject(data)) throw new ConnectionError('invalid_response');
    return { httpStatus: response.status, data };
  } catch (error) {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError(timedOut ? 'timeout' : 'unavailable');
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  }
}

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
