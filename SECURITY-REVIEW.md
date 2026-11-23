# Analyse de sécurité : VideoPlayTool et Xiongmai Camera Web

Date : 2026-11-23. Analyse statique, sans exécution des binaires constructeur,
sans connexion à une caméra et sans capture réseau.

## Conclusion

Le logiciel constructeur **n'est pas limité à un lecteur vidéo purement local** :
son interface prévoit des téléchargements externes et son SDK contient des
fonctions cloud/P2P ainsi que des domaines associés. Cela étend la surface de
confiance et d'attaque, mais **ne prouve ni un logiciel malveillant, ni un envoi
effectif des images ou des mots de passe vers Internet**.

Ce projet évite d'exécuter le pont natif VideoPlayTool et les SDK cloud du
constructeur. Il réduit donc cette dépendance, sans sécuriser à lui seul la
caméra, le réseau ou tous les accès locaux. Deux risques élevés restent présents
dans l'application Node ; ils sont documentés ci-dessous et **non corrigés** dans
cette publication, conformément au choix de consigner les constats.

## Périmètre et niveau de preuve

L'appellation « OCX » désigne ici l'ensemble du plugin constructeur. Les preuves
examinées concernent surtout `VideoPlayTool.exe`, `VideoPlugin_x64.exe`,
`NetSdk.dll`, `XNetSDK.dll` et l'interface web extraite ; elles ne permettent pas
de généraliser à toutes les versions d'un ancien contrôle ActiveX.

L'installateur analysé est `VideoPlayToolSetup.exe`, de 47 126 299 octets :

```text
SHA-256: 58D9E79CDE1D663D539FA0C77FFA4A584CC653C042817F5C8FD8079505CD6853
```

Le dépôt publie les rapports de chaînes/imports et de signatures, mais pas
l'installateur ni ses copies extraites : aucune autorisation de redistribution
de l'ensemble n'a été vérifiée. Les chemins `analysis/extracted/...` indiqués
ci-dessous sont donc des références à la copie locale, pas des fichiers publiés.

Trois niveaux sont distingués :

- **Code visible** : une construction d'URL ou un chemin d'appel existe dans les
  scripts extraits ; ses conditions d'activation restent importantes.
- **Chaîne/import binaire** : capacité ou destination potentielle, pas preuve
  qu'un appel a lieu, ni de son contenu.
- **Non vérifié dynamiquement** : fréquence, trafic réel, validation TLS,
  permissions du processus et portée effective des ports d'écoute.

Les scans sont filtrés : ils ne constituent pas une liste exhaustive des
destinations. Aucun domaine n'a été contacté pour cette analyse.

## Appels et destinations externes

