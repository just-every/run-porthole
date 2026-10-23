package main
import (
 "context"
 "encoding/json"
 "fmt"
 "os"
 "regexp"
 "go.opentelemetry.io/otel/baggage"
 "go.opentelemetry.io/otel/propagation"
)
type baggagePolicy struct {Version int `json:"version"`;Revision int `json:"revision"`;Enabled bool `json:"enabled"`;Allowed []string `json:"allowedKeys"`;Attributes []string `json:"attributeKeys"`;MaxEntries int `json:"maxEntries"`;MaxBytes int `json:"maxValueBytes"`}
var policy baggagePolicy
var denied=regexp.MustCompile(`(?i)auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone`)
func includes(values []string,key string)bool{for _,value:=range values{if value==key{return true}};return false}
func loadPolicy(){
 data,err:=os.ReadFile(os.Getenv("PORTHOLE_BAGGAGE_POLICY"));if err==nil {err=json.Unmarshal(data,&policy)}
 valid:=err==nil&&policy.Version==1&&policy.Revision>0&&policy.MaxEntries==8&&policy.MaxBytes==256
 keyPattern:=regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)
 for _,list:=range [][]string{policy.Allowed,policy.Attributes}{seen:=map[string]bool{};if len(list)>64{valid=false};for _,key:=range list{if !keyPattern.MatchString(key)||seen[key]{valid=false};seen[key]=true}}
 for _,key:=range policy.Attributes{if !includes(policy.Allowed,key){valid=false}}
 if !valid{policy=baggagePolicy{};if os.Getenv("PORTHOLE_BAGGAGE_POLICY")!=""{fmt.Fprintln(os.Stderr,`{"porthole.baggage":"policy_unavailable","enabled":false}`)}}
}
type policyPropagator struct{}
func(policyPropagator) Fields()[]string{return []string{"baggage"}}
func filterBaggage(ctx context.Context)context.Context{
 var kept []baggage.Member;reasons:=map[string]int{}
 for _,entry:=range baggage.FromContext(ctx).Members(){key,value:=entry.Key(),entry.Value();reason:=""
  if !policy.Enabled{reason="disabled"}else if denied.MatchString(key){reason="sensitive_key"}else if !includes(policy.Allowed,key){reason="not_allowlisted"}else if len([]byte(value))>256{reason="value_too_large"}else if len(kept)>=8{reason="entry_limit"}
  if reason!=""{reasons[reason]++}else{member,err:=baggage.NewMember(key,value);if err==nil{kept=append(kept,member)}}
 }
 if len(reasons)>0{data,_:=json.Marshal(map[string]interface{}{"porthole.baggage":"refused","revision":policy.Revision,"reasons":reasons});fmt.Fprintln(os.Stderr,string(data))}
 filtered,_:=baggage.New(kept...);return baggage.ContextWithBaggage(ctx,filtered)
}
func(policyPropagator) Extract(ctx context.Context,carrier propagation.TextMapCarrier)context.Context{
 if len([]byte(carrier.Get("baggage")))>16384{fmt.Fprintln(os.Stderr,`{"porthole.baggage":"refused","reasons":{"header_too_large":1}}`);return baggage.ContextWithoutBaggage(ctx)}
 return filterBaggage((propagation.Baggage{}).Extract(baggage.ContextWithoutBaggage(ctx),carrier))
}
func(policyPropagator) Inject(ctx context.Context,carrier propagation.TextMapCarrier){carrier.Set("baggage","");(propagation.Baggage{}).Inject(filterBaggage(ctx),carrier)}
