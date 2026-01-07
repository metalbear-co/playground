variable "project_id" {
  description = "The GCP Project ID"
  type        = string
  default     = "mirrord-test"
}

variable "region" {
  description = "The GCP Region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The GCP Zone for the GKE cluster"
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "The name of the GKE cluster"
  type        = string
  default     = "playground-dev"
}

variable "github_repo" {
  description = "The GitHub repository in 'owner/repo' format"
  type        = string
  default     = "metalbear-co/playground"
}

variable "argocd_domain" {
  description = "Domain for ArgoCD (e.g., argocd.example.com)"
  type        = string
  default     = "argocd-playground.metalbear.dev"
}

variable "argocd_oauth_client_id" {
  description = "Google OAuth Client ID for ArgoCD SSO"
  type        = string
  sensitive   = true
  default     = "" # User must provide
}

variable "argocd_oauth_client_secret" {
  description = "Google OAuth Client Secret for ArgoCD SSO"
  type        = string
  sensitive   = true
  default     = "" # User must provide
}

variable "iap_allowed_users" {
  description = "List of email addresses of users to allow access via IAP and grant ArgoCD admin"
  type        = list(string)
  default     = ["pavelzagalsky@gmail.com"]
}

variable "github_pat" {
  description = "GitHub Personal Access Token for repository access"
  type        = string
  sensitive   = true
}
