import os
import signal
import sys
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
import porthole_policy
import requests
import logging
from flask import request
from opentelemetry import metrics
from opentelemetry.sdk._logs import LoggingHandler
request_logger = logging.getLogger("requests.completed")
request_logger.setLevel(logging.INFO)
request_logger.propagate = False
request_logger.addHandler(LoggingHandler())
request_counter = metrics.get_meter("requests.completed", "1.0.0").create_counter("synthetic_porthole_requests", unit="{request}")
from flask import Flask, make_response
from opentelemetry import baggage
app = Flask(__name__)
@app.get('/health')
def health():
    return 'ready'
@app.get('/work')
def work():
    target = os.environ.get('NEXT_URL')
    if target:
        requests.get(target, timeout=10).raise_for_status()
    request_id = request.headers.get('x-request-id', 'warmup')
    status = 503 if request.args.get('fail') == 'true' else 200
    fields = {'request.id': request_id, 'http.response.status_code': status}
    request_logger.info('request %s completed', request_id, extra=fields)
    request_counter.add(1, fields)
    values=baggage.get_all()
    response=make_response('python completed\n', status)
    response.headers['x-porthole-baggage-keys']=','.join(sorted(values))
    response.headers['x-porthole-baggage-bytes']=str(max((len(v.encode('utf-8')) for v in values.values()),default=0))
    return response
app.run(host='0.0.0.0', port=int(os.environ['PORT']))
