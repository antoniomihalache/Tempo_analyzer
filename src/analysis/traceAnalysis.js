import { inferExternalTarget, spanLabel } from '../parser/tempoParser.js';

function fmt(ms) { return `${Number(ms || 0).toFixed(1)} ms`; }
function pct(value, total) { return total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'; }
function avg(total, count) { return count ? total / count : 0; }
function median(values) {
  if (!values.length) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
function p95(values) {
  if (!values.length) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.ceil(arr.length * 0.95) - 1)];
}
function confidence(value) { return value; }

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
    if (g.examples.length < 8) g.examples.push(hop);
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

function computeLatestLeafChain(trace) {
  const leafParentIds = new Set(trace.spans.map(s => s.parentId).filter(Boolean));
  const leaves = trace.spans.filter(s => !leafParentIds.has(s.id));
  const latestLeaf = leaves.slice().sort((a, b) => spanEndOffset(b) - spanEndOffset(a))[0] || trace.spans.slice().sort((a, b) => spanEndOffset(b) - spanEndOffset(a))[0];
  const chain = [];
  let current = latestLeaf;
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    chain.push(current);
    guard.add(current.id);
    current = trace.spanById.get(current.parentId);
  }
  chain.reverse();
  return { latestLeaf, chain };
}

export function computeTraceMetrics(trace, graph = null) {
  const hops = buildRequestHops(trace);
  const { latestLeaf, chain } = computeLatestLeafChain(trace);

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
  const byType = trace.spans.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {});
  const hopByType = hops.reduce((acc, h) => { acc[h.type] = (acc[h.type] || 0) + 1; return acc; }, {});

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
    graphCriticalApproxMs: graph?.critical?.totalMs || null,
    spanTypeCounts: byType,
    hopTypeCounts: hopByType,
    dbSpanCount: byType.database || 0,
    messagingSpanCount: byType.messaging || 0,
    httpClientSpanCount: byType['http-client'] || 0,
    httpServerSpanCount: byType['http-server'] || 0
  };
}

