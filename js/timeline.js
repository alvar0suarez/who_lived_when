/*
 * Who Lived When? — motor de linea de tiempo
 * -------------------------------------------------------------
 * Render sobre <canvas> pensado para escalar a miles de personas:
 *   - Solo se dibuja lo visible (viewport culling).
 *   - Nivel de detalle (LOD): el zoom decide que "tier" de notoriedad
 *     aparece, para que la densidad sea siempre legible.
 *   - Empaquetado en carriles (lane packing) para que las barras no
 *     se solapen, reservando espacio para la etiqueta.
 *   - Capas de contexto: eras de fondo, eventos, cajas y relaciones.
 */
(function () {
  "use strict";

  // ---- Configuracion ----------------------------------------------------
  var CURRENT_YEAR = 2026;

  var CATEGORIES = {
    philosophy:    { label: "Filosofia",        color: "#8dc63f" },
    religion:      { label: "Religion",         color: "#d9a441" },
    politics:      { label: "Politica",         color: "#9aa0aa" },
    military:      { label: "Militares",        color: "#a8553a" },
    history:       { label: "Historia y sociedad", color: "#7b8cd4" },
    writers:       { label: "Literatura",       color: "#1fb6b6" },
    science:       { label: "Ciencia",          color: "#4ba3e3" },
    art:           { label: "Arte",             color: "#e56ba6" },
    music:         { label: "Musica",           color: "#ef5350" },
    exploration:   { label: "Exploracion",      color: "#57c08a" },
    business:      { label: "Negocios",         color: "#f2c800" },
    entertainment: { label: "Cine y espectaculo", color: "#b07cd6" },
    sports:        { label: "Deportes",         color: "#e0803a" }
  };

  // Filtros rapidos: conjuntos de categorias
  var CAT_PRESETS = {
    humanidades: ["philosophy", "religion", "politics", "history", "writers"]
  };

  var RULER_H = 56;      // alto de la regla superior
  var LANE_H = 28;       // alto de cada carril (etiqueta + barra)
  var BAR_H = 12;        // alto de la barra
  var LABEL_LIFT = 14;   // separacion de la etiqueta sobre la barra
  var MINIMAP_H = 46;    // alto del minimapa inferior
  var GAP_PX = 14;       // hueco minimo entre barras del mismo carril

  // ---- Estado -----------------------------------------------------------
  var people = (window.WLW_PEOPLE || []).slice();
  var eras = window.WLW_ERAS || [];
  var events = window.WLW_EVENTS || [];
  var groups = window.WLW_GROUPS || [];
  var relations = window.WLW_RELATIONS || [];

  // rango de datos
  var DATA_MIN = -1900, DATA_MAX = CURRENT_YEAR;
  people.forEach(function (p) {
    if (p.b < DATA_MIN) DATA_MIN = p.b;
  });
  DATA_MIN -= 60;

  var active = {}; // categorias activas
  Object.keys(CATEGORIES).forEach(function (k) { active[k] = true; });

  var view = { startYear: DATA_MIN, pxPerYear: 0.2, offsetY: 0 };
  var selected = null, hovered = null;
  var searchTerm = "";
  var cam = null;        // animacion de camara en curso
  var introT = 0;        // 0..1 fundido de entrada
  var t0Intro = 0;

  var canvas = document.getElementById("timeline");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, dpr = 1;

  var layout = { lanes: 0, list: [] };
  var drawn = [];          // rectangulos dibujados este frame (para hit-test)
  var drawnByName = {};    // nombre -> rect dibujado
  var dirty = true, dirtyLayout = true;

  var textCache = {};
  function measure(txt, font) {
    var key = font + "|" + txt;
    if (textCache[key] != null) return textCache[key];
    ctx.font = font;
    var w = ctx.measureText(txt).width;
    textCache[key] = w;
    return w;
  }

  // ---- Utilidades de tiempo --------------------------------------------
  function yearToX(y) { return (y - view.startYear) * view.pxPerYear; }
  function xToYear(x) { return view.startYear + x / view.pxPerYear; }
  function deathOf(p) { return p.d == null ? CURRENT_YEAR : p.d; }

  function minPxPerYear() { return (W - 4) / (DATA_MAX - DATA_MIN); }
  function clampPx(v) {
    var mn = minPxPerYear();
    if (v < mn) return mn;
    if (v > 45) return 45;
    return v;
  }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // Anima la camara (tiempo, zoom y scroll vertical) hacia un destino.
  function animateTo(startYear, pxPerYear, offsetY, dur) {
    cam = {
      sy0: view.startYear, sy1: startYear,
      px0: view.pxPerYear, px1: clampPx(pxPerYear),
      oy0: view.offsetY, oy1: offsetY,
      t0: performance.now(), dur: dur || 550
    };
  }

  function fmtYear(y) {
    if (y < 0) return Math.abs(y) + " a.C.";
    return String(y);
  }
  function fmtRange(p) {
    var pre = p.approx ? "c. " : "";
    if (p.d == null) return pre + fmtYear(p.b) + "–";
    return pre + fmtYear(p.b) + "–" + fmtYear(p.d);
  }

  // El tier maximo visible depende de cuantos anios caben en pantalla.
  function maxTierForZoom() {
    var yearsVisible = W / view.pxPerYear;
    if (yearsVisible > 2500) return 1;
    if (yearsVisible > 1200) return 2;
    if (yearsVisible > 450) return 3;
    return 4;
  }

  // ---- Empaquetado en carriles -----------------------------------------
  function computeLayout() {
    var maxTier = maxTierForZoom();
    var elig = people.filter(function (p) {
      if (!active[p.cat]) return false;
      if (p.tier > maxTier) return false;
      if (searchTerm && p.name.toLowerCase().indexOf(searchTerm) === -1) return false;
      return true;
    });
    // el seleccionado siempre entra
    if (selected && elig.indexOf(selected) === -1) elig.push(selected);

    elig.sort(function (a, b) { return a.b - b.b; });

    var labelFont = "600 12px system-ui, sans-serif";
    var laneEnds = []; // anio (borde derecho incl. etiqueta) por carril
    elig.forEach(function (p) {
      var labelPx = measure(p.name + "  " + fmtRange(p), labelFont);
      var extentYears = Math.max(deathOf(p) - p.b, labelPx / view.pxPerYear);
      var rightYear = p.b + extentYears + GAP_PX / view.pxPerYear;
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= p.b) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = rightYear;
      p._lane = lane;
    });

    layout = { lanes: laneEnds.length, list: elig };
    dirtyLayout = false;
    clampOffsetY();
  }

  function contentHeight() {
    return RULER_H + layout.lanes * LANE_H + 24;
  }
  function viewportHeight() {
    return H - MINIMAP_H;
  }
  function clampOffsetY() {
    var max = Math.max(0, contentHeight() - viewportHeight());
    if (view.offsetY < 0) view.offsetY = 0;
    if (view.offsetY > max) view.offsetY = max;
  }

  // ---- Dibujo -----------------------------------------------------------
  function rr(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function niceStep(raw) {
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
    return 10000;
  }
  function tickStep() { return niceStep(100 / view.pxPerYear); }

  // color hex -> rgba con alfa
  function withAlpha(hex, a) {
    var h = hex.replace("#", "");
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function lighten(hex, amt) {
    var h = hex.replace("#", "");
    var r = Math.min(255, parseInt(h.substring(0, 2), 16) + amt);
    var g = Math.min(255, parseInt(h.substring(2, 4), 16) + amt);
    var b = Math.min(255, parseInt(h.substring(4, 6), 16) + amt);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function draw() {
    if (dirtyLayout) computeLayout();
    drawn = [];
    drawnByName = {};

    ctx.clearRect(0, 0, W, H);
    var vpH = viewportHeight();

    drawBackground(vpH);

    // clip al area de contenido (encima del minimapa)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, W, vpH - RULER_H);
    ctx.clip();

    ctx.globalAlpha = introT;
    drawEras(vpH);
    drawGrid(vpH);
    drawEventsBg(vpH);
    drawPeople(vpH);
    drawGroups();
    drawRelations();
    ctx.globalAlpha = 1;

    ctx.restore();

    drawRuler();
    drawEventLabels();
    drawMinimap();
    if (hovered) drawTooltip();
    updateCount();
  }

  // Fondo con gradiente ambiental sutil.
  function drawBackground(vpH) {
    var g = ctx.createLinearGradient(0, RULER_H, 0, vpH);
    g.addColorStop(0, "#161821");
    g.addColorStop(1, "#0f1016");
    ctx.fillStyle = g;
    ctx.fillRect(0, RULER_H, W, vpH - RULER_H);
    // resplandor central tenue
    var rg = ctx.createRadialGradient(W * 0.5, vpH * 0.35, 0, W * 0.5, vpH * 0.35, Math.max(W, vpH) * 0.7);
    rg.addColorStop(0, "rgba(90,120,180,0.06)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, RULER_H, W, vpH - RULER_H);
  }

  // Rejilla vertical alineada con las marcas de la regla.
  function drawGrid(vpH) {
    var step = tickStep();
    var first = Math.ceil(view.startYear / step) * step;
    ctx.lineWidth = 1;
    for (var y = first; ; y += step) {
      var x = yearToX(y);
      if (x > W) break;
      if (x < 0) continue;
      ctx.strokeStyle = (y % (step * 5) === 0) ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.035)";
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, vpH); ctx.stroke();
    }
  }

  function drawEras(vpH) {
    eras.forEach(function (e, i) {
      var x0 = yearToX(e.b), x1 = yearToX(e.d);
      if (x1 < 0 || x0 > W) return;
      var cx0 = Math.max(0, x0), cx1 = Math.min(W, x1);
      var g = ctx.createLinearGradient(0, RULER_H, 0, vpH);
      g.addColorStop(0, withAlpha(e.color, 0.11));
      g.addColorStop(1, withAlpha(e.color, 0.03));
      ctx.fillStyle = g;
      ctx.fillRect(cx0, RULER_H, cx1 - cx0, vpH - RULER_H);
      // borde izquierdo suave
      if (x0 >= 0) {
        ctx.strokeStyle = withAlpha(e.color, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, RULER_H); ctx.lineTo(x0, vpH); ctx.stroke();
      }
      // etiqueta vertical en la banda
      ctx.save();
      ctx.fillStyle = withAlpha(e.color, 0.7);
      ctx.font = "700 11px system-ui, sans-serif";
      var lx = Math.max(cx0 + 14, 14);
      ctx.translate(lx, vpH - 14);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(e.name.toUpperCase(), 0, 0);
      ctx.restore();
    });
  }

  function drawEventsBg(vpH) {
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    events.forEach(function (ev) {
      var x = yearToX(ev.year);
      if (x < 0 || x > W) return;
      var g = ctx.createLinearGradient(0, RULER_H, 0, vpH);
      g.addColorStop(0, "rgba(240,150,110,0.45)");
      g.addColorStop(1, "rgba(240,150,110,0.05)");
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, vpH);
      ctx.stroke();
      // marcador circular arriba
      ctx.setLineDash([]);
      ctx.fillStyle = "#f0966e";
      ctx.beginPath(); ctx.arc(x, RULER_H + 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([2, 5]);
    });
    ctx.setLineDash([]);
  }

  function drawPeople(vpH) {
    var nameFont = "600 12px system-ui, sans-serif";
    var dateFont = "11px system-ui, sans-serif";
    // La atenuacion del resto solo ocurre al pasar el raton (hover),
    // no con la seleccion persistente (que solo resalta su barra).
    var focusMode = !!hovered;
    var connected = {};
    if (focusMode) {
      var f = hovered.name;
      relations.forEach(function (r) {
        if (r.a === f) connected[r.b] = 1;
        if (r.b === f) connected[r.a] = 1;
      });
    }
    layout.list.forEach(function (p) {
      var x0 = yearToX(p.b), x1 = yearToX(deathOf(p));
      if (x1 < 0 || x0 > W) return; // culling horizontal
      var rowTop = RULER_H + p._lane * LANE_H - view.offsetY;
      if (rowTop > vpH || rowTop + LANE_H < RULER_H) return; // culling vertical
      var barY = rowTop + LABEL_LIFT;
      var bw = Math.max(3, x1 - x0);
      var col = CATEGORIES[p.cat].color;

      var isSel = p === selected, isHov = p === hovered;
      var isRel = connected[p.name];
      var dim = focusMode && !isHov && !isRel && !isSel;

      // sombra/glow para el foco
      if (isSel || isHov) {
        ctx.save();
        ctx.shadowColor = withAlpha(col, 0.9);
        ctx.shadowBlur = 16;
      }

      // barra con degradado vertical
      var grad = ctx.createLinearGradient(0, barY, 0, barY + BAR_H);
      grad.addColorStop(0, lighten(col, 40));
      grad.addColorStop(1, col);
      ctx.fillStyle = grad;
      ctx.globalAlpha = dim ? 0.28 : 1;
      rr(x0, barY, bw, BAR_H, 3.5);
      ctx.fill();
      // brillo superior
      if (!dim && bw > 6) {
        ctx.globalAlpha = dim ? 0.1 : 0.25;
        ctx.fillStyle = "#ffffff";
        rr(x0 + 1, barY + 1, bw - 2, 2.5, 1.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (isSel || isHov) ctx.restore();

      if (isSel || isHov) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        rr(x0, barY, bw, BAR_H, 3.5);
        ctx.stroke();
      }

      // etiqueta encima de la barra
      var lx = Math.max(x0, 2);
      ctx.font = nameFont;
      ctx.globalAlpha = dim ? 0.4 : 1;
      ctx.fillStyle = (isSel || isHov) ? "#ffffff" : "#eceef4";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(p.name, lx, rowTop + 11);
      var nameW = measure(p.name, nameFont);
      ctx.font = dateFont;
      ctx.fillStyle = withAlpha(col, dim ? 0.5 : 0.95);
      ctx.fillText("  " + fmtRange(p), lx + nameW, rowTop + 11);
      ctx.globalAlpha = 1;

      var rect = { p: p, x: x0, y: rowTop, w: Math.max(bw, nameW + measure("  " + fmtRange(p), dateFont)), h: LANE_H };
      drawn.push(rect);
      drawnByName[p.name] = rect;
    });
  }

  function drawGroups() {
    ctx.font = "700 10px system-ui, sans-serif";
    groups.forEach(function (g) {
      var xs = [], ys = [];
      g.members.forEach(function (nm) {
        var r = drawnByName[nm];
        if (r) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
      });
      if (xs.length < 2) return; // nada visible del grupo
      var minX = Math.min.apply(null, xs) - 8, maxX = Math.max.apply(null, xs) + 8;
      var minY = Math.min.apply(null, ys) - 6, maxY = Math.max.apply(null, ys) + 4;
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      rr(minX, minY, maxX - minX, maxY - minY, 6);
      ctx.stroke();
      ctx.setLineDash([]);
      // etiqueta del grupo
      var label = g.name.toUpperCase();
      var lw = measure(label, "700 10px system-ui, sans-serif") + 10;
      ctx.fillStyle = "rgba(20,21,26,0.9)";
      ctx.fillRect(minX + 6, minY - 7, lw, 14);
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillText(label, minX + 11, minY + 3);
    });
  }

  function drawRelations() {
    ctx.lineWidth = 1.4;
    ctx.font = "italic 10px system-ui, sans-serif";
    var focusName = (selected || hovered) ? (selected || hovered).name : null;
    relations.forEach(function (rel) {
      var ra = drawnByName[rel.a], rb = drawnByName[rel.b];
      if (!ra || !rb) return;
      var ax = ra.x + ra.w, ay = ra.y + LABEL_LIFT + BAR_H / 2;
      var bx = rb.x, by = rb.y + LABEL_LIFT + BAR_H / 2;
      if (bx < ax) { var t = ra; ra = rb; rb = t; ax = ra.x + ra.w; ay = ra.y + LABEL_LIFT + BAR_H / 2; bx = rb.x; by = rb.y + LABEL_LIFT + BAR_H / 2; }
      var midx = (ax + bx) / 2;
      var hot = focusName && (rel.a === focusName || rel.b === focusName);
      ctx.strokeStyle = hot ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)";
      if (hot) { ctx.save(); ctx.shadowColor = "rgba(255,255,255,0.6)"; ctx.shadowBlur = 8; }
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(midx, ay, midx, by, bx, by);
      ctx.stroke();
      if (hot) ctx.restore();
      if (rel.label) {
        var lw = measure(rel.label, "italic 10px system-ui, sans-serif");
        var mx = midx - lw / 2, my = (ay + by) / 2;
        ctx.fillStyle = "rgba(12,13,18,0.85)";
        ctx.fillRect(mx - 3, my - 11, lw + 6, 13);
        ctx.fillStyle = hot ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)";
        ctx.fillText(rel.label, mx, my - 1);
      }
    });
  }

  function drawRuler() {
    var g = ctx.createLinearGradient(0, 0, 0, RULER_H);
    g.addColorStop(0, "#0c0d12");
    g.addColorStop(1, "#12141c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RULER_H - 0.5); ctx.lineTo(W, RULER_H - 0.5); ctx.stroke();

    var step = tickStep();
    var first = Math.ceil(view.startYear / step) * step;
    ctx.textBaseline = "alphabetic";
    for (var y = first; ; y += step) {
      var x = yearToX(y);
      if (x > W) break;
      if (x < 0) continue;
      var major = (y % (step * 5) === 0);
      ctx.strokeStyle = major ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.16)";
      ctx.beginPath(); ctx.moveTo(x, RULER_H - (major ? 14 : 9)); ctx.lineTo(x, RULER_H); ctx.stroke();
      ctx.fillStyle = major ? "#e6e8f0" : "#a6abba";
      ctx.font = (major ? "700 12px " : "500 11px ") + "system-ui, sans-serif";
      var lbl = fmtYear(y);
      ctx.fillText(lbl, x - measure(lbl, ctx.font) / 2, RULER_H - 20);
    }
    // linea + etiqueta del anio actual
    var nx = yearToX(CURRENT_YEAR);
    if (nx >= 0 && nx <= W) {
      ctx.strokeStyle = "rgba(110,220,150,0.55)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(nx, RULER_H); ctx.lineTo(nx, viewportHeight()); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(110,220,150,0.95)";
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.fillText("HOY", Math.min(nx + 5, W - 26), RULER_H + 12);
    }
  }

  function drawEventLabels() {
    ctx.font = "600 10px system-ui, sans-serif";
    events.forEach(function (ev) {
      var x = yearToX(ev.year);
      if (x < 0 || x > W) return;
      ctx.fillStyle = "rgba(230,120,90,0.9)";
      ctx.save();
      ctx.translate(x + 3, RULER_H + 6);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(ev.year + "  " + ev.label, 0, 0);
      ctx.restore();
    });
  }

  // ---- Minimapa ---------------------------------------------------------
  function mapXToYear(x) { return DATA_MIN + (x / W) * (DATA_MAX - DATA_MIN); }
  function yearToMapX(y) { return ((y - DATA_MIN) / (DATA_MAX - DATA_MIN)) * W; }

  function drawMinimap() {
    var top = H - MINIMAP_H;
    ctx.fillStyle = "#0f1014";
    ctx.fillRect(0, top, W, MINIMAP_H);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(W, top + 0.5); ctx.stroke();

    // densidad: un tick por persona segun su categoria
    people.forEach(function (p) {
      if (!active[p.cat]) return;
      var mx = yearToMapX(p.b);
      ctx.fillStyle = CATEGORIES[p.cat].color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(mx, top + 8 + (p.tier - 1) * 7, 1.5, 6);
    });
    ctx.globalAlpha = 1;

    // etiquetas de siglos
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "10px system-ui, sans-serif";
    for (var yy = -1000; yy <= 2000; yy += 500) {
      var mx = yearToMapX(yy);
      ctx.fillText(fmtYear(yy), mx + 2, H - 4);
    }

    // rectangulo del viewport
    var vx0 = yearToMapX(view.startYear);
    var vx1 = yearToMapX(xToYear(W));
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx0, top + 3, Math.max(4, vx1 - vx0), MINIMAP_H - 6);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(vx0, top + 3, Math.max(4, vx1 - vx0), MINIMAP_H - 6);
  }

  // ---- Tooltip ----------------------------------------------------------
  var tip = document.getElementById("tooltip");
  var lastMouse = { x: 0, y: 0 };
  function drawTooltip() {
    var p = hovered;
    tip.innerHTML = "<strong>" + p.name + "</strong>" +
      "<span class='role'>" + (p.role || CATEGORIES[p.cat].label) + "</span>" +
      "<span class='dates'>" + fmtRange(p) + "</span>" +
      (p.note ? "<span class='note'>" + p.note + "</span>" : "");
    tip.style.display = "block";
    var tx = lastMouse.x + 14, ty = lastMouse.y + 14;
    if (tx + tip.offsetWidth > W) tx = lastMouse.x - tip.offsetWidth - 14;
    if (ty + tip.offsetHeight > H) ty = lastMouse.y - tip.offsetHeight - 14;
    tip.style.left = tx + "px";
    tip.style.top = ty + "px";
  }
  function hideTooltip() { tip.style.display = "none"; }

  // ---- Panel de detalle -------------------------------------------------
  function showDetail(p) {
    var el = document.getElementById("detail");
    if (!p) { el.classList.remove("open"); return; }
    var age = (p.d == null ? CURRENT_YEAR : p.d) - p.b;
    var duringEras = eras.filter(function (e) { return p.b < e.d && deathOf(p) > e.b; })
      .map(function (e) { return e.name; });
    var rels = relations.filter(function (r) { return r.a === p.name || r.b === p.name; })
      .map(function (r) { var other = r.a === p.name ? r.b : r.a; return r.label + " " + other; });
    var col = CATEGORIES[p.cat].color;
    var initials = p.name.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
    el.style.setProperty("--accent", col);
    el.innerHTML =
      "<button class='close' aria-label='Cerrar'>&times;</button>" +
      "<div class='d-head'>" +
        "<div class='mono' style='background:linear-gradient(135deg," + col + "," + col + "99)'>" + initials + "</div>" +
        "<div class='d-title'>" +
          "<span class='pill' style='background:" + col + "22;color:" + col + ";border-color:" + col + "55'>" + (p.role || CATEGORIES[p.cat].label) + "</span>" +
          "<h2>" + p.name + "</h2>" +
          "<div class='meta'>" + (p.region || "") + "</div>" +
        "</div>" +
      "</div>" +
      "<div class='big'>" + fmtRange(p) + "</div>" +
      "<div class='age'>" + (p.d == null ? "Vivo/a &middot; " + age + " años" : "Vivió " + age + " años") + "</div>" +
      (p.note ? "<p class='note'>" + p.note + "</p>" : "") +
      (duringEras.length ? "<div class='tag-title'>Vivió durante</div><div class='tags'>" + duringEras.map(function (e) { return "<span>" + e + "</span>"; }).join("") + "</div>" : "") +
      (rels.length ? "<div class='tag-title'>Relaciones</div><div class='tags'>" + rels.map(function (r) { return "<span>" + r + "</span>"; }).join("") + "</div>" : "");
    el.classList.add("open");
    el.querySelector(".close").addEventListener("click", function () {
      selected = null; showDetail(null); markDirty();
    });
  }

  // ---- Interaccion ------------------------------------------------------
  function hitTest(mx, my) {
    for (var i = drawn.length - 1; i >= 0; i--) {
      var r = drawn[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.p;
    }
    return null;
  }

  function markDirty() { dirty = true; }
  function markLayout() { dirtyLayout = true; dirty = true; }

  var drag = null;
  canvas.addEventListener("pointerdown", function (e) {
    var my = e.offsetY;
    if (my > H - MINIMAP_H) { minimapJump(e.offsetX, true); return; }
    drag = { x: e.offsetX, y: e.offsetY, sy: view.startYear, oy: view.offsetY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    lastMouse.x = e.offsetX; lastMouse.y = e.offsetY;
    if (draggingMap) { minimapJump(e.offsetX, false); return; }
    if (drag) {
      var dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      view.startYear = drag.sy - dx / view.pxPerYear;
      view.offsetY = drag.oy - dy;
      clampOffsetY();
      hideTooltip();
      markDirty();
      return;
    }
    // hover
    if (e.offsetY < RULER_H || e.offsetY > H - MINIMAP_H) { setHover(null); return; }
    var p = hitTest(e.offsetX, e.offsetY);
    setHover(p);
  });
  canvas.addEventListener("pointerup", function (e) {
    draggingMap = false;
    if (drag && !drag.moved) {
      var p = hitTest(e.offsetX, e.offsetY);
      selected = p;
      showDetail(p);
      markDirty();
    }
    drag = null;
  });
  canvas.addEventListener("pointerleave", function () { setHover(null); });

  function setHover(p) {
    if (p === hovered) return;
    hovered = p;
    canvas.style.cursor = p ? "pointer" : "grab";
    if (!p) hideTooltip();
    markDirty();
  }

  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (e.shiftKey) {
      view.offsetY += e.deltaY;
      clampOffsetY();
      markDirty();
      return;
    }
    zoomAt(e.offsetX, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function zoomAt(px, factor) {
    var anchorYear = xToYear(px);
    var prevTier = maxTierForZoom();
    view.pxPerYear *= factor;
    var minPx = (W - 4) / (DATA_MAX - DATA_MIN);
    if (view.pxPerYear < minPx) view.pxPerYear = minPx;
    if (view.pxPerYear > 45) view.pxPerYear = 45;
    view.startYear = anchorYear - px / view.pxPerYear;
    if (maxTierForZoom() !== prevTier) markLayout();
    else markDirty();
  }

  var draggingMap = false;
  function minimapJump(px, start) {
    draggingMap = true;
    if (start) draggingMap = true;
    var centerYear = mapXToYear(px);
    view.startYear = centerYear - (W / view.pxPerYear) / 2;
    markDirty();
  }

  // ---- Enfocar una persona ---------------------------------------------
  function focusPerson(p) {
    selected = p;
    var span = Math.max(deathOf(p) - p.b, 20);
    var tpx = clampPx((W * 0.42) / span);
    var center = p.b + (deathOf(p) - p.b) / 2;
    var tsy = center - (W / tpx) / 2;
    // calcular el carril en el zoom de destino
    var sPx = view.pxPerYear;
    view.pxPerYear = tpx; computeLayout(); view.pxPerYear = sPx;
    var toy = RULER_H + ((p._lane || 0) * LANE_H) - viewportHeight() / 2;
    var maxOy = Math.max(0, contentHeight() - viewportHeight());
    if (toy < 0) toy = 0; if (toy > maxOy) toy = maxOy;
    animateTo(tsy, tpx, toy, 650);
    showDetail(p);
  }

  // ---- Presets de rango -------------------------------------------------
  function setRange(a, b, instant) {
    var tpx = clampPx(W / (b - a));
    if (instant) {
      view.pxPerYear = tpx; view.startYear = a; view.offsetY = 0;
      markLayout();
    } else {
      animateTo(a, tpx, 0, 650);
    }
  }

  // ---- UI ---------------------------------------------------------------
  function buildLegend() {
    var el = document.getElementById("legend");
    Object.keys(CATEGORIES).forEach(function (k) {
      var c = CATEGORIES[k];
      var b = document.createElement("button");
      b.className = "cat active";
      b.setAttribute("data-cat", k);
      b.innerHTML = "<span class='dot' style='background:" + c.color + "'></span>" + c.label;
      b.addEventListener("click", function () {
        active[k] = !active[k];
        b.classList.toggle("active", active[k]);
        markLayout();
      });
      el.appendChild(b);
    });
  }

  function wireSearch() {
    var input = document.getElementById("search");
    var box = document.getElementById("suggest");
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      box.innerHTML = "";
      if (!q) { box.style.display = "none"; return; }
      var matches = people.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      matches.forEach(function (p) {
        var d = document.createElement("div");
        d.className = "s-item";
        d.innerHTML = "<span class='dot' style='background:" + CATEGORIES[p.cat].color + "'></span>" +
          p.name + " <span class='yr'>" + fmtRange(p) + "</span>";
        d.addEventListener("click", function () {
          box.style.display = "none";
          input.value = p.name;
          focusPerson(p);
        });
        box.appendChild(d);
      });
      box.style.display = matches.length ? "block" : "none";
    });
    document.addEventListener("click", function (e) {
      if (!box.contains(e.target) && e.target !== input) box.style.display = "none";
    });
  }

  // Centra la vista en un anio manteniendo el zoom actual.
  function centerOnYear(y) {
    view.startYear = y - (W / view.pxPerYear) / 2;
    markDirty();
  }

  // Interpreta textos como "1492", "-500", "500 a.C.", "323 aC".
  function parseYear(txt) {
    if (!txt) return null;
    var s = txt.toLowerCase().trim();
    var bce = /a\.?\s*c/.test(s);
    var n = parseInt(s.replace(/[^0-9-]/g, ""), 10);
    if (isNaN(n)) return null;
    if (bce && n > 0) n = -n;
    return n;
  }

  function applyCatPreset(mode) {
    Object.keys(CATEGORIES).forEach(function (k) {
      if (mode === "all") active[k] = true;
      else if (mode === "none") active[k] = false;
      else active[k] = CAT_PRESETS[mode].indexOf(k) !== -1;
    });
    // refleja el estado en la leyenda
    document.querySelectorAll("#legend .cat").forEach(function (b) {
      var k = b.getAttribute("data-cat");
      b.classList.toggle("active", !!active[k]);
    });
    markLayout();
  }

  function animatedZoom(factor) {
    var px = W / 2, anchorYear = xToYear(px);
    var tpx = clampPx(view.pxPerYear * factor);
    animateTo(anchorYear - px / tpx, tpx, view.offsetY, 350);
  }

  function wireControls() {
    document.getElementById("zoom-in").addEventListener("click", function () { animatedZoom(1.6); });
    document.getElementById("zoom-out").addEventListener("click", function () { animatedZoom(1 / 1.6); });
    document.querySelectorAll("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () {
        var r = b.getAttribute("data-range").split(",");
        setRange(parseInt(r[0], 10), parseInt(r[1], 10));
      });
    });
    document.querySelectorAll("[data-preset]").forEach(function (b) {
      b.addEventListener("click", function () { applyCatPreset(b.getAttribute("data-preset")); });
    });
    var gy = document.getElementById("gotoyear");
    if (gy) {
      var go = function () {
        var y = parseYear(gy.value);
        if (y == null) return;
        if (y < DATA_MIN) y = DATA_MIN;
        if (y > DATA_MAX) y = DATA_MAX;
        // si estamos muy alejados, acercamos a un nivel comodo (~150 anios de ancho)
        var tpx = view.pxPerYear;
        if (W / view.pxPerYear > 400) tpx = W / 150;
        tpx = clampPx(tpx);
        animateTo(y - (W / tpx) / 2, tpx, 0, 600); // reinicia el scroll vertical
      };
      gy.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      var gb = document.getElementById("gotoyear-btn");
      if (gb) gb.addEventListener("click", go);
    }
  }

  function updateCount() {
    var el = document.getElementById("count");
    if (el) el.textContent = drawn.length + " en pantalla · " + layout.list.length + " en este nivel · " + people.length + " en total";
  }

  // ---- Bucle de render --------------------------------------------------
  function frame(now) {
    now = now || performance.now();
    if (cam) {
      var t = (now - cam.t0) / cam.dur;
      if (t >= 1) t = 1;
      var e = easeInOut(t);
      view.startYear = cam.sy0 + (cam.sy1 - cam.sy0) * e;
      view.pxPerYear = cam.px0 + (cam.px1 - cam.px0) * e;
      view.offsetY = cam.oy0 + (cam.oy1 - cam.oy0) * e;
      dirtyLayout = true; dirty = true;
      if (t >= 1) cam = null;
    }
    if (introT < 1) {
      introT = Math.min(1, (now - t0Intro) / 700);
      dirty = true;
    }
    if (dirty) { dirty = false; draw(); }
    requestAnimationFrame(frame);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    textCache = {};
    markLayout();
  }

  // ---- Inicio -----------------------------------------------------------
  buildLegend();
  wireSearch();
  wireControls();
  window.addEventListener("resize", resize);
  resize();
  // vista inicial: todo el rango
  setRange(DATA_MIN, DATA_MAX + 10, true);
  t0Intro = performance.now();
  requestAnimationFrame(frame);
})();
