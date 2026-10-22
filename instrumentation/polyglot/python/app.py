import os
import requests
from flask import Flask
app = Flask(__name__)
@app.get('/work')
def work():
    target = os.environ.get('NEXT_URL')
    if target:
        requests.get(target, timeout=10).raise_for_status()
    return 'python completed\n'
app.run(host='0.0.0.0', port=int(os.environ['PORT']))
