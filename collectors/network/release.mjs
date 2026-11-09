const image=(parts,digest)=>parts.join('/')+'@sha256:'+digest
// Official immutable distribution manifests, recorded from registry pulls.
// Collector Contrib uses the unchanged sampling release version.
export const releases={
 workload:'node@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e',
 netem:image(['ghcr.io', 'nicolaka', 'netshoot'],'7f08c4aff13ff61a35d30e30c5c1ea8396eac6ab4ce19fd02d5a4b3b5d0d09a2'),
 collector:image(['otel', 'opentelemetry-collector-contrib'],'89107a3a8f4636a396927edf7025bb9614b8da2d92f4cc3f43109e8d115736e2'),
 resolver:image(['coredns', 'coredns'],'986f04c2e15e147d00bdd51e8c51bcef3644b13ff806be7d2ff1b261d6dfbae1'),
 nodeExporter:image(['prom', 'node-exporter'],'d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a'),
 obi:image(['otel', 'ebpf-instrument'],'a68d70e934260f72540f157ccf4fb4adfa38f11de060d7d905696dad6a3fca02'),
}
