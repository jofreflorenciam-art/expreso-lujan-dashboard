const API_URL = "https://script.google.com/macros/s/AKfycbxDWo1sJI7Sq36gkigBYAcCeKx4faT4YrsnI77x8NB70rOPPItZu5K2-edWW9ukwRhY/exec";

const MONEY = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fmt = (n) => '$' + MONEY.format(Math.round(n || 0));

const ETAPAS_ORDEN = ["NUEVO", "COTIZACION ENVIADA", "NEGOCIACION", "GANADA", "PERDIDA"];
const ETAPAS_LABEL = { NUEVO: "Nuevo", "COTIZACION ENVIADA": "Cotización enviada", NEGOCIACION: "Negociación", GANADA: "Ganada", PERDIDA: "Perdida" };

let DATA = null;

async function cargarDatos() {
  const statusEl = document.getElementById('status-carga');
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    statusEl.textContent = 'Actualizado: ' + new Date(DATA.generadoEl).toLocaleString('es-AR');
    statusEl.classList.remove('status-error');
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'No se pudo cargar la información. Reintentando...';
    statusEl.classList.add('status-error');
    setTimeout(cargarDatos, 8000);
    return;
  }
  intentarRenderizar('Ventas General', renderVentasGeneral);
  intentarRenderizar('Por Comercial', renderPorComercial);
  intentarRenderizar('Progreso al Bono', renderProgresoBono);
}

function intentarRenderizar(nombre, fn) {
  try {
    fn();
  } catch (err) {
    console.error('Error renderizando ' + nombre + ':', err);
  }
}

/** Barra horizontal simple hecha con CSS/HTML (sin librerías externas, no depende de ningún CDN) */
function renderBarras(containerId, entries, opciones) {
  opciones = opciones || {};
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  if (!entries || entries.length === 0) {
    wrap.innerHTML = `<p class="empty-msg">${opciones.vacioMsg || 'No hay datos para mostrar.'}</p>`;
    return;
  }
  const max = Math.max(...entries.map(e => e.value), 1);
  entries.forEach(e => {
    const row = document.createElement('div');
    row.className = 'simple-bar-row';
    row.innerHTML = `
      <span class="simple-bar-label" title="${e.label}">${e.label}</span>
      <div class="simple-bar-track"><div class="simple-bar-fill" style="width:${(e.value / max) * 100}%; background:${e.color || 'var(--red)'}"></div></div>
      <span class="simple-bar-value">${opciones.formatValue ? opciones.formatValue(e.value) : e.value}</span>`;
    wrap.appendChild(row);
  });
}

/** Dibuja un embudo real (trapecios apilados) para las etapas de avance,
 *  y muestra "Perdida" aparte como salida del embudo (no como escalón). */
function renderFunnel(containerId, embudo) {
  const ETAPAS_FUNNEL = ["NUEVO", "COTIZACION ENVIADA", "NEGOCIACION", "GANADA"];
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';

  const outer = document.createElement('div');
  outer.className = 'embudo-svg-wrap';

  const valores = ETAPAS_FUNNEL.map(e => embudo[e] || 0);
  const max = Math.max(...valores, 1);
  const W = 320, H = 210, STAGE_H = H / ETAPAS_FUNNEL.length, MIN_W = 40;

  const widthFor = (v) => Math.max(MIN_W, (v / max) * W);

  let svg = `<svg viewBox="0 0 ${W} ${H + 90}" width="100%" style="max-width:360px" xmlns="http://www.w3.org/2000/svg">`;
  const colores = ['#1C1B1A', '#4A4744', '#8A8580', '#CA151E'];
  ETAPAS_FUNNEL.forEach((etapa, i) => {
    const wTop = widthFor(valores[i]);
    const wBottom = i < ETAPAS_FUNNEL.length - 1 ? widthFor(valores[i + 1]) : wTop * 0.9;
    const y = i * STAGE_H;
    const xTopL = (W - wTop) / 2, xTopR = (W + wTop) / 2;
    const xBotL = (W - wBottom) / 2, xBotR = (W + wBottom) / 2;
    svg += `<polygon points="${xTopL},${y} ${xTopR},${y} ${xBotR},${y + STAGE_H - 4} ${xBotL},${y + STAGE_H - 4}" fill="${colores[i]}" />`;
    svg += `<text x="${W / 2}" y="${y + STAGE_H / 2 - 6}" text-anchor="middle" fill="#fff" font-family="Raleway" font-weight="800" font-size="15">${valores[i]}</text>`;
    svg += `<text x="${W / 2}" y="${y + STAGE_H / 2 + 12}" text-anchor="middle" fill="#fff" font-family="Raleway" font-weight="500" font-size="10.5" opacity="0.85">${ETAPAS_LABEL[etapa]}</text>`;
  });
  svg += `</svg>`;

  const svgHolder = document.createElement('div');
  svgHolder.style.flex = '1';
  svgHolder.innerHTML = svg;
  outer.appendChild(svgHolder);

  const perdidas = document.createElement('div');
  perdidas.className = 'embudo-perdidas';
  perdidas.innerHTML = `<div class="valor">${embudo.PERDIDA || 0}</div><div class="label">Perdidas</div>`;
  outer.appendChild(perdidas);

  wrap.appendChild(outer);
}

