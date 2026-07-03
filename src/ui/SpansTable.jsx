import React from 'react';
export function SpansTable({ trace }) {
 return <section className="card"><div className="cardHeader"><h2>Span table</h2><span>{trace.spans.length} spans</span></div><div className="tableWrap"><table className="dataTable"><thead><tr><th>Service</th><th>Type</th><th>Name</th><th>Route/target</th><th>Status</th><th>Duration</th></tr></thead><tbody>{trace.spans.slice().sort((a,b)=>a.startNs-b.startNs).map(s=><tr key={s.id}><td>{s.service}</td><td>{s.type}</td><td title={s.name}>{s.name}</td><td title={s.url || s.messagingDestination}>{s.route || s.dbCollection || s.messagingDestination || '-'}</td><td>{s.status || s.statusCode || '-'}</td><td>{s.durationMs.toFixed(1)} ms</td></tr>)}</tbody></table></div></section>
}
