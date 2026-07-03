import { spanLabel } from '../parser/tempoParser.js';
import { analysisMarkdown, analyzeTrace } from '../analysis/traceAnalysis.js';
import { buildGraph } from '../graph/buildGraph.js';

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ms){ return `${Number(ms||0).toFixed(1)} ms`; }

export function summaryMd(trace, graph) {
  const a = analyzeTrace(trace, graph);
  const rootNames = a.roots.slice(0, 8).map(s => `- ${s.service}: ${spanLabel(s)} (${s.durationMs.toFixed(1)} ms)`).join('\n');
  const topEdges = graph.edges.slice(0, 20).map(e => `- ${e.source} → ${e.target}: ${e.calls} call(s), ${e.totalMs.toFixed(1)} ms`).join('\n');
  const findings = a.findings.map(x => `- **${x.title}:** ${x.text}`).join('\n');
  return `# Tempo Trace Summary\n\n- Trace ID: ${trace.spans[0]?.traceId || '-'}\n- Wall time: ${trace.wallTimeMs.toFixed(1)} ms\n- Spans: ${trace.spans.length}\n- Services: ${trace.services.length}\n- Error spans: ${trace.errorSpans.length}\n- Graph: ${graph.nodes.length} nodes / ${graph.edges.length} edges\n\n## Conclusion\n\n${findings}\n\n## Root spans\n\n${rootNames || '- none'}\n\n## Top service edges\n\n${topEdges || '- none'}\n`;
}

export function waterfallMd(trace) {
  const rows = trace.spans.slice().sort((a,b)=>a.startOffsetMs-b.startOffsetMs || b.durationMs-a.durationMs);
  return `# Tempo Trace Waterfall\n\n| # | Service | Span | Start offset | Duration | Status |\n|---:|---|---|---:|---:|---|\n${rows.map((s,i) => `| ${i+1} | ${s.service} | ${spanLabel(s).replace(/\|/g,'/')} | ${s.startOffsetMs.toFixed(1)} ms | ${s.durationMs.toFixed(1)} ms | ${s.status || s.statusCode || '-'} |`).join('\n')}\n`;
}

export function spansCsv(trace) {
  const header = ['service','spanId','parentSpanId','type','kind','name','method','route','url','status','startOffsetMs','durationMs','peerService','dbSystem','dbCollection','messagingSystem','messagingOperation','messagingDestination'];
  const rows = trace.spans.map(s => header.map(k => csvEscape(s[k])).join(','));
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function hopsCsv(trace, graph) {
  const a = analyzeTrace(trace, graph);
  const header = ['index','source','target','type','operation','status','startOffsetMs','durationMs','spanId','note'];
  const rows = a.hops.map((h,i) => [i+1,h.source,h.target,h.type,h.label,h.status,h.startOffsetMs,h.durationMs,h.spanId,h.note].map(csvEscape).join(','));
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

export function serviceGraphMmd(graph) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9_]/g, '_');
  const lines = ['flowchart LR'];
  for (const n of graph.nodes) lines.push(`  ${safe(n.id)}["${String(n.label || n.id).replace(/"/g, "'")}"]`);
  for (const e of graph.edges) lines.push(`  ${safe(e.source)} -->|"${e.label}"| ${safe(e.target)}`);
  return `${lines.join('\n')}\n`;
}