function actualizarVistaMes(vg, mes) {
  document.getElementById('kpi-facturacion-label').textContent = `Facturación clientes nuevos — ${mes}`;
  document.getElementById('kpi-facturacion-total').textContent = fmt(vg.facturacionPorMes[mes] || 0);

  // Top 10 clientes del mes elegido
  const filasDelMes = (vg.detalleFacturacion || []).filter(f => f.mes === mes);
  const top10 = filasDelMes
    .sort((a, b) => b.facturacion - a.facturacion)
    .slice(0, 10)
    .map(f => ({ label: f.cliente || f.oportunidad, value: f.facturacion }));
  renderBarras('top-clientes', top10, { formatValue: fmt, vacioMsg: 'No hay facturación de clientes nuevos cargada para este mes.' });
}

/* ---------------- VENTAS GENERAL ---------------- */
function renderVentasGeneral() {
  const vg = DATA.ventasGeneral;

  document.getElementById('kpi-ganadas').textContent = vg.embudo.GANADA;
  document.getElementById('kpi-pendientes').textContent = vg.gananadasPendientesDeConfirmar;

  const meses = Object.keys(vg.facturacionPorMes).sort();
  const selector = document.getElementById('mes-selector');
  const mesPrevio = selector.value;
  selector.innerHTML = meses.map(m => `<option value="${m}">${m}</option>`).join('');
  const mesElegido = meses.includes(mesPrevio) ? mesPrevio : meses[meses.length - 1];
  selector.value = mesElegido;
  selector.onchange = () => actualizarVistaMes(vg, selector.value);
  actualizarVistaMes(vg, mesElegido);

  renderFunnel('embudo-general', vg.embudo);

  const entradasMes = meses.map(m => ({ label: m, value: vg.facturacionPorMes[m] }));
  renderBarras('facturacion-mes-barras', entradasMes, { formatValue: fmt });

  renderEtiquetas(vg.etiquetasPorCategoria, 'Rubro');
  document.querySelectorAll('.tag-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tag-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEtiquetas(vg.etiquetasPorCategoria, btn.dataset.cat);
    };
  });
}

function renderEtiquetas(etiquetasPorCategoria, categoria) {
  const datos = etiquetasPorCategoria[categoria] || {};
  const entries = Object.entries(datos)
    .sort((a, b) => b[1].facturacion - a[1].facturacion)
    .slice(0, 8)
    .map(([tag, info]) => ({ label: tag, value: info.facturacion }));
  renderBarras('etiquetas-lista', entries, { formatValue: fmt, vacioMsg: 'Todavía no hay etiquetas cargadas en esta categoría.' });
}

