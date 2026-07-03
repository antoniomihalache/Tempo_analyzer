import { inferExternalTarget, spanLabel } from '../parser/tempoParser.js';

function addNode(map, id, patch = {}) {
  if (!id) return;
  if (!map.has(id)) map.set(id, { id, label: id, type: 'service', spanCount: 0, totalMs: 0, errorCount: 0, ...patch });
  else Object.assign(map.get(id), patch);
}
function edgeKey(source, target) { return `${source}-->${target}`; }
function addEdge(map, source, target, span, label) {
  if (!source || !target || source === target) return;
  const key = edgeKey(source, target);
  if (!map.has(key)) map.set(key, { id: key, source, target, calls: 0, totalMs: 0, maxMs: 0, spans: [], labels: new Map(), errors: 0, types: new Set() });
  const e = map.get(key);
  e.calls += 1;
  e.totalMs += span.durationMs || 0;
  e.maxMs = Math.max(e.maxMs, span.durationMs || 0);
  e.spans.push(span.id);
  e.types.add(span.type);
  if (Number(span.status) >= 500 || Number(span.statusCode) > 0) e.errors += 1;
  if (label) e.labels.set(label, (e.labels.get(label) || 0) + 1);
}

export function buildGraph(trace, filters = {}) {
  const { minCalls = 1, showInfra = true, types = new Set(['http-server','http-client','database','messaging','internal']), query = '', minDuration = 0, topEdges = 80 } = filters;
  const nodes = new Map();
  const edges = new Map();
  const q = query.trim().toLowerCase();

  for (const span of trace.spans) {
    if (span.durationMs < minDuration) continue;
    if (types?.size && !types.has(span.type)) continue;
    if (q && !(`${span.service} ${span.name} ${span.route} ${span.url} ${span.peerService} ${span.dbCollection} ${span.messagingDestination}`.toLowerCase().includes(q))) continue;

    addNode(nodes, span.service, { type: 'service' });
    const n = nodes.get(span.service);
    n.spanCount += 1;
    n.totalMs += span.durationMs || 0;
    if (Number(span.status) >= 500 || Number(span.statusCode) > 0) n.errorCount += 1;

    const parent = trace.spanById.get(span.parentId);
    if (parent && parent.service && parent.service !== span.service) addEdge(edges, parent.service, span.service, span, spanLabel(span));

    const target = inferExternalTarget(span);
    if (target && target.id !== span.service && (showInfra || target.type === 'service')) {
      addNode(nodes, target.id, { label: target.label, type: target.type });
      addEdge(edges, span.service, target.id, span, spanLabel(span));
    }
  }

  let edgeList = [...edges.values()]
    .filter((e) => e.calls >= minCalls)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, Number(topEdges || 10000))
    .map((e) => ({
      ...e,
      type: e.types.has('messaging') ? 'messaging' : e.types.has('database') ? 'database' : 'http',
      label: `${e.calls} call${e.calls === 1 ? '' : 's'} • ${e.totalMs.toFixed(1)} ms`,
      topLabel: [...e.labels.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || ''
    }));

  const used = new Set(); edgeList.forEach(e => { used.add(e.source); used.add(e.target); });
  const nodeList = [...nodes.values()].filter(n => used.has(n.id));

  const adjacency = new Map(), reverse = new Map();
  nodeList.forEach(n => { adjacency.set(n.id, []); reverse.set(n.id, []); });
  edgeList.forEach(e => { adjacency.get(e.source)?.push(e.target); reverse.get(e.target)?.push(e.source); });

  function upstream(id, acc = new Set()) { for (const x of reverse.get(id) || []) if (!acc.has(x)) { acc.add(x); upstream(x, acc); } return [...acc]; }
  function downstream(id, acc = new Set()) { for (const x of adjacency.get(id) || []) if (!acc.has(x)) { acc.add(x); downstream(x, acc); } return [...acc]; }
  function connectedEdges(ids) { const s = new Set(ids); return edgeList.filter(e => s.has(e.source) && s.has(e.target)).map(e => e.id); }

  const roots = nodeList.filter(n => (reverse.get(n.id) || []).length === 0).map(n => n.id);
  const leaves = nodeList.filter(n => (adjacency.get(n.id) || []).length === 0).map(n => n.id);

  return { nodes: nodeList, edges: edgeList, adjacency, reverse, roots, leaves, upstream, downstream, connectedEdges };
}

export function criticalPath(graph) {
  const best = new Map();
  const prev = new Map();
  graph.nodes.forEach(n => best.set(n.id, 0));
  const edges = [...graph.edges].sort((a,b)=>b.totalMs-a.totalMs);
  // Relax repeatedly; graph may not be a DAG due async traces.
  for (let i = 0; i < graph.nodes.length; i++) {
    for (const e of edges) {
      const cand = (best.get(e.source) || 0) + e.totalMs;
      if (cand > (best.get(e.target) || 0)) { best.set(e.target, cand); prev.set(e.target, e); }
    }
  }
  let end = [...best.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const nodeIds = new Set(), edgeIds = new Set();
  let guard = 0;
  while (end && guard++ < 100) { nodeIds.add(end); const e = prev.get(end); if (!e) break; edgeIds.add(e.id); nodeIds.add(e.source); end = e.source; }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds], totalMs: Math.max(...best.values(), 0) };
}
