# Dashboard Visualization Improvements

> Roadmap for enriching the Pew dashboard with advanced visualizations and insights.

## Product Positioning

Pew tracks token usage from local AI coding tools (Claude Code, Gemini CLI, OpenCode, OpenClaw). The dashboard should:

1. **Quantify value** — Show users how much they're using and what it costs
2. **Reveal patterns** — Surface productivity insights and usage trends
3. **Drive engagement** — Leaderboards, achievements, and personal milestones

---

## Improvement Categories

### 1. Cost Insights

| Feature | Description | Priority |
|---------|-------------|----------|
| Cost trend chart | Daily/weekly cost change curve | High |
| Cache savings ($\$$) | Actual money saved, not just percentage | High |
| Cost forecast | Linear extrapolation based on historical data (end-of-month projection) | Medium |
| Cost-per-token comparison | Bar chart comparing different models/tools | Medium |

### 2. Efficiency Metrics

| Feature | Description |
|---------|-------------|
| Tokens/hour | Coding efficiency metric |
| Cache hit rate trend | Line chart showing cache performance over time |
| Input/Output ratio | Pie chart reflecting conversation patterns |
| Reasoning ratio | "Thinking depth" metric for reasoning models |

### 3. Time Analysis Enhancements

| Feature | Description |
|---------|-------------|
| Peak hour detection | Highlight top 3 most active time slots |
| Weekend vs weekday comparison | Dual bar chart |
| Month-over-month comparison | MoM growth rate |
| Streak badges | Consecutive usage days (like GitHub contributions) |

### 4. Model/Tool Comparison

| Feature | Description |
|---------|-------------|
| Overlay trend chart | Compare multiple tools on same timeline |
| Tool switch timeline | When user switched from Claude to Gemini etc. |
| Model evolution chart | New vs legacy model share over time |

### 5. Personal Insight Cards

Spotify Wrapped-style "fun facts":

- "Your most-used model is **claude-sonnet-4**, accounting for **67%** of total usage"
- "Your cache hit rate is higher than **82%** of users"
- "Your most active time this week was **Wednesday 9-11 PM**"

### 6. Goal Tracking

| Feature | Description |
|---------|-------------|
| Monthly budget setting | User-defined token/cost limits |
| Progress bar | Used this month / budget |
| Overage warning | Alert when projected to exceed budget |

### 7. Leaderboard Enhancements

| Feature | Description |
|---------|-------------|
| Tier system | Bronze/Silver/Gold/Platinum ranking |
| Rank change indicators | Up/down arrows with position change |
| "Nearby users" | List of users with similar rankings |

### 8. Advanced Chart Types

| Chart | Use Case |
|-------|----------|
| Sankey diagram | Token flow: Tool → Model → Input/Output |
| Radar chart | Multi-dimensional assessment (cost, efficiency, frequency, cache rate) |
| Small multiples | Faceted trend charts by tool |

---

## MVP Extension Priority

Recommended implementation order for maximum impact:

1. **Cost trend chart** — Users care most about money
2. **Cache savings ($\$$)** — Emphasizes product value
3. **Personal insight cards** — Increases engagement and fun factor
4. **Weekend vs weekday comparison** — Easy to implement, valuable insight

---

## Technical Considerations

### Data Requirements

- Cost data requires accurate pricing tables per model
- Time-based aggregations need efficient queries (pre-compute daily/weekly buckets)
- Leaderboard tiers need periodic recalculation

### Frontend Libraries

- Current: Recharts (area, bar, pie, donut)
- Potential additions:
  - `d3-sankey` for Sankey diagrams
  - `react-radar-chart` for radar charts

### Performance

- Heavy aggregations should be computed server-side
- Consider caching computed insights (refresh daily)
- Large datasets need pagination or windowing

---

## Future Considerations

- **Team dashboards** — Aggregate usage across organization
- **API for power users** — Export data for custom analysis
- **Mobile-friendly charts** — Responsive design for smaller screens
- **Dark mode chart colors** — Already implemented via Basalt theme
