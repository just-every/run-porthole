# Private dashboards

Open `/app/dashboards` from Explore. Owners, admins and maintainers create a dashboard for a service, team, environment and exact nanosecond range. Each new dashboard contains a selected metric average, log count and trace duration p95. Metric selection is exact; unrelated metrics do not enter the average. Trace durations use milliseconds. Metric units come from intake; incompatible units produce an error.

Add panels and annotations from the dashboard's editor. Keyboard Move up and Move down controls and pointer dragging save a conditional new revision. The JSON editor supports the same validated definition. Clone creates an independent dashboard. Archive preserves the definition and history. Every change uses the current native session and writes a private transactional audit fact.

Team, environment and range controls alter the current view. A private shared link preserves those parameters; it grants no authority. Every opening checks current membership and the complete dashboard scope. Each underlying-query link carries the same signal, service, variables, range, metric selection and completed-ingest watermark into Explore. Historical revisions require both current and historical scope.

Charts display numeric values in record order, beside their aggregate and values table. Empty, stale, partial and failed queries have separate labels. Reads follow bounded pages; an unfinished scan has no aggregate presented as complete. TV mode hides editing controls and remains private. It does not publish a sanitized public dataset.

Installation archives include current dashboards and every saved revision. Restore preserves their definitions but quarantines the current dashboard; an authorized person reviews and saves a new revision before it queries again. Sessions and sharing authority do not transfer.

The full widget catalog, visual query dialects, source-dashboard import parity, week comparisons, public publication, embeds and image export remain open contract work. These three panel aggregates do not qualify the full dashboard catalog.
