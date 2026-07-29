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
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'No se pudo cargar la información. Reintentando...';
    statusEl.classList.add('status-error');
    setTimeout(cargarDatos, 8000);
    return;
  }
  // Cada sección se renderiza de forma independiente: si una falla (por ejemplo,
  // un bloqueador de anuncios que impide cargar Chart.js), las demás igual se muestran.
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

function chartDisponible() {
  return typeof Chart !== 'undefined';
}

function mostrarAvisoSinGrafico(canvasId, mensaje) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const aviso = document.createElement('p');
  aviso.className = 'empty-msg';
  aviso.textContent = mensaje;
  canvas.replaceWith(aviso);
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
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

function actualizarKpiFacturacionMes(vg, mes) {
  document.getElementById('kpi-facturacion-label').textContent = `Facturación clientes nuevos — ${mes}`;
  document.getElementById('kpi-facturacion-total').textContent = fmt(vg.facturacionPorMes[mes] || 0);
}

/* ---------------- VENTAS GENERAL ---------------- */
function renderVentasGeneral() {
  const vg = DATA.ventasGeneral;

  document.getElementById('kpi-ganadas').textContent = vg.embudo.GANADA;
  document.getElementById('kpi-pendientes').textContent = vg.gananadasPendientesDeConfirmar;

  // Selector de mes: reemplaza el KPI acumulado (poco útil) por facturación del mes elegido
  const meses = Object.keys(vg.facturacionPorMes).sort();
  const selector = document.getElementById('mes-selector');
  const mesPrevio = selector.value;
  selector.innerHTML = meses.map(m => `<option value="${m}">${m}</option>`).join('');
  const mesElegido = meses.includes(mesPrevio) ? mesPrevio : meses[meses.length - 1];
  selector.value = mesElegido;
  selector.onchange = () => actualizarKpiFacturacionMes(vg, selector.value);
  actualizarKpiFacturacionMes(vg, mesElegido);

  // Embudo (forma real de embudo)
  renderFunnel('embudo-general', vg.embudo);

  // Facturación por mes
  if (chartDisponible()) {
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
  } else {
    mostrarAvisoSinGrafico('chart-facturacion-mes', 'No se pudo cargar el gráfico (puede estar bloqueado por una extensión del navegador). Datos: ' + meses.map(m => `${m}: ${fmt(vg.facturacionPorMes[m])}`).join(' · '));
  }

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
    const canvasHolder = document.getElementById('comercial-chart-wrap');
    canvasHolder.style.display = 'block';
    document.getElementById('comercial-kpis').style.display = 'none';
    if (chartDisponible()) {
      destroyChart('comparativa');
      const canvasEl = document.getElementById('chart-comparativa');
      if (canvasEl) {
        charts.comparativa = new Chart(canvasEl, {
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
      }
    } else {
      mostrarAvisoSinGrafico('chart-comparativa', 'No se pudo cargar el gráfico. Datos: ' + DATA.porComercial.map(p => `${p.vendedor}: ${fmt(p.facturacionClientesNuevos)}`).join(' · '));
    }
    return;
  }
  document.getElementById('comercial-chart-wrap').style.display = 'none';
  document.getElementById('comercial-kpis').style.display = 'grid';
  const persona = DATA.porComercial.find(p => p.vendedor === nombre);
  document.getElementById('com-kpi-facturacion').textContent = fmt(persona.facturacionClientesNuevos);
  document.getElementById('com-kpi-clientes').textContent = persona.clientesNuevos;
  document.getElementById('com-kpi-ganadas').textContent = persona.embudo.GANADA;

  renderFunnel('embudo-comercial', persona.embudo);
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
