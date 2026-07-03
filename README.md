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
