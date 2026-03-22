Build and deploy all services to minikube for local testing.

Follow these steps:

1. Switch kubectl context to minikube: `kubectl config use-context minikube`
2. Point Docker to minikube's daemon: `eval $(minikube docker-env)`
3. Build Docker images for all services that have changed (compare against what's already deployed). Build from each service's directory using its Dockerfile. Use the service name as the image tag. The services are:
   - apps/shop/inventory-service
   - apps/shop/order-service
   - apps/shop/payment-service
   - apps/shop/delivery-service
   - apps/shop/receipt-service
   - apps/shop/metal-mart-frontend
   - apps/ip-visit/ip-info
   - apps/ip-visit/ip-info-grpc
   - apps/ip-visit/ip-visit-consumer
   - apps/ip-visit/ip-visit-counter
   - apps/ip-visit/ip-visit-frontend
   - apps/ip-visit/ip-visit-sqs-consumer
   - apps/visualization/visualization-backend
   - apps/visualization/visualization-frontend
   - apps/visualization-shop/visualization-backend
   - apps/visualization-shop/visualization-frontend
4. Deploy infrastructure and all apps using kustomize: `kubectl apply -k overlays/local`
5. Wait for all deployments to become ready: `kubectl rollout status` for each deployment.
6. Start minikube tunnel in the background: `minikube tunnel`
7. Get the minikube IP with `minikube ip` and list all NodePort services with `kubectl get svc --all-namespaces -o wide`.
8. Print a clickable URL for each frontend/externally-accessible service (e.g., `http://<minikube-ip>:<node-port>`) so the user can open the site directly in their browser.
