"""Read exported OTLP files with the official generated protobuf schemas."""
import base64
import hashlib
import json
import sys
from pathlib import Path

from google.protobuf.json_format import MessageToDict, ParseDict
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.collector.profiles.v1development.profiles_service_pb2 import ExportProfilesServiceRequest

TYPES = {'logs': ExportLogsServiceRequest, 'metrics': ExportMetricsServiceRequest,
         'traces': ExportTraceServiceRequest, 'profiles': ExportProfilesServiceRequest}


def ids(value, encode):
    # OTLP JSON specifies hexadecimal identifiers while protobuf JSON uses base64.
    if isinstance(value, list):
        return [ids(item, encode) for item in value]
    if isinstance(value, dict):
        return {key: (base64.b64encode(bytes.fromhex(item)).decode() if encode
                      else base64.b64decode(item).hex())
                if key in ('traceId', 'spanId', 'parentSpanId', 'profileId') and item
                else ids(item, encode) for key, item in value.items()}
    return value


source = Path(sys.argv[1])
progress = json.loads((source / 'progress.json').read_text())
if not progress['complete'] or progress['format'] != 'otlp-json':
    raise ValueError('Complete OTLP download required')
for index, page in enumerate(progress['pages']):
    data = (source / f'page-{index:08d}.ndjson').read_bytes()
    if hashlib.sha256(data).hexdigest() != page['sha256']:
        raise ValueError('Page integrity mismatch')
    rows = data.splitlines()
    if len(rows) != page['records']:
        raise ValueError('Page count mismatch')
    for line in rows:
        row = json.loads(line)
        message = ParseDict(ids(row['exportRequest'], True), TYPES[row['signal']]())
        # Exercise the independent binary parser too, preserving uint64 values.
        decoded = TYPES[row['signal']]()
        decoded.ParseFromString(message.SerializeToString())
        print(json.dumps({'id': row['id'], 'signal': row['signal'],
                          'exportRequest': ids(MessageToDict(decoded, use_integers_for_enums=True), False)}))
