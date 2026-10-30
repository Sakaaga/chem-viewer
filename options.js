const els = {
  timeout: document.getElementById("timeout-input"),
  historyMax: document.getElementById("history-max-input"),
  structure: document.getElementById("structure-select"),
  autoHighlight: document.getElementById("auto-highlight-input"),
  saveBtn: document.getElementById("save-btn"),
  saveStatus: document.getElementById("save-status"),
};

function showMessage(text, isError = false) {
  els.saveStatus.textContent = text;
  els.saveStatus.style.color = isError ? "#dc2626" : "#16a34a";
  setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 3000);
}

async function loadSettings() {
  const settings = await ChemAPI.getSettings();
  els.timeout.value = settings.timeoutSeconds;
  els.historyMax.value = settings.historyMax;
  els.structure.value = settings.preferredStructure;
  // 権限がブラウザ側で取り消されている場合は、実態に合わせてOFF表示にする
  const hasPermission = await browser.permissions.contains(ChemHighlight.ORIGINS);
  els.autoHighlight.checked = settings.autoHighlight && hasPermission;
}

async function handleSave() {
  // 同期的に値を確定してから、最初の await で権限要求を行う（ユーザー操作の有効期間内に呼ぶ必要がある）
  const values = {
    timeoutSeconds: els.timeout.value,
    historyMax: els.historyMax.value,
    preferredStructure: els.structure.value,
  };
  let autoHighlight = els.autoHighlight.checked;
  let permissionDenied = false;

  try {
    if (autoHighlight) {
      const granted = await browser.permissions.request(ChemHighlight.ORIGINS);
      if (!granted) {
        autoHighlight = false;
        permissionDenied = true;
        els.autoHighlight.checked = false;
      }
    }
    await ChemHighlight.sync(autoHighlight);
    const saved = await ChemAPI.saveSettings({ ...values, autoHighlight });
    els.timeout.value = saved.timeoutSeconds;
    els.historyMax.value = saved.historyMax;
    showMessage(permissionDenied ? t("permissionDenied") : t("savedMessage"), permissionDenied);
  } catch (err) {
    console.error(err);
    showMessage(t("statusError"), true);
  }
}

els.saveBtn.addEventListener("click", handleSave);
loadSettings();
