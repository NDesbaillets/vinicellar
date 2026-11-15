// Ancienne adresse de la cave : la cave est devenue l'accueil de l'app. On garde le paramètre de cave (?loc=…).
location.replace("/app/" + location.search + location.hash);
