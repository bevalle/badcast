#!/bin/sh
# À lancer sur chaque PC relié à un écran (Linux). Remplacez l'IP par celle du PC maître.
MASTER="${MASTER:-192.168.1.10:8080}"
# PAGE=buvette pour l'écran de la buvette (diaporama + classement)
PAGE="${PAGE:-screen}"
BROWSER=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run "http://$MASTER/$PAGE"
