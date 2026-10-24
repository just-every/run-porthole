using OpenTelemetry.Trace;
using OpenTelemetry.Resources;
OpenTelemetry.Sdk.SetDefaultTextMapPropagator(new OpenTelemetry.Context.Propagation.CompositeTextMapPropagator(new OpenTelemetry.Context.Propagation.TextMapPropagator[]{new OpenTelemetry.Context.Propagation.TraceContextPropagator(),new PolicyPropagator()}));
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddOpenTelemetry().ConfigureResource(resource=>resource.AddService(Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet").AddEnvironmentVariableDetector()).WithTracing(tracing=>tracing.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter());
builder.Services.AddHttpClient();
var app=builder.Build();
app.MapGet("/work",async (IHttpClientFactory clients,HttpContext http)=>{
 var next=Environment.GetEnvironmentVariable("NEXT_URL");
 if(!String.IsNullOrEmpty(next)){var response=await clients.CreateClient().GetAsync(next);response.EnsureSuccessStatusCode();}
 var values=OpenTelemetry.Baggage.Current.GetBaggage().ToArray();
 http.Response.Headers["x-porthole-baggage-keys"]=String.Join(",",values.Select(entry=>entry.Key).OrderBy(key=>key));
 http.Response.Headers["x-porthole-baggage-bytes"]=(values.Length==0?0:values.Max(entry=>System.Text.Encoding.UTF8.GetByteCount(entry.Value))).ToString();
 return "dotnet completed\n";
});
app.Run("http://0.0.0.0:"+Environment.GetEnvironmentVariable("PORT"));
