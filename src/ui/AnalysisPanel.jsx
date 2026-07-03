import React, { useMemo } from 'react';
import { analyzeTrace } from '../analysis/traceAnalysis.js';
import { spanLabel } from '../parser/tempoParser.js';
function fmt(ms){return `${Number(ms||0).toFixed(1)} ms`;}

export function AnalysisPanel({ trace, graph }) {
  const a = useMemo(() => analyzeTrace(trace, graph), [trace, graph]);
  return <section className="card analysisPanel">
    <div className="cardHeader"><div><h2>Distributed trace analysis</h2><p>Automatic conclusions focused on request path, redundant trips, long hops, and optimization opportunities.</p></div></div>
    <div className="conclusionGrid">
      {a.findings.map((f, i) => <div className={`finding ${f.level}`} key={i}><b>{f.title}</b><p>{f.text}</p></div>)}
    </div>
    <div className="metricExplainer card inner wide"><h3>Trace intelligence metrics</h3><div className="metricRows"><div><b>{a.metrics.spanCount}</b><span>Span count</span><small>How much instrumented work was recorded.</small></div><div><b>{a.metrics.serviceHopCount}</b><span>Service hop count</span><small>How many boundary hop events were detected, including HTTP, DB, and messaging targets.</small></div><div><b>{a.metrics.criticalPathLength}</b><span>Critical path length</span><small>How many dependent boundary steps are on the latest/longest parent chain.</small></div></div><p className="muted">These numbers answer different questions: spans = work volume, service hops = cross-boundary traffic, critical path length = dependent steps that shape request latency.</p></div>
    <div className="analysisGrid">
      <div className="card inner"><h3>Critical path steps</h3><table className="miniTable"><tbody>{a.metrics.criticalPathSteps.map((h,i)=><tr key={`${h.spanId}-${i}`}><td>{i+1}. {h.source} → {h.target}<br/><small>{h.label}</small></td><td>{fmt(h.durationMs)}</td><td>+{fmt(h.startOffsetMs)}</td></tr>)}{!a.metrics.criticalPathSteps.length && <tr><td>No boundary steps detected.</td></tr>}</tbody></table></div>
      <div className="card inner"><h3>Recommendations</h3><ul>{a.recommendations.map((r,i)=><li key={i}>{r}</li>)}</ul></div>
      <div className="card inner"><h3>Request start / end</h3><ul><li><b>Start:</b> {a.roots[0]?.service || '-'} — {a.roots[0]?.label || ''}</li><li><b>Latest leaf:</b> {a.endSpans[0]?.service || '-'} — {a.endSpans[0]?.label || ''}</li><li><b>Wall time:</b> {fmt(trace.wallTimeMs)}</li></ul></div>
      <div className="card inner"><h3>Potential redundant trips</h3><table className="miniTable"><tbody>{a.repeatedServiceTrips.slice(0,10).map(e=><tr key={e.id}><td>{e.source} → {e.target}</td><td>{e.calls} calls</td><td>{fmt(e.totalMs)}</td></tr>)}{!a.repeatedServiceTrips.length && <tr><td>No repeated trips detected.</td></tr>}</tbody></table></div>
      <div className="card inner"><h3>Services revisited</h3><table className="miniTable"><tbody>{a.revisitedServices.slice(0,10).map(([svc,count])=><tr key={svc}><td>{svc}</td><td>{count} visits</td></tr>)}{!a.revisitedServices.length && <tr><td>No revisited services detected.</td></tr>}</tbody></table></div>
      <div className="card inner"><h3>Longest boundary hops</h3><table className="miniTable"><tbody>{a.slowestHops.slice(0,10).map(h=><tr key={h.id}><td>{h.source} → {h.target}<br/><small>{h.label}</small></td><td>{fmt(h.durationMs)}</td><td>+{fmt(h.startOffsetMs)}</td></tr>)}</tbody></table></div>
      <div className="card inner"><h3>Slowest spans</h3><table className="miniTable"><tbody>{a.slowestSpans.slice(0,10).map(s=><tr key={s.id}><td>{s.service}<br/><small>{spanLabel(s)}</small></td><td>{fmt(s.durationMs)}</td><td>+{fmt(s.startOffsetMs)}</td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
