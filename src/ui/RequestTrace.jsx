import React, { useMemo, useState } from 'react';
import { analyzeTrace } from '../analysis/traceAnalysis.js';
function fmt(ms){return `${Number(ms||0).toFixed(1)} ms`;}

function TypeBadge({ type }) { return <em className={`typeBadge ${type}`}>{type}</em>; }

export function RequestTrace({ trace, graph }) {
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [allSpans, setAllSpans] = useState(false);
  const [text, setText] = useState('');
  const analysis = useMemo(() => analyzeTrace(trace, graph), [trace, graph]);
  const repeatedKeys = new Set(analysis.hopGroups.filter(g => g.calls > 1).map(g => `${g.source}-->${g.target}::${g.label}`));
  const q = text.trim().toLowerCase();
  const rows = allSpans ? analysis.spanTimeline : analysis.hops;
  const filtered = rows.filter(h => {
    const key = `${h.source || h.service}-->${h.target || ''}::${h.label}`;
    if (!allSpans && onlyRepeated && !repeatedKeys.has(key)) return false;
    if (q && !(`${h.source || ''} ${h.target || ''} ${h.service || ''} ${h.label} ${h.spanName || h.name || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const start = analysis.roots[0];
  const end = analysis.endSpans[0];

  return <section className="card requestTrace">
    <div className="cardHeader"><div><h2>Full request path</h2><p>Chronological view of every boundary hop. Toggle all spans when you need the absolute full picture, including middleware/internal spans.</p></div><span>{filtered.length} rows</span></div>
    <div className="routeSummary">
      <div><span>Started</span><b>{start ? start.service : '-'}</b><small>{start ? start.label : ''}</small></div>
      <div><span>Ended/latest leaf</span><b>{end ? end.service : '-'}</b><small>{end ? end.label : ''}</small></div>
      <div><span>Wall time</span><b>{fmt(trace.wallTimeMs)}</b><small>{analysis.metrics.spanCount} spans</small></div>
      <div><span>Service hops</span><b>{analysis.metrics.serviceHopCount}</b><small>{analysis.metrics.uniqueServiceHopCount} unique edges</small></div>
      <div><span>Critical path</span><b>{analysis.metrics.criticalPathLength} steps</b><small>{fmt(analysis.metrics.criticalPathDurationMs)}</small></div>
    </div>
    <div className="traceControls">
      <input placeholder="Filter source, target, endpoint, span..." value={text} onChange={e=>setText(e.target.value)} />
      <label className="check"><input type="checkbox" checked={onlyRepeated} disabled={allSpans} onChange={e=>setOnlyRepeated(e.target.checked)} /> Repeated hops only</label>
      <label className="check"><input type="checkbox" checked={allSpans} onChange={e=>setAllSpans(e.target.checked)} /> Show all spans</label>
    </div>
    {!allSpans && <div className="timelineList">
      {filtered.map((h, idx) => {
        const repeated = repeatedKeys.has(`${h.source}-->${h.target}::${h.label}`);
        return <div className={`hopRow ${repeated ? 'isRepeated' : ''}`} key={h.id}>
          <div className="hopIndex">{idx + 1}</div>
          <div className="hopTime">+{fmt(h.startOffsetMs)}<br/><b>{fmt(h.durationMs)}</b></div>
          <div className="hopMain"><div><b>{h.source}</b> <span>→</span> <b>{h.target}</b> <TypeBadge type={h.type}/>{repeated && <strong className="repeatBadge">repeated</strong>}</div><p>{h.label}</p><small>{h.note}</small></div>
          <div className="hopStatus">{h.status}</div>
        </div>;
      })}
    </div>}
    {allSpans && <div className="tableWrap"><table className="dataTable"><thead><tr><th>#</th><th>Offset</th><th>Duration</th><th>Service</th><th>Target</th><th>Type</th><th>Operation</th><th>Status</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id} className={r.isBoundary ? 'boundaryRow' : ''}><td>{r.index}</td><td>+{fmt(r.startOffsetMs)}</td><td>{fmt(r.durationMs)}</td><td>{r.service}</td><td>{r.target || r.parentService || '-'}</td><td>{r.type}</td><td title={r.name}>{r.label}</td><td>{r.status}</td></tr>)}</tbody></table></div>}
  </section>;
}
