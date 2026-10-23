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
  server.createContext("/work", exchange -> {
   try {
    var next=System.getenv("NEXT_URL");
    if(next!=null&&!next.isBlank()){
     var response=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(next)).GET().build(),HttpResponse.BodyHandlers.ofString());
     if(response.statusCode()!=200)throw new Exception("downstream refused");
    }
    var baggage=io.opentelemetry.api.baggage.Baggage.current().asMap();
    exchange.getResponseHeaders().set("x-porthole-baggage-keys",String.join(",",new java.util.TreeSet<>(baggage.keySet())));
    exchange.getResponseHeaders().set("x-porthole-baggage-bytes",Integer.toString(baggage.values().stream().mapToInt(entry->entry.getValue().getBytes(java.nio.charset.StandardCharsets.UTF_8).length).max().orElse(0)));
    var body="java completed\n".getBytes();exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);
   } catch(Exception error){exchange.sendResponseHeaders(502,0);} finally{exchange.close();}
  });
  server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());server.start();
 }
}
