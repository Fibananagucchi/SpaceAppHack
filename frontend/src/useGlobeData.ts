import { useEffect, useState } from 'react';
import { apiRequest, isAbort } from './api';
import { parseGlobeFrames, parseNeighborStrip, validateDisplayGrid } from './globeData';
import type { GlobeFrames, NeighborStrip, GlobeDomain } from './globeData';
import { parseTrendMap } from './trendMap';
import type { TrendMap } from './trendMap';
import type { ObjectValue, Variable } from './contract';
import { record } from './analysis';

export interface GlobeResource<T> {
  kind: 'loading' | 'ready' | 'not_available' | 'error';
  data?: T;
  key: string;
  domain?: GlobeDomain;
  notice?: string;
}

/** Layers are rebuilt by the pipeline every few days: a slow heartbeat plus focus/visibility checks is enough. */
export const GLOBE_POLL_MS = 5 * 60 * 1000;

type LayerType = 'frames' | 'trend';
const NOT_PUBLISHED = ['not_ready', 'not_available', 'not_found'];
const NOTICE = {
  europeOnly: 'Europe only · world layer is not ready for this view.',
  worldFailed: 'World layer unavailable · showing Europe only.',
  worldRefreshFailed: 'World refresh failed · showing the last loaded world layer.',
  indexFailed: 'Europe only · world availability could not be checked.',
};

/** One shared request for the availability index, so concurrent hooks do not each ask for it. */
let indexInFlight: Promise<ObjectValue> | undefined;
export function fetchGlobeIndex(signal: AbortSignal): Promise<ObjectValue> {
  if (!indexInFlight) {
    const controller = new AbortController();
    indexInFlight = apiRequest('/globe', { signal: controller.signal, timeout: 10000 })
      .then((r) => {
        if (r.httpStatus !== 200 || !Array.isArray(r.data.layers)) throw Error('availability_unavailable');
        return r.data;
      })
      .finally(() => {
        indexInFlight = undefined;
      });
  }
  const shared = indexInFlight;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Parsed layers by URL and revision: switching back to a variable reuses them without a download. */
const parsedCache = new Map<string, { revision: string; data: unknown }>();
const PARSED_CACHE_LIMIT = 8;
export const clearGlobeCache = () => parsedCache.clear();
function remember(url: string, revision: string, data: unknown) {
  parsedCache.delete(url);
  parsedCache.set(url, { revision, data });
  while (parsedCache.size > PARSED_CACHE_LIMIT) parsedCache.delete(parsedCache.keys().next().value!);
}

/** Load the real layer of the domain the index says is ready (world first); Europe is only a fallback. */
export function useGlobeData(
  variable: Variable | undefined,
  refresh: number,
): { frames: GlobeResource<GlobeFrames>; map: GlobeResource<TrendMap> } {
  const id = variable?.variable_id ?? '';
  const [frames, setFrames] = useState<GlobeResource<GlobeFrames>>({ kind: 'loading', key: '' });
  const [map, setMap] = useState<GlobeResource<TrendMap>>({ kind: 'loading', key: '' });

  useEffect(() => {
    if (!id) return;
    const c = new AbortController();
    let live = true;
    let checking = false;
    setFrames({ kind: 'loading', key: id });
    setMap({ kind: 'loading', key: id });
    if (variable?.capabilities.map_europe !== 'precomputed') {
      setFrames({ kind: 'not_available', key: id });
      setMap({ kind: 'not_available', key: id });
      return () => c.abort();
    }
    const active = () => live && !c.signal.aborted;
    const loaded = new Map<string, string>();
    const pending = new Set<string>();

    async function load<T extends { raw: Record<string, unknown> }>(
      domain: GlobeDomain,
      type: LayerType,
      parse: (d: ObjectValue) => T,
      set: (fn: (old: GlobeResource<T>) => GlobeResource<T>) => void,
      revision: string,
      notice?: string,
    ): Promise<boolean> {
      const key = `${domain}/${type}`;
      if (loaded.get(key) === revision || pending.has(key)) return true;
      pending.add(key);
      const url = `/globe/${domain}/${encodeURIComponent(id)}${type === 'trend' ? '/trend' : ''}`;
      try {
        let data: T;
        const cached = parsedCache.get(url);
        if (cached && cached.revision === revision && revision !== 'unknown') data = cached.data as T;
        else {
          // 'no-cache' revalidates with the server's ETag: an unchanged layer answers 304 without a body.
          const r = await apiRequest(url, { signal: c.signal, cache: 'no-cache' });
          if (!active()) return true;
          if (NOT_PUBLISHED.includes(String(r.data.status))) return false;
          if (r.httpStatus !== 200) throw Error('layer_unavailable');
          validateDisplayGrid(r.data, domain);
          data = parse(r.data);
          remember(url, revision, data);
        }
        if (!active()) return true;
        loaded.set(key, revision);
        set((old) => {
          if (domain === 'europe' && old.domain === 'world' && old.key === id) return old;
          const computed = data.raw.computed_at;
          if (old.key === id && old.domain === domain && typeof computed === 'string' && old.data?.raw.computed_at === computed)
            return old.notice !== notice ? { ...old, notice } : old;
          return { key: id, kind: 'ready', data, domain, notice };
        });
        return true;
      } catch (e) {
        if (!active() || isAbort(e)) return true;
        if (domain === 'world') {
          let kept = false;
          set((old) => {
            if (old.key !== id || old.domain !== 'world' || !old.data) return old;
            kept = true;
            return { ...old, notice: NOTICE.worldRefreshFailed };
          });
          return kept;
        }
        set((old) => (old.key === id && old.domain === 'world' ? old : { key: id, kind: 'error' }));
        return true;
      } finally {
        pending.delete(key);
      }
    }

    const parsers = {
      frames: (d: ObjectValue) => parseGlobeFrames(d, id),
      trend: (d: ObjectValue) => parseTrendMap(d, id),
    };
    const loadLayer = async (
      type: LayerType,
      world: Record<string, unknown> | undefined,
      europe: Record<string, unknown> | undefined,
      indexNotice?: string,
    ) => {
      const run = <T extends { raw: Record<string, unknown> }>(
        set: (fn: (old: GlobeResource<T>) => GlobeResource<T>) => void,
        parse: (d: ObjectValue) => T,
      ) => ({
        world: (revision: string) => load('world', type, parse, set, revision),
        europe: (revision: string, notice: string) => load('europe', type, parse, set, revision, notice),
        missing: () => set((old) => (old.key === id && old.data ? old : { key: id, kind: 'not_available' })),
      });
      const loader = type === 'frames' ? run(setFrames, parsers.frames) : run(setMap, parsers.trend);
      const revisionOf = (meta: Record<string, unknown> | undefined) =>
        typeof meta?.computed_at === 'string' ? meta.computed_at : 'unknown';
      if (world?.status === 'ok' && (await loader.world(revisionOf(world)))) return;
      if (!active()) return;
      const notice = indexNotice ?? (world?.status === 'ok' ? NOTICE.worldFailed : NOTICE.europeOnly);
      if (europe && europe.status !== 'ok') return loader.missing();
      if (!(await loader.europe(revisionOf(europe), notice)) && active()) loader.missing();
    };

    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        let entry: Record<string, unknown> | undefined;
        let indexNotice: string | undefined;
        try {
          const index = await fetchGlobeIndex(c.signal);
          entry = (index.layers as unknown[]).map(record).find((v) => v.variable_id === id);
        } catch (e) {
          if (isAbort(e) || !active()) return;
          indexNotice = NOTICE.indexFailed;
        }
        if (!active()) return;
        const world = entry ? record(entry.world) : undefined;
        const europe = entry && entry.europe !== undefined ? record(entry.europe) : undefined;
        await Promise.all(
          (['frames', 'trend'] as const).map((type) =>
            loadLayer(type, world && record(world[type]), europe && record(europe[type]), indexNotice),
          ),
        );
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), GLOBE_POLL_MS);
    const focus = () => void check();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      live = false;
      c.abort();
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [id, variable?.capabilities.map_europe, refresh]);

  return {
    frames: frames.key === id ? frames : { kind: 'loading' as const, key: id },
    map: map.key === id ? map : { kind: 'loading' as const, key: id },
  };
}

