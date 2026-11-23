// Server-side messages (FR/EN). The client sends its language in the X-Lang header.
const MESSAGES = {
  fr: {
    notConnected: "Non connecté à une caméra",
    invalidConfigName: "Nom de configuration invalide",
    invalidHost: "Adresse IP ou nom d'hôte invalide",
    invalidPort: "Port invalide",
    missingValue: "Valeur manquante",
    passwordTooShort: "Le mot de passe doit faire au moins 8 caractères",
    invalidPtz: "Commande PTZ invalide",
    invalidPreset: "Numéro de preset invalide (1 à 255)",
    snapshotFailed: "Capture impossible",
    exportRefused: "Export refusé par la caméra (Ret={ret})",
    emptyFile: "Fichier vide",
    noVerifiedFirmware: "Aucun firmware compatible vérifié : analysez d'abord un fichier",
    fwNotZip: "Ce fichier n'est pas une archive firmware (ZIP) valide",
    fwZipCorrupt: "Répertoire ZIP corrompu",
    fwZipMethod: "Méthode de compression ZIP non prise en charge ({method})",
    fwNoManifest: "Manifeste InstallDesc absent : fichier non reconnu comme firmware Xiongmai",
    forbiddenHost: "Hôte non autorisé"
  },
  en: {
    notConnected: "Not connected to a camera",
    invalidConfigName: "Invalid configuration name",
    invalidHost: "Invalid IP address or host name",
    invalidPort: "Invalid port",
    missingValue: "Missing value",
    passwordTooShort: "The password must be at least 8 characters long",
    invalidPtz: "Invalid PTZ command",
    invalidPreset: "Invalid preset number (1 to 255)",
    snapshotFailed: "Snapshot failed",
    exportRefused: "Export refused by the camera (Ret={ret})",
    emptyFile: "Empty file",
    noVerifiedFirmware: "No verified compatible firmware: inspect a file first",
    fwNotZip: "This file is not a valid firmware archive (ZIP)",
    fwZipCorrupt: "Corrupted ZIP directory",
    fwZipMethod: "Unsupported ZIP compression method ({method})",
    fwNoManifest: "InstallDesc manifest missing: not a Xiongmai firmware file",
    forbiddenHost: "Forbidden host"
  }
};

class AppError extends Error {
  constructor(status, key, params = {}) {
    super(key);
    this.status = status;
    this.key = key;
    this.params = params;
  }
}

function langOf(req) {
  const explicit = String(req.get("X-Lang") || "").toLowerCase();
  if (MESSAGES[explicit]) return explicit;
  return /^en/i.test(String(req.get("Accept-Language") || "")) ? "en" : "fr";
}

function tr(lang, key, params = {}) {
  const text = (MESSAGES[lang] || MESSAGES.fr)[key] || MESSAGES.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? ""));
}

function errorMessage(req, err) {
  return err.key ? tr(langOf(req), err.key, err.params) : err.message;
}

module.exports = { AppError, langOf, tr, errorMessage };
