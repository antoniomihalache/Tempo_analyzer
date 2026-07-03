import { inferExternalTarget, spanLabel } from '../parser/tempoParser.js';

function fmt(ms) { return `${Number(ms || 0).toFixed(1)} ms`; }

export function spanEndOffset(span) {
  return Number(span.startOffsetMs || 0) + Number(span.durationMs || 0);
}

export function buildRequestHops(trace) {
  const hops = [];
  for (const span of trace.spans) {
    const parent = trace.spanById.get(span.parentId);
    const label = spanLabel(span);

    if (parent && parent.service && parent.service !== span.service) {
      hops.push({
        id: `span:${span.id}`,
        source: parent.service,
        target: span.service,
        label,
        type: span.type,
        spanId: span.id,
        parentSpanId: span.parentId,
        startOffsetMs: span.startOffsetMs,
        endOffsetMs: spanEndOffset(span),
        durationMs: span.durationMs,
        status: span.status || span.statusCode || '-',
        spanName: span.name,
        isExternal: false,
        note: 'cross-service span'
      });
    }

    const target = inferExternalTarget(span);
    if (target && target.id !== span.service) {
      hops.push({
        id: `external:${span.id}:${target.id}`,
        source: span.service,
        target: target.id,
        label,
        type: target.type === 'database' ? 'database' : target.type === 'messaging' ? 'messaging' : span.type,
        spanId: span.id,
        parentSpanId: span.parentId,
        startOffsetMs: span.startOffsetMs,
        endOffsetMs: spanEndOffset(span),
        durationMs: span.durationMs,
        status: span.status || span.statusCode || '-',
        spanName: span.name,
        isExternal: true,
        note: `${target.type || 'external'} target`
      });
    }
  }

  return hops.sort((a, b) => a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs || a.source.localeCompare(b.source));
}

export function buildSpanTimeline(trace) {
  return trace.spans.slice().sort((a, b) => a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs).map((s, index) => {
    const parent = trace.spanById.get(s.parentId);
    const target = inferExternalTarget(s);
    return {
      index: index + 1,
      id: s.id,
      parentId: s.parentId,
      service: s.service,
      parentService: parent?.service || '',
      target: target?.id || '',
      type: s.type,
      label: spanLabel(s),
      name: s.name,
      startOffsetMs: s.startOffsetMs,
      endOffsetMs: spanEndOffset(s),
      durationMs: s.durationMs,
      status: s.status || s.statusCode || '-',
      isBoundary: Boolean((parent && parent.service && parent.service !== s.service) || target)
    };
  });
}

