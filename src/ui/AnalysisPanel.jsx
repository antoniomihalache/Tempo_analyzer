import React, { useMemo } from 'react';
import { analyzeTrace } from '../analysis/traceAnalysis.js';
import { spanLabel } from '../parser/tempoParser.js';
function fmt(ms){return `${Number(ms||0).toFixed(1)} ms`;}

function severityLabel(sev) {
  if (sev === 'error') return 'Error';
  if (sev === 'warn') return 'Warning';
  if (sev === 'ok') return 'Healthy';
  return 'Info';
}

export function AnalysisPanel({ trace, graph }) {
  const a = useMemo(() => analyzeTrace(trace, graph), [trace, graph]);
  return <section className="card analysisPanel">
    <div className="cardHeader">
      <div>
        <h2>Distributed trace analysis engine</h2>
        <p>Structured findings with evidence, confidence, impact, and concrete optimization recommendations.</p>
      </div>
      <div className="scoreBadge"><span>Score</span><b>{a.score}/100</b></div>
    </div>

    <div className="card inner wide executiveSummary">
      <h3>Executive summary</h3>
      <p>{a.executiveSummary}</p>
    </div>

    <div className="metricExplainer card inner wide">
      <h3>Trace intelligence metrics</h3>
      <div className="metricRows">
        <div><b>{a.metrics.spanCount}</b><span>Span count</span><small>How much instrumented work was recorded.</small></div>
        <div><b>{a.metrics.serviceHopCount}</b><span>Service hop count</span><small>How many boundary hop events were detected, including HTTP, DB, and messaging targets.</small></div>
        <div><b>{a.metrics.criticalPathLength}</b><span>Critical path length</span><small>How many dependent boundary steps are on the latest/longest parent chain.</small></div>
        <div><b>{fmt(a.metrics.criticalPathDurationMs)}</b><span>Critical path duration</span><small>Approximate parent-chain duration ending at the latest leaf span.</small></div>
      </div>
      <p className="muted">Spans = recorded work volume. Service hops = cross-boundary traffic. Critical path = dependent steps most likely to shape request latency.</p>
    </div>

    <div className="analysisGrid">
      <div className="card inner wide">
        <h3>Findings</h3>
        <div className="findingList">
          {a.findings.map((f, i) => <article className={`findingCard ${f.severity}`} key={f.id || i}>
            <div className="findingTop"><b>{i + 1}. {f.title}</b><span>{severityLabel(f.severity)} • {f.confidence} confidence • {f.category}</span></div>
            <p><b>Impact:</b> {f.impact}</p>
            <p><b>Recommendation:</b> {f.recommendation}</p>
            <details>
              <summary>Evidence</summary>
              <ul>{f.evidence.map((e, idx) => <li key={idx}>{e}</li>)}</ul>
            </details>
          </article>)}
        </div>
      </div>

      <div className="card inner"><h3>Recommendations</h3><ol>{a.structuredRecommendations.map((r,i)=><li key={i}><b>{r.title}</b><br/><span>{r.recommendation}</span><br/><small>{r.confidence} confidence</small></li>)}</ol></div>

      <div className="card inner"><h3>Critical path steps</h3><table className="miniTable"><tbody>{a.metrics.criticalPathSteps.map((h,i)=><tr key={`${h.spanId}-${i}`}><td>{i+1}. {h.source} → {h.target}<br/><small>{h.label}</small></td><td>{fmt(h.durationMs)}</td><td>+{fmt(h.startOffsetMs)}</td></tr>)}{!a.metrics.criticalPathSteps.length && <tr><td>No boundary steps detected.</td></tr>}</tbody></table></div>

      <div className="card inner"><h3>Request start / end</h3><ul><li><b>Start:</b> {a.roots[0]?.service || '-'} — {a.roots[0]?.label || ''}</li><li><b>Latest leaf:</b> {a.endSpans[0]?.service || '-'} — {a.endSpans[0]?.label || ''}</li><li><b>Wall time:</b> {fmt(trace.wallTimeMs)}</li></ul></div>

      <div className="card inner"><h3>Potential redundant trips</h3><table className="miniTable"><tbody>{a.edgeStats.filter(e=>e.calls>1).slice(0,10).map(e=><tr key={e.id}><td>{e.source} → {e.target}<br/><small>{e.topLabel}</small></td><td>{e.calls} calls</td><td>{fmt(e.totalMs)}<br/><small>avg {fmt(e.avgMs)}</small></td></tr>)}{!a.edgeStats.filter(e=>e.calls>1).length && <tr><td>No repeated trips detected.</td></tr>}</tbody></table></div>

      <div className="card inner"><h3>Duplicate operation patterns</h3><table className="miniTable"><tbody>{a.repeatedOperationGroups.slice(0,10).map(g=><tr key={g.key}><td>{g.source} → {g.target}<br/><small>{g.label}</small></td><td>{g.calls}x</td><td>{fmt(g.totalMs)}</td></tr>)}{!a.repeatedOperationGroups.length && <tr><td>No duplicate operation labels detected.</td></tr>}</tbody></table></div>

      <div className="card inner"><h3>Operation summary</h3><table className="miniTable"><tbody><tr><td>Database</td><td>{a.opStats.database.count} spans</td><td>{fmt(a.opStats.database.totalMs)} total<br/><small>max {fmt(a.opStats.database.maxMs)}</small></td></tr><tr><td>Messaging</td><td>{a.opStats.messaging.count} spans</td><td>{a.opStats.messaging.publishCount} publish / {a.opStats.messaging.consumeCount} receive<br/><small>avg latency {fmt(a.opStats.messaging.avgLatencyMs)}</small></td></tr><tr><td>HTTP</td><td>{a.opStats.http.count} spans</td><td>{a.metrics.httpClientSpanCount} client / {a.metrics.httpServerSpanCount} server</td></tr></tbody></table></div>

      <div className="card inner"><h3>Services revisited</h3><table className="miniTable"><tbody>{a.revisitedServices.slice(0,10).map(([svc,count])=><tr key={svc}><td>{svc}</td><td>{count} visits</td></tr>)}{!a.revisitedServices.length && <tr><td>No revisited services detected.</td></tr>}</tbody></table></div>

      <div className="card inner"><h3>Longest boundary hops</h3><table className="miniTable"><tbody>{a.slowestHops.slice(0,10).map(h=><tr key={h.id}><td>{h.source} → {h.target}<br/><small>{h.label}</small></td><td>{fmt(h.durationMs)}</td><td>+{fmt(h.startOffsetMs)}</td></tr>)}</tbody></table></div>

      <div className="card inner"><h3>Slowest spans</h3><table className="miniTable"><tbody>{a.slowestSpans.slice(0,10).map(s=><tr key={s.id}><td>{s.service}<br/><small>{spanLabel(s)}</small></td><td>{fmt(s.durationMs)}</td><td>+{fmt(s.startOffsetMs)}</td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
