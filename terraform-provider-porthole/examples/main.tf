terraform {
  required_version = ">= 1.5.0"
  required_providers {
    porthole = {
      source = "registry.terraform.io/just-every/porthole"
    }
  }
}

variable "origin" {
  type        = string
  description = "Installation origin. Authentication comes only from PORTHOLE_SESSION."
}

provider "porthole" {
  origin = var.origin
}

locals {
  checkout_scope = {
    services     = ["checkout"]
    environments = ["production"]
    teams        = ["commerce"]
  }
}

resource "porthole_monitor" "checkout" {
  name       = "Checkout error count"
  scope_json = jsonencode(local.checkout_scope)
  definition_json = jsonencode({
    signal        = "logs"
    operator      = "above"
    threshold     = 5
    windowSeconds = 60
  })
}

resource "porthole_dashboard" "checkout" {
  name       = "Checkout latency"
  scope_json = jsonencode(local.checkout_scope)
  definition_json = jsonencode({
    panels = [{
      id        = "latency"
      title     = "Checkout request latency"
      signal    = "metrics"
      service   = "checkout"
      aggregate = "average"
      metric    = "checkout.request.duration"
      unit      = "ms"
    }]
    variables   = { team = "commerce", environment = "production" }
    range       = { from = "0", through = "18446744073709551615" }
    annotations = []
  })
}
