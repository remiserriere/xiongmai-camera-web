# Xiongmai Camera Web – remplacement du plugin VideoPlayTool

[Français](README.md) | [English](README.en.md)

Application web locale qui remplace le plugin Windows du fabricant (Xiongmai/JFTech) pour :
- se connecter à la caméra (IP, utilisateur, mot de passe) et charger toute sa configuration ;
- modifier la configuration par onglets (Image, Vidéo, Réseau, Détection, Système, Firmware), avec Recharger / Enregistrer par section ;
- voir le flux en direct, prendre une capture en pleine résolution, piloter le PTZ ;
- gérer le firmware : version, vérification en ligne, mise à jour depuis un fichier, sauvegarde et restauration de la configuration.

Aucun fichier de configuration : les identifiants restent en mémoire du serveur local ; le flux RTSP et la capture sont déduits de la configuration lue sur la caméra.

## Lancement

Prérequis : Node.js 18 ou plus récent (ffmpeg est fourni par la dépendance `ffmpeg-static`).

```powershell
npm install
npm start
```

Ouvrir http://127.0.0.1:8080, onglet Connexion. Variables d'environnement facultatives : `PORT` (8080), `HOST` (127.0.0.1).
`HOST` définit l'adresse d'écoute ; `ALLOWED_HOSTS` ajoute les hôtes HTTP autorisés
(voir la section K3s ci-dessous).

## Docker

Image Linux `amd64` publiée sur GitHub Container Registry :
`ghcr.io/remiserriere/xiongmai-camera-web`.

- Chaque push sur `main` publie `main-<hash court du commit>` (7 caractères).
- Chaque tag Git poussé publie une image portant ce tag, par exemple `v1.2.3`.
  Les caractères incompatibles avec les tags Docker sont normalisés par
  `docker/metadata-action`. Aucun tag `latest` n'est créé automatiquement.
- Le workflow [Docker image](.github/workflows/docker.yml) construit l'image,
  vérifie FFmpeg et le démarrage HTTP sans caméra, puis publie avec le
  `GITHUB_TOKEN` fourni par GitHub Actions : aucun secret supplémentaire requis.

Exemple pour une version publiée :

```powershell
docker run --rm --name xiongmai-camera-web -p 127.0.0.1:8080:8080 ghcr.io/remiserriere/xiongmai-camera-web:v1.2.3
```

Remplacer `v1.2.3` par un tag réellement publié, puis ouvrir
http://127.0.0.1:8080. Si GHCR demande une authentification, rendre le package
public dans ses paramètres GitHub ou utiliser `docker login ghcr.io`.

Pour construire localement :

```powershell
docker build -t xiongmai-camera-web:local .
docker run --rm --name xiongmai-camera-web -p 127.0.0.1:8080:8080 xiongmai-camera-web:local
```

L'image utilise Node.js 24 et un utilisateur non-root. `HOST=0.0.0.0` permet
l'accès au service **dans le conteneur** ; conserver le mapping sur
`127.0.0.1` côté hôte, sans `--network host`. Les risques résiduels décrits
dans la section Sécurité restent applicables. L'adresse réseau de la caméra
doit être joignable depuis le conteneur.

Le contexte Docker est une liste autorisée de sources : aucun historique Git,
identifiant local, export caméra, fichier d'analyse ou installateur constructeur
n'est inclus. Les identifiants saisis restent en mémoire et sont perdus à
l'arrêt du conteneur ; aucun volume n'est nécessaire.

### K3s / Kubernetes / reverse proxy

Une erreur `Forbidden host` signifie que l'en-tête HTTP `Host` reçu ne fait pas
partie des adresses autorisées. `HOST=0.0.0.0` ne désactive pas ce contrôle :
utiliser `ALLOWED_HOSTS` pour ajouter les noms ou adresses réellement utilisés.
Extrait de la configuration du conteneur dans un Deployment :

```yaml
env:
  - name: HOST
    value: "0.0.0.0"
  - name: ALLOWED_HOSTS
    value: "camera.example.test,192.0.2.10:30080"
```

Remplacer ces exemples par le nom de l'Ingress et/ou l'adresse du nœud et son
NodePort. La liste est séparée par des virgules, insensible à la casse, et
s'ajoute aux hôtes locaux par défaut. Chaque entrée correspond exactement à
`Host`, port compris lorsqu'il est présent : ajouter `camera.example.test:8443`
si cette valeur est utilisée. Ne pas mettre `http://`, `https://`, de chemin
ou de joker `*` ; une configuration invalide bloque le démarrage.

Le proxy doit conserver l'en-tête `Host` attendu. `X-Forwarded-Host` n'est pas
utilisé pour décider des autorisations. Pour une sonde HTTP Kubernetes vers
l'IP dynamique d'un Pod, définir explicitement un hôte autorisé :

```yaml
readinessProbe:
  httpGet:
    path: /api/status
    port: 8080
    httpHeaders:
      - name: Host
        value: "localhost:8080"
```

