import React from 'react';
function fmt(ms){return `${Number(ms||0).toFixed(1)} ms`;}
export function DetailsPanel({ trace, graph, nodeId }) {
  if (!nodeId) return <section className="card details"><h2>Selection details</h2><p>Hover a service to temporarily highlight its request path. Click to pin it here.</p></section>;
  const node = graph.nodes.find(n=>n.id===nodeId);
  const incoming = graph.edges.filter(e=>e.target===nodeId);
  const outgoing = graph.edges.filter(e=>e.source===nodeId);
  const up = graph.upstream(nodeId); const down = graph.downstream(nodeId);
  const spans = trace.spans.filter(s => s.service === nodeId || incoming.some(e=>e.spans.includes(s.id)) || outgoing.some(e=>e.spans.includes(s.id))).sort((a,b)=>b.durationMs-a.durationMs).slice(0,12);
  return <section className="card details">
    <div className="cardHeader"><div><h2>{node?.label || nodeId}</h2><p>{node?.type || 'service'} • {node?.spanCount || 0} spans • {fmt(node?.totalMs)}</p></div></div>
    <div className="detailsGrid">
      <div><h3>Request path</h3><div className="pathWrap">{[...up.reverse(), nodeId, ...down].map(x=><span className="pathPill" key={x}>{x}</span>)}</div></div>
      <div><h3>Incoming</h3><ul>{incoming.length ? incoming.map(e=><li key={e.id}>{e.source} → {e.target}: {e.calls} call(s), {fmt(e.totalMs)}</li>) : <li>No incoming edge in current graph.</li>}</ul></div>
      <div><h3>Outgoing</h3><ul>{outgoing.length ? outgoing.map(e=><li key={e.id}>{e.source} → {e.target}: {e.calls} call(s), {fmt(e.totalMs)}</li>) : <li>No outgoing edge in current graph.</li>}</ul></div>
      <div><h3>Slow related spans</h3><ul>{spans.map(s=><li key={s.id}><b>{fmt(s.durationMs)}</b> {s.name}</li>)}</ul></div>
    </div>
  </section>;
}
