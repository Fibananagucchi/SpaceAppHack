import type { ObjectValue } from './contract';
import { isMonth, isObject } from './contract';
import { finite, record, safeLink, text, unavailable } from './analysis';
import { month, number, pValue, signed } from './format';
import type { ChartMarker } from './TimeSeries';

export const referenceUrl = (value: unknown): string | undefined => safeLink(value) ?? safeLink(record(value).url);
export function boundariesFrom(data: ObjectValue): ObjectValue[] {
  return Array.isArray(data.warnings)
    ? data.warnings.filter(isObject).filter((w) => w.code === 'product_boundary_in_period' && isMonth(w.date) && referenceUrl(w.reference))
    : [];
}
export function markersFrom(data: ObjectValue): ChartMarker[] {
  const breaks = record(data.breaks),
    change = record(breaks.change_point),
    outliers = record(breaks.outliers);
  const markers: ChartMarker[] = [];
  if (typeof change.change_id === 'string' && isMonth(change.date) && ['detected', 'inconclusive'].includes(String(change.status)))
    markers.push({
      id: change.change_id,
      date: change.date,
      kind: 'change',
      label: change.status === 'detected' ? 'Possible level change' : 'Unresolved candidate',
      tentative: change.status === 'inconclusive',
    });
  for (const b of boundariesFrom(data))
    markers.push({ id: `boundary-${text(b.boundary_id)}`, date: String(b.date), kind: 'boundary', label: 'Documented product boundary' });
  if (outliers.status === 'ok' && Array.isArray(outliers.items))
    for (const row of outliers.items.filter(isObject)) {
      if (isMonth(row.t) && finite(row.anomaly))
        markers.push({ id: `outlier-${row.t}`, date: row.t, kind: 'outlier', label: 'Flagged observation' });
    }
  return markers;
}

function Segment({ value, index }: { value: ObjectValue; index: number }) {
  const period = record(value.period),
    sen = record(value.sen_slope),
    mk = record(value.mann_kendall),
    ci = record(sen.ci);
  const available = value.status === 'ok';
  return (
    <article className="segment-card">
      <p className="eyebrow">
        {index === 0 ? 'Before' : 'After'} / {month(period.start)} — {month(period.end)}
      </p>
      <h4>{available && finite(sen.estimate) ? `${signed(sen.estimate)} ${text(sen.unit)}` : 'Segment estimate unavailable'}</h4>
      <p className="field-help">{number(value.n_valid)} valid months · common full-period anomaly baseline</p>
      {available ? (
        <>
          {finite(ci.low) && finite(ci.high) && (
            <p className="metric-detail">
              {number(Number(ci.level) * 100)}% CI: {signed(ci.low)} to {signed(ci.high)}
            </p>
          )}
          {finite(mk.p_value) && typeof mk.significant === 'boolean' ? (
            <p className="metric-detail">
              MK p = {pValue(mk.p_value)} · {mk.significant ? 'Trend detected' : 'Trend not detected'}
            </p>
          ) : (
            <p className="field-help">Segment trend test unavailable.</p>
          )}
        </>
      ) : (
        <p className="field-help">
          {value.reason === 'too_short' ? 'Too few valid months for this segment’s trend test.' : unavailable(value)}
        </p>
      )}
    </article>
  );
}

const changeCopy: Record<string, { title: string; body: string }> = {
  detected: { title: 'A possible level change.', body: 'The test favours a jump over a gradual line; this does not identify its cause.' },
  not_detected: { title: 'No change detected by this test.', body: 'This test found no jump; it may still miss changes.' },
  not_distinct_from_trend: { title: 'A gradual trend remains plausible.', body: 'A gradual line fits better than a sudden jump.' },
  inconclusive: { title: 'Step or gradual trend?', body: 'This record does not clearly separate a jump from a gradual trend.' },
};

