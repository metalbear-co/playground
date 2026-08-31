# Metal Mart frontend

Next.js storefront for the MetalMart shop, served under `/shop` (`NEXT_BASE_PATH`).
It proxies the backend services through `/shop/api/*` and forwards the `baggage`
header, so mirrord preview environments and CI sessions can route requests to
the right service pods.

Architecture, routes, and components are documented in the repo root `CLAUDE.md`
(section "MetalMart Frontend Architecture").
