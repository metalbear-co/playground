---
name: minikube-deploy
description: Use when the user wants the playground repo built and deployed to local minikube for testing, including changed service images, `overlays/local`, readiness checks, and local access URLs.
---

# Minikube Deploy

Use this skill for local minikube deployment work in this repo.

## Workflow

1. Switch `kubectl` context to `minikube`.
2. Point Docker at the minikube daemon with `eval "$(minikube docker-env)"`.
3. Build images for changed services from their own directories. The service set is:
   - `apps/shop/inventory-service`
   - `apps/shop/order-service`
   - `apps/shop/payment-service`
   - `apps/shop/delivery-service`
   - `apps/shop/receipt-service`
   - `apps/shop/metal-mart-frontend`
   - `apps/ip-visit/ip-info`
   - `apps/ip-visit/ip-info-grpc`
   - `apps/ip-visit/ip-visit-consumer`
   - `apps/ip-visit/ip-visit-counter`
   - `apps/ip-visit/ip-visit-frontend`
   - `apps/ip-visit/ip-visit-sqs-consumer`
   - `apps/visualization/visualization-backend`
   - `apps/visualization/visualization-frontend`
   - `apps/visualization-shop/visualization-backend`
   - `apps/visualization-shop/visualization-frontend`
4. Deploy infrastructure and apps with `kubectl apply -k overlays/local`.
5. Wait for the deployments to become ready.
6. Start `minikube tunnel` if required for local access.
7. Collect `minikube ip` and externally reachable service ports.
8. Return direct local URLs for each accessible frontend.

## Guardrails

- Read `docs/AI_ROOT_CONTEXT.md` in the repo before making assumptions about deployment layout.
- Only rebuild services that actually changed unless the user asks for a full rebuild.
- If `minikube tunnel` needs elevated permissions or must stay attached, tell the user exactly what remains running.
