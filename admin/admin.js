/* Panel de administración GRIP SPORTS — Etapas 1 y 2 (acceso privado + pedidos).
   - El token de sesión vive solo en sessionStorage (se borra al cerrar la pestaña).
   - Todo el contenido dinámico se inserta con textContent (nunca innerHTML).
   - La política CSP de index.html bloquea scripts y conexiones no autorizados.
   - Las reglas de estados las decide el servidor; el panel solo muestra lo que el servidor permite. */
(function () {
  "use strict";

  var API = "https://gripmedias-backend.onrender.com";
  var TOKEN_KEY = "gs_admin_token";
  var IDLE_MS = 30 * 60 * 1000;
  var REQUEST_TIMEOUT_MS = 60000; // el backend gratuito puede tardar en "despertar"

  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  var idleTimer = null;

  // ---------- utilidades ----------
  function storeGet() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function storeSet(v) { try { sessionStorage.setItem(TOKEN_KEY, v); } catch (e) {} }
  function storeClear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function append(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function show(view) {
    $("view-login").hidden = view !== "login";
    $("view-panel").hidden = view !== "panel";
    $("top-actions").hidden = view !== "panel";
  }

  function setMsg(node, text, kind) {
    if (!text) { node.hidden = true; node.textContent = ""; return; }
    node.hidden = false;
    node.textContent = text;
    node.className = "msg" + (kind === "error" || kind === true ? " error" : kind === "ok" ? " ok" : "");
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
    if (!v) return "—";
    var d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  }
  function fmtDateSec(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return "—";
    n = Number(n);
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }

  var SHIPPING_LABELS = { domicilio: "Envío a domicilio", sucursal: "Envío a sucursal", retiro: "Retiro en persona" };
  var PAYMENT_METHOD_LABELS = { mercadopago: "Mercado Pago", transferencia: "Transferencia bancaria" };
  var MP_STATUS_LABELS = {
    approved: "Aprobado", pending: "Pendiente", in_process: "En proceso", in_mediation: "En mediación",
    rejected: "Rechazado", cancelled: "Cancelado", refunded: "Reembolsado", charged_back: "Contracargo", authorized: "Autorizado"
  };
  var ACTION_LABELS = {
    login_ok: "Ingreso correcto",
    login_fallido: "Intento fallido",
    login_bloqueado: "Bloqueado por demasiados intentos",
    logout: "Cierre de sesión",
    logout_todas: "Se cerraron todas las sesiones"
  };
  var EVENT_LABELS = {
    estado: "Cambio de estado",
    transferencia_confirmada: "Transferencia confirmada",
    transferencia_confirmacion_quitada: "Confirmación de transferencia quitada",
    seguimiento: "Código de seguimiento",
    nota: "Nota interna"
  };

  function badge(text, kind) { return el("span", "badge" + (kind ? " " + kind : ""), text); }
  function paymentBadge(p) {
    var kind = "";
    if (p.status === "payment_pending" || p.status === "preparing" || p.status === "shipped" || p.status === "completed") kind = "warn";
    else if (p.status === "rejected" || p.status === "cancelled") kind = "bad";
    else if (p.status === "pending") kind = "";
    else kind = "ok";
    return badge(p.label, kind);
  }
  function fulfillmentBadge(f) {
    return badge(f.label, f.status === "delivered" ? "ok" : f.status === "none" ? "" : "info");
  }

  // ---------- sesión ----------
  function resetIdle() {
    clearTimeout(idleTimer);
    if (!token) return;
    idleTimer = setTimeout(function () { endSession("Se cerró la sesión por inactividad."); }, IDLE_MS);
  }
  ["click", "keydown", "touchstart"].forEach(function (ev) {
    document.addEventListener(ev, function () { if (token) resetIdle(); }, { passive: true });
  });

  function endSession(message) {
    token = null;
    storeClear();
    clearTimeout(idleTimer);
    ordersReq++; orderReq++; // descarta respuestas pendientes
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    show("login");
    $("password").value = "";
    setMsg($("login-msg"), message || "", false);
    setMsg($("global-msg"), "");
  }

  // Devuelve true si la respuesta era "sesión vencida" (y ya cerró la sesión).
  function handleExpired(r) {
    if (r.status === 401) { endSession("Tu sesión venció. Ingresá de nuevo."); return true; }
    return false;
  }

  // ---------- navegación (hash) ----------
  function setActiveNav(name) {
    var links = document.querySelectorAll("[data-nav]");
    for (var i = 0; i < links.length; i++) {
      links[i].className = links[i].getAttribute("data-nav") === name ? "active" : "";
    }
  }
  function showSection(name) {
    $("view-home").hidden = name !== "home";
    $("view-orders").hidden = name !== "orders";
    $("view-order").hidden = name !== "order";
    setActiveNav(name === "order" ? "orders" : name);
  }

  function route() {
    if (!token) return;
    var h = (location.hash || "").replace(/^#\/?/, "");
    var m = /^pedido\/(\d{1,9})$/.exec(h);
    if (m) { showSection("order"); loadOrder(m[1]); }
    else if (h === "pedidos") { showSection("orders"); loadOrders(); }
    else { showSection("home"); }
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ---------- inicio ----------
  function renderActivity(rows) {
    var body = $("activity-body");
    clear(body);
    rows.forEach(function (r) {
      var tr = el("tr");
      [fmtDateSec(r.at), ACTION_LABELS[r.action] || String(r.action), r.ip || "—"].forEach(function (t) {
        tr.appendChild(el("td", "", t));
      });
      body.appendChild(tr);
    });
  }

  function enterPanel(user, expiresAt) {
    $("who").textContent = user && user.username ? user.username : "";
    $("expires").textContent = fmtDateSec(expiresAt);
    show("panel");
    resetIdle();
    route();
    api("/admin/auth/activity").then(function (r) {
      if (handleExpired(r)) return;
      if (r.ok && Array.isArray(r.data.activity)) renderActivity(r.data.activity);
    }).catch(function () {});
  }

  // ---------- listado de pedidos ----------
  var ordersReq = 0;
  var ordersState = { q: "", payment: "", fulfillment: "", page: 1, totalPages: 1 };

  function loadOrders() {
    var my = ++ordersReq;
    var params = new URLSearchParams();
    if (ordersState.q) params.set("q", ordersState.q);
    if (ordersState.payment) params.set("payment", ordersState.payment);
    if (ordersState.fulfillment) params.set("fulfillment", ordersState.fulfillment);
    params.set("page", String(ordersState.page));
    setMsg($("orders-msg"), "");
    $("orders-count").textContent = "Cargando… (si el servidor estaba inactivo, puede tardar hasta un minuto)";
    api("/admin/orders?" + params.toString()).then(function (r) {
      if (my !== ordersReq) return;
      if (handleExpired(r)) return;
      if (!r.ok) {
        $("orders-count").textContent = "";
        return setMsg($("orders-msg"), r.data.error || "No se pudieron cargar los pedidos.", "error");
      }
      renderOrders(r.data);
    }).catch(function () {
      if (my !== ordersReq) return;
      $("orders-count").textContent = "";
      setMsg($("orders-msg"), "No se pudo conectar con el servidor. Probá de nuevo en unos instantes.", "error");
    });
  }

  function cell(label, content, cls) {
    var td = el("td", cls || "");
    td.setAttribute("data-label", label);
    if (typeof content === "string") td.textContent = content;
    else if (content) td.appendChild(content);
    return td;
  }

  function renderOrders(data) {
    ordersState.page = data.page;
    ordersState.totalPages = data.totalPages;
    var body = $("orders-body");
    clear(body);

    $("orders-count").textContent = data.total === 1 ? "1 pedido" : data.total + " pedidos";
    if (!data.orders.length) {
      var tr0 = el("tr"); var td0 = el("td", "empty", "No hay pedidos para mostrar con estos filtros.");
      td0.colSpan = 7; tr0.appendChild(td0); body.appendChild(tr0);
    }
    data.orders.forEach(function (o) {
      var tr = el("tr");
      tr.appendChild(cell("Pedido", el("span", "code", o.orderCode), "cell-code"));
      tr.appendChild(cell("Fecha", fmtDate(o.createdAt)));
      var who = el("span", "", o.buyer.name);
      if (o.buyer.email) who.appendChild(el("span", "sub", o.buyer.email));
      tr.appendChild(cell("Cliente", who));
      tr.appendChild(cell("Total", fmtMoney(o.total)));
      tr.appendChild(cell("Pago", paymentBadge(o.payment)));
      var f = el("span", "");
      f.appendChild(fulfillmentBadge(o.fulfillment));
      if (o.paymentMethod === "transferencia" && !o.transferConfirmed && o.payment.status !== "rejected" && o.payment.status !== "cancelled") {
        f.appendChild(el("span", "sub", "Transferencia sin confirmar"));
      }
      tr.appendChild(cell("Preparación / envío", f));
      var a = el("a", "btn btn-small btn-ghost", "Ver detalle");
      a.href = "#pedido/" + encodeURIComponent(o.id);
      tr.appendChild(cell("", a, "cell-action"));
      body.appendChild(tr);
    });

    $("orders-page").textContent = "Página " + data.page + " de " + data.totalPages;
    $("orders-prev").disabled = data.page <= 1;
    $("orders-next").disabled = data.page >= data.totalPages;
  }

  $("orders-filters").addEventListener("submit", function (ev) {
    ev.preventDefault();
    ordersState.q = $("f-q").value.trim();
    ordersState.payment = $("f-payment").value;
    ordersState.fulfillment = $("f-fulfillment").value;
    ordersState.page = 1;
    loadOrders();
  });
  ["f-payment", "f-fulfillment"].forEach(function (id) {
    $(id).addEventListener("change", function () { $("orders-filters").dispatchEvent(new Event("submit", { cancelable: true })); });
  });
  $("orders-clear").addEventListener("click", function () {
    $("f-q").value = ""; $("f-payment").value = ""; $("f-fulfillment").value = "";
    ordersState.q = ""; ordersState.payment = ""; ordersState.fulfillment = ""; ordersState.page = 1;
    loadOrders();
  });
  $("orders-prev").addEventListener("click", function () { if (ordersState.page > 1) { ordersState.page--; loadOrders(); } });
  $("orders-next").addEventListener("click", function () { if (ordersState.page < ordersState.totalPages) { ordersState.page++; loadOrders(); } });

  // ---------- detalle de un pedido ----------
  var orderReq = 0;
  var currentOrderId = null;
  var busy = false;

  function loadOrder(id) {
    var my = ++orderReq;
    currentOrderId = id;
    clear($("order-detail"));
    setMsg($("order-msg"), "Cargando pedido…", false);
    api("/admin/orders/" + encodeURIComponent(id)).then(function (r) {
      if (my !== orderReq) return;
      if (handleExpired(r)) return;
      if (!r.ok) return setMsg($("order-msg"), r.data.error || "No se pudo cargar el pedido.", "error");
      setMsg($("order-msg"), "");
      renderOrder(r.data.order);
    }).catch(function () {
      if (my !== orderReq) return;
      setMsg($("order-msg"), "No se pudo conectar con el servidor.", "error");
    });
  }

  function kv(pairs) {
    var dl = el("dl", "kv");
    pairs.forEach(function (p) {
      if (p[1] === null || p[1] === undefined || p[1] === "") return;
      dl.appendChild(el("dt", "", p[0]));
      var dd = el("dd");
      if (typeof p[1] === "object") dd.appendChild(p[1]); else dd.textContent = String(p[1]);
      dl.appendChild(dd);
    });
    return dl;
  }
  function card(title) {
    var c = el("div", "card");
    if (title) c.appendChild(el("h2", "", title));
    return c;
  }

  function renderOrder(o) {
    var root = $("order-detail");
    clear(root);

    // Encabezado
    var head = card();
    var hd = el("div", "detail-head");
    var left = el("div");
    left.appendChild(el("h1", "", "Pedido " + o.orderCode));
    left.appendChild(el("p", "muted", "Realizado el " + fmtDate(o.createdAt)));
    var badges = el("div", "badges");
    badges.appendChild(el("span", "lbl", "Pago"));
    badges.appendChild(paymentBadge(o.payment));
    badges.appendChild(el("span", "lbl", "Preparación / envío"));
    badges.appendChild(fulfillmentBadge(o.fulfillment));
    append(hd, left, badges);
    head.appendChild(hd);
    root.appendChild(head);

    // Gestión
    root.appendChild(renderManagement(o));

    // Cliente + entrega
    var g = el("div", "grid2");
    var cc = card("Cliente");
    cc.appendChild(kv([
      ["Nombre", o.buyer.name + " " + o.buyer.lastname],
      ["Email", o.buyer.email || "No informado"],
      ["Teléfono", o.buyer.phone]
    ]));
    var dc = card("Entrega");
    var isPickup = o.shipping.method === "retiro";
    dc.appendChild(kv([
      ["Modalidad", SHIPPING_LABELS[o.shipping.method] || o.shipping.method || "—"],
      [o.shipping.method === "sucursal" ? "Sucursal / dirección" : "Dirección", isPickup ? "" : o.shipping.address],
      ["Localidad", isPickup ? "" : o.shipping.locality],
      ["Provincia", isPickup ? "" : o.shipping.province],
      ["Código postal", isPickup ? "" : o.shipping.cp],
      ["Notas del cliente", o.shipping.notes],
      ["Costo de envío", o.shipping.cost === 0 ? "Gratis" : fmtMoney(o.shipping.cost)]
    ]));
    if (isPickup) dc.appendChild(el("p", "hint", "El cliente retira en persona: no hay dirección de entrega."));
    append(g, cc, dc);
    root.appendChild(g);

    // Productos
    var pc = card("Productos");
    var wrap = el("div", "table-wrap");
    var t = el("table", "items-table");
    var thead = el("thead"); var thr = el("tr");
    ["Producto", "Variante", "Cant.", "Precio", "Subtotal"].forEach(function (h) { thr.appendChild(el("th", "", h)); });
    thead.appendChild(thr); t.appendChild(thead);
    var tb = el("tbody");
    o.items.forEach(function (it) {
      var tr = el("tr");
      var variant = [it.color, it.size ? "Talle " + it.size : ""].filter(Boolean).join(" · ") || "—";
      tr.appendChild(cell("Producto", it.name));
      tr.appendChild(cell("Variante", variant));
      tr.appendChild(cell("Cant.", String(it.quantity)));
      tr.appendChild(cell("Precio", fmtMoney(it.unitPrice)));
      tr.appendChild(cell("Subtotal", fmtMoney(it.lineTotal)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); pc.appendChild(wrap);
    var totals = el("div", "totals");
    function trow(label, value, cls) {
      var d = el("div", cls || ""); d.appendChild(el("span", "", label)); d.appendChild(el("span", "", value)); totals.appendChild(d);
    }
    trow("Productos", fmtMoney(o.amounts.subtotal));
    trow("Envío", o.shipping.cost === 0 ? "Gratis" : fmtMoney(o.amounts.shipping));
    if (o.amounts.discount > 0) trow("Descuento por transferencia", "− " + fmtMoney(o.amounts.discount));
    trow("Total", fmtMoney(o.amounts.total), "grand");
    pc.appendChild(totals);
    root.appendChild(pc);

    // Pago (solo lectura)
    var pay = card("Pago");
    pay.appendChild(kv([
      ["Medio de pago", PAYMENT_METHOD_LABELS[o.payment.method] || o.payment.method],
      ["Estado del pago", paymentBadge(o.payment)],
      ["Total", fmtMoney(o.amounts.total)],
      ["ID de pago (Mercado Pago)", o.payment.mpPaymentId],
      ["Transferencia", o.payment.method === "transferencia"
        ? (o.fulfillment.transferConfirmedAt ? "Confirmada el " + fmtDate(o.fulfillment.transferConfirmedAt) + (o.fulfillment.transferConfirmedBy ? " por " + o.fulfillment.transferConfirmedBy : "") : "Sin confirmar")
        : ""]
    ]));
    pay.appendChild(el("p", "readonly-note", "El estado del pago lo gestiona Mercado Pago y no se puede modificar desde el panel."));
    if (o.payment.notifications.length) {
      pay.appendChild(el("h2", "", "Notificaciones de pago"));
      var ul = el("ul", "history");
      o.payment.notifications.forEach(function (n) {
        var li = el("li");
        li.appendChild(el("span", "", (MP_STATUS_LABELS[n.status] || n.status || "—") + (n.statusDetail ? " (" + n.statusDetail + ")" : "")));
        li.appendChild(el("span", "when", fmtDateSec(n.at) + (n.mpPaymentId ? " · pago " + n.mpPaymentId : "")));
        ul.appendChild(li);
      });
      pay.appendChild(ul);
    }
    root.appendChild(pay);

    // Historial
    var hc = card("Historial de cambios del panel");
    if (!o.history.length) hc.appendChild(el("p", "muted", "Todavía no hay cambios registrados."));
    else {
      var hl = el("ul", "history");
      o.history.forEach(function (h) {
        var li = el("li");
        var text = EVENT_LABELS[h.event] || h.event;
        if (h.from || h.to) text += ": " + (h.from ? h.from : "—") + " → " + (h.to ? h.to : "—");
        li.appendChild(el("span", "", text));
        li.appendChild(el("span", "when", fmtDateSec(h.at) + (h.actor ? " · " + h.actor : "")));
        hl.appendChild(li);
      });
      hc.appendChild(hl);
    }
    root.appendChild(hc);
  }

  function renderManagement(o) {
    var c = card("Gestión del pedido");
    c.className = "card actions-box";
    var a = o.actions;
    var msg = el("p", "msg", ""); msg.hidden = true; msg.setAttribute("role", "status");

    c.appendChild(kv([
      ["Estado actual", fulfillmentBadge(o.fulfillment)],
      ["Última modificación", o.fulfillment.updatedAt ? fmtDate(o.fulfillment.updatedAt) + (o.fulfillment.updatedBy ? " · " + o.fulfillment.updatedBy : "") : "Sin cambios"]
    ]));

    var btns = el("div");
    function actionButton(text, cls, fn) {
      var b = el("button", cls, text); b.type = "button";
      b.addEventListener("click", function () { if (!busy) fn(b); });
      return b;
    }

    if (a.canConfirmTransfer) {
      btns.appendChild(actionButton("Confirmé la transferencia", "btn", function () {
        if (!window.confirm("¿Confirmás que recibiste la transferencia del pedido " + o.orderCode + " por " + fmtMoney(o.amounts.total) + "?\n\nEsto no cambia el estado de pago: solo deja registrado que la recibiste y habilita la preparación.")) return;
        send("/admin/orders/" + encodeURIComponent(o.id) + "/transfer-confirmation", { confirmed: true }, msg, "Transferencia confirmada.");
      }));
    }
    if (a.next && !a.next.blockedReason) {
      btns.appendChild(actionButton("Pasar a: " + a.next.label, "btn", function () {
        if (!window.confirm("¿Pasar el pedido " + o.orderCode + " a “" + a.next.label + "”?")) return;
        send("/admin/orders/" + encodeURIComponent(o.id) + "/status", { from: o.fulfillment.status, to: a.next.to }, msg, "Estado actualizado a “" + a.next.label + "”.");
      }));
    }
    if (a.prev) {
      btns.appendChild(actionButton("Volver a: " + a.prev.label, "btn btn-ghost", function () {
        if (!window.confirm("¿Volver el pedido " + o.orderCode + " a “" + a.prev.label + "”? Queda registrado en el historial.")) return;
        send("/admin/orders/" + encodeURIComponent(o.id) + "/status", { from: o.fulfillment.status, to: a.prev.to }, msg, "Estado corregido a “" + a.prev.label + "”.");
      }));
    }
    if (a.canUnconfirmTransfer) {
      btns.appendChild(actionButton("Quitar confirmación de transferencia", "btn btn-ghost", function () {
        if (!window.confirm("¿Quitar la confirmación de la transferencia del pedido " + o.orderCode + "?")) return;
        send("/admin/orders/" + encodeURIComponent(o.id) + "/transfer-confirmation", { confirmed: false }, msg, "Confirmación quitada.");
      }));
    }
    c.appendChild(btns);
    if (a.next && a.next.blockedReason) c.appendChild(el("p", "hint warn", a.next.blockedReason));
    if (!a.next && !a.prev && !a.canConfirmTransfer) c.appendChild(el("p", "hint", "No hay acciones disponibles para este pedido."));

    // Seguimiento y nota
    var form = el("form", ""); form.noValidate = true;
    var r1 = el("div", "form-row"); var l1 = el("label", "", "Código de seguimiento"); l1.setAttribute("for", "tracking");
    var i1 = el("input"); i1.id = "tracking"; i1.type = "text"; i1.maxLength = 60; i1.autocomplete = "off"; i1.value = o.fulfillment.trackingCode || "";
    append(r1, l1, i1);
    var r2 = el("div", "form-row"); var l2 = el("label", "", "Nota interna (solo la ves vos)"); l2.setAttribute("for", "note");
    var i2 = el("textarea"); i2.id = "note"; i2.maxLength = 1000; i2.value = o.fulfillment.note || "";
    append(r2, l2, i2);
    var save = el("button", "btn btn-small", "Guardar seguimiento y nota"); save.type = "submit";
    form.appendChild(r1); form.appendChild(r2); form.appendChild(save);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (busy) return;
      send("/admin/orders/" + encodeURIComponent(o.id) + "/notes", { trackingCode: i1.value.trim(), note: i2.value }, msg, "Guardado.");
    });
    var sep = el("div", "form-row");
    sep.appendChild(el("h2", "", "Seguimiento y nota"));
    sep.appendChild(form);
    c.appendChild(sep);
    c.appendChild(msg);
    return c;
  }

  // Envía una acción al servidor y vuelve a dibujar el pedido con la respuesta.
  function send(path, body, msgNode, okText) {
    busy = true;
    var buttons = document.querySelectorAll("#order-detail button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    api(path, { method: "POST", body: body }).then(function (r) {
      if (handleExpired(r)) return;
      if (r.ok && r.data.order) {
        renderOrder(r.data.order);
        var m = document.querySelector("#order-detail .actions-box .msg");
        if (m) setMsg(m, (r.data.changed && !r.data.changed.length) ? "No había cambios para guardar." : okText, "ok");
      } else {
        setMsg(msgNode, r.data.error || "No se pudo completar la acción.", "error");
        if (r.status === 409 && currentOrderId) loadOrderQuiet(currentOrderId, r.data.error);
      }
    }).catch(function () {
      setMsg(msgNode, "No se pudo conectar con el servidor. Probá de nuevo.", "error");
    }).finally(function () {
      busy = false;
      var bs = document.querySelectorAll("#order-detail button");
      for (var j = 0; j < bs.length; j++) bs[j].disabled = false;
    });
  }

  // Tras un conflicto (el pedido cambió), recarga los datos y conserva el mensaje de error.
  function loadOrderQuiet(id, errorText) {
    var my = ++orderReq;
    api("/admin/orders/" + encodeURIComponent(id)).then(function (r) {
      if (my !== orderReq || handleExpired(r) || !r.ok) return;
      renderOrder(r.data.order);
      var m = document.querySelector("#order-detail .actions-box .msg");
      if (m) setMsg(m, errorText, "error");
    }).catch(function () {});
  }

  // ---------- acciones de sesión ----------
  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var u = $("username").value.trim();
    var p = $("password").value;
    var btn = $("btn-login");
    if (!u || !p) return setMsg($("login-msg"), "Ingresá usuario y contraseña.", "error");
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
          setMsg($("login-msg"), r.data.error || "No se pudo iniciar sesión.", "error");
        }
      })
      .catch(function () {
        setMsg($("login-msg"), "No se pudo conectar con el servidor. Probá de nuevo en unos instantes.", "error");
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

  // ---------- arranque: si hay un token guardado en esta pestaña, se valida ----------
  token = storeGet();
  if (token) {
    show("login");
    setMsg($("login-msg"), "Verificando sesión…", false);
    api("/admin/auth/me").then(function (r) {
      if (r.ok) { setMsg($("login-msg"), ""); enterPanel(r.data.user, r.data.expiresAt); }
      else endSession(r.status === 401 ? "Tu sesión venció. Ingresá de nuevo." : "");
    }).catch(function () {
      setMsg($("login-msg"), "No se pudo conectar con el servidor.", "error");
    });
  } else {
    show("login");
  }
})();