function buildEdgeStats(hops) {
  const map = new Map();
  for (const h of hops) {
    const key = `${h.source}-->${h.target}`;
    if (!map.has(key)) {
      map.set(key, { id: key, source: h.source, target: h.target, calls: 0, totalMs: 0, maxMs: 0, minMs: Infinity, durations: [], labels: new Map(), examples: [] });
    }
    const e = map.get(key);
    e.calls += 1;
    e.totalMs += h.durationMs;
    e.maxMs = Math.max(e.maxMs, h.durationMs);
    e.minMs = Math.min(e.minMs, h.durationMs);
    e.durations.push(h.durationMs);
    e.labels.set(h.label, (e.labels.get(h.label) || 0) + 1);
    if (e.examples.length < 10) e.examples.push(h);
  }
  return [...map.values()].map(e => ({
    ...e,
    avgMs: avg(e.totalMs, e.calls),
    medianMs: median(e.durations),
    p95Ms: p95(e.durations),
    topLabel: [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  })).sort((a, b) => b.totalMs - a.totalMs);
}

function buildOperationStats(trace) {
  const db = trace.spans.filter(s => s.type === 'database');
  const messaging = trace.spans.filter(s => s.type === 'messaging');
  const http = trace.spans.filter(s => s.type === 'http-client' || s.type === 'http-server');
  const dbDurations = db.map(s => s.durationMs);
  const mqLatencies = messaging.map(s => Number(s.attrs?.['messaging.message_latency_ms'])).filter(Number.isFinite);
  const publishCount = messaging.filter(s => /publish|send/i.test(`${s.messagingOperation} ${s.name}`)).length;
  const consumeCount = messaging.filter(s => /receive|process|consume/i.test(`${s.messagingOperation} ${s.name}`)).length;
  return {
    database: { count: db.length, totalMs: dbDurations.reduce((a, b) => a + b, 0), avgMs: avg(dbDurations.reduce((a,b)=>a+b,0), db.length), maxMs: Math.max(...dbDurations, 0), p95Ms: p95(dbDurations), slowest: db.slice().sort((a,b)=>b.durationMs-a.durationMs).slice(0, 10) },
    messaging: { count: messaging.length, publishCount, consumeCount, latencySamples: mqLatencies.length, avgLatencyMs: avg(mqLatencies.reduce((a,b)=>a+b,0), mqLatencies.length), p95LatencyMs: p95(mqLatencies), maxLatencyMs: Math.max(...mqLatencies, 0), slowest: messaging.slice().sort((a,b)=>b.durationMs-a.durationMs).slice(0, 10) },
    http: { count: http.length, slowest: http.slice().sort((a,b)=>b.durationMs-a.durationMs).slice(0, 10) }
  };
}

function buildFindings(trace, graph, context) {
  const { metrics, edgeStats, slowestHops, slowestSpans, repeatedOperationGroups, revisitedServices, opStats } = context;
  const findings = [];
  const add = (finding) => findings.push({
    id: finding.id || `finding-${findings.length + 1}`,
    title: finding.title,
    severity: finding.severity || 'info',
    confidence: finding.confidence || confidence('medium'),
    category: finding.category || 'general',
    evidence: finding.evidence || [],
    impact: finding.impact || '',
    recommendation: finding.recommendation || '',
    text: finding.text || finding.impact || finding.recommendation || ''
  });

  if (trace.errorSpans.length) {
    add({
      title: 'Errors detected', severity: 'error', confidence: 'high', category: 'reliability',
      evidence: [`${trace.errorSpans.length} span(s) have error status.`],
      impact: 'The request path contains failed operations, so latency analysis should be interpreted together with error handling and retries.',
      recommendation: 'Start with the error spans before optimizing latency.'
    });
  }

  const repeatedEdges = edgeStats.filter(e => e.calls > 1).sort((a,b)=>b.calls-a.calls || b.totalMs-a.totalMs);
  if (repeatedEdges.length) {
    const e = repeatedEdges[0];
    add({
      title: 'Repeated service communication', severity: e.calls >= 10 ? 'warn' : 'info', confidence: 'high', category: 'redundancy',
      evidence: [`${e.source} → ${e.target}`, `${e.calls} calls`, `${fmt(e.totalMs)} cumulative`, `${fmt(e.avgMs)} average`, `Most common operation: ${e.topLabel}`],
      impact: 'This is cumulative work volume, not necessarily wall time. If the calls overlap, total time can exceed the request wall time; it can still indicate N+1 behavior, request fragmentation, or redundant downstream lookups.',
      recommendation: 'Check whether these calls can be batched, cached in request scope, or replaced by a single broader downstream request.'
    });
  }

  if (repeatedOperationGroups.length) {
    const g = repeatedOperationGroups[0];
    add({
      title: 'Duplicate operation pattern', severity: g.calls >= 3 ? 'warn' : 'info', confidence: 'high', category: 'duplicate-work',
      evidence: [`${g.source} → ${g.target}`, `${g.calls} matching operations`, `${fmt(g.totalMs)} cumulative`, `Operation: ${g.label}`],
      impact: 'The same operation label appears multiple times on the same edge, which is stronger evidence of duplicate work than repeated service visits alone.',
      recommendation: 'If the parameters are identical or equivalent, cache/reuse the result during the request. If they differ only by ID, consider a batch endpoint.'
    });
  }

  if (slowestHops.length) {
    const h = slowestHops[0];
    add({
      title: 'Slowest boundary hop', severity: h.durationMs > metrics.wallTimeMs * 0.2 ? 'warn' : 'info', confidence: 'high', category: 'latency',
      evidence: [`${h.source} → ${h.target}`, `${fmt(h.durationMs)} duration`, `Started at +${fmt(h.startOffsetMs)}`, `Operation: ${h.label}`],
      impact: `This single hop accounts for ${pct(h.durationMs, metrics.wallTimeMs)} of the trace wall time if it blocks the response path.`,
      recommendation: 'Inspect downstream service latency, payload size, retries, and whether this hop sits on the critical path.'
    });
  }

  if (metrics.criticalPathLength) {
    add({
      title: 'Critical path identified', severity: metrics.criticalPathDurationMs > metrics.wallTimeMs * 0.7 ? 'warn' : 'info', confidence: 'medium', category: 'critical-path',
      evidence: [`${metrics.criticalPathLength} dependent boundary steps`, `${fmt(metrics.criticalPathDurationMs)} critical-chain duration`, `${pct(metrics.criticalPathDurationMs, metrics.wallTimeMs)} of wall time`, `Ends at ${metrics.criticalPathEndService}`],
      impact: 'This is the parent-chain path that reaches the latest leaf span. It is useful for understanding latency propagation, but asynchronous traces can make exact critical-path reconstruction approximate.',
      recommendation: 'Prioritize optimizations on this chain before optimizing off-path background work.'
    });
  }

  if (revisitedServices.length) {
    const [svc, count] = revisitedServices[0];
    add({
      title: 'Service revisited multiple times', severity: count >= 5 ? 'warn' : 'info', confidence: 'medium', category: 'round-trips',
      evidence: [`${svc} visited ${count} times`],
      impact: 'Repeated visits to the same service can indicate avoidable round trips, fragmented ownership of data, or async fan-out loops.',
      recommendation: 'Review whether the caller can collect required data in one visit, or whether downstream events are producing avoidable loops.'
    });
  }

  if (opStats.database.count) {
    const severity = opStats.database.maxMs > metrics.wallTimeMs * 0.1 ? 'warn' : 'ok';
    add({
      title: 'Database activity summary', severity, confidence: 'high', category: 'database',
      evidence: [`${opStats.database.count} DB spans`, `${fmt(opStats.database.totalMs)} cumulative`, `${fmt(opStats.database.avgMs)} average`, `${fmt(opStats.database.maxMs)} max`],
      impact: severity === 'ok' ? 'Database spans do not appear to dominate the wall time based on duration alone.' : 'One or more database operations contribute a visible portion of wall time.',
      recommendation: severity === 'ok' ? 'Do not start with DB optimization unless payload/query semantics indicate otherwise.' : 'Inspect indexes, query shape, collection scans, and request-scope duplicate DB access.'
    });
  }

  if (opStats.messaging.count) {
    const hasLatency = opStats.messaging.latencySamples > 0;
    add({
      title: 'Messaging activity summary', severity: opStats.messaging.maxLatencyMs > 100 ? 'warn' : 'ok', confidence: hasLatency ? 'high' : 'medium', category: 'messaging',
      evidence: [`${opStats.messaging.count} messaging spans`, `${opStats.messaging.publishCount} publishes`, `${opStats.messaging.consumeCount} receives/processes`, hasLatency ? `${fmt(opStats.messaging.avgLatencyMs)} avg queue latency` : 'No queue latency attributes found'],
      impact: hasLatency && opStats.messaging.maxLatencyMs <= 100 ? 'Queue latency looks low in this trace.' : 'Messaging contributes to trace fan-out; queue latency should be checked when available.',
      recommendation: 'Separate synchronous response-path messaging from async post-response work when deciding what to optimize.'
    });
  }

  if (!findings.length) {
    add({
      title: 'No obvious issues detected', severity: 'ok', confidence: 'medium', category: 'general',
      evidence: ['No errors, repeated boundary hops, or slow cross-service calls passed the current thresholds.'],
      impact: 'The request looks clean under the current analyzer rules.',
      recommendation: 'Use the Waterfall and Request Trace tabs for manual inspection.'
    });
  }

  return findings;
}

function computePerformanceScore(findings, metrics) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'error') score -= 25;
    if (f.severity === 'warn') score -= 10;
    if (f.category === 'redundancy' && f.severity === 'warn') score -= 8;
    if (f.category === 'critical-path' && f.severity === 'warn') score -= 6;
  }
  if (metrics.serviceHopCount > 100) score -= 8;
  if (metrics.criticalPathLength > 20) score -= 8;
  if (metrics.spanCount > 500) score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildExecutiveSummary(trace, context) {
  const { metrics, edgeStats, slowestHops, findings, opStats } = context;
  const topRepeated = edgeStats.filter(e => e.calls > 1).sort((a,b)=>b.calls-a.calls || b.totalMs-a.totalMs)[0];
  const slowest = slowestHops[0];
  const riskFindings = findings.filter(f => f.severity === 'error' || f.severity === 'warn');
  const parts = [];
  parts.push(`This request completed in ${fmt(metrics.wallTimeMs)} and produced ${metrics.spanCount} spans across ${metrics.uniqueServicesInHops} services/targets.`);
  parts.push(`The analyzer detected ${metrics.serviceHopCount} boundary hop events (${metrics.uniqueServiceHopCount} unique edges) and a ${metrics.criticalPathLength}-step critical path ending at ${metrics.criticalPathEndService || 'unknown'}.`);
  if (topRepeated) parts.push(`The most repeated edge is ${topRepeated.source} → ${topRepeated.target} with ${topRepeated.calls} calls and ${fmt(topRepeated.totalMs)} cumulative time; this is the strongest redundancy signal.`);
  if (slowest) parts.push(`The slowest single boundary hop is ${slowest.source} → ${slowest.target}, lasting ${fmt(slowest.durationMs)} at +${fmt(slowest.startOffsetMs)}.`);
  if (opStats.database.count) parts.push(`Database activity: ${opStats.database.count} spans, ${fmt(opStats.database.totalMs)} cumulative, max ${fmt(opStats.database.maxMs)}.`);
  if (opStats.messaging.count) parts.push(`Messaging activity: ${opStats.messaging.publishCount} publishes and ${opStats.messaging.consumeCount} receives/processes${opStats.messaging.latencySamples ? `, with ${fmt(opStats.messaging.avgLatencyMs)} average queue latency` : ''}.`);
  if (riskFindings.length) parts.push(`Main optimization focus: ${riskFindings.slice(0, 3).map(f => f.title.toLowerCase()).join(', ')}.`);
  return parts.join(' ');
}

