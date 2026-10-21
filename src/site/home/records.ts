import type { Team } from './parts'

// The floor on Mon Oct 19, 2:00 pm ET (STRUCTURE.md's records): six teams,
// 46 services. A service on the POST /checkout path is `path`; identity-verify
// is slow but harmless (`brass`); billing-worker sends logs only (`quiet`).
export interface Service { name: string; stats: string; kind?: 'path' | 'brass' | 'quiet' }
export interface TeamCard { team: Team; lead: string; count: number; services: Service[]; more: number }

export const floor: TeamCard[] = [
  { team: 'Edge', lead: 'Sam Whitaker', count: 8, more: 5, services: [
    { name: 'api-gateway', stats: '1,240 req/s · 38 ms · 0.02%', kind: 'path' },
    { name: 'cdn-edge', stats: '3,900 req/s · 12 ms · 0.00%' },
    { name: 'rate-limiter', stats: '1,240 req/s · 2 ms · 0.00%' } ] },
  { team: 'Identity', lead: 'Grace Liu', count: 6, more: 3, services: [
    { name: 'auth', stats: '410 req/s · 42 ms · 0.01%', kind: 'path' },
    { name: 'sessions', stats: '620 req/s · 9 ms · 0.00%' },
    { name: 'identity-verify', stats: '3 req/s · 880 ms · 0.30%', kind: 'brass' } ] },
  { team: 'Checkout', lead: 'Dana Brooks', count: 7, more: 4, services: [
    { name: 'checkout-svc', stats: '86 req/s · 390 ms · 0.04%', kind: 'path' },
    { name: 'cart', stats: '240 req/s · 31 ms · 0.01%' },
    { name: 'promotions', stats: '150 req/s · 24 ms · 0.00%' } ] },
  { team: 'Inventory', lead: 'Tomás Rivera', count: 9, more: 6, services: [
    { name: 'inventory-svc', stats: '520 req/s · 64 ms · 0.01%', kind: 'path' },
    { name: 'search-api', stats: '310 req/s · 88 ms · 0.02%' },
    { name: 'search-indexer', stats: 'nightly job' } ] },
  { team: 'Data', lead: 'Ben Okafor', count: 8, more: 5, services: [
    { name: 'orders-db', stats: '2,900 queries/s · 4 ms · 0.00%', kind: 'path' },
    { name: 'kafka-main', stats: '6,100 msgs/s · 3 ms · 0.00%' },
    { name: 'redis-cache', stats: '18,000 ops/s · 1 ms · 0.00%' } ] },
  { team: 'Payments', lead: 'Ana Ruiz', count: 8, more: 5, services: [
    { name: 'payments-svc', stats: '14 req/s · 180 ms · 0.05%', kind: 'path' },
    { name: 'ledger', stats: '14 req/s · 22 ms · 0.00%' },
    { name: 'billing-worker', stats: 'no traces yet', kind: 'quiet' } ] },
]
