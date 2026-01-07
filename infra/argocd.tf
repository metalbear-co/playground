resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "6.7.11"
  namespace  = "argocd"
  create_namespace = true

  values = [
    <<EOT
server:
  ingress:
    enabled: true
    ingressClassName: "gce"
    annotations:
      kubernetes.io/ingress.class: "gce"
      networking.gke.io/managed-certificates: "argocd-cert"
    hostname: "${var.argocd_domain}"
  service:
    annotations:
      beta.cloud.google.com/backend-config: '{"default": "argocd-backend-config"}'
  extraArgs:
    - --insecure
configs:
  cm:
    url: "https://${var.argocd_domain}"
    oidc.config: |
      name: Google
      issuer: https://accounts.google.com
      clientID: ${var.argocd_oauth_client_id}
      clientSecret: $oidc.google.clientSecret
      requestedScopes: ["openid", "profile", "email"]
  secret:
    extra:
      oidc.google.clientSecret: ${var.argocd_oauth_client_secret}
  rbac:
    policy.csv: |
      ${join("\n      ", formatlist("g, %s, role:admin", setunion(toset(var.iap_allowed_users), toset(["pavelz@metalbear.com"]))))}
    scopes: "[email]"
EOT
  ]
}

resource "helm_release" "argo_rollouts" {
  name       = "argo-rollouts"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-rollouts"
  version    = "2.35.1"
  namespace  = "argo-rollouts"
  create_namespace = true
  
  set {
    name  = "dashboard.enabled"
    value = "true"
  }
}
