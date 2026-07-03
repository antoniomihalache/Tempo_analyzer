import React, { useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { parseTempoTrace } from './parser/tempoParser.js';
import { buildGraph, criticalPath } from './graph/buildGraph.js';
import { GraphView } from './ui/GraphView.jsx';
import { DetailsPanel } from './ui/DetailsPanel.jsx';
import { Waterfall } from './ui/Waterfall.jsx';
import { SpansTable } from './ui/SpansTable.jsx';
import { AnalysisPanel } from './ui/AnalysisPanel.jsx';
import { RequestTrace } from './ui/RequestTrace.jsx';
import { computeTraceMetrics } from './analysis/traceAnalysis.js';
import { downloadReportFiles } from './exporters/reportExport.js';
import './styles.css';

const allTypes = ['http-server','http-client','database','messaging','internal'];

function App() {
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [tab, setTab] = useState('graph');
  const [query, setQuery] = useState('');
  const [minCalls, setMinCalls] = useState(1);
  const [minDuration, setMinDuration] = useState(0);
  const [topEdges, setTopEdges] = useState(80);
  const [showInfra, setShowInfra] = useState(true);
  const [layoutName, setLayoutName] = useState('dagre');
  const [types, setTypes] = useState(new Set(allTypes));
  const [showCritical, setShowCritical] = useState(false);

  async function loadFile(file) {
    setError(''); setPinned(null); setHover(null);
    try { setTrace(parseTempoTrace(JSON.parse(await file.text()))); }
    catch (e) { setError(e?.message || String(e)); }
  }

  const graph = useMemo(() => trace ? buildGraph(trace, { minCalls, showInfra, query, minDuration, topEdges, types }) : null, [trace, minCalls, showInfra, query, minDuration, topEdges, types]);
  const crit = useMemo(() => graph && showCritical ? criticalPath(graph) : null, [graph, showCritical]);
  const metrics = useMemo(() => trace && graph ? computeTraceMetrics(trace, graph) : null, [trace, graph]);
  const active = hover || pinned;
  const toggleType = useCallback((t) => setTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; }), []);

  return <div className="app">
    <header className="topbar">
      <div><h1>Tempo Trace Explorer</h1><p>Standalone Grafana/Tempo JSON trace explorer. No backend. No Load Forge dependency.</p></div>
      <label className="primaryButton">Open Tempo JSON<input type="file" accept=".json,application/json" onChange={e => e.target.files?.[0] && loadFile(e.target.files[0])}/></label>
    </header>
    {error && <div className="error">{error}</div>}
    {!trace && <section className="emptyState"><h2>Upload a Tempo JSON export</h2><p>Hover/click services, filter noisy spans, view waterfall, and export report files.</p></section>}
    {trace && graph && <>
      <section className="summaryGrid">
        <div className="card stat"><span>Wall time</span><strong>{trace.wallTimeMs.toFixed(1)} ms</strong></div>
        <div className="card stat"><span>Span count</span><strong>{metrics?.spanCount}</strong><em>recorded work units</em></div>
        <div className="card stat"><span>Service hops</span><strong>{metrics?.serviceHopCount}</strong><em>{metrics?.uniqueServiceHopCount} unique edges</em></div>
        <div className="card stat"><span>Critical path length</span><strong>{metrics?.criticalPathLength}</strong><em>dependent boundary steps</em></div>
        <div className="card stat"><span>Services</span><strong>{trace.services.length}</strong></div>
        <div className="card stat"><span>Graph</span><strong>{graph.nodes.length}/{graph.edges.length}</strong><em>nodes/edges</em></div>
        <div className="card stat"><span>Errors</span><strong>{trace.errorSpans.length}</strong></div>
      </section>

      <section className="card controls">
        <input placeholder="Search service, route, span, endpoint..." value={query} onChange={e=>setQuery(e.target.value)} />
        <label>Min calls <input type="number" min="1" value={minCalls} onChange={e=>setMinCalls(Math.max(1, Number(e.target.value||1)))} /></label>
        <label>Min ms <input type="number" min="0" value={minDuration} onChange={e=>setMinDuration(Math.max(0, Number(e.target.value||0)))} /></label>
        <label>Top edges <input type="number" min="5" value={topEdges} onChange={e=>setTopEdges(Math.max(5, Number(e.target.value||80)))} /></label>
        <select value={layoutName} onChange={e=>setLayoutName(e.target.value)}><option value="dagre">Dagre LR</option><option value="breadthfirst">Breadthfirst</option><option value="circle">Circle</option></select>
        <label className="check"><input type="checkbox" checked={showInfra} onChange={e=>setShowInfra(e.target.checked)} /> Infra</label>
        <label className="check"><input type="checkbox" checked={showCritical} onChange={e=>setShowCritical(e.target.checked)} /> Critical path</label>
      </section>
      <section className="typeFilters">{allTypes.map(t => <button key={t} className={types.has(t)?'chip on':'chip'} onClick={()=>toggleType(t)}>{t}</button>)}<button className="chip" onClick={()=>downloadReportFiles(trace, graph)}>Export report files</button></section>
      {showCritical && <section className="criticalNote"><b>Critical path:</b> highlights the heaviest connected chain in the current service graph, using total edge duration as weight. It is not the exact CPU execution path; it is a latency-focused approximation that helps you see which route contributes the most accumulated time under the current filters.</section>}
      <nav className="tabs"><button className={tab==='graph'?'active':''} onClick={()=>setTab('graph')}>Graph</button><button className={tab==='trace'?'active':''} onClick={()=>setTab('trace')}>Request trace</button><button className={tab==='analysis'?'active':''} onClick={()=>setTab('analysis')}>Analysis</button><button className={tab==='waterfall'?'active':''} onClick={()=>setTab('waterfall')}>Waterfall</button><button className={tab==='spans'?'active':''} onClick={()=>setTab('spans')}>Spans</button></nav>
      {tab === 'graph' && <>
        <section className="card graphCard"><div className="cardHeader"><div><h2>Service graph</h2><p>Taller canvas. Pan/zoom enabled. Hover or click a service to highlight upstream/downstream paths.</p></div><span>{graph.nodes.length} nodes • {graph.edges.length} edges</span></div><GraphView graph={graph} activeNodeId={active} pinnedNodeId={pinned} critical={crit} layoutName={layoutName} onHover={setHover} onPin={setPinned}/></section>
        <DetailsPanel trace={trace} graph={graph} nodeId={active}/>
      </>}
      {tab === 'trace' && <RequestTrace trace={trace} graph={graph}/>}
      {tab === 'analysis' && <AnalysisPanel trace={trace} graph={graph}/>}
      {tab === 'waterfall' && <Waterfall trace={trace}/>} 
      {tab === 'spans' && <SpansTable trace={trace}/>} 
    </>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />);
