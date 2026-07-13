(() => {
  "use strict";

  const form = document.querySelector("#login-form");
  const errorBox = document.querySelector("#login-error");
  const activeSession = document.querySelector("#active-session");
  const submitButton = form.querySelector('button[type="submit"]');

  function safeNextUrl() {
    const candidate = new URLSearchParams(window.location.search).get("next") || "/";
    return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/";
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.toggle("is-visible", Boolean(message));
  }

  async function checkSession() {
    try {
      const response = await fetch("/api/auth", { cache: "no-store" });
      const payload = await response.json();
      if (payload.authenticated) {
        form.classList.add("hide");
        activeSession.classList.remove("hide");
      }
    } catch (error) {
      console.warn("Não foi possível consultar a sessão.", error);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const formData = new FormData(form);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    if (!username || !password) {
      showError("Preencha o usuário e a senha.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Entrando...";
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível entrar.");
      }
      window.location.replace(safeNextUrl());
    } catch (error) {
      showError(error.message || "Não foi possível entrar.");
      document.querySelector("#password").select();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Entrar como administrador";
    }
  });

  checkSession();
})();