/* ---------------- POR COMERCIAL ---------------- */
function renderPorComercial() {
  const selector = document.getElementById('comercial-selector');
  selector.innerHTML = '';
  const opciones = ['Todos', ...DATA.porComercial.map(p => p.vendedor)];
  opciones.forEach((nombre, i) => {
    const btn = document.createElement('button');
    btn.className = 'pill' + (i === 0 ? ' active' : '');
    btn.textContent = nombre;
    btn.onclick = () => {
      document.querySelectorAll('#comercial-selector .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pintarComercial(nombre);
    };
    selector.appendChild(btn);
  });
  pintarComercial('Todos');
}

function pintarComercial(nombre) {
  if (nombre === 'Todos') {
    document.getElementById('comercial-chart-wrap').style.display = 'block';
    document.getElementById('comercial-kpis').style.display = 'none';
    const entradas = DATA.porComercial.map(p => ({ label: p.vendedor, value: p.facturacionClientesNuevos }));
    renderBarras('comparativa-barras', entradas, { formatValue: fmt });
    return;
  }
  document.getElementById('comercial-chart-wrap').style.display = 'none';
  document.getElementById('comercial-kpis').style.display = 'grid';
  const persona = DATA.porComercial.find(p => p.vendedor === nombre);
  document.getElementById('com-kpi-facturacion').textContent = fmt(persona.facturacionClientesNuevos);
  document.getElementById('com-kpi-clientes').textContent = persona.clientesNuevos;
  document.getElementById('com-kpi-ganadas').textContent = persona.embudo.GANADA;

  const noNuevas = persona.ganadasNoNuevas || [];
  const notaEl = document.getElementById('com-kpi-clientes-note');
  if (noNuevas.length > 0) {
    const nombres = noNuevas.map(g => g.cliente || g.oportunidad).join(', ');
    notaEl.textContent = `${noNuevas.length} ganada(s) ya facturaban antes, no cuentan para el bono: ${nombres}`;
  } else {
    notaEl.textContent = 'Todas las ganadas son de clientes nuevos.';
  }

  renderFunnel('embudo-comercial', persona.embudo);
}

/* ---------------- PROGRESO AL BONO ---------------- */
function renderProgresoBono() {
  const objetivo = DATA.objetivoBono[0]['Objetivo Mensual'];
  document.getElementById('bono-objetivo-label').textContent = fmt(objetivo) + ' / mes, 2 meses seguidos';

  const desbloqueado = DATA.objetivoBono.some(m => m['¿2 Meses Consecutivos? (Bono Grupal)'] === 'BONO DESBLOQUEADO');
  const banner = document.getElementById('bono-banner');
  if (desbloqueado) {
    banner.textContent = '🎉 Bono grupal DESBLOQUEADO';
    banner.className = 'bono-banner bono-banner--ok';
  } else {
    banner.textContent = 'Bono grupal todavía no desbloqueado';
    banner.className = 'bono-banner';
  }

  const relevantes = DATA.objetivoBono.filter(m => m['Facturación Neta Clientes Nuevos'] > 0).slice(0, 6);
  const ruta = document.getElementById('ruta-meses');
  ruta.innerHTML = '';
  relevantes.forEach(m => {
    const pct = Math.min(100, (m['Facturación Neta Clientes Nuevos'] / objetivo) * 100);
    const cumple = m['¿Cumple Objetivo?'] === 'SI';
    const stop = document.createElement('div');
    stop.className = 'ruta-stop';
    stop.innerHTML = `
      <div class="ruta-mes">${m['Mes']}</div>
      <div class="ruta-track">
        <div class="ruta-fill ${cumple ? 'ruta-fill--ok' : ''}" style="width:${pct}%"></div>
        <div class="ruta-truck" style="left:${pct}%">🚚</div>
      </div>
      <div class="ruta-monto">${fmt(m['Facturación Neta Clientes Nuevos'])} <span class="ruta-pct">(${pct.toFixed(0)}%)</span></div>`;
    ruta.appendChild(stop);
  });

  const tbody = document.getElementById('comisiones-tbody');
  tbody.innerHTML = '';
  DATA.comisiones.forEach(row => {
    const tr = document.createElement('tr');
    if (row.Vendedor === 'TOTAL') tr.className = 'fila-total';
    tr.innerHTML = `
      <td>${row.Vendedor}</td>
      <td>${fmt(row['Facturación Neta Clientes Nuevos (acum.)'])}</td>
      <td>${fmt(row['Bono Bruto (10%)'])}</td>
      <td>${fmt(row['Bono Final (ajustado por tope)'])}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------------- NAV ---------------- */
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.view).classList.add('active');
  });
});

cargarDatos();
setInterval(cargarDatos, 5 * 60 * 1000);
