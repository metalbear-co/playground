resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "playground-repo"
  description   = "Docker repository for playground images"
  format        = "DOCKER"
}
