using System.Text.Json;
using System.Text.RegularExpressions;
using OpenTelemetry;
using OpenTelemetry.Context.Propagation;
public sealed class PolicyPropagator : TextMapPropagator {
 private record Policy(int Version,int Revision,bool Enabled,string[] AllowedKeys,string[] AttributeKeys,int MaxEntries,int MaxValueBytes);
 private readonly Policy policy;
 private readonly BaggagePropagator stock=new();
 private static readonly Regex Denied=new("auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone",RegexOptions.IgnoreCase);
 public PolicyPropagator(){
  var fallback=new Policy(1,0,false,Array.Empty<string>(),Array.Empty<string>(),8,256);
  try {
   var loaded=JsonSerializer.Deserialize<Policy>(File.ReadAllText(Environment.GetEnvironmentVariable("PORTHOLE_BAGGAGE_POLICY")!),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})!;
   if(loaded.Version!=1||loaded.Revision<1||loaded.MaxEntries!=8||loaded.MaxValueBytes!=256||new[]{loaded.AllowedKeys,loaded.AttributeKeys}.Any(keys=>keys==null||keys.Length>64||keys.Distinct().Count()!=keys.Length||keys.Any(key=>!Regex.IsMatch(key,"^[a-z][a-z0-9_.-]{0,63}$")))||loaded.AttributeKeys.Any(key=>!loaded.AllowedKeys.Contains(key)))throw new Exception();
   policy=loaded;
  } catch {policy=fallback;if(Environment.GetEnvironmentVariable("PORTHOLE_BAGGAGE_POLICY")!=null)Console.Error.WriteLine("{\"porthole.baggage\":\"policy_unavailable\",\"enabled\":false}");}
 }
 public override ISet<string> Fields=>new HashSet<string>{"baggage"};
 private PropagationContext Filter(PropagationContext context){
  var kept=new List<KeyValuePair<string,string>>();var reasons=new Dictionary<string,int>();
  foreach(var entry in context.Baggage.GetBaggage()){
   var reason=!policy.Enabled?"disabled":Denied.IsMatch(entry.Key)?"sensitive_key":!policy.AllowedKeys.Contains(entry.Key)?"not_allowlisted":System.Text.Encoding.UTF8.GetByteCount(entry.Value)>256?"value_too_large":kept.Count>=8?"entry_limit":null;
   if(reason!=null)reasons[reason]=reasons.GetValueOrDefault(reason)+1;else kept.Add(entry);
  }
  if(reasons.Count>0)Console.Error.WriteLine(JsonSerializer.Serialize(new Dictionary<string,object>{{"porthole.baggage","refused"},{"revision",policy.Revision},{"reasons",reasons}}));
  return new PropagationContext(context.ActivityContext,default(Baggage).SetBaggage(kept));
 }
 public override PropagationContext Extract<T>(PropagationContext context,T carrier,Func<T,string,IEnumerable<string>> getter){
  if(getter(carrier,"baggage").Sum(value=>System.Text.Encoding.UTF8.GetByteCount(value))>16384){Console.Error.WriteLine("{\"porthole.baggage\":\"refused\",\"reasons\":{\"header_too_large\":1}}");return new PropagationContext(context.ActivityContext,default);}
  return Filter(stock.Extract(new PropagationContext(context.ActivityContext,default),carrier,getter));
 }
 public override void Inject<T>(PropagationContext context,T carrier,Action<T,string,string> setter){setter(carrier,"baggage","");stock.Inject(Filter(context),carrier,setter);}
}