export function buildHopGroups(hops) {
  const groups = new Map();
  for (const hop of hops) {
    const key = `${hop.source}-->${hop.target}::${hop.label}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        source: hop.source,
        target: hop.target,
        label: hop.label,
        type: hop.type,
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        minMs: Number.POSITIVE_INFINITY,
        firstOffsetMs: hop.startOffsetMs,
        examples: []
      });
    }
    const g = groups.get(key);
    g.calls += 1;
    g.totalMs += hop.durationMs;
    g.maxMs = Math.max(g.maxMs, hop.durationMs);
    g.minMs = Math.min(g.minMs, hop.durationMs);
    g.firstOffsetMs = Math.min(g.firstOffsetMs, hop.startOffsetMs);
    if (g.examples.length < 5) g.examples.push(hop);
  }
  return [...groups.values()].sort((a, b) => b.calls - a.calls || b.totalMs - a.totalMs);
}

export function buildServiceVisits(hops) {
  const visits = [];
  const seen = new Map();
  for (const hop of hops) {
    const key = hop.target;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    visits.push({ service: key, visit: count, from: hop.source, offset: hop.startOffsetMs, durationMs: hop.durationMs, label: hop.label });
  }
  return visits;
}


export function computeTraceMetrics(trace, graph = null) {
  const hops = buildRequestHops(trace);
  const leafParentIds = new Set(trace.spans.map(s => s.parentId).filter(Boolean));
  const leaves = trace.spans.filter(s => !leafParentIds.has(s.id));
  const latestLeaf = leaves.slice().sort((a, b) => spanEndOffset(b) - spanEndOffset(a))[0] || trace.spans.slice().sort((a,b)=>spanEndOffset(b)-spanEndOffset(a))[0];

  const chain = [];
  let current = latestLeaf;
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    chain.push(current);
    guard.add(current.id);
    current = trace.spanById.get(current.parentId);
  }
  chain.reverse();

  const criticalBoundarySteps = [];
  for (const span of chain) {
    const parent = trace.spanById.get(span.parentId);
    if (parent && parent.service && parent.service !== span.service) {
      criticalBoundarySteps.push({
        source: parent.service,
        target: span.service,
        type: span.type,
        label: spanLabel(span),
        startOffsetMs: span.startOffsetMs,
        durationMs: span.durationMs,
        spanId: span.id
      });
    }
    const target = inferExternalTarget(span);
    if (target && target.id !== span.service) {
      criticalBoundarySteps.push({
        source: span.service,
        target: target.id,
        type: target.type === 'database' ? 'database' : target.type === 'messaging' ? 'messaging' : span.type,
        label: spanLabel(span),
        startOffsetMs: span.startOffsetMs,
        durationMs: span.durationMs,
        spanId: span.id
      });
    }
  }

  const uniqueBoundaryEdges = new Set(hops.map(h => `${h.source}-->${h.target}`));
  const uniqueServicesVisited = new Set();
  hops.forEach(h => { uniqueServicesVisited.add(h.source); uniqueServicesVisited.add(h.target); });

  return {
    spanCount: trace.spans.length,
    serviceHopCount: hops.length,
    uniqueServiceHopCount: uniqueBoundaryEdges.size,
    criticalPathLength: criticalBoundarySteps.length,
    criticalPathSpanCount: chain.length,
    criticalPathDurationMs: latestLeaf ? spanEndOffset(latestLeaf) - (chain[0]?.startOffsetMs || 0) : 0,
    criticalPathEndService: latestLeaf?.service || '',
    criticalPathSteps: criticalBoundarySteps,
    uniqueServicesInHops: uniqueServicesVisited.size,
    wallTimeMs: trace.wallTimeMs,
    graphCriticalApproxMs: graph?.critical?.totalMs || null
  };
}

export function analyzeTrace(trace, graph) {
  const hops = buildRequestHops(trace);
  const spanTimeline = buildSpanTimeline(trace);
  const hopGroups = buildHopGroups(hops);
  const serviceVisits = buildServiceVisits(hops);
  const metrics = computeTraceMetrics(trace, graph);
  const slowestSpans = trace.spans.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 15);
  const slowestHops = hops.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 15);
  const repeatedHops = hopGroups.filter(g => g.calls > 1).slice(0, 20);
  const repeatedServiceTrips = [...graph.edges].filter(e => e.calls > 1).sort((a, b) => b.calls - a.calls || b.totalMs - a.totalMs).slice(0, 20);
  const roots = trace.roots.slice().sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const leafIds = new Set(trace.spans.map(s => s.parentId).filter(Boolean));
  const endSpans = trace.spans.filter(s => !leafIds.has(s.id)).sort((a, b) => spanEndOffset(b) - spanEndOffset(a)).slice(0, 15);
  const serviceVisitCounts = new Map();
  for (const h of hops) serviceVisitCounts.set(h.target, (serviceVisitCounts.get(h.target) || 0) + 1);
  const revisitedServices = [...serviceVisitCounts.entries()].filter(([, count]) => count > 1).sort((a,b)=>b[1]-a[1]).slice(0, 15);

  const findings = [];
  if (trace.errorSpans.length) findings.push({ level: 'error', title: 'Errors detected', text: `${trace.errorSpans.length} span(s) have error status.` });
  if (repeatedServiceTrips.length) findings.push({ level: 'warn', title: 'Repeated service trips', text: `Top repeated edge: ${repeatedServiceTrips[0].source} → ${repeatedServiceTrips[0].target} (${repeatedServiceTrips[0].calls} calls, ${fmt(repeatedServiceTrips[0].totalMs)} total).` });
  if (revisitedServices.length) findings.push({ level: 'warn', title: 'Services revisited', text: `${revisitedServices[0][0]} is visited ${revisitedServices[0][1]} times. This can indicate avoidable request round trips or repeated async fan-out.` });
  if (slowestHops.length) findings.push({ level: 'info', title: 'Slowest boundary hop', text: `${slowestHops[0].source} → ${slowestHops[0].target}: ${fmt(slowestHops[0].durationMs)} at +${fmt(slowestHops[0].startOffsetMs)}.` });
  if (slowestSpans.length) findings.push({ level: 'info', title: 'Slowest individual span', text: `${slowestSpans[0].service}: ${spanLabel(slowestSpans[0])} (${fmt(slowestSpans[0].durationMs)}).` });
  if (!findings.length) findings.push({ level: 'ok', title: 'No obvious issues', text: 'No obvious errors or repeated service trips were found with the current filters.' });

  const recommendations = [];
  for (const e of repeatedServiceTrips.slice(0, 5)) {
    recommendations.push(`Check whether ${e.source} → ${e.target} can be cached, batched, or moved earlier/later in the request. It appears ${e.calls} times and costs ${fmt(e.totalMs)} total.`);
  }
  for (const h of slowestHops.slice(0, 3)) {
    recommendations.push(`Investigate ${h.source} → ${h.target} (${fmt(h.durationMs)}). Check downstream latency, payload size, retries, and whether this call blocks the response path.`);
  }
  if (!recommendations.length) recommendations.push('Start by reviewing the slowest spans and any cross-service fan-out in the request trace.');

  return { metrics, hops, spanTimeline, hopGroups, serviceVisits, slowestSpans, slowestHops, repeatedHops, repeatedServiceTrips, revisitedServices, roots, endSpans, findings, recommendations };
}

export function analysisMarkdown(trace, graph) {
  const a = analyzeTrace(trace, graph);
  const findingLines = a.findings.map(x => `- **${x.title}:** ${x.text}`).join('\n');
  const rootLines = a.roots.slice(0, 10).map(s => `- Starts at **${s.service}**: ${spanLabel(s)} (${fmt(s.durationMs)}, offset +${fmt(s.startOffsetMs)})`).join('\n');
  const endLines = a.endSpans.slice(0, 10).map(s => `- Ends at **${s.service}**: ${spanLabel(s)} (${fmt(s.durationMs)}, offset +${fmt(s.startOffsetMs)})`).join('\n');
  const repeated = a.repeatedServiceTrips.map(e => `- ${e.source} → ${e.target}: ${e.calls} calls, ${fmt(e.totalMs)} total, max ${fmt(e.maxMs)}`).join('\n');
  const revisits = a.revisitedServices.map(([svc, count]) => `- ${svc}: ${count} visits`).join('\n');
  const slowHops = a.slowestHops.map(h => `- ${h.source} → ${h.target}: ${fmt(h.durationMs)} at +${fmt(h.startOffsetMs)} — ${h.label}`).join('\n');
  const recommendations = a.recommendations.map(x => `- ${x}`).join('\n');
  const metricLines = `- Span count: ${a.metrics.spanCount}
- Service hop count: ${a.metrics.serviceHopCount} boundary hop events (${a.metrics.uniqueServiceHopCount} unique edges)
- Critical path length: ${a.metrics.criticalPathLength} dependent boundary steps (${a.metrics.criticalPathSpanCount} spans in the parent chain)
- Critical path duration: ${fmt(a.metrics.criticalPathDurationMs)}
- Wall time: ${fmt(trace.wallTimeMs)}`;
  const criticalSteps = a.metrics.criticalPathSteps.map((h, i) => `| ${i+1} | +${fmt(h.startOffsetMs)} | ${fmt(h.durationMs)} | ${h.source} → ${h.target} | ${h.type} | ${h.label.replace(/\|/g, '/')} |`).join('\n');
  const allHops = a.hops.map((h, i) => `| ${i+1} | +${fmt(h.startOffsetMs)} | ${fmt(h.durationMs)} | ${h.source} → ${h.target} | ${h.type} | ${h.label.replace(/\|/g, '/')} | ${h.status} |`).join('\n');

  return `# Distributed Trace Analysis\n\n## Conclusion\n\n${findingLines}\n\n## Recommendations\n\n${recommendations}\n\n## Where the request started\n\n${rootLines || '- No root spans found.'}\n\n## Where the request ended\n\n${endLines || '- No leaf/end spans found.'}\n\n## Potential redundant trips\n\n${repeated || '- No repeated service-to-service trips detected.'}\n\n## Services visited more than once\n\n${revisits || '- No revisited services detected.'}\n\n## Longest cross-service / external hops\n\n${slowHops || '- No cross-boundary hops detected.'}\n\n## Full hop timeline\n\n| # | Offset | Duration | Hop | Type | Operation | Status |\n|---:|---:|---:|---|---|---|---|\n${allHops || '| - | - | - | No hops detected | - | - | - |'}\n`;
}
