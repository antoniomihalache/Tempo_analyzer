# Tempo Distributed Trace Analyzer

Standalone React/Vite app for analyzing Grafana Tempo JSON exports.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL and upload a Grafana/Tempo JSON trace export.

## What it shows

- Service graph with pan/zoom, hover/click path highlighting, and optional critical path highlighting.
- Full request path: every cross-service/external hop in chronological order, including timing, status, operation, and repeated-hop markers.
- All-spans mode: full span timeline including internal/middleware spans.
- Analysis tab: automatic conclusions, slowest hops, repeated trips, revisited services, request start/end, and recommendations.
- Waterfall and spans table.
- Export report files: `summary.md`, `analysis.md`, `waterfall.md`, `spans.csv`, `hops.csv`, `service-graph.mmd`, and an interactive standalone `index.html` report suitable for Confluence/Jira attachment.

## Critical path checkbox

Critical path highlights the heaviest connected chain in the currently visible service graph, using accumulated edge duration. It is a latency-focused approximation. It is useful for spotting the path that contributes the most time, but it is not the exact CPU execution path and it changes when filters change.


## v5 updates

- Redesigned Waterfall view.
- Service column is compact and uses shortened labels with full names on hover.
- Timeline column is wider and behaves like a real trace timeline with a time ruler.
- Timeline bars are positioned by span start offset and sized by duration.
- Colors distinguish HTTP, database, messaging, and internal spans.