| Destination | Preuve locale | Interprétation et limites |
|---|---|---|
| `https://ocx.jftechws.com/ocx/VideoPlayToolSetup.exe` | `analysis/extracted/Web/plugin/common.js`, ligne 417 ; [chaînes du plugin](analysis/scan-VideoPlugin_x64.exe.txt), lignes 24 et 27 | Adresse par défaut de téléchargement de l'installateur. Une action de téléchargement peut contacter le fournisseur ; cela ne prouve pas un téléchargement automatique à chaque lancement. |
| `https://ocx.jftechws.com/web/...` et `/web/webplayer` | Même script, lignes 398 à 421 et 436 à 473 ; [chaînes VideoPlayTool](analysis/scan-VideoPlayTool.exe.txt), ligne 40 | Le chemin distant est sélectionné notamment si le mode non embarqué, le serveur accessible et l'absence de plugin chargé le permettent. Les fonctions de chargement utilisent cette base pour des ressources, dont du JavaScript. Le choix n'est pas systématiquement distant : un chemin local existe aussi. |
| `https://app.jftechws.com/apps/latest/` | [Chaînes VideoPlayTool](analysis/scan-VideoPlayTool.exe.txt), ligne 25 | Destination externe embarquée. Le nom évoque un catalogue ou une version récente ; son rôle exact et son invocation ne sont pas établis par la seule chaîne. |
| `ams.jftechws.com`, `api.jftechws.com`, `rs.jftechws.com`, `pub-token.xmeye.net` | [Chaînes XNetSDK](analysis/scan-XNetSDK.dll.txt), lignes 23 à 31 | Destinations présentes dans le SDK, avec des symboles de compte cloud et de connexion. Les rôles précis, les données échangées et l'activation en mode IP local ne sont pas démontrés. |
| `sdk-gateway.jftechws.com/statv2` | [Chaînes XNetSDK](analysis/scan-XNetSDK.dll.txt), lignes 29 et 30 | Le suffixe suggère une fonction de statistiques. C'est un indice, pas une preuve de télémétrie personnelle ni une description de sa charge utile. |
| `upgrade.jftechws.com` | [Chaînes XNetSDK](analysis/scan-XNetSDK.dll.txt), lignes 47 à 53 | Présent près de noms de composants de vérification/téléchargement de mises à jour. L'exécution et les contrôles d'authenticité n'ont pas été établis. |
| `ams-xcloudsdk.jftechws.com` | [Chaînes XNetSDK](analysis/scan-XNetSDK.dll.txt), lignes 232 à 236 | Présent avec des indications de P2P et de résolution de service. Cela confirme du code lié au cloud/P2P, pas son usage pour une connexion donnée. |
| `https://d.jaify.net/jaify?fp=...&pid=...` | `analysis/extracted/Web/html/cfg/Info_QR.js`, lignes 21 à 32 | URL encodée dans un QR code pour certains identifiants OEM, avec numéro de série et identifiant produit. La génération du QR code n'est pas un appel HTTP ; son ouverture peut transmettre ces paramètres au site. |

Les liens de documentation de bibliothèques (FFmpeg, jQuery, espaces de noms XML,
etc.) présents dans les chaînes ne sont pas, à eux seuls, des appels sortants.

### Ne pas confondre le PC et la caméra

Le SDK exporte des fonctions de connexion cloud, d'interrogation P2P et de mise
à jour cloud : voir [le scan NetSdk](analysis/scan-NetSdk.dll.txt), notamment
`H264_DVR_Login_Cloud`, `H264_DVR_QueryP2PState` et `H264_DVR_Upgrade_Cloud`.
Un export atteste une capacité, pas l'appel effectif de cette fonction.

La caméra peut aussi communiquer de sa propre initiative : cloud/NAT, DDNS, NTP
ou mises à jour, indépendamment du logiciel utilisé sur le PC. Le serveur
`upgrade.secu100.net` mentionné dans les README concerne la mise à jour de la
caméra ; ce n'est pas une preuve d'appel direct du plugin sur le PC.

Le bouton de vérification en ligne du remplacement n'est pas un mode hors ligne :
[server.js](server.js), ligne 220, envoie une commande `cldupgrade` à la caméra,
avec son numéro de série dans `UUID`. Cette action peut lui faire contacter son
service de mise à jour. L'application ne désactive pas automatiquement ses
fonctions réseau.

## Surface locale et risques du logiciel constructeur

### Pont navigateur vers processus natif

Dans `analysis/extracted/Web/plugin/common.js`, les lignes 418 et 433 définissent
par défaut le port HTTP `54455` et l'hôte `127.0.0.1`. Dans
`analysis/extracted/Web/plugin/class.js` :

- la ligne 942 construit l'accès HTTP `/Cmd-WebLocalCtrl` ;
- les lignes 953 à 956 obtiennent un port puis ouvrent un WebSocket `/VideoPlay` ;
- les lignes 1072 et 1073 tentent le protocole de lancement `VideoPlayTool://1`.

Les [chaînes VideoPlayTool](analysis/scan-VideoPlayTool.exe.txt), lignes 35 à 56,
contiennent également des références à un serveur WebSocket Qt et à son écoute.
Ces éléments établissent l'architecture du pont natif. Ils ne suffisent pas à
conclure que le serveur natif écoute sur toutes les interfaces ou qu'il omet
l'authentification ou le contrôle d'origine : ces points restent à tester.

