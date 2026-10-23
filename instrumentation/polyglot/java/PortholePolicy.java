package porthole;
import com.google.gson.*;
import io.opentelemetry.api.baggage.*;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.*;
import io.opentelemetry.sdk.autoconfigure.spi.ConfigProperties;
import io.opentelemetry.sdk.autoconfigure.spi.ConfigurablePropagatorProvider;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
public final class PortholePolicy implements ConfigurablePropagatorProvider {
 public String getName(){return "porthole";}
 public TextMapPropagator getPropagator(ConfigProperties config){return new Policy();}
 static final class Policy implements TextMapPropagator {
  boolean enabled=false;int revision=0;Set<String> allowed=new HashSet<>();
  final TextMapPropagator stock=io.opentelemetry.api.baggage.propagation.W3CBaggagePropagator.getInstance();
  final Pattern denied=Pattern.compile("auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone",Pattern.CASE_INSENSITIVE);
  Policy(){
   try {
    var p=JsonParser.parseString(Files.readString(Path.of(System.getenv("PORTHOLE_BAGGAGE_POLICY")))).getAsJsonObject();
    if(p.get("version").getAsInt()!=1||p.get("revision").getAsInt()<1||p.get("maxEntries").getAsInt()!=8||p.get("maxValueBytes").getAsInt()!=256||!p.get("enabled").getAsJsonPrimitive().isBoolean())throw new Exception();
    var attrs=new HashSet<String>();
    for(var field:List.of("allowedKeys","attributeKeys")){
     var keys=p.getAsJsonArray(field);var target=field.equals("allowedKeys")?allowed:attrs;
     if(keys.size()>64)throw new Exception();
     for(var value:keys){var key=value.getAsString();if(!key.matches("[a-z][a-z0-9_.-]{0,63}")||!target.add(key))throw new Exception();}
    }
    if(!allowed.containsAll(attrs))throw new Exception();revision=p.get("revision").getAsInt();enabled=p.get("enabled").getAsBoolean();
   }catch(Exception error){allowed.clear();if(System.getenv("PORTHOLE_BAGGAGE_POLICY")!=null)System.err.println("{\"porthole.baggage\":\"policy_unavailable\",\"enabled\":false}");}
  }
  public Collection<String> fields(){return List.of("baggage");}
  Context filter(Context context){
   var builder=Baggage.builder();var reasons=new TreeMap<String,Integer>();int count=0;
   for(var pair:Baggage.fromContext(context).asMap().entrySet()){
    var key=pair.getKey();var value=pair.getValue().getValue();
    String reason=!enabled?"disabled":denied.matcher(key).find()?"sensitive_key":!allowed.contains(key)?"not_allowlisted":value.getBytes(StandardCharsets.UTF_8).length>256?"value_too_large":count>=8?"entry_limit":null;
    if(reason!=null)reasons.merge(reason,1,Integer::sum);else{builder.put(key,value);count++;}
   }
   if(!reasons.isEmpty())System.err.println(new Gson().toJson(Map.of("porthole.baggage","refused","revision",revision,"reasons",reasons)));
   return builder.build().storeInContext(context);
  }
  public <C> Context extract(Context context,C carrier,TextMapGetter<C> getter){
   var raw=getter.get(carrier,"baggage");
   if(raw!=null&&raw.getBytes(StandardCharsets.UTF_8).length>16384){System.err.println("{\"porthole.baggage\":\"refused\",\"reasons\":{\"header_too_large\":1}}");return Baggage.empty().storeInContext(context);}
   return filter(stock.extract(Baggage.empty().storeInContext(context),carrier,getter));
  }
  public <C> void inject(Context context,C carrier,TextMapSetter<C> setter){setter.set(carrier,"baggage","");stock.inject(filter(context),carrier,setter);}
 }
}
