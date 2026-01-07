resource "kubernetes_manifest" "argocd_cert" {
  manifest = {
    apiVersion = "networking.gke.io/v1"
    kind       = "ManagedCertificate"
    metadata = {
      name      = "argocd-cert"
      namespace = "argocd"
    }
    spec = {
      domains = [var.argocd_domain]
    }
  }

  depends_on = [helm_release.argocd]
}
