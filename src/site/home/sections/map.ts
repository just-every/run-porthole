import { check, head, tag } from '../parts'
import { floor, type TeamCard } from '../records'

// 02, the service map on Mon Oct 19: the heading inside a ring of the six team
// cards, and the checkout path as exactly the five call edges of 03's trace
// (api-gateway → auth, checkout-svc; checkout-svc → inventory-svc, orders-db,
// payments-svc), drawn over the cards from 1280 px. Narrower screens get the
// phone plan: the path as a chip, then the cards stacked whole.
const tile = ({ name, stats, kind }: TeamCard['services'][number]) =>
  `<li class="svc${kind ? ` svc-${kind}` : ''}"><span class="dot" aria-hidden="true"></span><span class="svc-text"><b>${name}</b><span class="svc-sep" aria-hidden="true"> / </span><span class="svc-stats">${stats}</span></span></li>`

const teamCard = (card: TeamCard) => `<article class="team card team-${card.team.toLowerCase()}" aria-label="${card.team}">`
  + `<div class="team-head">${tag(card.team)}<p>${card.lead} · ${card.count} services</p></div>`
  + `<ul class="svcs">${card.services.map(tile).join('')}</ul><p class="more">+${card.more} more</p></article>`

// The five call edges in desk pixels (the stage is 1536 x 920), heads at the callee.
const edges = [
  'M1066 121H476',
  'M1460 121C1528 128 1528 404 1478 431',
  'M1478 445C1528 470 1528 712 1462 733',
  'M1103 441C900 470 660 470 458 441',
  'M1103 448C1050 610 790 733 482 737',
]
const paths = `<svg class="map-edges" viewBox="0 0 1536 920" aria-hidden="true"><defs><marker id="map-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#a24fd8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`
  + `<circle cx="1068" cy="121" r="4.5"/><circle cx="1105" cy="441" r="4.5"/>${edges.map(d => `<path d="${d}" marker-end="url(#map-head)"/>`).join('')}</svg>`

export const serviceMap = (): string => `<section class="sec map" aria-labelledby="map-title"><div class="frame">`
  + `<div class="map-stage">`
  + head({ id: 'map-title', eyebrow: 'Service map · six teams · Mon Oct 19', line1: 'Six teams, 46 services.', line2: 'One map.', lead: 'Every service was discovered from its own traffic, with its owner, rate, p95 and errors. The checkout path runs through all six teams.', align: 'center' })
  + '<p class="map-path"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4" cy="6" r="2.4"/><path d="M7 7.5c5 1.5 6 8 13 9.5"/></svg><span>Checkout path: <span class="nowrap">api-gateway → auth, checkout-svc</span><br><span class="nowrap">checkout-svc → inventory-svc,</span> <span class="nowrap">orders-db, payments-svc</span></span></p>'
  + `<div class="map-teams">${floor.map(teamCard).join('')}</div>${paths}</div>`
  + `<ul class="map-foot"><li><span>46 services · 212 hosts · 9 clusters · 6 teams</span></li><li class="map-foot-ok"><span>POST /checkout 3.1 req/s · p95 420 ms · target 800 ms${check}</span></li><li><span>45 of 46 sending traces · billing-worker logs only</span></li></ul>`
  + '</div></section>'
