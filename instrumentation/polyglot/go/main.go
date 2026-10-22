package main
import (
 "context"
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
 provider:=sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter),sdktrace.WithResource(resources))
 defer provider.Shutdown(ctx)
 otel.SetTracerProvider(provider);otel.SetTextMapPropagator(propagation.TraceContext{})
 client:=&http.Client{Transport:otelhttp.NewTransport(http.DefaultTransport)}
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if next:=os.Getenv("NEXT_URL");next!=""{
   request,_:=http.NewRequestWithContext(r.Context(),"GET",next,nil)
   response,err:=client.Do(request);if err!=nil||response.StatusCode!=200{http.Error(w,"downstream unavailable",502);return};response.Body.Close()
  }
  w.Write([]byte("go completed\n"))
 })
 log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"),otelhttp.NewHandler(handler,"GET /work")))
}