function buildRecommendations(findings) {
  const recommendations = [];
  for (const f of findings) {
    if (!f.recommendation) continue;
    recommendations.push({
      title: f.title,
      severity: f.severity,
      confidence: f.confidence,
      category: f.category,
      recommendation: f.recommendation,
      evidence: f.evidence
    });
  }
  return recommendations;
}

export function analyzeTrace(trace, graph) {
  const hops = buildRequestHops(trace);
  const spanTimeline = buildSpanTimeline(trace);
  const hopGroups = buildHopGroups(hops);
  const serviceVisits = buildServiceVisits(hops);
  const metrics = computeTraceMetrics(trace, graph);
  const slowestSpans = trace.spans.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20);
  const slowestHops = hops.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20);
  const repeatedHops = hopGroups.filter(g => g.calls > 1).slice(0, 30);
  const repeatedServiceTrips = [...(graph?.edges || [])].filter(e => e.calls > 1).sort((a, b) => b.calls - a.calls || b.totalMs - a.totalMs).slice(0, 30);
  const roots = trace.roots.slice().sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  const leafIds = new Set(trace.spans.map(s => s.parentId).filter(Boolean));
  const endSpans = trace.spans.filter(s => !leafIds.has(s.id)).sort((a, b) => spanEndOffset(b) - spanEndOffset(a)).slice(0, 20);
  const serviceVisitCounts = new Map();
  for (const h of hops) serviceVisitCounts.set(h.target, (serviceVisitCounts.get(h.target) || 0) + 1);
  const revisitedServices = [...serviceVisitCounts.entries()].filter(([, count]) => count > 1).sort((a,b)=>b[1]-a[1]).slice(0, 20);
  const edgeStats = buildEdgeStats(hops);
  const repeatedOperationGroups = hopGroups.filter(g => g.calls > 1).sort((a,b)=>b.calls-a.calls || b.totalMs-a.totalMs).slice(0, 30);
  const opStats = buildOperationStats(trace);

  const provisionalContext = { metrics, edgeStats, slowestHops, slowestSpans, repeatedOperationGroups, revisitedServices, opStats };
  const findings = buildFindings(trace, graph, provisionalContext);
  const score = computePerformanceScore(findings, metrics);
  const context = { ...provisionalContext, findings, score };
  const executiveSummary = buildExecutiveSummary(trace, context);
  const recommendations = buildRecommendations(findings);

  // Backward-compatible plain text recommendations for old UI/export code.
  const recommendationTexts = recommendations.map(r => `${r.recommendation} (${r.confidence} confidence; evidence: ${r.evidence.slice(0, 2).join(', ')})`);

  return {
    engineVersion: 'analysis-engine-v1',
    score,
    executiveSummary,
    metrics,
    hops,
    spanTimeline,
    hopGroups,
    serviceVisits,
    slowestSpans,
    slowestHops,
    repeatedHops,
    repeatedServiceTrips,
    repeatedOperationGroups,
    edgeStats,
    opStats,
    revisitedServices,
    roots,
    endSpans,
    findings,
    structuredRecommendations: recommendations,
    recommendations: recommendationTexts.length ? recommendationTexts : ['Use the Waterfall and Request Trace tabs to inspect the request chronologically.']
  };
}

