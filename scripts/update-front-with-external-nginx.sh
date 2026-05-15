echo -e "Copying Fronend into /var/www/stealthnet..."
mkdir -p /var/www/stealthnet
docker compose cp frontend:/dist/. /var/www/stealthnet/ 2>/dev/null || {
  # Fallback: copying from volume
  docker run --rm -v stealthnet_frontend_dist:/src -v /var/www/stealthnet:/dst alpine sh -c "cp -r /src/* /dst/"
  }
echo -e "Frontend copied in /var/www/stealthnet/";
