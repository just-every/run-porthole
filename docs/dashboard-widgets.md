# Native dashboard widget slice

The renderer in `./src/porthole/dashboards/widgets.ts` exports `widgetKinds`,
`WidgetInput`, and `widgetMarkup(input): string`. It renders only data supplied
by the existing authorized dashboard read. It performs no query and supplies no
application values when data is absent. Unknown widget kinds fail with status
400. The parent page retains its current state indicator, underlying query link,
and the selected widget. Tables expose exact values; charts retain source links.

The input is a kind, title, unit, aggregate value or null, selected `from` and
`through` Unix nanoseconds, numeric points, source log records, and optional
explicit note text. Every point has `timeNs`, `value`, and the actual `series`
identity supplied by the read layer. A record has `id`, `event_time_ns`, and
`payload.record`. No extra record fields are required. Reads must preserve the
full series identity; the renderer never infers a service or group from a title.
Inputs are bounded to 2,000 points and 2,000 records. Invalid numbers, timestamps,
or samples outside the selected inclusive range are refused.

| Kind | Meaning |
| --- | --- |
| `query_value` | The supplied aggregate value and unit, without another aggregation. Null shows no data. |
| `timeseries` | One chronological line per actual series. Horizontal position uses the exact timestamp difference within the selected range; vertical position uses the observed numeric extent. Every observation is a visible point. A constant extent is centered. Lines connect adjacent observations without inserting values, extrapolating, or filling missing intervals. |
| `table` | Every supplied point with UTC time, original nanoseconds, actual series identity, value, and unit. |
| `top_list` | All actual series ranked by descending arithmetic mean, with observation counts. Ties use the series name. It does not silently discard lower-ranked series. |
| `list` | The same complete ranked series means as a readable ordered list and exact table. |
| `distribution` | An equal-width histogram over the observed numeric extent. The number of buckets is the lesser of six and the ceiling of the square root of the observation count. A constant value has one bucket. Every lower boundary is inclusive; upper boundaries are exclusive except the last, which includes the maximum. Counts are exact. |
| `heatmap` | Exact counts in equal time and value bins. Time uses the selected inclusive nanosecond range, with at most eight columns; value uses the observed extent, with at most six rows. Each axis also respects the ceiling of the square root of the observation count. A constant value has one row; time columns never exceed the number of integer nanoseconds. Time boundaries use integer arithmetic. All bin rectangles include their exact count, including zero. A table identifies nonempty time and value intervals. |
| `pie` | Each actual series contributes its arithmetic mean. Areas use each mean divided by the sum of means. All series, counts, means and the total remain in an exact table. Any negative source value is refused with an actionable instruction to choose a timeseries or table. Zero means have no area. |
| `treemap` | A slice partition of rectangular area using the same nonnegative series means and exact total as the pie. This is a proportional area view, with each series identified in the exact table and accessible shape label. It does not imply hierarchy. |
| `log_stream` | Actual source log bodies, their UTC time and original nanoseconds, in supplied record order. OTLP scalar AnyValues become plain text; arrays and key-value lists become readable plain text. Bytes remain their source encoding. Missing bodies remain empty. Unknown body shapes are refused. |
| `notes` | Only explicitly supplied plain text. Text is escaped; line breaks are preserved. Markup, scripts, images and embedded frames do not execute. An absent note is an error; an explicit empty note is identified as empty. |

Arithmetic means use the supplied observations once each. The numeric total for
the grouped views is the sum of those series means, rather than a global mean
or raw sample total. Values are not rounded in tables or semantic attributes.
Non-finite results or an unrepresentable numeric extent fail with actionable
errors instead of drawing invented values. When all proportional means are
zero, the renderer states that there is no proportional area and retains every
zero in the exact table. An empty dataset renders a no-data statement.

Charts contain only numeric geometry and escaped text. They have accessible
image labels and titles, use the existing document look and current text color,
and load no scripts or external assets. SVG text is at least 13 units in a
280-unit viewbox to remain readable in the native narrow card. UTC axis labels
never use browser local time; raw timestamps retain nanosecond precision.
`data-count` on histogram and heatmap rectangles exposes exact bin counts.
Grouped table rows expose `data-series` and `data-value`; their table exposes
`data-total`. These attributes describe the displayed data.

This slice does not complete PORT-018 or PORT-068. Source-import parity,
layout and grouping containers, reusable powerpacks, formulas and the other
required function families remain gaps. Previous-week overlays use the fixed UTC
offset documented in `./docs/dashboards.md`; they preserve actual source ranges
and do not fill missing observations. Host and topology maps, service and
SLO summaries, monitor and check status, alert graphs, event streams, change
comparisons, scatter plots, geomaps, split graphs, images and embedded frames
are unsupported. No service, SLO, monitor, event or check data is inferred from
numeric points. Public publication remains the separately reviewed frozen
projection workflow; these private widget inputs are never publicized by the
renderer.
