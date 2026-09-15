/**
 * Renderer process logic for AI Pharmacy stub installer.
 * Communicates with main.js via window.installer (contextBridge).
 */

// Listen to download progress updates from main process
window.installer.onDownloadProgress((pct) => {
  document.getElementById('dl-bar').style.width = pct + '%';
  document.getElementById('dl-pct').textContent = pct + '%';
});

// Listen to install status updates from main process
window.installer.onInstallStatus((msg) => {
  if (msg === 'done') {
    showScreen('screen-success');
    setStep(3);
  } else {
    showScreen('screen-install');
    setStep(3);
    document.getElementById('install-label').textContent = msg;
  }
});

// Auto-format license key input as XXXX-XXXX-XXXX-XXXX
document.getElementById('licenseKey').addEventListener('input', (e) => {
  let val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  val = val.match(/.{1,4}/g)?.join('-') || val;
  e.target.value = val.substring(0, 19);
});

// Auto-uppercase license ID
document.getElementById('licenseId').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Enter key submits
document.getElementById('licenseKey').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') activate();
});

// ── Main flow ──────────────────────────────────────────────────────────────────

async function activate() {
  const licenseId  = document.getElementById('licenseId').value.trim();
  const licenseKey = document.getElementById('licenseKey').value.trim();
  const errBox     = document.getElementById('license-error');

  errBox.classList.remove('show');

  if (!licenseId || !licenseKey) {
    showError('Please enter both your License ID and License Key.');
    return;
  }

  // Validate with server
  setBtnLoading(true);
  const result = await window.installer.validateLicense(licenseId, licenseKey);
  setBtnLoading(false);

  if (!result.success) {
    showError(result.error || 'License validation failed. Please check your credentials.');
    return;
  }

  if (result.pharmacyName) {
    const successMsg = document.getElementById('success-msg');
    if (successMsg) {
      successMsg.innerHTML = `<strong>${result.pharmacyName}</strong> has been configured.<br/>AI Pharmacy has been installed successfully.`;
    }
  }

  // License valid → move to download
  setStep(2);
  showScreen('screen-download');

  // Direct high-speed CDN download URL from GitHub release
  const downloadUrl = 'https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v0.1.0/AI-Pharmacy-OS-Portable-Setup-v0.1.0.exe';

  const installResult = await window.installer.downloadAndInstall(
    downloadUrl,
    result.pharmacyName,
    licenseId,
    licenseKey
  );

  if (!installResult.success) {
    showScreen('screen-license');
    setStep(1);
    showError('Download/Install failed: ' + (installResult.error || 'Unknown error'));
  }
  // On success, the onInstallStatus listener will handle showing screen-success
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setStep(n) {
  ['step1', 'step2', 'step3'].forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('active', 'done');
    if (i + 1 < n)  el.classList.add('done');
    if (i + 1 === n) el.classList.add('active');
  });
}

function showError(msg) {
  const box = document.getElementById('license-error');
  box.textContent = msg;
  box.classList.add('show');
}

function setBtnLoading(loading) {
  const btn = document.getElementById('btn-activate');
  const lbl = document.getElementById('btn-activate-label');
  btn.disabled = loading;
  lbl.innerHTML = loading
    ? '<div style="width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></div>Validating...'
    : 'Activate &amp; Install';
}
