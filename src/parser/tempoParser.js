export function attrsToObject(attributes = []) {
  const obj = {};
  for (const attr of attributes || []) {
    const key = attr.key;
    const val = attr.value || {};
    if ('stringValue' in val) obj[key] = val.stringValue;
    else if ('intValue' in val) obj[key] = Number(val.intValue);
    else if ('doubleValue' in val) obj[key] = Number(val.doubleValue);
    else if ('boolValue' in val) obj[key] = Boolean(val.boolValue);
    else if ('arrayValue' in val) obj[key] = val.arrayValue;
    else obj[key] = val;
  }
  return obj;
}

export function cleanServiceName(value = '') {
  return String(value || '')
    .replace(/^https?:\/\//, '')
    .replace(/^Exchange\[/, '')
    .replace(/^Queue\[/, '')
    .replace(/\].*$/, '')
    .replace(/:\d+$/, '')
    .trim() || 'unknown';
}

function endpointFromUrl(url = '') {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search || ''}`;
  } catch {
    return String(url || '').replace(/^https?:\/\/[^/]+/, '') || '';
  }
}

export function parseTempoTrace(raw) {
  const batches = raw.batches || raw.resourceSpans || [];
  const spans = [];
  const spanById = new Map();
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = 0;

  for (const batch of batches) {
    const resourceAttrs = attrsToObject(batch.resource?.attributes || []);
    const service = resourceAttrs['service.name'] || resourceAttrs.serviceName || 'unknown-service';
    const pod = resourceAttrs['host.name'] || '';
    const groups = batch.instrumentationLibrarySpans || batch.scopeSpans || [];

    for (const group of groups) {
      for (const span of group.spans || []) {
        const attrs = attrsToObject(span.attributes || []);
        const startNs = Number(span.startTimeUnixNano || 0);
        const endNs = Number(span.endTimeUnixNano || startNs);
        const durationMs = Math.max(0, (endNs - startNs) / 1_000_000);
        if (startNs) minStart = Math.min(minStart, startNs);
        if (endNs) maxEnd = Math.max(maxEnd, endNs);

        const method = attrs['http.method'] || attrs['http.request.method'] || '';
        const url = attrs['http.url'] || attrs['url.full'] || '';
        const route = attrs['http.route'] || attrs['http.target'] || attrs['url.path'] || endpointFromUrl(url) || '';
        const status = attrs['http.status_code'] || attrs['http.response.status_code'] || attrs['http.response.status'] || '';
        const dbSystem = attrs['db.system'] || '';
        const dbCollection = attrs['db.collection'] || '';
        const messagingSystem = attrs['messaging.system'] || '';
        const messagingOperation = attrs['messaging.operation'] || '';
        const messagingDest = attrs['messaging.destination'] || attrs['messaging.source'] || attrs['messaging.self-destination'] || '';
        const peer = attrs['peer.service'] || attrs['net.peer.name'] || attrs['server.address'] || attrs['http.host'] || '';

        const parsed = {
          id: span.spanId,
          parentId: span.parentSpanId || '',
          traceId: span.traceId,
          name: span.name || '',
          kind: span.kind || '',
          statusCode: span.status?.code || 0,
          statusMessage: span.status?.message || '',
          service,
          pod,
          resourceAttrs,
          attrs,
          startNs,
          endNs,
          durationMs,
          startOffsetMs: 0,
          method,
          url,
          route,
          status,
          peerService: peer,
          dbSystem,
          dbCollection,
          messagingSystem,
          messagingOperation,
          messagingDestination: messagingDest,
          type: inferSpanType({ attrs, dbSystem, messagingSystem, kind: span.kind || '', name: span.name || '' })
        };
        spans.push(parsed);
        spanById.set(parsed.id, parsed);
      }
    }
  }

  if (!Number.isFinite(minStart)) minStart = 0;
  for (const span of spans) span.startOffsetMs = (span.startNs - minStart) / 1_000_000;

  const services = [...new Set(spans.map((s) => s.service))].sort();
  const errorSpans = spans.filter((s) => Number(s.status) >= 500 || Number(s.statusCode) > 0);
  const roots = spans.filter((s) => !s.parentId || !spanById.has(s.parentId));

  return { spans, spanById, services, errorSpans, roots, wallTimeMs: Math.max(0, (maxEnd - minStart) / 1_000_000), minStart, maxEnd };
}

function inferSpanType(span) {
  if (span.dbSystem) return 'database';
  if (span.messagingSystem) return 'messaging';
  if (span.kind?.includes('SERVER')) return 'http-server';
  if (span.kind?.includes('CLIENT')) return 'http-client';
  if (/middleware|router/i.test(span.name)) return 'internal';
  return 'internal';
}

export function inferExternalTarget(span) {
  if (span.dbSystem) {
    const label = span.dbSystem === 'mongodb' ? 'MongoDB' : span.dbSystem;
    return { id: cleanServiceName(label), label, type: 'database' };
  }
  if (span.messagingSystem) {
    const label = span.peerService || span.attrs?.['server.address'] || span.messagingSystem;
    return { id: cleanServiceName(label === 'rabbitmq' ? 'RabbitMQ' : label), label: label === 'rabbitmq' ? 'RabbitMQ' : cleanServiceName(label), type: 'messaging' };
  }
  if (span.peerService) {
    const id = cleanServiceName(span.peerService);
    if (id && !/^127\.0\.0\.1|localhost$/.test(id)) return { id, label: id, type: 'service' };
    if (/^127\.0\.0\.1|localhost$/.test(id)) return { id, label: id, type: 'local' };
  }
  return null;
}

export function spanLabel(span) {
  const method = String(span.method || '').toUpperCase();
  if (span.messagingSystem) return `${span.messagingOperation || 'message'} ${cleanServiceName(span.messagingDestination)}`.trim();
  if (span.dbSystem) return `${span.dbSystem} ${span.dbCollection || ''}`.trim();
  if (method || span.route) return `${method} ${span.route || endpointFromUrl(span.url)}`.trim();
  return span.name;
}
