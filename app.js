(() => {
  const form = document.getElementById("unlock-form");
  const input = document.getElementById("dashboard-password");
  const button = document.getElementById("unlock-button");
  const message = document.getElementById("lock-message");

  const fromBase64 = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

  async function decryptDashboard(password, payload) {
    if (payload.version !== 1 || payload.kdf !== "PBKDF2-SHA-256" || payload.cipher !== "AES-GCM") {
      throw new Error("Format de données chiffrées non reconnu.");
    }
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {name:"PBKDF2",salt:fromBase64(payload.salt),iterations:payload.iterations,hash:"SHA-256"},
      material,{name:"AES-GCM",length:256},false,["decrypt"]
    );
    const clear = await crypto.subtle.decrypt(
      {name:"AES-GCM",iv:fromBase64(payload.iv)},key,fromBase64(payload.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(clear));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = input.value;
    if (!password) return;
    button.disabled = true;
    button.textContent = "Vérification…";
    message.textContent = "";
    try {
      const response = await fetch("./data.enc.json", {cache:"no-store"});
      if (!response.ok) throw new Error("Les données sécurisées ne sont pas encore installées. Le tableau de bord est en cours de configuration.");
      const payload = await response.json();
      const data = await decryptDashboard(password,payload);
      window.KPI_DASHBOARD_DATA = data;
      document.body.classList.add("unlocked");
      input.value = "";
    } catch (error) {
      message.textContent = error.name === "OperationError"
        ? "Mot de passe incorrect."
        : (error.message || "Impossible de déverrouiller les données.");
    } finally {
      button.disabled = false;
      button.innerHTML = 'Déverrouiller <span>→</span>';
    }
  });
})();