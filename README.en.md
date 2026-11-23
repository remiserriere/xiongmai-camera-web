# Xiongmai Camera Web – VideoPlayTool plugin replacement

[Français](README.md) | [English](README.en.md)

Local web application that replaces the vendor's Windows plugin (Xiongmai/JFTech) to:
- connect to the camera (IP, user, password) and load its whole configuration;
- edit the configuration through tabs (Image, Video, Network, Detection, System, Firmware), with Reload / Save per section;
- watch the live stream, take a full-resolution snapshot, control PTZ;
- manage the firmware: version, online check, update from a file, configuration backup and restore.

No configuration file: credentials stay in the local server's memory; the RTSP stream and snapshot are derived from the configuration read from the camera.

## Getting started

Requirements: Node.js 18 or later (ffmpeg is provided by the `ffmpeg-static` dependency).

```powershell
npm install
npm start
```

Open http://127.0.0.1:8080, Connection tab. Optional environment variables: `PORT` (8080), `HOST` (127.0.0.1).
`HOST` controls the listening address; `ALLOWED_HOSTS` adds allowed HTTP hosts
(see the K3s section below).

## Docker

Linux `amd64` image published to GitHub Container Registry:
`ghcr.io/remiserriere/xiongmai-camera-web`.

- Every push to `main` publishes `main-<short commit hash>` (7 characters).
- Every pushed Git tag publishes an image with that tag, for example `v1.2.3`.
  Characters unsupported in Docker tags are normalized by
  `docker/metadata-action`. No `latest` tag is created automatically.
- The [Docker image workflow](.github/workflows/docker.yml) builds the image,
  checks FFmpeg and HTTP startup without a camera, then publishes using the
  GitHub Actions `GITHUB_TOKEN`: no additional secret is required.

Example for a published version:

```powershell
docker run --rm --name xiongmai-camera-web -p 127.0.0.1:8080:8080 ghcr.io/remiserriere/xiongmai-camera-web:v1.2.3
```

Replace `v1.2.3` with an existing published tag, then open
http://127.0.0.1:8080. If GHCR requires authentication, make the package public
in its GitHub settings or use `docker login ghcr.io`.

To build locally:

```powershell
docker build -t xiongmai-camera-web:local .
docker run --rm --name xiongmai-camera-web -p 127.0.0.1:8080:8080 xiongmai-camera-web:local
```

The image uses Node.js 24 and a non-root user. `HOST=0.0.0.0` makes the service
reachable **inside the container**; keep the host port mapping bound to
`127.0.0.1`, without `--network host`. The residual risks in the Security
section still apply. The camera's network address must be reachable from the
container.

The Docker context allowlists application sources: it does not include Git
history, local credentials, camera exports, analysis files or vendor installers.
Entered credentials remain in memory and are lost when the container stops;
no volume is required.

### K3s / Kubernetes / reverse proxy

A `Forbidden host` error means that the received HTTP `Host` header is not in
the allowlist. `HOST=0.0.0.0` does not disable this check: use `ALLOWED_HOSTS` to
add the names or addresses actually used. Container configuration excerpt
inside a Deployment:

```yaml
env:
  - name: HOST
    value: "0.0.0.0"
  - name: ALLOWED_HOSTS
    value: "camera.example.test,192.0.2.10:30080"
```

Replace these examples with your Ingress hostname and/or node address and
NodePort. Entries are comma-separated, case-insensitive, and added to the
default local hosts. Each entry matches `Host` exactly, including its port
when present: add `camera.example.test:8443` if that value is used. Do not
include `http://`, `https://`, paths or the `*` wildcard; invalid
configuration prevents startup.

The proxy must preserve the expected `Host` header. `X-Forwarded-Host` is not
used for authorization. For a Kubernetes HTTP probe targeting a dynamic Pod
IP, set an explicitly allowed host:

```yaml
readinessProbe:
  httpGet:
    path: /api/status
    port: 8080
    httpHeaders:
      - name: Host
        value: "localhost:8080"
```

Adapt any startup and liveness probes too. This setting is not authentication:
keep access on a private network/VPN, restrict allowed clients, and do not
expose the application to the Internet. Sessions are held in memory: use a
single replica unless affinity and sessions are explicitly managed.

## Languages

The interface and server messages are available in French and English (selector at the top right; defaults to the browser language). Strings live in `public/i18n.js` (interface) and `lib/messages.js` (server).

## Contextual help and value lists

Each setting has a "?" tooltip that clearly separates:
- **From the original interface (.exe)**: label automatically extracted from the web interface shipped in `VideoPlayToolSetup.exe` (`html/cfg/*.js`, `*.html` and `lg/*.xml` files). "Approximate match" flags a less certain mapping;
- **AI-generated explanation**: text written by AI (`public/param-help-ai.json`). "AI-generated assumption" flags an unverified guess.

Fields that are drop-down lists in the original interface (codec, resolution, quality, bitrate control, white balance, day/night, exposure, date format…) are drop-down lists here too (`public/param-choices.json`). Values come from the .exe code, filtered by the abilities reported by the camera (codecs and resolutions it actually supports). The few labels badly translated by the vendor are corrected and flagged in the tooltip; the raw value is still shown in brackets.

To regenerate the data extracted from the .exe (after extracting `VideoPlayToolSetup.exe` into `analysis/extracted` with 7-Zip):

```powershell
node tools/build-param-help.js
```

## Firmware

- Dumping the current firmware: not possible over the network. The API offers no dump and no debug access (telnet 23/9527) is open; hardware access is required (UART serial port or reading the SPI flash chip).
- Update from a file: the `.bin` is analysed (`InstallDesc` manifest) and flashing is refused unless its target hardware exactly matches the camera.
- By default the camera updates itself from `upgrade.secu100.net`: turn this off in Firmware > Automatic update (`AutoUpgradeImp`, `AutoCheck`).

## Security

- Outside a container, the server defaults to 127.0.0.1; do not broaden the listener using `HOST`. In Docker, bind the published port to `127.0.0.1` as shown above. The server rejects HTTP requests whose Host header is not allowed (partial DNS rebinding protection).
- Do not expose this service to the Internet.
- Set an administrator password on the camera (System > Account).
- The video WebSocket does not check the browser's origin: a third-party site can
  access the stream while a camera session is connected. Avoid untrusted websites
  while using the app, and disconnect the camera afterwards.
- Camera communication uses HTTP and RTSP without authenticated transport.
  The vendor protocol's application-layer encryption does not establish the
  camera's identity. Use a trusted network, preferably an isolated one.
- See the [security review of the plugin and replacement](SECURITY-REVIEW.md)
  for identified external endpoints, improvements and residual risks.

## Published content and privacy

The repository includes the application sources and static analysis reports of
the vendor software. The installer, its extracted files and pages downloaded
from a camera remain local: no redistribution permission has been verified for
them. To regenerate the help data, supply your own copy of the installer and
extract it as described above.

Camera configuration exports and diagnostic output are not anonymous examples:
they may contain credentials, network addresses, a MAC address and a serial
number. Do not commit them or attach them to an issue without sanitizing them.
The `.gitignore` exclusions are a precaution, not a secret detector. The address
`192.0.2.10` shown in the interface is reserved for documentation; replace it with
your camera's address.

## Tools

- `node tools/test-cgi.js <ip> [user] [password]`: read-only diagnostics (version, updates, configuration export, open ports).
- `node tools/dump-keys.js <ip> [user] [password]`: lists the settings of each section (read-only).
- `node tools/build-param-help.js`: regenerates the labels and lists extracted from the .exe.
