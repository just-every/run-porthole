<?php
use OpenTelemetry\API\Baggage\Baggage;
use OpenTelemetry\API\Baggage\Propagation\BaggagePropagator;
use OpenTelemetry\Context\Context;
use OpenTelemetry\Context\ContextInterface;
use OpenTelemetry\Context\Propagation\TextMapPropagatorInterface;
use OpenTelemetry\Context\Propagation\PropagationGetterInterface;
use OpenTelemetry\Context\Propagation\PropagationSetterInterface;
final class PortholePolicy implements TextMapPropagatorInterface {
 private array $policy=['enabled'=>false,'allowedKeys'=>[],'attributeKeys'=>[],'revision'=>0];
 public function __construct(){
  try{
   $p=json_decode(@file_get_contents(getenv('PORTHOLE_BAGGAGE_POLICY')?:'/nonexistent'),true,512,JSON_THROW_ON_ERROR);
   if($p['version']!==1||!is_int($p['revision'])||$p['revision']<1||!is_bool($p['enabled'])||$p['maxEntries']!==8||$p['maxValueBytes']!==256)throw new Exception();
   foreach(['allowedKeys','attributeKeys'] as $field){if(!is_array($p[$field])||count($p[$field])>64||count(array_unique($p[$field]))!==count($p[$field]))throw new Exception();foreach($p[$field] as $key)if(!is_string($key)||!preg_match('/^[a-z][a-z0-9_.-]{0,63}$/D',$key))throw new Exception();}
   if(array_diff($p['attributeKeys'],$p['allowedKeys']))throw new Exception();$this->policy=$p;
  }catch(Throwable $error){if(getenv('PORTHOLE_BAGGAGE_POLICY'))error_log('{"porthole.baggage":"policy_unavailable","enabled":false}');}
 }
 public function fields():array{return ['baggage'];}
 private function filter(ContextInterface $context):ContextInterface{
  $builder=Baggage::getBuilder();$reasons=[];$count=0;
  foreach(Baggage::fromContext($context)->getAll() as $key=>$entry){
   $value=$entry->getValue();
   $reason=!$this->policy['enabled']?'disabled':(preg_match('/auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone/i',$key)?'sensitive_key':(!in_array($key,$this->policy['allowedKeys'],true)?'not_allowlisted':(strlen($value)>256?'value_too_large':($count>=8?'entry_limit':null))));
   if($reason)$reasons[$reason]=($reasons[$reason]??0)+1;else{$builder->set($key,$value);$count++;}
  }
  if($reasons)error_log(json_encode(['porthole.baggage'=>'refused','revision'=>$this->policy['revision'],'reasons'=>$reasons]));
  return $builder->build()->storeInContext($context);
 }
 public function extract($carrier,?PropagationGetterInterface $getter=null,?ContextInterface $context=null):ContextInterface{
  $context??=Context::getCurrent();$getter??=\OpenTelemetry\Context\Propagation\ArrayAccessGetterSetter::getInstance();
  $raw=$getter->get($carrier,'baggage');
  if(strlen(is_array($raw)?implode(',',$raw):(string)$raw)>16384){error_log('{"porthole.baggage":"refused","reasons":{"header_too_large":1}}');return Baggage::getBuilder()->build()->storeInContext($context);}
  $parsed=[];$counts=[];$invalid=0;
  foreach(explode(',',is_array($raw)?implode(',',$raw):(string)$raw) as $member){
   try{$pair=explode('=',trim(explode(';',$member,2)[0]),2);if(count($pair)!==2||!preg_match('/^[a-z][a-z0-9_.-]{0,63}$/D',trim($pair[0]))||preg_match('/%(?![a-fA-F0-9]{2})/',$pair[1]))throw new Exception();$key=trim($pair[0]);$value=rawurldecode(trim($pair[1]));if(!preg_match('//u',$value))throw new Exception();$parsed[]=[$key,$value];$counts[$key]=($counts[$key]??0)+1;}catch(Throwable $error){if(trim($member)!=='')$invalid++;}
  }
  $builder=Baggage::getBuilder();foreach($parsed as [$key,$value]){if($counts[$key]>1)$invalid++;else $builder->set($key,$value);}
  if($invalid)error_log(json_encode(['porthole.baggage'=>'refused','reasons'=>['invalid_or_duplicate'=>$invalid]]));
  return $this->filter($builder->build()->storeInContext($context));
 }
 public function inject(&$carrier,?PropagationSetterInterface $setter=null,?ContextInterface $context=null):void{
  $setter??=\OpenTelemetry\Context\Propagation\ArrayAccessGetterSetter::getInstance();$setter->set($carrier,'baggage','');BaggagePropagator::getInstance()->inject($carrier,$setter,$this->filter($context??Context::getCurrent()));
 }
}
\OpenTelemetry\API\Globals::registerInitializer(function($config){return $config->withPropagator(new \OpenTelemetry\Context\Propagation\MultiTextMapPropagator([\OpenTelemetry\API\Trace\Propagation\TraceContextPropagator::getInstance(),new PortholePolicy()]));});