export function useNeighborStrip(
  id: string,
  point: { lat: number; lon: number } | undefined,
  refresh: number,
  domain: GlobeDomain = 'europe',
): GlobeResource<NeighborStrip> {
  const key = point ? JSON.stringify([id, point.lat, point.lon, domain]) : '';
  const [resource, setResource] = useState<GlobeResource<NeighborStrip>>({ kind: 'not_available', key: '' });
  useEffect(() => {
    if (!point || !id) {
      setResource({ kind: 'not_available', key });
      return;
    }
    const c = new AbortController();
    setResource({ kind: 'loading', key });
    void apiRequest(`/globe/${domain}/${encodeURIComponent(id)}/strip?lat=${point.lat}&lon=${point.lon}&ring=1`, { signal: c.signal })
      .then((r) => {
        if (c.signal.aborted) return;
        if (['not_available', 'not_ready'].includes(String(r.data.status))) {
          setResource({ kind: 'not_available', key, domain });
          return;
        }
        if (r.httpStatus !== 200) throw Error();
        setResource({ kind: 'ready', key, domain, data: parseNeighborStrip(r.data, id) });
      })
      .catch((e) => {
        if (!c.signal.aborted && !isAbort(e)) setResource({ kind: 'error', key, domain });
      });
    return () => c.abort();
  }, [key, refresh]);
  return resource.key === key ? resource : { kind: 'loading' as const, key };
}
