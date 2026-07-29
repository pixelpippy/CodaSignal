// src/config.js
const os = require('node:os');
const path = require('node:path');

function defaultPort() {
  const p = parseInt(process.env.CODASIGNAL_PORT || '18765', 10);
  return Number.isFinite(p) ? p : 18765;
}

const PROJECTS_DIR = process.env.CODEBUDDY_PROJECTS_DIR ||
  path.join(os.homedir(), '.codebuddy', 'projects');
const SIGNAL_DIR = path.join(os.homedir(), '.codasignal');

module.exports = { defaultPort, PROJECTS_DIR, SIGNAL_DIR };
