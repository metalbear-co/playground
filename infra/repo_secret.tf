resource "kubernetes_secret" "argocd_repo_secret" {
  metadata {
    name      = "argocd-repo-secret"
    namespace = "argocd"
    labels = {
      "argocd.argoproj.io/secret-type" = "repository"
    }
  }

  data = {
    type     = "git"
    url      = "https://github.com/${var.github_repo}.git"
    username = "git"
    password = var.github_pat
  }

  type = "Opaque"

  depends_on = [helm_release.argocd]
}
