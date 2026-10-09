#!/bin/sh
# Lance le serveur BadCast sur le PC maître (Linux / macOS). Nécessite Node.js >= 18.
cd "$(dirname "$0")" && exec node server.js
