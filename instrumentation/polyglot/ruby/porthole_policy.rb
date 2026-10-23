require 'json'
require 'uri'
require 'opentelemetry/sdk'
require 'opentelemetry/baggage/propagation/text_map_propagator'
class PortholePolicy
 attr_reader :fields
 def initialize
  @fields=['baggage'];@stock=OpenTelemetry::Baggage::Propagation::TextMapPropagator.new
  @policy={'enabled'=>false,'allowedKeys'=>[],'attributeKeys'=>[],'revision'=>0}
  begin
   p=JSON.parse(File.read(ENV.fetch('PORTHOLE_BAGGAGE_POLICY')))
   raise unless p['version']==1 && p['revision'].is_a?(Integer) && p['revision']>0 && [true,false].include?(p['enabled']) && p['maxEntries']==8 && p['maxValueBytes']==256
   ['allowedKeys','attributeKeys'].each{|field|raise unless p[field].is_a?(Array) && p[field].size<=64 && p[field].uniq.size==p[field].size && p[field].all?{|key|key.is_a?(String) && key.match?(/\A[a-z][a-z0-9_.-]{0,63}\z/)}}
   raise unless (p['attributeKeys']-p['allowedKeys']).empty?
   @policy=p
  rescue
   warn '{"porthole.baggage":"policy_unavailable","enabled":false}' if ENV['PORTHOLE_BAGGAGE_POLICY']
  end
 end
 def filter(context)
  kept={};reasons=Hash.new(0)
  OpenTelemetry::Baggage.values(context: context).each do |key,value|
   reason=if !@policy['enabled'];'disabled';elsif key.match?(/auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone/i);'sensitive_key';elsif !@policy['allowedKeys'].include?(key);'not_allowlisted';elsif value.bytesize>256;'value_too_large';elsif kept.size>=8;'entry_limit';end
   if reason;reasons[reason]+=1;else;kept[key]=value;end
  end
  warn JSON.generate({'porthole.baggage'=>'refused','revision'=>@policy['revision'],'reasons'=>reasons}) unless reasons.empty?
  kept.reduce(OpenTelemetry::Baggage.clear(context: context)){|current,(key,value)|OpenTelemetry::Baggage.set_value(key,value,context:current)}
 end
 def extract(carrier,context: OpenTelemetry::Context.current,getter: OpenTelemetry::Context::Propagation.text_map_getter)
  raw=getter.get(carrier,'baggage').to_s
  if raw.bytesize>16384
   warn '{"porthole.baggage":"refused","reasons":{"header_too_large":1}}'
   return OpenTelemetry::Baggage.clear(context: context)
  end
  parsed=[];counts=Hash.new(0);invalid=0
  raw.split(',').each do |member|
   begin
    pair=member.split(';',2)[0].strip.split('=',2)
    raise unless pair.size==2 && pair[0].strip.match?(/\A[a-z][a-z0-9_.-]{0,63}\z/) && !pair[1].match?(/%(?![a-fA-F0-9]{2})/)
    key=pair[0].strip;value=URI::DEFAULT_PARSER.unescape(pair[1].strip).force_encoding('UTF-8');raise unless value.valid_encoding?
    parsed << [key,value];counts[key]+=1
   rescue;invalid+=1;end
  end
  clean=OpenTelemetry::Baggage.clear(context:context)
  parsed.each{|key,value|if counts[key]>1;invalid+=1;else;clean=OpenTelemetry::Baggage.set_value(key,value,context:clean);end}
  warn JSON.generate({'porthole.baggage'=>'refused','reasons'=>{'invalid_or_duplicate'=>invalid}}) if invalid>0
  filter(clean)
 end
 def inject(carrier,context: OpenTelemetry::Context.current,setter: OpenTelemetry::Context::Propagation.text_map_setter)
  setter.set(carrier,'baggage','');@stock.inject(carrier,context:filter(context),setter:setter)
 end
end
OpenTelemetry.propagation=OpenTelemetry::Context::Propagation::CompositeTextMapPropagator.compose_propagators([OpenTelemetry::Trace::Propagation::TraceContext::TextMapPropagator.new,PortholePolicy.new])
