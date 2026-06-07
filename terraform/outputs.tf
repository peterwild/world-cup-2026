output "static_ip" {
  description = "Point cup.ptwconsultingllc.com at this A record."
  value       = aws_lightsail_static_ip.app.ip_address
}

output "ssh" {
  description = "SSH into the box."
  value       = "ssh ubuntu@${aws_lightsail_static_ip.app.ip_address}"
}

output "instance_name" {
  value = aws_lightsail_instance.app.name
}