function computeSvgLayout(graph, trace = null) {
  const nodeW = 260;
  const nodeH = 64;
  const xGap = 340;
  const yGap = 112;
  const margin = 80;

  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const pos = new Map();
  if (!nodes.length) return { pos, width: 1200, height: 760 };

  // Use the first occurrence in the trace to keep the exported report readable and stable.
  // This avoids the old rank-based layout collapsing into an empty-looking graph when the
  // service graph contains cycles or when no root can be inferred.
  const firstSeen = new Map();
  if (trace?.spans?.length) {
    for (const span of trace.spans) {
      const offset = Number(span.startOffsetMs || 0);
      if (span.service && !firstSeen.has(span.service)) firstSeen.set(span.service, offset);
    }
  }
  for (const edge of edges) {
    if (!firstSeen.has(edge.source)) firstSeen.set(edge.source, 0);
    if (!firstSeen.has(edge.target)) firstSeen.set(edge.target, (firstSeen.get(edge.source) || 0) + 1);
  }

  const indegree = new Map(nodes.map(n => [n.id, 0]));
  const outdegree = new Map(nodes.map(n => [n.id, 0]));
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    outdegree.set(edge.source, (outdegree.get(edge.source) || 0) + 1);
  }

  const ordered = nodes.slice().sort((a, b) => {
    const fa = firstSeen.has(a.id) ? firstSeen.get(a.id) : Number.POSITIVE_INFINITY;
    const fb = firstSeen.has(b.id) ? firstSeen.get(b.id) : Number.POSITIVE_INFINITY;
    if (fa !== fb) return fa - fb;
    return String(a.id).localeCompare(String(b.id));
  });

  // Put services into columns in first-seen order. This produces a full-picture graph that
  // is much easier to embed in Confluence/Jira than Mermaid spaghetti.
  const maxPerColumn = 10;
  const columns = [];
  ordered.forEach((n, idx) => {
    const col = Math.floor(idx / maxPerColumn);
    if (!columns[col]) columns[col] = [];
    columns[col].push(n);
  });

  const width = Math.max(1400, margin * 2 + Math.max(1, columns.length - 1) * xGap + nodeW);
  const height = Math.max(860, margin * 2 + Math.max(...columns.map(c => c.length), 1) * yGap + nodeH);

  columns.forEach((colNodes, colIdx) => {
    const blockH = (colNodes.length - 1) * yGap;
    const startY = margin + Math.max(0, (height - margin * 2 - blockH) / 2);
    colNodes.forEach((n, rowIdx) => {
      pos.set(n.id, { x: margin + colIdx * xGap, y: startY + rowIdx * yGap, w: nodeW, h: nodeH });
    });
  });

  return { pos, width, height };
}

