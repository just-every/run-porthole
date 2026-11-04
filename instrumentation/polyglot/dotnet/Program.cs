using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;
using OpenTelemetry.Logs;
using System.Diagnostics.Metrics;
using OpenTelemetry.Resources;
OpenTelemetry.Sdk.SetDefaultTextMapPropagator(new OpenTelemetry.Context.Propagation.CompositeTextMapPropagator(new OpenTelemetry.Context.Propagation.TextMapPropagator[]{new OpenTelemetry.Context.Propagation.TraceContextPropagator(),new PolicyPropagator()}));
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddOpenTelemetry().ConfigureResource(resource=>resource.AddService(Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet").AddEnvironmentVariableDetector()).WithTracing(tracing=>tracing.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter());
if(Environment.GetEnvironmentVariable("OTEL_LOGS_EXPORTER")!="none")builder.Logging.AddOpenTelemetry(logging=>{logging.IncludeScopes=true;logging.IncludeFormattedMessage=true;logging.SetResourceBuilder(ResourceBuilder.CreateDefault().AddService(Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet").AddEnvironmentVariableDetector());logging.AddOtlpExporter();});
if(Environment.GetEnvironmentVariable("OTEL_METRICS_EXPORTER")!="none")builder.Services.AddOpenTelemetry().WithMetrics(metrics=>metrics.AddMeter("requests.completed").AddOtlpExporter());
var meter=new Meter("requests.completed", "1.0.0");
var counter=meter.CreateCounter<long>("synthetic_porthole_requests", "{request}");
builder.Services.AddHttpClient();
var app=builder.Build();
app.MapGet("/health",()=>"ready");
app.MapGet("/work",async (IHttpClientFactory clients,HttpContext http,ILogger<Program> logger)=>{
 var next=Environment.GetEnvironmentVariable("NEXT_URL");
 if(!String.IsNullOrEmpty(next)){var response=await clients.CreateClient().GetAsync(next);response.EnsureSuccessStatusCode();}
 var requestId=http.Request.Headers["x-request-id"].ToString();if(String.IsNullOrEmpty(requestId))requestId="warmup";
 var status=http.Request.Query["fail"]=="true"?503:200;
 using(logger.BeginScope(new Dictionary<string,object>{{"request.id",requestId},{"http.response.status_code",status}}))logger.LogInformation("request {RequestId} completed",requestId);
 counter.Add(1,new KeyValuePair<string,object?>("request.id",requestId),new KeyValuePair<string,object?>("http.response.status_code",status));
 http.Response.StatusCode=status;
 var values=OpenTelemetry.Baggage.Current.GetBaggage().ToArray();
 http.Response.Headers["x-porthole-baggage-keys"]=String.Join(",",values.Select(entry=>entry.Key).OrderBy(key=>key));
 http.Response.Headers["x-porthole-baggage-bytes"]=(values.Length==0?0:values.Max(entry=>System.Text.Encoding.UTF8.GetByteCount(entry.Value))).ToString();
 return "dotnet completed\n";
});
app.Run("http://0.0.0.0:"+Environment.GetEnvironmentVariable("PORT"));