Le risque architectural est qu'un service natif accessible depuis un navigateur
dispose de fonctions sensibles de la caméra et de traitements de données
multimédias. Une faille de ce pont aurait des conséquences au-delà d'une simple
page web. Aucun contournement du pont constructeur n'est démontré ici.

### Secrets dans les chemins de diagnostic

Le [scan VideoPlugin](analysis/scan-VideoPlugin_x64.exe.txt), lignes 70 et 71,
montre des formats de journal incluant jeton, numéro de série, utilisateur et
mot de passe. Le [scan XNetSDK](analysis/scan-XNetSDK.dll.txt), ligne 229, contient
aussi un format incluant des paramètres Wi-Fi et une clé d'authentification.
Ce sont des formats compilés, pas des secrets personnels trouvés dans ces
rapports. Il reste à déterminer s'ils sont activés et où leurs sorties vont.

Le script local `analysis/extracted/Web/plugin/class.js`, ligne 2110, construit
aussi, pour un chemin de capture, une URL HTTP avec utilisateur et mot de passe
dans la chaîne de requête. Si ce chemin est utilisé, ces valeurs ne bénéficient
pas de TLS et peuvent apparaître dans des journaux d'URL.

### Téléchargements et confiance dans les binaires

Le chargement conditionnel de JavaScript externe augmente la confiance accordée
à l'infrastructure du fournisseur. HTTPS protège normalement le transport,
mais ne supprime pas le risque de compromission du serveur ou de la chaîne de
distribution. La présence d'URL HTTPS ne prouve pas non plus que tous les
binaires natifs valident correctement les certificats.

Le [rapport de signatures](analysis/signatures.txt), lignes 53 à 55, indique
`NotSigned` pour les exécutables principaux et XNetSDK. D'autres bibliothèques
sont indiquées comme signées. L'absence de signature Authenticode n'est pas une
preuve de malveillance ; elle limite la vérification de l'éditeur de ces
fichiers. Ce rapport n'atteste pas l'authenticité globale de l'installateur.
Aucune CVE précise ni vulnérabilité d'une version de bibliothèque n'est attribuée
sans vérification supplémentaire.

## En quoi ce projet réduit le risque

| Sujet | Réduction apportée | Limite |
|---|---|---|
| Exécution du plugin | Aucun besoin de lancer VideoPlayTool, son gestionnaire de protocole ou ses SDK propriétaires pour l'utilisation normale. | Ne désinstalle ni n'arrête une ancienne installation déjà présente. |
| Cloud du SDK constructeur | Connexion directe à l'adresse choisie via CGI et RTSP, sans reprendre les fonctions de compte cloud/P2P du SDK. | N'empêche pas la caméra de contacter Internet. |
| Ressources de l'interface | Interface, lecteur et données d'aide servis depuis les fichiers locaux, sans reprise du chargement distant de scripts constructeur. | L'installation npm et les mises à jour des dépendances restent une chaîne de confiance distincte. |
| Exposition HTTP | Écoute en boucle locale par défaut hors conteneur et filtre `Host` pour les requêtes HTTP. `ALLOWED_HOSTS` permet une liste explicite supplémentaire pour un Ingress ou NodePort, sans joker ni confiance dans `X-Forwarded-Host`. | Ce n'est pas une authentification ; `HOST` peut élargir l'écoute. En conteneur, restreindre le port publié ou l'accès réseau. Le WebSocket reste un problème distinct. |
| Identifiants | Session conservée en mémoire du serveur, sans fichier de configuration automatique. | Mémoire et processus locaux ne sont pas un coffre-fort ; exports et diagnostics peuvent contenir des secrets. Les URL RTSP contiennent les identifiants et sont utilisées par FFmpeg. |
| Auditabilité | Code applicatif lisible et périmètre fonctionnel réduit. | Node, les paquets npm, FFmpeg et le lecteur restent des composants à maintenir. FFmpeg demeure un décodeur natif exposé au flux caméra. |

Il s'agit donc d'une **réduction de dépendance et de surface**, pas d'une preuve
d'innocuité ni d'une suppression de tout accès externe.

