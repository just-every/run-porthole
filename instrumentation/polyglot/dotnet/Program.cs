using OpenTelemetry.Trace;
using OpenTelemetry.Resources;
var builder=WebApplication.CreateBuilder(args);
builder.Services.AddOpenTelemetry().ConfigureResource(resource=>resource.AddService(Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME") ?? "dotnet").AddEnvironmentVariableDetector()).WithTracing(tracing=>tracing.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter());
builder.Services.AddHttpClient();
var app=builder.Build();
app.MapGet("/work",async (IHttpClientFactory clients)=>{
 var next=Environment.GetEnvironmentVariable("NEXT_URL");
 if(!String.IsNullOrEmpty(next)){var response=await clients.CreateClient().GetAsync(next);response.EnsureSuccessStatusCode();}
 return "dotnet completed\n";
});
app.Run("http://0.0.0.0:"+Environment.GetEnvironmentVariable("PORT"));
