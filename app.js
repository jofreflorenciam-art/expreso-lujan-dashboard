const API_URL = "https://script.google.com/macros/s/AKfycbxDWo1sJI7Sq36gkigBYAcCeKx4faT4YrsnI77x8NB70rOPPItZu5K2-edWW9ukwRhY/exec";

const MONEY = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fmt = (n) => '$' + MONEY.format(Math.round(n || 0));

const ETAPAS_ORDEN = ["NUEVO", "COTIZACION ENVIADA", "NEGOCIACION", "GANADA", "PERDIDA"];
const ETAPAS_LABEL = { NUEVO: "Nuevo", "COTIZACION ENVIADA": "Cotización enviada", NEGOCIACION: "Negociación", GANADA: "Ganada", PERDIDA: "Perdida" };

let DATA = null;
let charts = {};

async function cargarDatos() {
  const statusEl = document.getElementById('status-carga');
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    statusEl.textContent = 'Actualizado: ' + new Date(DATA.generadoEl).toLocaleString('es-AR');
    statusEl.classList.remove('status-error');
    renderVentasGeneral();
    renderPorComercial();
    renderProgresoBono();
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'No se pudo cargar la información. Reintentando...';
    statusEl.classList.add('status-error');
    setTimeout(cargarDatos, 8000);
  }
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

/* ---------------- VENTAS GENERAL ---------------- */
function renderVentasGeneral() {
  const vg = DATA.ventasGeneral;

  document.getElementById('kpi-facturacion-total').textContent = fmt(vg.facturacionTotal);
  document.getElementById('kpi-ganadas').textContent = vg.embudo.GANADA;
  document.getElementById('kpi-pendientes').textContent = vg.gananadasPendientesDeConfirmar;

  // Embudo
  const embudoWrap = document.getElementById('embudo-general');
  embudoWrap.innerHTML = '';
  const maxEmbudo = Math.max(...ETAPAS_ORDEN.map(e => vg.embudo[e] || 0), 1);
  ETAPAS_ORDEN.forEach(etapa => {
    const val = vg.embudo[etapa] || 0;
    const row = document.createElement('div');
    row.className = 'embudo-row etapa-' + etapa.replace(/\s+/g, '-').toLowerCase();
    row.innerHTML = `
      <span class="embudo-label">${ETAPAS_LABEL[etapa]}</span>
      <div class="embudo-bar-track"><div class="embudo-bar-fill" style="width:${(val / maxEmbudo) * 100}%"></div></div>
      <span class="embudo-value">${val}</span>`;
    embudoWrap.appendChild(row);
  });

  // Facturación por mes
  const meses = Object.keys(vg.facturacionPorMes).sort();
  destroyChart('facturacionMes');
  charts.facturacionMes = new Chart(document.getElementById('chart-facturacion-mes'), {
    type: 'bar',
    data: {
      labels: meses,
      datasets: [{
        label: 'Facturación clientes nuevos',
        data: meses.map(m => vg.facturacionPorMes[m]),
        backgroundColor: '#CA151E',
        borderRadius: 4,
        maxBarThickness: 56,
      }]
    },
    options: chartBaseOptions((v) => fmt(v))
  });

  // Etiquetas por categoría
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
  const wrap = document.getElementById('etiquetas-lista');
  wrap.innerHTML = '';
  const datos = etiquetasPorCategoria[categoria] || {};
  const entries = Object.entries(datos).sort((a, b) => b[1].facturacion - a[1].facturacion).slice(0, 8);
  if (entries.length === 0) {
    wrap.innerHTML = '<p class="empty-msg">Todavía no hay etiquetas cargadas en esta categoría.</p>';
    return;
  }
  const max = Math.max(...entries.map(e => e[1].facturacion), 1);
  entries.forEach(([tag, info]) => {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `
      <span class="tag-name">${tag}</span>
      <div class="tag-bar-track"><div class="tag-bar-fill" style="width:${(info.facturacion / max) * 100}%"></div></div>
      <span class="tag-value">${fmt(info.facturacion)}</span>`;
    wrap.appendChild(row);
  });
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
  const cont = document.getElementById('comercial-detalle');
  if (nombre === 'Todos') {
    destroyChart('comparativa');
    const canvasHolder = document.getElementById('comercial-chart-wrap');
    canvasHolder.style.display = 'block';
    document.getElementById('comercial-kpis').style.display = 'none';
    charts.comparativa = new Chart(document.getElementById('chart-comparativa'), {
      type: 'bar',
      data: {
        labels: DATA.porComercial.map(p => p.vendedor),
        datasets: [{
          label: 'Facturación clientes nuevos',
          data: DATA.porComercial.map(p => p.facturacionClientesNuevos),
          backgroundColor: ['#CA151E', '#1C1B1A', '#8A8580'],
          borderRadius: 4,
          maxBarThickness: 70,
        }]
      },
      options: chartBaseOptions((v) => fmt(v))
    });
    return;
  }
  document.getElementById('comercial-chart-wrap').style.display = 'none';
  document.getElementById('comercial-kpis').style.display = 'grid';
  const persona = DATA.porComercial.find(p => p.vendedor === nombre);
  document.getElementById('com-kpi-facturacion').textContent = fmt(persona.facturacionClientesNuevos);
  document.getElementById('com-kpi-clientes').textContent = persona.clientesNuevos;
  document.getElementById('com-kpi-ganadas').textContent = persona.embudo.GANADA;

  const embudoWrap = document.getElementById('embudo-comercial');
  embudoWrap.innerHTML = '';
  const maxEmbudo = Math.max(...ETAPAS_ORDEN.map(e => persona.embudo[e] || 0), 1);
  ETAPAS_ORDEN.forEach(etapa => {
    const val = persona.embudo[etapa] || 0;
    const row = document.createElement('div');
    row.className = 'embudo-row etapa-' + etapa.replace(/\s+/g, '-').toLowerCase();
    row.innerHTML = `
      <span class="embudo-label">${ETAPAS_LABEL[etapa]}</span>
      <div class="embudo-bar-track"><div class="embudo-bar-fill" style="width:${(val / maxEmbudo) * 100}%"></div></div>
      <span class="embudo-value">${val}</span>`;
    embudoWrap.appendChild(row);
  });
}

/* ---------------- PROGRESO AL BONO ---------------- */
function renderProgresoBono() {
  const meses = DATA.objetivoBono.filter(m => m['Facturación Neta Clientes Nuevos'] > 0 || m['Mes'] <= mesActualAprox());
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

  // Ruta: mostramos los últimos 6 meses con datos (o hasta el mes actual)
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

  // Tabla comisiones
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

function mesActualAprox() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function chartBaseOptions(tooltipFmt) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => tooltipFmt(ctx.parsed.y ?? ctx.parsed.x) } }
    },
    scales: {
      y: { ticks: { callback: (v) => tooltipFmt(v) }, grid: { color: '#EDEBE7' } },
      x: { grid: { display: false } }
    }
  };
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
setInterval(cargarDatos, 5 * 60 * 1000); // refresco automático cada 5 minutos
