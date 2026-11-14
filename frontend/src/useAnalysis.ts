import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ConnectionError, isAbort } from './api';
import { analysisState, isObject, readProgress } from './contract';
import type { AnalysisRequest, ApiResponse, ViewState } from './contract';

const WATCH_KEY = 'earth-trends-pending-request-v1';
const idle: ViewState = { kind: 'idle', warnings: [] };
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

function saveWatch(jobId: string | undefined, request?: AnalysisRequest) {
  try {
    if (jobId && request) sessionStorage.setItem(WATCH_KEY, JSON.stringify({ jobId, request }));
    else sessionStorage.removeItem(WATCH_KEY);
  } catch { /* Storage can be unavailable; API state remains authoritative. */ }
}

function restoreWatch(): { jobId: string; request: AnalysisRequest } | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(WATCH_KEY) ?? 'null');
    if (!isObject(value) || !safeId(value.jobId) || !isObject(value.request)) return undefined;
    const r = value.request;
    if (typeof r.variable_id !== 'string' || !isObject(r.location) || r.location.type !== 'point' ||
        typeof r.location.lat !== 'number' || !Number.isFinite(r.location.lat) || Math.abs(r.location.lat) > 90 ||
        typeof r.location.lon !== 'number' || !Number.isFinite(r.location.lon) || Math.abs(r.location.lon) > 180 ||
        !isObject(r.period) || typeof r.period.start !== 'string' || typeof r.period.end !== 'string') return undefined;
    return { jobId: value.jobId, request: r as unknown as AnalysisRequest };
  } catch { return undefined; }
}

/** One request at a time: superseded responses cannot overwrite the current selection. */
export function useAnalysis() {
  const [state, setState] = useState<ViewState>(idle);
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastRequest = useRef<AnalysisRequest | undefined>(undefined);
  const watchedJob = useRef<string | undefined>(undefined);

  const stop = useCallback(() => {
    active.current?.abort();
    clearTimeout(pollTimer.current);
    clearTimeout(connectionTimer.current);
    sequence.current++;
  }, []);

  const reset = useCallback(() => {
    stop(); saveWatch(undefined); watchedJob.current = undefined; lastRequest.current = undefined;
    setState(idle);
  }, [stop]);

  const begin = useCallback((request: AnalysisRequest, resumeJob?: string) => {
    stop();
    const controller = new AbortController();
    active.current = controller;
    const serial = sequence.current;
    const current = () => !controller.signal.aborted && serial === sequence.current;
    const startedAt = Date.now();
    lastRequest.current = request;
    watchedJob.current = resumeJob;
    if (!resumeJob) saveWatch(undefined);
    setState({ kind: resumeJob ? 'queued' : 'loading', request, jobId: resumeJob, warnings: [], startedAt });
    const armConnectionNotice = () => {
      clearTimeout(connectionTimer.current);
      connectionTimer.current = setTimeout(() => {
        if (current()) setState(old => ({ ...old, kind: 'connecting' }));
      }, 2000);
    };

    const fail = (error: unknown) => {
      clearTimeout(connectionTimer.current);
      if (!current() || isAbort(error)) return;
      setState({ kind: error instanceof ConnectionError && error.kind === 'invalid_response' ? 'protocol_error' : 'source_error',
        request, warnings: [], reason: 'service_unavailable', jobId: watchedJob.current });
    };

    const accept = async (response: ApiResponse): Promise<void> => {
      if (!current()) return;
      clearTimeout(connectionTimer.current);
      const next = analysisState(response, request);
      if ((next.kind === 'queued' || next.kind === 'running') && safeId(next.jobId)) {
        watchedJob.current = next.jobId;
        saveWatch(next.jobId, request);
        setState({ ...next, startedAt });
        schedulePoll(next.jobId, response.data.next_poll_s);
      } else {
        watchedJob.current = undefined; saveWatch(undefined);
        setState(next);
      }
    };

    const poll = async (jobId: string) => {
      try {
        armConnectionNotice();
        const response = await apiRequest(`/jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
        if (!current()) return;
        clearTimeout(connectionTimer.current);
        const data = response.data;
        if (data.status === 'complete' && isObject(data.result)) {
          if (data.result.type !== 'analysis' || !safeId(data.result.id)) throw new ConnectionError('invalid_response');
          const result = await apiRequest(`/analyses/${encodeURIComponent(data.result.id)}`, { signal: controller.signal });
          await accept(result);
        } else if (data.status === 'failed') {
          watchedJob.current = undefined; saveWatch(undefined);
          setState({ kind: 'source_error', request, warnings: [], reason: 'job_failed' });
        } else if (data.status === 'queued' || data.status === 'running') {
          setState({ kind: data.status, request, warnings: [], jobId, startedAt,
            stage: typeof data.stage === 'string' ? data.stage : undefined, progress: readProgress(data) });
          schedulePoll(jobId, data.next_poll_s);
        } else {
          await accept(response);
        }
      } catch (error) { fail(error); }
    };

    const schedulePoll = (jobId: string, seconds: unknown) => {
      const delay = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(30, Math.max(1, seconds)) * 1000 : 10000;
      pollTimer.current = setTimeout(() => { if (current()) void poll(jobId); }, delay);
    };

    armConnectionNotice();
    if (resumeJob) void poll(resumeJob);
    else void apiRequest('/analyses', { signal: controller.signal, body: request, timeout: 90000 }).then(accept).catch(fail);
  }, [stop]);

  const retry = useCallback(() => {
    if (lastRequest.current) begin(lastRequest.current, watchedJob.current);
  }, [begin]);

  useEffect(() => {
    const restored = restoreWatch();
    if (restored) begin(restored.request, restored.jobId);
    return stop;
  }, [begin, stop]);

  return { state, submit: begin, reset, retry };
}
