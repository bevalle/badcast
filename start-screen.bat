@echo off
REM A lancer sur chaque PC relie a un ecran (Windows).
REM Remplacez l'adresse IP par celle du PC maitre (affichee au demarrage du serveur).
set MASTER=192.168.1.10:8080
REM Ecran de la buvette (diaporama + classement) : remplacez screen par buvette
set PAGE=screen

REM Edge est installe sur tous les Windows ; remplacez par chrome.exe si vous preferez.
start "" msedge --kiosk "http://%MASTER%/%PAGE%" --edge-kiosk-type=fullscreen --no-first-run --autoplay-policy=no-user-gesture-required
