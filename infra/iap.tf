resource "kubernetes_secret" "iap_secret" {
  metadata {
    name      = "argocd-iap-secret"
    namespace = "argocd"
  }

  data = {
    client_id     = var.argocd_oauth_client_id
    client_secret = var.argocd_oauth_client_secret
  }

  type = "Opaque"

  depends_on = [helm_release.argocd]
}

resource "kubernetes_manifest" "iap_backend_config" {
  manifest = {
    apiVersion = "cloud.google.com/v1"
    kind       = "BackendConfig"
    metadata = {
      name      = "argocd-backend-config"
      namespace = "argocd"
    }
    spec = {
      iap = {
        enabled       = true
        oauthclientCredentials = {
          secretName = "argocd-iap-secret"
        }
      }
    }
  }

  depends_on = [helm_release.argocd]
}

# Grant IAP access to the users for the entire project's web resources
resource "google_project_iam_member" "iap_access" {
  for_each = setunion(toset(var.iap_allowed_users), toset(["pavelz@metalbear.com"]))
  project = var.project_id
  role    = "roles/iap.httpsResourceAccessor"
  member  = "user:${each.value}"
}
