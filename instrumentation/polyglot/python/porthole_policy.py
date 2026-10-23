"""Install before serving: tracecontext plus owner-deployed baggage policy."""
import json, os, re, sys
from opentelemetry import baggage, propagate
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.propagators.composite import CompositePropagator
DENIED = re.compile(r'auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone', re.I)
def load():
    try:
        with open(os.environ['PORTHOLE_BAGGAGE_POLICY']) as stream: p=json.load(stream)
        assert p['version']==1 and type(p['revision']) is int and p['revision']>0 and type(p['enabled']) is bool and p['maxEntries']==8 and p['maxValueBytes']==256
        for field in ['allowedKeys','attributeKeys']:
            assert isinstance(p[field],list) and len(p[field])<=64 and len(set(p[field]))==len(p[field]) and all(isinstance(k,str) and re.fullmatch('[a-z][a-z0-9_.-]{0,63}',k) for k in p[field])
        assert set(p['attributeKeys'])<=set(p['allowedKeys'])
        return p
    except Exception:
        if os.environ.get('PORTHOLE_BAGGAGE_POLICY'): print('{"porthole.baggage":"policy_unavailable","enabled":false}',file=sys.stderr)
        return {'enabled':False,'allowedKeys':[],'attributeKeys':[],'revision':0}
POLICY=load()
class PolicyPropagator:
    fields={'baggage'}
    def filter(self,context):
        kept={}; reasons={}
        for key,value in baggage.get_all(context).items():
            reason=('disabled' if not POLICY['enabled'] else 'sensitive_key' if DENIED.search(key) else 'not_allowlisted' if key not in POLICY['allowedKeys'] else 'value_too_large' if len(value.encode('utf-8'))>256 else 'entry_limit' if len(kept)>=8 else None)
            if reason: reasons[reason]=reasons.get(reason,0)+1
            else: kept[key]=value
        if reasons: print(json.dumps({'porthole.baggage':'refused','revision':POLICY['revision'],'reasons':reasons}),file=sys.stderr,flush=True)
        context=baggage.clear(context)
        for key,value in kept.items(): context=baggage.set_baggage(key,value,context)
        return context
    def extract(self,carrier,context=None,getter=propagate.default_getter):
        raw=getter.get(carrier,'baggage') or []
        if sum(len(v.encode('utf-8')) for v in raw)>16384:
            print('{"porthole.baggage":"refused","reasons":{"header_too_large":1}}',file=sys.stderr,flush=True)
            return baggage.clear(context)
        return self.filter(W3CBaggagePropagator().extract(carrier,baggage.clear(context),getter))
    def inject(self,carrier,context=None,setter=propagate.default_setter):
        setter.set(carrier,'baggage','')
        W3CBaggagePropagator().inject(carrier,self.filter(context),setter)
propagate.set_global_textmap(CompositePropagator([TraceContextTextMapPropagator(),PolicyPropagator()]))
