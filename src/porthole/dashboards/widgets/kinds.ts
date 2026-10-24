export const widgetKinds=['query_value','timeseries','table','top_list','distribution','heatmap','pie','treemap','list','log_stream','notes'] as const
export type WidgetKind=typeof widgetKinds[number]
