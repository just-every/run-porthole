<?php
require __DIR__.'/vendor/autoload.php';
$app=\Slim\Factory\AppFactory::create();
$app->get('/work', function($request,$response){
 $response->getBody()->write("php completed\n");
 return $response;
});
$app->run();
