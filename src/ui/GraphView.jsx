import React, { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
cytoscape.use(dagre);

function nodeColor(type) {
  if (type === 'database') return '#7c3aed';
  if (type === 'messaging') return '#d97706';
  if (type === 'local') return '#64748b';
  return '#2563eb';
}
function edgeColor(type) {
  if (type === 'database') return '#a78bfa';
  if (type === 'messaging') return '#f59e0b';
  return '#60a5fa';
}

export function GraphView({ graph, activeNodeId, pinnedNodeId, critical, onHover, onPin, layoutName }) {
  const ref = useRef(null);
  const cyRef = useRef(null);

  const elements = useMemo(() => [
    ...graph.nodes.map(n => ({ data: { id: n.id, label: n.label || n.id, type: n.type, color: nodeColor(n.type), spanCount: n.spanCount, totalMs: n.totalMs, errorCount: n.errorCount } })),
    ...graph.edges.map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label, totalMs: e.totalMs, calls: e.calls, type: e.type, color: edgeColor(e.type), topLabel: e.topLabel } }))
  ], [graph]);

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements,
      wheelSensitivity: 2.5,
      minZoom: 0.05,
      maxZoom: 2.5,
      style: [
        { selector: 'node', style: {
          'shape': 'round-rectangle', 'background-color': 'data(color)', 'border-width': 2, 'border-color': '#93c5fd',
          'label': 'data(label)', 'color': '#f8fafc', 'font-size': 18, 'font-weight': 800,
          'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': 210,
          'width': 190, 'height': 58, 'padding': '12px', 'text-outline-color': '#020617', 'text-outline-width': 3
        }},
        { selector: 'node[type="database"]', style: { 'shape': 'database' } },
        { selector: 'edge', style: {
          'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
          'width': 'mapData(totalMs, 0, 1000, 2, 8)', 'label': 'data(label)', 'font-size': 12, 'color': '#e2e8f0',
          'text-background-color': '#020617', 'text-background-opacity': 0.9, 'text-background-padding': 4,
          'text-rotation': 'autorotate', 'text-margin-y': -10
        }},
        { selector: '.dimmed', style: { 'opacity': 0.08 } },
        { selector: '.path', style: { 'opacity': 1, 'z-index': 999 } },
        { selector: 'node.path', style: { 'border-width': 5, 'border-color': '#22c55e' } },
        { selector: 'edge.path', style: { 'line-color': '#22c55e', 'target-arrow-color': '#22c55e', 'width': 6 } },
        { selector: '.critical', style: { 'border-color': '#f97316', 'line-color': '#f97316', 'target-arrow-color': '#f97316' } },
        { selector: '.pinned', style: { 'border-width': 6, 'border-color': '#facc15' } }
      ],
      layout: layoutConfig(layoutName)
    });
    cy.on('mouseover', 'node', e => onHover(e.target.id()));
    cy.on('mouseout', 'node', () => onHover(null));
    cy.on('tap', 'node', e => onPin(e.target.id()));
    cy.on('tap', e => { if (e.target === cy) onPin(null); });
    cyRef.current = cy;
    setTimeout(() => cy.fit(undefined, 60), 60);
    return () => cy.destroy();
  }, [elements, layoutName, onHover, onPin]);

  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().removeClass('dimmed path pinned critical');
    if (critical?.nodeIds?.length) {
      critical.nodeIds.forEach(id => cy.getElementById(id).addClass('critical'));
      critical.edgeIds.forEach(id => cy.getElementById(id).addClass('critical'));
    }
    if (pinnedNodeId) cy.getElementById(pinnedNodeId).addClass('pinned');
    const id = activeNodeId || pinnedNodeId;
    if (!id) return;
    const ids = new Set([id, ...graph.upstream(id), ...graph.downstream(id)]);
    const edgeIds = graph.connectedEdges([...ids]);
    cy.elements().addClass('dimmed');
    ids.forEach(x => cy.getElementById(x).removeClass('dimmed').addClass('path'));
    edgeIds.forEach(x => cy.getElementById(x).removeClass('dimmed').addClass('path'));
  }, [activeNodeId, pinnedNodeId, graph, critical]);

  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.layout(layoutConfig(layoutName)).run();
    setTimeout(() => cy.fit(undefined, 60), 120);
  }, [layoutName]);

  return <div className="graphViewport"><div ref={ref} className="cy" /></div>;
}

function layoutConfig(name) {
  if (name === 'breadthfirst') return { name: 'breadthfirst', directed: true, spacingFactor: 1.8, avoidOverlap: true, padding: 80 };
  if (name === 'circle') return { name: 'circle', spacingFactor: 1.5, padding: 80 };
  return { name: 'dagre', rankDir: 'LR', rankSep: 180, nodeSep: 80, edgeSep: 30, padding: 80, animate: false };
}
