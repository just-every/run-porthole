package main
import (
 "context"
 "os/signal"
 "syscall"
 "time"
 "go.opentelemetry.io/otel/attribute"
 "go.opentelemetry.io/otel/metric"
 otellog "go.opentelemetry.io/otel/log"
 logglobal "go.opentelemetry.io/otel/log/global"
 sdklog "go.opentelemetry.io/otel/sdk/log"
 sdkmetric "go.opentelemetry.io/otel/sdk/metric"
 "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
 "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
 "sort"
 "strconv"
 "strings"
 "go.opentelemetry.io/otel/baggage"
 "log"
 "net/http"
 "os"
 "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
 "go.opentelemetry.io/otel"
 "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
 "go.opentelemetry.io/otel/propagation"
 "go.opentelemetry.io/otel/sdk/resource"
 sdktrace "go.opentelemetry.io/otel/sdk/trace"
)
func main(){
 ctx:=context.Background()
 exporter,err:=otlptracehttp.New(ctx);if err!=nil{log.Fatal(err)}
 resources,err:=resource.New(ctx,resource.WithFromEnv(),resource.WithTelemetrySDK());if err!=nil{log.Fatal(err)}
 provider:=sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter,sdktrace.WithBatchTimeout(100*time.Millisecond)),sdktrace.WithResource(resources))
 defer provider.Shutdown(ctx)
 logExporter,err:=otlploghttp.New(ctx);if err!=nil{log.Fatal(err)}
 logProvider:=sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter,sdklog.WithExportInterval(100*time.Millisecond))),sdklog.WithResource(resources))
 defer logProvider.Shutdown(ctx)
 logglobal.SetLoggerProvider(logProvider)
 requestLogger:=logProvider.Logger("requests.completed",otellog.WithInstrumentationVersion("1.0.0"))
 metricExporter,err:=otlpmetrichttp.New(ctx);if err!=nil{log.Fatal(err)}
 metricProvider:=sdkmetric.NewMeterProvider(sdkmetric.WithResource(resources),sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter,sdkmetric.WithInterval(time.Second))))
 defer metricProvider.Shutdown(ctx)
 otel.SetMeterProvider(metricProvider)
 requestCounter,err:=metricProvider.Meter("requests.completed").Int64Counter("synthetic_porthole_requests",metric.WithUnit("{request}"));if err!=nil{log.Fatal(err)}
 loadPolicy()
 otel.SetTracerProvider(provider);otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{},policyPropagator{}))
 client:=&http.Client{Transport:otelhttp.NewTransport(http.DefaultTransport)}
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if next:=os.Getenv("NEXT_URL");next!=""{
   request,_:=http.NewRequestWithContext(r.Context(),"GET",next,nil)
   response,err:=client.Do(request);if err!=nil||response.StatusCode!=200{http.Error(w,"downstream unavailable",502);return};response.Body.Close()
  }
  if r.URL.Path=="/health" {w.Write([]byte("ready"));return}
  requestId:=r.Header.Get("x-request-id");if requestId==""{requestId="warmup"}
  status:=200;if r.URL.Query().Get("fail")=="true"{status=503}
  entry:=otellog.Record{};entry.SetTimestamp(time.Now());entry.SetSeverity(otellog.SeverityInfo);entry.SetBody(otellog.StringValue("request "+requestId+" completed"));entry.AddAttributes(otellog.String("request.id",requestId),otellog.Int("http.response.status_code",status))
  requestLogger.Emit(r.Context(),entry)
  requestCounter.Add(r.Context(),1,metric.WithAttributes(attribute.String("request.id",requestId),attribute.Int("http.response.status_code",status)))
  var keys []string;maxBytes:=0
  for _,entry:=range baggage.FromContext(r.Context()).Members(){keys=append(keys,entry.Key());if len([]byte(entry.Value()))>maxBytes{maxBytes=len([]byte(entry.Value()))}}
  sort.Strings(keys);w.Header().Set("x-porthole-baggage-keys",strings.Join(keys,","));w.Header().Set("x-porthole-baggage-bytes",strconv.Itoa(maxBytes))
  w.WriteHeader(status)
  w.Write([]byte("go completed\n"))
 })
 server:=&http.Server{Addr:":"+os.Getenv("PORT"),Handler:otelhttp.NewHandler(handler,"GET /work")}
 stopped:=make(chan os.Signal,1);signal.Notify(stopped,os.Interrupt,syscall.SIGTERM)
 go func(){<-stopped;server.Shutdown(ctx)}()
 if err:=server.ListenAndServe();err!=nil&&err!=http.ErrServerClosed{log.Fatal(err)}
}
