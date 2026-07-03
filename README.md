# Tempo Distributed Trace Analyzer

Standalone browser-based analyzer for Grafana Tempo / OpenTelemetry JSON exports.

## Run

```bash
npm config set registry https://registry.npmjs.org/
npm install
npm start
```

Open the shown URL and upload a Tempo JSON export.

## Analysis Engine v1

The analyzer now produces a structured report object instead of simple heuristic recommendation strings.

It includes:

- executive summary
- performance score
- structured findings
- severity and confidence per finding
- evidence per finding
- impact statement
- recommendation per finding
- span count, service hop count, critical path length
- repeated service communication detection
- duplicate operation pattern detection
- slowest boundary hop detection
- DB and RabbitMQ summaries
- exported `analysis.md`, `summary.md`, `waterfall.md`, `spans.csv`, `hops.csv`, `service-graph.mmd`, and interactive `index.html`

## v0.4.1

- Fixed exported HTML service graph rendering when UI filters are active.
- Exported HTML now uses the full trace graph, not the currently filtered in-app graph.
- Replaced the exported SVG layout with a stable first-seen grid layout so cyclic traces do not collapse into an empty-looking graph.
