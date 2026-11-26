/* Panel de administración GRIP SPORTS — Etapa 1 (acceso privado).
   - El token de sesión vive solo en sessionStorage (se borra al cerrar la pestaña).
   - Todo el contenido dinámico se inserta con textContent (nunca innerHTML).
   - La política CSP de index.html bloquea scripts y conexiones no autorizados. */
(function () {
  "use strict";

  var API = "https://gripmedias-backend.onrender.com";
  var TOKEN_KEY = "gs_admin_token";
  var IDLE_MS = 30 * 60 * 1000;
  var REQUEST_TIMEOUT_MS = 60000; // el backend gratuito puede tardar en "despertar"

  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  var idleTimer = null;

  function storeGet() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function storeSet(v) { try { sessionStorage.setItem(TOKEN_KEY, v); } catch (e) {} }
  function storeClear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function show(view) {
    $("view-login").hidden = view !== "login";
    $("view-panel").hidden = view !== "panel";
    $("top-actions").hidden = view !== "panel";
  }

  function setMsg(el, text, isError) {
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = "msg" + (isError ? " error" : "");
  }

  function api(path, options) {
    options = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    var headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    return fetch(API + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, ok: res.ok, data: data };
      });
    }).finally(function () { clearTimeout(timer); });
  }

  function fmtDate(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
  }

  var ACTION_LABELS = {
    login_ok: "Ingreso correcto",
    login_fallido: "Intento fallido",
    login_bloqueado: "Bloqueado por demasiados intentos",
    logout: "Cierre de sesión",
    logout_todas: "Se cerraron todas las sesiones"
  };

  function resetIdle() {
    clearTimeout(idleTimer);
    if (!token) return;
    idleTimer = setTimeout(function () {
      endSession("Se cerró la sesión por inactividad.");
    }, IDLE_MS);
  }
  ["click", "keydown", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function () { if (token) resetIdle(); }, { passive: true });
  });

  function endSession(message) {
    token = null;
    storeClear();
    clearTimeout(idleTimer);
    show("login");
    $("password").value = "";
    setMsg($("login-msg"), message || "", false);
    setMsg($("global-msg"), "");
  }

  function renderActivity(rows) {
    var body = $("activity-body");
    body.textContent = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      [fmtDate(r.at), ACTION_LABELS[r.action] || String(r.action), r.ip || "—"].forEach(function (t) {
        var td = document.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function enterPanel(user, expiresAt) {
    $("who").textContent = user && user.username ? user.username : "";
    $("expires").textContent = fmtDate(expiresAt);
    show("panel");
    resetIdle();
    api("/admin/auth/activity").then(function (r) {
      if (r.status === 401) return endSession("Tu sesión venció. Ingresá de nuevo.");
      if (r.ok && Array.isArray(r.data.activity)) renderActivity(r.data.activity);
    }).catch(function () {});
  }

  // ---- acciones ----
  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var u = $("username").value.trim();
    var p = $("password").value;
    var btn = $("btn-login");
    if (!u || !p) return setMsg($("login-msg"), "Ingresá usuario y contraseña.", true);
    btn.disabled = true;
    btn.textContent = "Verificando…";
    setMsg($("login-msg"), "Si el servidor estaba inactivo, puede tardar hasta un minuto.", false);
    api("/admin/auth/login", { method: "POST", body: { username: u, password: p } })
      .then(function (r) {
        $("password").value = "";
        if (r.ok && r.data.token) {
          token = r.data.token;
          storeSet(token);
          setMsg($("login-msg"), "");
          enterPanel(r.data.user, r.data.expiresAt);
        } else {
          setMsg($("login-msg"), r.data.error || "No se pudo iniciar sesión.", true);
        }
      })
      .catch(function () {
        setMsg($("login-msg"), "No se pudo conectar con el servidor. Probá de nuevo en unos instantes.", true);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Ingresar";
      });
  });

  $("btn-logout").addEventListener("click", function () {
    api("/admin/auth/logout", { method: "POST" }).catch(function () {}).finally(function () {
      endSession("Cerraste la sesión.");
    });
  });

  $("btn-logout-all").addEventListener("click", function () {
    if (!window.confirm("¿Cerrar TODAS las sesiones abiertas, incluida esta?")) return;
    api("/admin/auth/logout-all", { method: "POST" }).catch(function () {}).finally(function () {
      endSession("Se cerraron todas las sesiones.");
    });
  });

  // ---- arranque: si hay un token guardado en esta pestaña, se valida ----
  token = storeGet();
  if (token) {
    show("login");
    setMsg($("login-msg"), "Verificando sesión…", false);
    api("/admin/auth/me").then(function (r) {
      if (r.ok) { setMsg($("login-msg"), ""); enterPanel(r.data.user, r.data.expiresAt); }
      else endSession(r.status === 401 ? "Tu sesión venció. Ingresá de nuevo." : "");
    }).catch(function () {
      setMsg($("login-msg"), "No se pudo conectar con el servidor.", true);
    });
  } else {
    show("login");
  }
})();
