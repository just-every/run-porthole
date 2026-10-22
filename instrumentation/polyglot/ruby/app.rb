require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/rack'
require 'opentelemetry/instrumentation/net/http'
require 'rackup'
require 'net/http'
OpenTelemetry::SDK.configure do |config|
 config.use 'OpenTelemetry::Instrumentation::Rack'
 config.use 'OpenTelemetry::Instrumentation::Net::HTTP'
end
app=proc do |env|
 next_url=ENV['NEXT_URL']
 Net::HTTP.get_response(URI(next_url)).value if next_url && !next_url.empty?
 [200,{'content-type'=>'text/plain'},['ruby completed']]
end
wrapped=Rack::Builder.new do
 use *OpenTelemetry::Instrumentation::Rack::Instrumentation.instance.middleware_args
 run app
end.to_app
Rackup::Server.start(app: wrapped, Host: '0.0.0.0', Port: Integer(ENV.fetch('PORT')), server: 'webrick')
