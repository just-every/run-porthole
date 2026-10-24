<?php
require __DIR__.'/vendor/autoload.php';
require __DIR__.'/policy.php';
$app=\Slim\Factory\AppFactory::create();
$app->get('/work', function($request,$response){
 $response->getBody()->write("php completed\n");
 $values=iterator_to_array(\OpenTelemetry\API\Baggage\Baggage::getCurrent()->getAll());$keys=array_keys($values);sort($keys);
 return $response->withHeader('x-porthole-baggage-keys',implode(',',$keys))->withHeader('x-porthole-baggage-bytes',(string)(empty($values)?0:max(array_map(fn($entry)=>strlen($entry->getValue()),$values))));
});
$app->run();
