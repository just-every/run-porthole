import os
import porthole_policy
import requests
from flask import Flask, make_response
from opentelemetry import baggage
app = Flask(__name__)
@app.get('/work')
def work():
    target = os.environ.get('NEXT_URL')
    if target:
        requests.get(target, timeout=10).raise_for_status()
    values=baggage.get_all()
    response=make_response('python completed\n')
    response.headers['x-porthole-baggage-keys']=','.join(sorted(values))
    response.headers['x-porthole-baggage-bytes']=str(max((len(v.encode('utf-8')) for v in values.values()),default=0))
    return response
app.run(host='0.0.0.0', port=int(os.environ['PORT']))
