import { useState } from 'react';
import { record, safeLink } from './analysis';
import type { ObjectValue } from './contract';
import { isMonth } from './contract';
import { boundariesFrom } from './ChangePanel';
import { month, monthIndex } from './format';
import { References } from './Mode2Conclusion';
import type { GlobeEvent } from './globeChanges';

export interface TimelineStory {
  id: string;
  date: string;
  kind: 'jump' | 'product' | 'event';
  title: string;
  body: string;
  references: ObjectValue[];
}
/** Every story has a source date and decision; prose never introduces an event. */
export function timelineStories(
  data?: ObjectValue,
  context?: ObjectValue,
  boundaries: ObjectValue[] = [],
  events: GlobeEvent[] = [],
): TimelineStory[] {
  const result: TimelineStory[] = [],
    cp = record(record(data?.breaks).change_point);
  if (isMonth(cp.date) && ['detected', 'inconclusive'].includes(String(cp.status)))
    result.push({
      id: 'native-jump',
      date: cp.date,
      kind: 'jump',
      title: cp.status === 'detected' ? 'Sudden jump' : 'Possible jump',
      body:
        cp.status === 'detected'
          ? 'The point record favours a sudden jump over a gradual line.'
          : 'The point record cannot clearly separate a jump from a gradual trend.',
      references: [],
    });
  for (const b of [...(data ? boundariesFrom(data) : []), ...boundaries])
    if (isMonth(b.date) && !result.some((s) => s.id === `boundary-${b.boundary_id ?? b.id ?? b.date}`)) {
      const reference = record(b.reference),
        refs = safeLink(reference.url) ? [reference] : safeLink(b.reference) ? [{ title: 'Product documentation', url: b.reference }] : [];
      if (refs.length)
        result.push({
          id: `boundary-${b.boundary_id ?? b.id ?? b.date}`,
          date: b.date,
          kind: 'product',
          title: 'Product changed',
          body: typeof b.title === 'string' ? b.title : 'A documented product change occurred at this date.',
          references: refs,
        });
    }
  const matched = record(context?.conclusion).known_events;
  if (Array.isArray(matched))
    for (const value of matched) {
      const e = record(value),
        date = String(record(e.dates).start ?? '').slice(0, 7),
        sources = Array.isArray(e.sources) ? e.sources.map(record).filter((s) => safeLink(s.url)) : [];
      if (isMonth(date) && typeof e.title === 'string' && sources.length)
        result.push({
          id: `event-${e.event_id}`,
          date,
          kind: 'event',
          title: e.title,
          body: 'A documented event matches the backend’s place, time and variable checks; it is not proof of a cause.',
          references: sources,
        });
    }
  for (const e of events)
    if (!result.some((s) => s.id === `event-${e.id}`))
      result.push({
        id: `event-${e.id}`,
        date: e.start,
        kind: 'event',
        title: e.title,
        body: 'Documented context for this variable. Its map marker represents an approximate region; no match to the selected point is assumed.',
        references: e.sources,
      });
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
const symbols = { jump: '↳', product: '▱', event: '◇' };
export function TimelineStories({
  stories,
  first,
  last,
  year,
  onEvidence,
}: {
  stories: TimelineStory[];
  first: number;
  last: number;
  year?: number;
  onEvidence: () => void;
}) {
  const [selected, setSelected] = useState<string>(),
    active = stories.find((s) => s.id === selected),
    visible = stories.filter((s) => Number(s.date.slice(0, 4)) >= first && Number(s.date.slice(0, 4)) <= last),
    lanes: number[] = [],
    layout = visible.map((story) => {
      const position = ((monthIndex(story.date) / 12 - first + 1 / 24) / Math.max(1, last - first + 1)) * 100;
      let lane = lanes.findIndex((end) => position - end > 14);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = position;
      return { story, position, lane };
    });
  return (
    <>
      {visible.length > 0 && (
        <div
          className="timeline-stories"
          style={{ height: Math.max(1, lanes.length) * 24 + 12 }}
          aria-label="Changes and documented context on the time axis"
        >
          {layout.map(({ story, position, lane }) => (
            <button
              key={story.id}
              className={`timeline-story story-${story.kind}`}
              aria-expanded={selected === story.id}
              aria-label={`${month(story.date)} · ${story.title}`}
              style={{ left: `${Math.max(5, Math.min(95, position))}%`, top: lane * 24 }}
              onClick={() => setSelected((old) => (old === story.id ? undefined : story.id))}
            >
              <span aria-hidden="true">{symbols[story.kind]}</span>
              <span>
                {month(story.date)}
                <small>{story.title}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {active && (
        <aside className="timeline-story-detail" aria-live="polite">
          <div>
            <strong>
              {symbols[active.kind]} {month(active.date)} · {active.title}
            </strong>
            <p>{active.body}</p>
            <References value={active.references} />
          </div>
          <button className="text-button" onClick={onEvidence}>
            Evidence ↗
          </button>
          <button aria-label="Close timeline message" onClick={() => setSelected(undefined)}>
            ×
          </button>
        </aside>
      )}
      {stories.some((s) => Number(s.date.slice(0, 4)) === year) && (
        <div className="year-story-caption" role="status">
          {stories
            .filter((s) => Number(s.date.slice(0, 4)) === year)
            .map((s) => (
              <button key={s.id} className="text-button" onClick={() => setSelected(s.id)}>
                {symbols[s.kind]} {year} · {s.kind === 'product' ? s.body : s.title} ↗
              </button>
            ))}
        </div>
      )}
    </>
  );
}
