variable "aws_region" {
  description = "AWS region for the Lightsail box (Bedrock + your credits)."
  type        = string
  default     = "us-east-1"
}

variable "instance_name" {
  type    = string
  default = "world-cup-2026"
}

variable "bundle_id" {
  description = "Lightsail size. medium_2_0 = 4GB (safe for `next build`). small_2_0 = 2GB is cheaper but can OOM the build."
  type        = string
  default     = "medium_2_0"
}

variable "public_key_path" {
  description = "Public key imported as the box's SSH key. You SSH in with its private half."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}
