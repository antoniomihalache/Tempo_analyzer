import React, { useMemo, useState } from 'react';

function pct(v, t) {
  return t ? Math.max(0, Math.min(100, (v / t) * 100)) : 0;
}

function sortRows(spans, mode) {
  const rows = spans.slice();
  if (mode === 'duration') {
    return rows.sort((a, b) => b.durationMs - a.durationMs || a.startOffsetMs - b.startOffsetMs).slice(0, 100);
  }
  return rows.sort((a, b) => a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs || a.service.localeCompare(b.service));
}

function shortServiceName(service = '') {
  return String(service || '')
    .replace(/^xc1p-/, '')
    .replace(/^xc1-/, '')
    .replace(/configurations-orchestrator/g, 'config-orch')
    .replace(/certificates-manager/g, 'cert-manager')
    .replace(/inventory-analytics/g, 'inv-analytics')
    .replace(/predictive-analytics/g, 'pred-analytics')
    .replace(/data-forwarder/g, 'data-fwd')
    .replace(/hub-gateway/g, 'hub-gw')
    .replace(/service-support/g, 'svc-support')
    .replace(/organizations/g, 'orgs')
    .replace(/monitoring/g, 'monitor')
    .replace(/knowledge/g, 'knowledge')
    .replace(/mongodb/i, 'MongoDB')
    .replace(/rabbitmq/i, 'RabbitMQ');
}

function timelineClass(type = '') {
  if (type === 'database') return 'database';
  if (type === 'messaging') return 'messaging';
  if (type === 'http-client' || type === 'http-server') return 'http';
  return 'internal';
}

function timeTicks(wallTimeMs) {
  const max = Math.max(1, wallTimeMs || 1);
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    left: ratio * 100,
    label: `${Math.round(max * ratio)} ms`
  }));
}

function TimelineCell({ span, wallTimeMs }) {
  const left = pct(span.startOffsetMs, wallTimeMs);
  const rawWidth = pct(span.durationMs, wallTimeMs);
  const width = Math.max(0.35, rawWidth);
  const label = span.durationMs >= 15 ? `${span.durationMs.toFixed(1)} ms` : '';

  return (
    <div className="waterfallTimelineTrack" title={`Start +${span.startOffsetMs.toFixed(1)} ms, duration ${span.durationMs.toFixed(1)} ms`}>
      <div
        className={`waterfallSpanBar ${timelineClass(span.type)}`}
        style={{
          left: `${left}%`,
          width: `${width}%`
        }}
      >
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Waterfall({ trace }) {
  const [sortMode, setSortMode] = useState('time');
  const rows = useMemo(() => sortRows(trace.spans, sortMode), [trace.spans, sortMode]);
  const ticks = useMemo(() => timeTicks(trace.wallTimeMs), [trace.wallTimeMs]);

  return (
    <section className="card waterfallCard">
      <div className="cardHeader">
        <div>
          <h2>Waterfall</h2>
          <span>
            {sortMode === 'time'
              ? 'Spans ordered by start time, exactly as they happened in the trace.'
              : 'Top 100 spans ordered by duration.'}
          </span>
        </div>
        <div className="controls compactControls">
          <label>
            Sort
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
              <option value="time">Start time / occurrence order</option>
              <option value="duration">Duration / slowest first</option>
            </select>
          </label>
        </div>
      </div>

      <div className="waterfallLegend">
        <span>Wall time: {trace.wallTimeMs.toFixed(1)} ms</span>
        <span>Rows: {rows.length}</span>
        <span>{sortMode === 'time' ? 'Chronological view' : 'Slowest spans view'}</span>
        <span className="legendHttp">HTTP</span>
        <span className="legendDb">Database</span>
        <span className="legendMq">Messaging</span>
        <span className="legendInternal">Internal</span>
      </div>

      <div className="waterfallRuler" aria-hidden="true">
        {ticks.map((tick) => (
          <div key={tick.left} className="waterfallTick" style={{ left: `${tick.left}%` }}>
            <span>{tick.label}</span>
          </div>
        ))}
      </div>

      <div className="tableWrap waterfallWrap">
        <table className="dataTable waterfallTable">
          <colgroup>
            <col className="wfNo" />
            <col className="wfStart" />
            <col className="wfService" />
            <col className="wfType" />
            <col className="wfSpan" />
            <col className="wfStatus" />
            <col className="wfDuration" />
            <col className="wfTimeline" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Start</th>
              <th>Service</th>
              <th>Type</th>
              <th>Span</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Timeline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, index) => (
              <tr key={s.id} className={`wfRow wf-${timelineClass(s.type)}`}>
                <td>{index + 1}</td>
                <td>+{s.startOffsetMs.toFixed(1)} ms</td>
                <td title={s.service} className="wfServiceCell">{shortServiceName(s.service)}</td>
                <td><span className={`typePill ${timelineClass(s.type)}`}>{s.type}</span></td>
                <td title={s.name}>{s.name}</td>
                <td>{s.status || s.statusCode || '-'}</td>
                <td>{s.durationMs.toFixed(1)} ms</td>
                <td><TimelineCell span={s} wallTimeMs={trace.wallTimeMs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