export function ChangePanel({ data, selected, onSelect }: { data: ObjectValue; selected?: string; onSelect: (id: string) => void }) {
  const breaks = record(data.breaks),
    cp = record(breaks.change_point),
    shift = record(cp.shift),
    comparison = record(cp.model_comparison),
    outliers = record(breaks.outliers);
  const boundaries = boundariesFrom(data),
    segments = Array.isArray(breaks.segments) ? breaks.segments.filter(isObject) : [];
  const outlierItems = Array.isArray(outliers.items)
    ? outliers.items.filter(isObject).filter((p) => isMonth(p.t) && finite(p.anomaly))
    : [];
  const activeOutlier = outlierItems.find((p) => `outlier-${p.t}` === selected);
  const activeBoundary = boundaries.find((b) => `boundary-${text(b.boundary_id)}` === selected);
  const info = changeCopy[String(cp.status)];
  const conditions = record(breaks.conditions);
  return (
    <section id="changes" tabIndex={-1} className="change-panel" aria-label="Change-point inspection">
      <div className="change-heading">
        <p className="eyebrow">Change seam / basic change inspection</p>
        <h3>Look beyond one slope.</h3>
        <p>Select a marker to inspect what changed.</p>
      </div>
      {breaks.status !== 'ok' ? (
        <div className="warning-notice">
          <div>
            <strong>
              {breaks.status === 'insufficient_for_test'
                ? 'Change analysis unavailable for this series.'
                : 'Change analysis is not available yet.'}
            </strong>
            <p>
              {breaks.status === 'insufficient_for_test'
                ? unavailable(breaks)
                : 'The service has not returned a change analysis. No seam, date or explanation has been substituted.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="seam-summary" data-selected={selected === cp.change_id}>
            {typeof cp.change_id === 'string' && isMonth(cp.date) && ['detected', 'inconclusive'].includes(String(cp.status)) && (
              <button className="seam-select" aria-pressed={selected === cp.change_id} onClick={() => onSelect(String(cp.change_id))}>
                ↳ Inspect {month(cp.date)}
              </button>
            )}
            <h4>{info?.title ?? 'Change result unavailable.'}</h4>
            <p>{info?.body ?? 'The response contains an unrecognised change state. No conclusion has been substituted.'}</p>
            <dl className="change-metrics">
              <div>
                <dt>Pettitt p-value</dt>
                <dd>
                  {pValue(cp.p_value)} · α = {number(cp.alpha)}
                </dd>
              </div>
              {isMonth(cp.date) && (
                <div>
                  <dt>First valid month after division</dt>
                  <dd>{month(cp.date)}</dd>
                </div>
              )}
              {finite(shift.estimate) && (
                <div>
                  <dt>Median anomaly shift (after − before)</dt>
                  <dd>
                    {signed(shift.estimate)} {text(shift.unit)}
                  </dd>
                </div>
              )}
              {comparison.status === 'ok' && (
                <div>
                  <dt>Model comparison</dt>
                  <dd>
                    ΔBIC = {number(comparison.delta_bic)} ·{' '}
                    {comparison.preferred === 'step'
                      ? 'step favoured'
                      : comparison.preferred === 'line'
                        ? 'line favoured'
                        : 'neither favoured'}
                  </dd>
                </div>
              )}
            </dl>
            {breaks.trend_affected_by_change === true && (
              <aside className="warning-notice">
                <p>
                  A possible abrupt change may affect the whole-period trend estimate. Compare both segments before interpreting a single
                  slope.
                </p>
              </aside>
            )}
            {breaks.trend_affected_by_change === null && (
              <p className="field-help">The effect of this candidate on the whole-period trend has not been established.</p>
            )}
          </div>
          {(activeOutlier || activeBoundary) && (
            <aside className="selected-marker-detail" aria-live="polite">
              <p className="eyebrow">Selected chart marker</p>
              <h4>
                {activeBoundary ? 'Documented product boundary' : 'Flagged observation'} /{' '}
                {month((activeBoundary ?? activeOutlier)!.date ?? activeOutlier?.t)}
              </h4>
              {activeBoundary ? (
                <>
                  <p>{text(activeBoundary.title)}</p>
                  <a href={referenceUrl(activeBoundary.reference)} target="_blank" rel="noreferrer">
                    Product documentation ↗
                  </a>
                  <p>A documented product change is not proof that an observed change is an artifact.</p>
                </>
              ) : (
                <>
                  <p>
                    Anomaly: {number(activeOutlier!.anomaly, 6)} {text(record(data.series).unit)} · robust z ={' '}
                    {number(activeOutlier!.robust_z)}
                  </p>
                  <p>This observation remains in the series and its statistics. A flag is not a determination that it is erroneous.</p>
                </>
              )}
            </aside>
          )}
          {segments.length > 0 && (
            <div className="segment-comparison">
              <h4>Before and after / context, not attribution</h4>
              <p className="field-help">
                The same full-period monthly anomaly baseline is retained on both sides. Segment tests have their own data requirements.
              </p>
              <div className="segment-grid">
                {segments.map((s, i) => (
                  <Segment key={i} value={s} index={i} />
                ))}
              </div>
            </div>
          )}
          <details className="change-methods">
            <summary>Method, conditions and limits</summary>
            <p>{text(breaks.method)}</p>
            <p>
              Required: {number(conditions.min_valid_months)} valid months, valid fraction ≥ {number(conditions.min_valid_fraction)}, at
              least {number(conditions.min_months_each_side)} valid months on each side. Segment trend tests require{' '}
              {number(conditions.min_months_for_segment_trend)} valid months.
            </p>
            <p>{text(comparison.method)}</p>
            {typeof comparison.rule === 'string' && <p>{comparison.rule}</p>}
            <p>
              Neither this Pettitt p-value nor the BIC comparison adjusts for autocorrelation. Treat this as exploratory evidence. The
              candidate is found on monthly anomalies even when the chart displays raw observations. The single-change method can miss
              several changes. Dates are limited by missing observations and monthly resolution.
            </p>
            <p>
              Processing: {text(breaks.processing_version)}.{' '}
              <a href="https://doi.org/10.2307/2346729" target="_blank" rel="noreferrer">
                Pettitt test
              </a>{' '}
              ·{' '}
              <a href="https://doi.org/10.1080/01621459.1995.10476572" target="_blank" rel="noreferrer">
                BIC evidence scale
              </a>
            </p>
          </details>
        </>
      )}
      <details className="outlier-list">
        <summary>Flagged observations / {outliers.status === 'ok' ? number(outlierItems.length) : 'unavailable'}</summary>
        <p className="field-help">{outliers.status === 'ok' ? text(outliers.method) : unavailable(outliers)}</p>
        {outliers.status === 'ok' &&
          (outlierItems.length === 0 ? (
            <p>No observations were flagged by this method. That does not prove there are no unusual values.</p>
          ) : (
            <ul>
              {outlierItems.map((p) => (
                <li key={String(p.t)}>
                  <button aria-pressed={selected === `outlier-${p.t}`} onClick={() => onSelect(`outlier-${p.t}`)}>
                    ○ {month(p.t)} · anomaly {number(p.anomaly, 6)} {text(record(data.series).unit)} · z {number(p.robust_z)}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </details>
      <details className="boundary-list">
        <summary>Documented product boundaries / {number(boundaries.length)}</summary>
        {boundaries.length === 0 ? (
          <p>No documented product boundary was returned for this period. This does not exclude an undocumented change.</p>
        ) : (
          <ul>
            {boundaries.map((b) => (
              <li key={text(b.boundary_id)}>
                <button
                  aria-pressed={selected === `boundary-${text(b.boundary_id)}`}
                  onClick={() => onSelect(`boundary-${text(b.boundary_id)}`)}
                >
                  │ {month(b.date)} · {text(b.title)}
                </button>
                <a href={referenceUrl(b.reference)} target="_blank" rel="noreferrer">
                  Documentation ↗
                </a>
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(breaks.near_product_boundary) && breaks.near_product_boundary.length > 0 && (
          <p className="field-help">
            The service flags a product boundary near the candidate date. Temporal proximity does not establish a cause.
          </p>
        )}
      </details>
      <p className="field-help">
        This section describes a statistical change. Use the separate wider-context check to inspect features, product changes and event
        observations.
      </p>
    </section>
  );
}
