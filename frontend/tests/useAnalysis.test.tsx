import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnalysis } from '../src/useAnalysis';
import { jsonResponse, request, result } from './fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Request lifecycle', () => {
  it('follows a queued job to its stored result without using a supplied external URL', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'queued', job_id: 'j_test', next_poll_s: 1 }, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'complete', result: { type: 'analysis', id: 'a_test', url: 'https://example.invalid/result' } }))
      .mockResolvedValueOnce(jsonResponse(result));
    vi.stubGlobal('fetch', fetcher);
    const { result: hook } = renderHook(useAnalysis);
    await act(async () => { hook.current.submit(request); });
    expect(hook.current.state.kind).toBe('queued');
    expect(hook.current.state.progress).toBeUndefined();
    expect(sessionStorage.getItem('earth-trends-pending-request-v1')).toContain('j_test');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.current.state.kind).toBe('ready');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/v1/analyses', '/api/v1/jobs/j_test', '/api/v1/analyses/a_test']);
    expect(sessionStorage.getItem('earth-trends-pending-request-v1')).toBeNull();
  });
  it('does not let a late response overwrite a different current question', async () => {
    let release!: (response: Response) => void;
    const slow = new Promise<Response>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(slow).mockResolvedValueOnce(jsonResponse({ status: 'no_data' })));
    const { result: hook } = renderHook(useAnalysis);
    act(() => hook.current.submit(request));
    const next = { ...request, location: { ...request.location, lat: 1 } };
    act(() => hook.current.submit(next));
    await waitFor(() => expect(hook.current.state.kind).toBe('no_data'));
    await act(async () => { release(jsonResponse(result)); await slow; });
    expect(hook.current.state.kind).toBe('no_data');
    expect(hook.current.state.request?.location).toMatchObject({type:'point',lat:1});
  });
  it('does not retry a 501 automatically', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: 'not_implemented' }, 501));
    vi.stubGlobal('fetch', fetcher);
    const { result: hook } = renderHook(useAnalysis);
    act(() => hook.current.submit(request));
    await waitFor(() => expect(hook.current.state.kind).toBe('not_implemented'));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('restores a real job identifier and treats its 404 as not_found', async () => {
    sessionStorage.setItem('earth-trends-pending-request-v1', JSON.stringify({ jobId: 'j_test', request }));
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ status: 'not_found' }, 404));
    vi.stubGlobal('fetch', fetcher);
    const { result: hook } = renderHook(useAnalysis);
    await waitFor(() => expect(hook.current.state.kind).toBe('not_found'));
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/jobs/j_test');
    expect(sessionStorage.getItem('earth-trends-pending-request-v1')).toBeNull();
  });
  it('does not mistake an infrastructure HTML failure for absent observations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Unavailable</html>', { status: 503 })));
    const { result: hook } = renderHook(useAnalysis);
    act(() => hook.current.submit(request));
    await waitFor(() => expect(hook.current.state.kind).toBe('source_error'));
    expect(hook.current.state.reason).toBe('service_unavailable');
  });
});
