#!/bin/bash
set -e

# Usage: ./bootstrap.sh <PROJECT_ID> <REGION> <ZONE> <CLUSTER_NAME>

PROJECT_ID=${1:-mirrord-test}
REGION=${2:-us-central1}
ZONE=${3:-us-central1-a}
CLUSTER_NAME=${4:-playground-dev}

echo "Using Project: $PROJECT_ID, Region: $REGION, Zone: $ZONE, Cluster: $CLUSTER_NAME"

echo "Getting cluster credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" --zone "$ZONE" --project "$PROJECT_ID"

echo "Applying ArgoCD Application Root..."
# We apply the Application manifest locally. ArgoCD (installed via Terraform) will pick it up.
kubectl apply -f overlays/gke/application.yaml

echo "Applying Infrastructure Components (Ingress, Certs)..."
# These are currently outside the ArgoCD App scope in the original kustomization structure.
kubectl apply -f overlays/gke/ingress.yaml
kubectl apply -f overlays/gke/certificate.yaml
kubectl apply -f overlays/gke/namespace.yaml # Ensure namespaces exist if not already

echo "Bootstrap complete! ArgoCD should be syncing."
echo "Access ArgoCD via port-forward:"
echo "kubectl port-forward svc/argocd-server -n argocd 8080:443"
