import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ConnectionError, isAbort } from './api';
import { isObject, readEstimate, readProgress } from './contract';
import type { ObjectValue, ViewState } from './contract';

const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Context jobs are independent of the main analysis and its saved pending job. */
export function useInvestigation(analysisId: string, changeId: string) {
  const [state, setState] = useState<ViewState>({ kind: 'idle', warnings: [] });
  const active = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    sequence = useRef(0),
    watch = useRef<string | undefined>(undefined);
  const stop = useCallback(() => {
    active.current?.abort();
    clearTimeout(timer.current);
    sequence.current++;
  }, []);
  useEffect(() => {
    stop();
    watch.current = undefined;
    setState({ kind: 'idle', warnings: [] });
    return stop;
  }, [analysisId, changeId, stop]);
  const run = useCallback(() => {
    stop();
    const controller = new AbortController();
    active.current = controller;
    const serial = sequence.current,
      startedAt = Date.now(),
      current = () => !controller.signal.aborted && serial === sequence.current;
    setState({ kind: watch.current ? 'queued' : 'loading', warnings: [], startedAt });
    const fail = (error: unknown) => {
      if (!current() || isAbort(error)) return;
      setState({
        kind: error instanceof ConnectionError && error.kind === 'invalid_response' ? 'protocol_error' : 'source_error',
        warnings: [],
      });
    };
    const errorState = (data: ObjectValue, httpStatus: number) => {
      if (data.status === 'not_applicable') {
        watch.current = undefined;
        setState({ kind: 'insufficient_for_test', reason: 'no_abrupt_change', warnings: [] });
        return true;
      }
      if (data.status === 'not_found' || httpStatus === 404) {
        watch.current = undefined;
        setState({ kind: 'not_found', warnings: [] });
        return true;
      }
      if (data.status === 'not_implemented') {
        watch.current = undefined;
        setState({ kind: 'not_implemented', warnings: [] });
        return true;
      }
      if (httpStatus >= 400 || data.status === 'source_error' || data.status === 'invalid_request') {
        watch.current = undefined;
        setState({ kind: 'source_error', warnings: [] });
        return true;
      }
      return false;
    };
    const ready = (data: ObjectValue) => {
      if (
        data.analysis_id !== analysisId ||
        data.change_id !== changeId ||
        !safeId(data.investigation_id) ||
        data.status !== 'complete' ||
        !isObject(data.conclusion) ||
        !isObject(data.features) ||
        !isObject(data.eonet)
      )
        throw new ConnectionError('invalid_response');
      watch.current = undefined;
      setState({ kind: 'ready', warnings: [], result: data });
    };
    const accept = async (data: ObjectValue, httpStatus: number): Promise<void> => {
      if (!current()) return;
      if (errorState(data, httpStatus)) return;
      if (data.status === 'failed') {
        watch.current = undefined;
        setState({ kind: 'source_error', warnings: [] });
        return;
      }
      if (data.status === 'queued' || data.status === 'running') {
        if (!safeId(data.job_id) || (data.kind !== undefined && data.kind !== 'investigation'))
          throw new ConnectionError('invalid_response');
        if (isObject(data.request) && (data.request.analysis_id !== analysisId || data.request.change_id !== changeId))
          throw new ConnectionError('invalid_response');
        watch.current = data.job_id;
        setState({
          kind: data.status,
          warnings: [],
          startedAt,
          jobId: data.job_id,
          stage: typeof data.stage === 'string' ? data.stage : undefined,
          progress: readProgress(data),
          estimateSeconds: readEstimate(data),
        });
        const jobId = data.job_id,
          delay =
            typeof data.next_poll_s === 'number' && Number.isFinite(data.next_poll_s)
              ? Math.min(30, Math.max(1, data.next_poll_s)) * 1000
              : 10000;
        timer.current = setTimeout(() => {
          if (current()) void poll(jobId);
        }, delay);
        return;
      }
      if (data.status === 'complete' && isObject(data.result)) {
        if (data.result.type !== 'investigation' || !safeId(data.result.id)) throw new ConnectionError('invalid_response');
        const result = await apiRequest(`/investigations/${encodeURIComponent(data.result.id)}`, { signal: controller.signal });
        if (!current()) return;
        if (!errorState(result.data, result.httpStatus)) ready(result.data);
        return;
      }
      ready(data);
    };
    const poll = async (jobId: string) => {
      try {
        const response = await apiRequest(`/jobs/${encodeURIComponent(jobId)}`, { signal: controller.signal });
        await accept(response.data, response.httpStatus);
      } catch (error) {
        fail(error);
      }
    };
    if (watch.current) void poll(watch.current);
    else
      void apiRequest('/investigations', { signal: controller.signal, body: { analysis_id: analysisId, change_id: changeId } })
        .then((r) => accept(r.data, r.httpStatus))
        .catch(fail);
  }, [analysisId, changeId, stop]);
  return { state, run };
}
