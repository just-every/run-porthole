import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.Executors;
public class App {
 public static void main(String[] args) throws Exception {
  var server=HttpServer.create(new InetSocketAddress("0.0.0.0", Integer.parseInt(System.getenv("PORT"))), 0);
  server.createContext("/health", exchange -> {exchange.sendResponseHeaders(200,0);exchange.close();});
  var logger=io.opentelemetry.api.GlobalOpenTelemetry.get().getLogsBridge().loggerBuilder("requests.completed").setInstrumentationVersion("1.0.0").build();
  var counter=io.opentelemetry.api.GlobalOpenTelemetry.get().meterBuilder("requests.completed").setInstrumentationVersion("1.0.0").build().counterBuilder("synthetic_porthole_requests").setUnit("{request}").build();
  server.createContext("/work", exchange -> {
   try {
    var next=System.getenv("NEXT_URL");
    if(next!=null&&!next.isBlank()){
     var response=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(next)).GET().build(),HttpResponse.BodyHandlers.ofString());
     if(response.statusCode()!=200)throw new Exception("downstream refused");
    }
    var requestId=exchange.getRequestHeaders().getFirst("x-request-id");
    if(requestId==null)requestId="warmup";
    var status="fail=true".equals(exchange.getRequestURI().getQuery())?503:200;
    var fields=io.opentelemetry.api.common.Attributes.builder().put("request.id",requestId).put("http.response.status_code",status).build();
    logger.logRecordBuilder().setBody("request "+requestId+" completed").setSeverity(io.opentelemetry.api.logs.Severity.INFO).setAllAttributes(fields).setContext(io.opentelemetry.context.Context.current()).emit();
    counter.add(1,fields);
    var baggage=io.opentelemetry.api.baggage.Baggage.current().asMap();
    exchange.getResponseHeaders().set("x-porthole-baggage-keys",String.join(",",new java.util.TreeSet<>(baggage.keySet())));
    exchange.getResponseHeaders().set("x-porthole-baggage-bytes",Integer.toString(baggage.values().stream().mapToInt(entry->entry.getValue().getBytes(java.nio.charset.StandardCharsets.UTF_8).length).max().orElse(0)));
    var body="java completed\n".getBytes();exchange.sendResponseHeaders(status,body.length);exchange.getResponseBody().write(body);
   } catch(Exception error){exchange.sendResponseHeaders(502,0);} finally{exchange.close();}
  });
  server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());server.start();
 }
}
