# Dashboard Generation Skill

## Role
Generate interactive HTML dashboards for data visualization based on analysis results.

## Input
- Read from `state/run_<run_id>__data_analysis.json`
- Read input manifest for data source metadata

## Output
- Write dashboard HTML to `artifacts/run_<run_id>__live_dashboard__artifact.json`
- Include sources/view/actions specification

## Charts Supported
- Bar chart (category distribution)
- Line chart (time series)
- Pie chart (strategy group distribution)
- KPI cards (summary statistics)

## Rules
- Output must be self-contained HTML (inline CSS, no external dependencies)
- Responsive within the canvas panel (max-width: 800px)
- Use the tequila design token colors for consistency