Adapter aussi les éventuelles sondes de démarrage et de vivacité. Ce réglage
ne fournit aucune authentification : garder l'accès sur un réseau privé/VPN,
limiter les clients autorisés et ne pas exposer l'application sur Internet.
Les sessions sont en mémoire : utiliser une seule réplique, sauf gestion
explicite de l'affinité et des sessions.

## Langues

L'interface et les messages du serveur sont disponibles en français et en anglais (sélecteur en haut à droite ; par défaut, la langue du navigateur). Les textes sont dans `public/i18n.js` (interface) et `lib/messages.js` (serveur).

## Aide contextuelle et listes de valeurs

Chaque paramètre a une info-bulle « ? » qui distingue clairement :
- **D'après l'interface d'origine (.exe)** : libellé extrait automatiquement de l'interface web contenue dans `VideoPlayToolSetup.exe` (fichiers `html/cfg/*.js`, `*.html` et `lg/*.xml`). « Correspondance approximative » signale un rapprochement moins sûr ;
- **Explication générée par IA** : texte rédigé par IA (`public/param-help-ai.json`). « Hypothèse générée par IA » signale une supposition non vérifiée.

Les champs qui sont des listes déroulantes dans l'interface d'origine (codec, résolution, qualité, débit, balance des blancs, jour/nuit, exposition, format de date…) sont aussi des listes ici (`public/param-choices.json`). Les valeurs proviennent du code de l'.exe, filtrées selon les capacités renvoyées par la caméra (codecs et résolutions réellement pris en charge). Les quelques libellés mal traduits par le fabricant sont corrigés et signalés dans l'info-bulle ; la valeur brute reste affichée entre crochets.

Pour régénérer les données extraites de l'.exe (après extraction de `VideoPlayToolSetup.exe` dans `analysis/extracted` avec 7-Zip) :

```powershell
node tools/build-param-help.js
```

## Firmware

- Extraction du firmware actuel : impossible par le réseau. L'API ne propose pas de copie (dump) et aucun accès de débogage (telnet 23/9527) n'est ouvert ; il faut un accès matériel (port série UART ou lecture de la mémoire flash SPI).
- Mise à jour depuis un fichier : le `.bin` est analysé (manifeste `InstallDesc`) et le flash est refusé si le matériel visé ne correspond pas exactement à celui de la caméra.
- Par défaut, la caméra se met à jour toute seule depuis `upgrade.secu100.net` : à désactiver dans Firmware > Mise à jour automatique (`AutoUpgradeImp`, `AutoCheck`).

## Sécurité

- Hors conteneur, le serveur écoute par défaut sur 127.0.0.1 ; ne pas élargir l'écoute avec `HOST`. Dans Docker, limiter le port publié à `127.0.0.1` comme indiqué ci-dessus. Le serveur refuse les requêtes HTTP dont l'en-tête Host n'est pas autorisé (protection partielle contre le DNS rebinding).
- Ne pas exposer ce service sur Internet.
- Définir un mot de passe administrateur sur la caméra (Système > Compte).
- Le WebSocket vidéo ne vérifie pas l'origine du navigateur : un site tiers peut
  accéder au flux lorsqu'une session caméra est connectée. Ne pas naviguer sur des
  sites non fiables pendant l'utilisation ; déconnecter la caméra après usage.
- Les échanges avec la caméra utilisent HTTP et RTSP sans transport authentifié.
  Le chiffrement applicatif du protocole constructeur ne garantit pas l'identité
  de la caméra. Utiliser uniquement un réseau de confiance, idéalement isolé.
- Voir [l'analyse de sécurité du plugin et du remplacement](SECURITY-REVIEW.md)
  pour les appels externes identifiés, les gains et les risques résiduels.

## Contenu publié et confidentialité

Le dépôt contient les sources de l'application et les rapports d'analyse statique
du logiciel constructeur. L'installateur, ses fichiers extraits et les pages
téléchargées depuis une caméra restent locaux : leur redistribution n'est pas
couverte par une autorisation vérifiée. Pour régénérer les données d'aide, fournir
sa propre copie de l'installateur et l'extraire comme indiqué ci-dessus.

Les exports de configuration et les résultats de diagnostic d'une caméra ne sont
pas des exemples anonymes : ils peuvent contenir identifiants, adresses réseau,
adresse MAC et numéro de série. Ne pas les committer ni les joindre à une issue
sans les anonymiser. Les exclusions de `.gitignore` sont une précaution, pas un
détecteur de secrets. L'adresse `192.0.2.10` affichée dans l'interface est un exemple
réservé à la documentation, à remplacer par l'adresse de sa caméra.

## Outils

- `node tools/test-cgi.js <ip> [utilisateur] [mot de passe]` : diagnostic en lecture seule (version, mises à jour, export de la configuration, ports ouverts).
- `node tools/dump-keys.js <ip> [utilisateur] [mot de passe]` : liste les paramètres de chaque section (lecture seule).
- `node tools/build-param-help.js` : régénère les libellés et listes issus de l'.exe.