export function htmlReport(trace, graph) {
  const a = analyzeTrace(trace, graph);
  const { pos, width, height } = computeSvgLayout(graph, trace);
  const data = JSON.stringify({
    nodes: graph.nodes.map(n => ({ id: n.id, label: n.label || n.id, type: n.type, totalMs: n.totalMs, spanCount: n.spanCount })),
    edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, calls: e.calls, totalMs: e.totalMs, topLabel: e.topLabel })),
    hops: a.hops,
    findings: a.findings
  }).replace(/</g, '\\u003c');
  const pathId = (id) => `p-${String(id).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
  const pathDefs = graph.edges.map(e => { const s = pos.get(e.source), t = pos.get(e.target); if (!s || !t) return ''; const x1=s.x+s.w,y1=s.y+s.h/2,x2=t.x,y2=t.y+t.h/2,mx=(x1+x2)/2; return `<path id="${pathId(e.id)}" d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}"/>`; }).join('');
  const edgeSvg = graph.edges.map(e => { const s=pos.get(e.source),t=pos.get(e.target); if(!s||!t)return''; return `<path class="edge" data-id="${esc(e.id)}" data-source="${esc(e.source)}" data-target="${esc(e.target)}" d="${esc(documentPath(pos,e))}"/><text class="edgeLabel"><textPath href="#${pathId(e.id)}" startOffset="50%">${esc(e.label)}</textPath></text>`; }).join('');
  function documentPath(pos,e){ const s=pos.get(e.source),t=pos.get(e.target); const x1=s.x+s.w,y1=s.y+s.h/2,x2=t.x,y2=t.y+t.h/2,mx=(x1+x2)/2; return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`; }
  const nodeSvg = graph.nodes.map(n => { const p=pos.get(n.id); if(!p)return''; return `<g class="node" data-id="${esc(n.id)}" transform="translate(${p.x},${p.y})"><rect width="${p.w}" height="${p.h}" rx="13"/><text x="${p.w/2}" y="27">${esc(n.label || n.id)}</text><text class="sub" x="${p.w/2}" y="47">${esc(n.type)} • ${n.spanCount || 0} spans</text></g>`; }).join('');
  const findings = a.findings.map(f=>`<li><b>${esc(f.title)}:</b> ${esc(f.text)}</li>`).join('');
  const repeatedRows = a.repeatedServiceTrips.slice(0, 20).map(e => `<tr><td>${esc(e.source)} → ${esc(e.target)}</td><td>${e.calls}</td><td>${fmt(e.totalMs)}</td><td>${fmt(e.maxMs)}</td></tr>`).join('');
  const slowRows = a.slowestHops.slice(0, 20).map(h => `<tr><td>${esc(h.source)} → ${esc(h.target)}</td><td>${esc(h.label)}</td><td>${fmt(h.durationMs)}</td><td>+${fmt(h.startOffsetMs)}</td></tr>`).join('');
  const hopRows = a.hops.map((h,i)=>`<tr><td>${i+1}</td><td>+${fmt(h.startOffsetMs)}</td><td>${fmt(h.durationMs)}</td><td>${esc(h.source)} → ${esc(h.target)}</td><td>${esc(h.type)}</td><td>${esc(h.label)}</td><td>${esc(h.status)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Distributed Trace Analysis</title><style>
body{font-family:Inter,system-ui,sans-serif;background:#08111f;color:#e5e7eb;margin:24px}h1{margin-bottom:4px}.muted{color:#94a3b8}.card{border:1px solid #334155;border-radius:14px;padding:16px;margin:16px 0;background:#0f172a}.graphWrap{height:820px;overflow:auto;background:#020617;border-radius:12px;border:1px solid #1e293b}.node{cursor:pointer}.node rect{fill:#12213a;stroke:#60a5fa;stroke-width:2}.node text{fill:#f8fafc;text-anchor:middle;font-size:15px;font-weight:800}.node .sub{fill:#93c5fd;font-size:11px;font-weight:500}.edge{fill:none;stroke:#64748b;stroke-width:2.2;marker-end:url(#arrow);opacity:.7}.edgeLabel{fill:#cbd5e1;font-size:10px}.dim{opacity:.08}.hot rect{stroke:#22c55e;stroke-width:5}.hot.edge{stroke:#22c55e;stroke-width:4;opacity:1}.selected rect{stroke:#facc15;stroke-width:5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pill{display:inline-block;padding:7px 9px;border:1px solid #334155;border-radius:999px;margin:4px;background:#020617}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #1e293b;padding:8px;text-align:left;font-size:13px;vertical-align:top}pre{white-space:pre-wrap;background:#020617;padding:12px;border-radius:10px}.findings li{margin:7px 0}.tableBox{max-height:620px;overflow:auto}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style></head><body><h1>Distributed Trace Analysis</h1><p class="muted">Trace ID ${esc(trace.spans[0]?.traceId || '-')} • ${a.metrics.spanCount} spans • ${a.metrics.serviceHopCount} service hops • ${a.metrics.criticalPathLength} critical-path steps • ${fmt(trace.wallTimeMs)} wall time</p>
<div class="card"><h2>Headline metrics</h2><p><span class="pill">Span count: ${a.metrics.spanCount}</span><span class="pill">Service hops: ${a.metrics.serviceHopCount}</span><span class="pill">Unique edges: ${a.metrics.uniqueServiceHopCount}</span><span class="pill">Critical path length: ${a.metrics.criticalPathLength}</span><span class="pill">Critical path duration: ${fmt(a.metrics.criticalPathDurationMs)}</span></p><p class="muted">Span count measures recorded work. Service hop count measures cross-boundary traffic. Critical path length measures dependent boundary steps on the latest/longest parent chain.</p></div>
<div class="card"><h2>Conclusion</h2><ul class="findings">${findings}</ul></div>
<div class="card"><h2>Interactive service graph</h2><p class="muted">Hover or click a service to highlight upstream/downstream request path. Details appear below, so the graph keeps full width.</p><p class="muted">${graph.nodes.length} nodes • ${graph.edges.length} edges. This exported graph is generated from the full trace, not from the current UI filters.</p><div class="graphWrap"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"></path></marker>${pathDefs}</defs>${edgeSvg}${nodeSvg}</svg></div><div id="nodeDetails" class="card"><b>Hover or click a node</b><p class="muted">The upstream/downstream request path will be highlighted here.</p></div></div>
<div class="card grid"><div><h2>Potential redundant trips</h2><table><tr><th>Edge</th><th>Calls</th><th>Total</th><th>Max</th></tr>${repeatedRows || '<tr><td colspan="4">No repeated trips found.</td></tr>'}</table></div><div><h2>Longest hops</h2><table><tr><th>Hop</th><th>Operation</th><th>Duration</th><th>Offset</th></tr>${slowRows}</table></div></div>
<div class="card"><h2>Full hop timeline</h2><div class="tableBox"><table><tr><th>#</th><th>Offset</th><th>Duration</th><th>Hop</th><th>Type</th><th>Operation</th><th>Status</th></tr>${hopRows}</table></div></div>
<div class="card"><h2>Analysis Markdown</h2><pre>${esc(analysisMarkdown(trace, graph))}</pre></div>
<script>const graph=${data};let pinned=null;const nodes=[...document.querySelectorAll('.node')],edges=[...document.querySelectorAll('.edge')];const adj=new Map(),rev=new Map();graph.nodes.forEach(n=>{adj.set(n.id,[]);rev.set(n.id,[])});graph.edges.forEach(e=>{adj.get(e.source)?.push(e.target);rev.get(e.target)?.push(e.source)});function walk(map,id,set=new Set()){(map.get(id)||[]).forEach(x=>{if(!set.has(x)){set.add(x);walk(map,x,set)}});return set}function show(id){document.querySelectorAll('.dim,.hot,.selected').forEach(el=>el.classList.remove('dim','hot','selected'));if(!id)return;const ids=new Set([id,...walk(rev,id),...walk(adj,id)]);nodes.forEach(n=>{if(ids.has(n.dataset.id))n.classList.add('hot');else n.classList.add('dim')});edges.forEach(e=>{if(ids.has(e.dataset.source)&&ids.has(e.dataset.target))e.classList.add('hot');else e.classList.add('dim')});document.querySelector('.node[data-id="'+CSS.escape(id)+'"]')?.classList.add('selected');const incoming=graph.edges.filter(e=>e.target===id),outgoing=graph.edges.filter(e=>e.source===id);const path=[...walk(rev,id)].reverse().concat([id],[...walk(adj,id)]);document.getElementById('nodeDetails').innerHTML='<h2>'+id+'</h2><h3>Request path</h3><p>'+path.map(x=>'<span class="pill">'+x+'</span>').join('')+'</p><h3>Incoming</h3><ul>'+(incoming.map(e=>'<li>'+e.source+' → '+e.target+': '+e.label+'</li>').join('')||'<li>None</li>')+'</ul><h3>Outgoing</h3><ul>'+(outgoing.map(e=>'<li>'+e.source+' → '+e.target+': '+e.label+'</li>').join('')||'<li>None</li>')+'</ul>'}nodes.forEach(n=>{n.addEventListener('mouseenter',()=>!pinned&&show(n.dataset.id));n.addEventListener('mouseleave',()=>!pinned&&show(null));n.addEventListener('click',()=>{pinned=pinned===n.dataset.id?null:n.dataset.id;show(pinned)})});</script></body></html>`;
}

export function downloadReportFiles(trace, graph) {
  // Export should be a full, shareable analysis, not the currently filtered UI graph.
  // The filtered graph is useful in the app, but it can accidentally produce an empty
  // or partial exported HTML report if the user has search/type/min-duration filters active.
  const exportGraph = buildGraph(trace, {
    minCalls: 1,
    showInfra: true,
    query: '',
    minDuration: 0,
    topEdges: 10000,
    types: new Set(['http-server', 'http-client', 'database', 'messaging', 'internal'])
  });

  download('summary.md', summaryMd(trace, exportGraph));
  download('analysis.md', analysisMarkdown(trace, exportGraph));
  download('waterfall.md', waterfallMd(trace));
  download('spans.csv', spansCsv(trace), 'text/csv');
  download('hops.csv', hopsCsv(trace, exportGraph), 'text/csv');
  download('service-graph.mmd', serviceGraphMmd(exportGraph));
  download('index.html', htmlReport(trace, exportGraph), 'text/html');
}