function findingMarkdown(findings) {
  return findings.map((f, i) => `### Finding ${i + 1}: ${f.title}\n\n- Severity: ${f.severity}\n- Confidence: ${f.confidence}\n- Category: ${f.category}\n- Evidence:\n${f.evidence.map(e => `  - ${e}`).join('\n')}\n- Impact: ${f.impact || '-'}\n- Recommendation: ${f.recommendation || '-'}\n`).join('\n');
}

export function analysisMarkdown(trace, graph) {
  const a = analyzeTrace(trace, graph);
  const rootLines = a.roots.slice(0, 10).map(s => `- Start: ${s.service} — ${spanLabel(s)} (+${fmt(s.startOffsetMs)}, ${fmt(s.durationMs)})`).join('\n');
  const endLines = a.endSpans.slice(0, 10).map(s => `- End: ${s.service} — ${spanLabel(s)} (+${fmt(spanEndOffset(s))}, ${fmt(s.durationMs)})`).join('\n');
  const repeated = a.edgeStats.filter(e => e.calls > 1).slice(0, 15).map(e => `- ${e.source} → ${e.target}: ${e.calls} calls, ${fmt(e.totalMs)} cumulative, avg ${fmt(e.avgMs)}, max ${fmt(e.maxMs)}, operation: ${e.topLabel}`).join('\n');
  const repeatedOps = a.repeatedOperationGroups.slice(0, 15).map(g => `- ${g.source} → ${g.target}: ${g.calls} × ${g.label}, ${fmt(g.totalMs)} cumulative`).join('\n');
  const revisits = a.revisitedServices.map(([svc, count]) => `- ${svc}: ${count} visits`).join('\n');
  const slowHops = a.slowestHops.slice(0, 15).map(h => `- ${h.source} → ${h.target}: ${fmt(h.durationMs)} at +${fmt(h.startOffsetMs)} — ${h.label}`).join('\n');
  const criticalSteps = a.metrics.criticalPathSteps.map((h, i) => `| ${i + 1} | ${h.source} → ${h.target} | ${h.type} | ${h.label.replace(/\|/g, '/')} | +${fmt(h.startOffsetMs)} | ${fmt(h.durationMs)} |`).join('\n');
  const allHops = a.hops.map((h, i) => `| ${i + 1} | +${fmt(h.startOffsetMs)} | ${fmt(h.durationMs)} | ${h.source} → ${h.target} | ${h.type} | ${h.label.replace(/\|/g, '/')} | ${h.status} |`).join('\n');

  return `# Distributed Trace Analysis\n\n## Executive Summary\n\n${a.executiveSummary}\n\n## Performance Score\n\n${a.score} / 100\n\n## Headline Metrics\n\n- Wall time: ${fmt(a.metrics.wallTimeMs)}\n- Span count: ${a.metrics.spanCount}\n- Service hop count: ${a.metrics.serviceHopCount}\n- Unique service edges: ${a.metrics.uniqueServiceHopCount}\n- Critical path length: ${a.metrics.criticalPathLength}\n- Critical path duration: ${fmt(a.metrics.criticalPathDurationMs)}\n- Database spans: ${a.metrics.dbSpanCount}\n- Messaging spans: ${a.metrics.messagingSpanCount}\n\n## Findings\n\n${findingMarkdown(a.findings)}\n\n## Recommendations\n\n${a.structuredRecommendations.map((r, i) => `${i + 1}. **${r.title}** (${r.confidence} confidence): ${r.recommendation}`).join('\n')}\n\n## Critical Path Steps\n\n| # | Hop | Type | Operation | Start | Duration |\n|---:|---|---|---|---:|---:|\n${criticalSteps || '| - | No boundary steps detected | - | - | - | - |'}\n\n## Where the request started\n\n${rootLines || '- No root spans found.'}\n\n## Where the request ended\n\n${endLines || '- No leaf/end spans found.'}\n\n## Potential redundant service trips\n\n${repeated || '- No repeated service-to-service trips detected.'}\n\n## Duplicate operation patterns\n\n${repeatedOps || '- No repeated operation labels detected.'}\n\n## Services visited more than once\n\n${revisits || '- No revisited services detected.'}\n\n## Longest cross-service / external hops\n\n${slowHops || '- No cross-boundary hops detected.'}\n\n## Database Summary\n\n- Count: ${a.opStats.database.count}\n- Cumulative duration: ${fmt(a.opStats.database.totalMs)}\n- Average duration: ${fmt(a.opStats.database.avgMs)}\n- Max duration: ${fmt(a.opStats.database.maxMs)}\n- P95 duration: ${fmt(a.opStats.database.p95Ms)}\n\n## Messaging Summary\n\n- Count: ${a.opStats.messaging.count}\n- Publishes: ${a.opStats.messaging.publishCount}\n- Receives/processes: ${a.opStats.messaging.consumeCount}\n- Queue latency samples: ${a.opStats.messaging.latencySamples}\n- Average queue latency: ${fmt(a.opStats.messaging.avgLatencyMs)}\n- P95 queue latency: ${fmt(a.opStats.messaging.p95LatencyMs)}\n\n## Full hop timeline\n\n| # | Offset | Duration | Hop | Type | Operation | Status |\n|---:|---:|---:|---|---|---|---|\n${allHops || '| - | - | - | No hops detected | - | - | - |'}\n`;
}