## Vulnérabilités relevées dans le remplacement

Les niveaux ci-dessous supposent les scénarios d'attaque précisés après le
tableau. Ils ne constituent pas un score CVSS.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | [server.js](server.js) | 121 | Flux WebSocket local sans contrôle explicite de l'origine ni jeton d'accès | 9/10 |
| 2 | 🟠 HIGH | [xm-cgi.js](lib/xm-cgi.js) | 57 | Échanges caméra sur HTTP sans authentification du serveur | 9/10 |

### 1. Site tiers vers WebSocket local

`/api/stream` utilise la session caméra globale sans vérifier `Origin` ni exiger
de jeton. L'en-tête `Host` désigne la destination, pas le site ayant ouvert la
connexion. Une page tierce autorisée par le navigateur à joindre ce service
local peut ainsi recevoir le flux lorsque la caméra est connectée.

Les restrictions d'accès au réseau local ou de contenu mixte de certains
navigateurs peuvent limiter ce scénario ; elles ne remplacent pas un contrôle
dans le serveur. Correction recommandée : contrôler explicitement l'origine
sur l'upgrade WebSocket et prévoir une authentification appropriée du flux.
Le test HTTP de rejet d'un `Host` externe ne valide pas cette propriété.

### 2. Interception sur le réseau de la caméra

L'URL de base du client est HTTP. La clé RSA, le sel et le mode de chiffrement
annoncés sont reçus sur ce transport non authentifié. Le chiffrement applicatif
ne garantit donc pas l'identité de la caméra face à un attaquant actif sur le
trajet. Le changement de mot de passe transmet notamment l'ancien et le nouveau
secret dans le protocole applicatif : voir [server.js](server.js), ligne 178.
Le flux RTSP n'utilise pas non plus un transport TLS.

Correction souhaitable : transport authentifié si le matériel et le protocole
le permettent. Une simple substitution aveugle de HTTP par HTTPS, ou l'acceptation
de tout certificat, n'est pas une correction démontrée. À défaut, l'isolation du
réseau réduit l'exposition mais ne corrige pas le protocole.

## Mesures recommandées et vérifications restantes

- Utiliser un réseau caméra isolé et un mot de passe unique ; bloquer les sorties
  Internet inutiles au niveau réseau après vérification des besoins.
- Désactiver cloud/P2P, UPnP et mises à jour automatiques lorsqu'ils ne sont pas
  souhaités. Vérifier les effets : le remplacement ne le fait pas tout seul.
- Garder l'écoute Node sur `127.0.0.1`, ne pas publier le port, éviter les sites
  non fiables pendant une session et déconnecter la caméra après usage.
- Si le plugin n'est plus nécessaire, désinstaller son installation locale et
  vérifier l'arrêt de ses processus/services et la disparition de ses écouteurs.
- Ne jamais publier un export de configuration ou un diagnostic caméra brut.
- Pour confirmer les appels réels : utiliser ultérieurement une machine de test
  et une caméra isolées, observer DNS/TCP/UDP et attribuer les connexions aux
  processus. Comparer démarrage sans caméra, connexion IP, fonctions cloud et
  mises à jour ; masquer les secrets avant de partager toute capture.
- Tester séparément l'interface d'écoute native, les contrôles d'origine et
  d'accès, ainsi que l'authenticité des mises à jour. Rien de cela n'est certifié
  par la présente analyse statique.

## English summary

Static evidence shows vendor download/web-resource destinations and cloud/P2P
capabilities in the bundled SDK. It does **not** establish actual outbound
traffic, malicious behavior, or exfiltration. Some web resources can be loaded
from the vendor conditionally; a generated QR link can carry a device identifier
if opened.

This project avoids running the vendor bridge and cloud SDKs, serves its UI
locally and connects directly to the chosen camera. It does not stop camera-side
Internet access or remove an existing plugin installation. Two high-severity
findings remain documented, not fixed: missing origin/access checks on the local
video WebSocket, and unauthenticated HTTP communication with the camera. Use a
trusted isolated network and do not treat localhost binding as authentication.
