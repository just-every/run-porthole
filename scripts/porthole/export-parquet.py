#!/usr/bin/env python3
"""Convert a completed, integrity-checked signal download into bounded Parquet parts."""
import argparse
import hashlib
import json
import os
from decimal import Decimal
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA = pa.schema([
    pa.field(name, pa.string(), nullable=name in ('trace_id', 'span_id', 'metric_unit'))
    for name in ('id', 'batch_id', 'source_id', 'signal', 'team', 'service', 'environment',
                 'trace_id', 'span_id', 'metric_unit', 'payload_json')
] + [pa.field('event_time_ns', pa.decimal128(20, 0), nullable=False),
     pa.field('ordinal', pa.int64(), nullable=False)],
    metadata={b'porthole.format': b'porthole.signals.v1',
              b'porthole.timestamp': b'Unsigned Unix nanoseconds; exact decimal, not floating point.',
              b'porthole.payload': b'Original normalized signal payload as JSON; retains types and provenance.'})


def convert(source, destination):
    progress = json.loads((source / 'progress.json').read_text())
    if progress.get('version') != 1 or not progress.get('complete') or progress.get('format') != 'ndjson':
        raise ValueError('A complete NDJSON download is required')
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = destination / 'manifest.json'
    identity = hashlib.sha256(json.dumps(progress, sort_keys=True).encode()).hexdigest()
    if marker.exists():
        if json.loads(marker.read_text()).get('inputDigest') != identity:
            raise ValueError('Destination belongs to another download')
    elif any(destination.iterdir()):
        raise ValueError('A new conversion needs an empty directory')
    else:
        with open(marker, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump({'id': progress['id'], 'inputDigest': identity,
                       'parts': len(progress['pages'])}, stream)
    count = 0
    for index, page in enumerate(progress['pages']):
        name = f'page-{index:08d}'
        data = (source / (name + '.ndjson')).read_bytes()
        if hashlib.sha256(data).hexdigest() != page['sha256']:
            raise ValueError('Downloaded page integrity mismatch')
        rows = []
        for line in data.splitlines():
            record = json.loads(line)
            row = {key: record.get(key) for key in SCHEMA.names}
            row['event_time_ns'] = Decimal(record['event_time_ns'])
            row['metric_unit'] = record['payload'].get('metric', {}).get('unit')
            row['payload_json'] = json.dumps(record['payload'], ensure_ascii=False, separators=(',', ':'))
            rows.append(row)
        if len(rows) != page['records']:
            raise ValueError('Downloaded page count mismatch')
        target = destination / (name + '.parquet')
        temporary = target.with_suffix('.parquet.new')
        # One page per row group bounds conversion memory independently of the
        # total range. A rerun replaces parts only after complete file writes.
        with temporary.open('wb') as stream:
            os.chmod(temporary, 0o600)
            pq.write_table(pa.Table.from_pylist(rows, schema=SCHEMA), stream, compression='zstd')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        count += len(rows)
    return {'id': progress['id'], 'records': count, 'parts': len(progress['pages'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('download', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(convert(args.download, args.destination)))
    except (OSError, ValueError, KeyError, pa.ArrowException):
        parser.exit(1, 'Parquet conversion refused: check download integrity and destination permissions.\n')
