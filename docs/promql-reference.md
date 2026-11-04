# Bounded PromQL evaluation

The scalar reference is stock Prometheus **3.5.0**, using its default five-minute
lookback and the evaluation semantics in that release. This is a declared subset,
not full PromQL compatibility. The reference journey uses the released server
and a real instrumented counter producer; schema-edge samples supplement it.

The supported comparison cases are:

1. Instant gauge selection preserves all series labels and exact equality
   matchers. Each evaluation selects the latest sample at or before its timestamp
   and strictly inside lookback. Missing series stay absent.
2. Range evaluation repeats that selection at explicit start, end and step.
   End is included only when a step reaches it. No interpolation fills gaps.
3. `sum by (...)` groups selected values by the named labels, drops other labels
   and the metric name, and preserves absence rather than inventing zero series.
4. `rate(selector[duration])` and `increase(selector[duration])` use cumulative
   monotonic counters, exclude the left range boundary, require two samples,
   account for resets and use Prometheus boundary extrapolation and zero bounds.
5. Counter increments and a real producer process reset compare against the
   same samples and evaluation instants in the stock reference server.
6. Stale markers, absent inputs, lookback edges, exact range boundaries and
   multiple native read pages preserve membership and numeric values.

Only scalar OTLP gauges and monotonic cumulative sums are evaluated. Delta sums,
non-monotonic sums, histograms and summaries refuse. Units must remain compatible
within each series and each sum group. Unknown numeric types and non-finite
values refuse; explicit no-recorded-value and Prometheus stale markers are
missing evidence. Ordinary NaN is not a stale marker.

Unsupported operators, regex matchers, arbitrary functions, native histograms,
exemplars, recording rules and rollups remain outside this slice. Scan, byte,
series and evaluation limits refuse the entire evaluation with no complete
result. Retention, full compliance and capacity qualification remain open.
