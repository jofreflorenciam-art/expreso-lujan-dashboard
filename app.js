const API_URL = "https://script.google.com/macros/s/AKfycbxDWo1sJI7Sq36gkigBYAcCeKx4faT4YrsnI77x8NB70rOPPItZu5K2-edWW9ukwRhY/exec";

const MONEY = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const fmt = (n) => '$' + MONEY.format(Math.round(n || 0));
const fmtCorto = (n) => {
  n = n || 0;
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return fmt(n);
};

const ETAPAS_LABEL = { NUEVO: "Nuevo", "COTIZACION ENVIADA": "Cotización enviada", NEGOCIACION: "Negociación", GANADA: "Ganada", PERDIDA: "Perdida" };
const COLORES_COMERCIAL = ['#CA151E', '#1C1B1A', '#8A8580', '#981017', '#4A4744'];

let DATA = null;
let MES_ACTUAL = null;

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
  try { fn(); } catch (err) { console.error('Error renderizando ' + nombre + ':', err); }
}

/* ---------------- COMPONENTES VISUALES ---------------- */

function renderBarras(containerId, entries, opciones) {
  opciones = opciones || {};
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  if (!entries || entries.length === 0) {
    wrap.innerHTML = `<p class="empty-msg">${opciones.vacioMsg || 'No hay datos para mostrar.'}</p>`;
    return;
  }
  const max = Math.max(...entries.map(e => e.value), 1);
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'simple-bar-row';
    const rank = opciones.ranking ? `<span class="simple-bar-rank">${i + 1}</span>` : '';
    row.innerHTML = `
      <span class="simple-bar-label" title="${e.label}">${rank}${e.label}</span>
      <div class="simple-bar-track"><div class="simple-bar-fill" style="width:${(e.value / max) * 100}%; background:${e.color || 'var(--red)'}"></div></div>
      <span class="simple-bar-value">${opciones.formatValue ? opciones.formatValue(e.value) : e.value}</span>`;
    wrap.appendChild(row);
  });
}

/** Embudo real + tasas de conversión entre etapas */
/**
 * Cuadro de arrastre: oportunidades creadas ANTES del mes elegido que todavía
 * no se cerraron (ni ganadas ni perdidas), agrupadas por la etapa en la que están.
 * Sirve para ver el trabajo pendiente que se hereda de meses previos.
 */
function renderArrastre(containerId, filas, mes) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';

  const ABIERTAS = ['NUEVO', 'COTIZACION ENVIADA', 'NEGOCIACION'];
  const previas = filas.filter(f =>
    f.mesCreado && f.mesCreado < mes && ABIERTAS.includes(f.etapa)
  );

  if (previas.length === 0) {
    wrap.innerHTML = '<p class="empty-msg">No hay oportunidades abiertas de meses anteriores.</p>';
    return;
  }

  const total = document.createElement('div');
  total.className = 'arrastre-total';
  total.innerHTML = `<div class="valor">${previas.length}</div><div class="label">oportunidades abiertas que vienen de antes</div>`;
  wrap.appendChild(total);

  const lista = document.createElement('div');
  lista.className = 'arrastre-lista';
  ABIERTAS.forEach(etapa => {
    const n = previas.filter(f => f.etapa === etapa).length;
    if (n === 0) return;
    const fila = document.createElement('div');
    fila.className = 'arrastre-row';
    fila.innerHTML = `
      <span class="arrastre-etapa">${ETAPAS_LABEL[etapa]}</span>
      <div class="arrastre-track"><div class="arrastre-fill" style="width:${(n / previas.length) * 100}%"></div></div>
      <span class="arrastre-valor">${n}</span>`;
    lista.appendChild(fila);
  });
  wrap.appendChild(lista);

  // De qué meses vienen
  const porMes = {};
  previas.forEach(f => { porMes[f.mesCreado] = (porMes[f.mesCreado] || 0) + 1; });
  const detalle = document.createElement('div');
  detalle.className = 'embudo-pie';
  detalle.innerHTML = '<strong>Origen:</strong> ' +
    Object.keys(porMes).sort().map(m => `${m} (${porMes[m]})`).join(' · ');
  wrap.appendChild(detalle);

  const nota = document.createElement('div');
  nota.className = 'panel-nota';
  nota.innerHTML = '<strong>Nota:</strong> No se cuentan en el embudo de este mes. ' +
    'Al cerrarse impactan en el embudo de su mes de creación, y si se ganan, ' +
    'su facturación se computa en el mes de la factura, no en el de origen.';
  wrap.appendChild(nota);
}

/**
 * Embudo de COHORTE: sigue el recorrido de las oportunidades creadas en el período,
 * no una foto de dónde está cada una hoy.
 *
 * Regla de negocio (definida con Florencia): las únicas que NO recibieron cotización
 * son las que siguen en etapa "Nuevo". Todas las demás — cotizadas, en negociación,
 * ganadas y perdidas — pasaron por cotización antes.
 */
function renderFunnel(containerId, embudo) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';

  const nuevo    = embudo.NUEVO || 0;
  const enviada  = embudo['COTIZACION ENVIADA'] || 0;
  const negoc    = embudo.NEGOCIACION || 0;
  const ganadas  = embudo.GANADA || 0;
  const perdidas = embudo.PERDIDA || 0;

  const creadas   = nuevo + enviada + negoc + ganadas + perdidas;
  const cotizadas = creadas - nuevo;   // todas menos las que nunca se contactaron
  const definidas = ganadas + perdidas;

  const etapas = [
    { valor: creadas,   label: 'Creadas',   color: '#1C1B1A' },
    { valor: cotizadas, label: 'Cotizadas', color: '#4A4744' },
    { valor: ganadas,   label: 'Ganadas',   color: '#CA151E' },
  ];

  const layout = document.createElement('div');
  layout.className = 'embudo-layout';

  const max = Math.max(creadas, 1);
  const W = 340, STAGE_H = 68, MIN_W = 54;
  const H = STAGE_H * etapas.length;
  const widthFor = (v) => Math.max(MIN_W, (v / max) * W);

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:360px;display:block" xmlns="http://www.w3.org/2000/svg">`;
  etapas.forEach((et, i) => {
    const wTop = widthFor(et.valor);
    const wBottom = i < etapas.length - 1 ? widthFor(etapas[i + 1].valor) : wTop * 0.88;
    const y = i * STAGE_H;
    const xTopL = (W - wTop) / 2, xTopR = (W + wTop) / 2;
    const xBotL = (W - wBottom) / 2, xBotR = (W + wBottom) / 2;
    svg += `<polygon points="${xTopL},${y} ${xTopR},${y} ${xBotR},${y + STAGE_H - 5} ${xBotL},${y + STAGE_H - 5}" fill="${et.color}" />`;
    svg += `<text x="${W / 2}" y="${y + STAGE_H / 2 - 4}" text-anchor="middle" fill="#fff" font-family="Raleway,sans-serif" font-weight="900" font-size="18">${et.valor}</text>`;
    svg += `<text x="${W / 2}" y="${y + STAGE_H / 2 + 14}" text-anchor="middle" fill="#fff" font-family="Raleway,sans-serif" font-weight="600" font-size="10" opacity="0.8" letter-spacing="0.5">${et.label.toUpperCase()}</text>`;
  });
  svg += `</svg>`;

  const svgHolder = document.createElement('div');
  svgHolder.innerHTML = svg;
  layout.appendChild(svgHolder);

  const side = document.createElement('div');
  side.className = 'embudo-side';

  const pct = (parte, base) => base > 0 ? Math.round((parte / base) * 100) + '%' : '—';
  [
    { valor: pct(cotizadas, creadas), label: 'De lo creado, se cotizó' },
    { valor: pct(ganadas, cotizadas), label: 'De lo cotizado, se ganó' },
    { valor: pct(ganadas, definidas), label: 'Tasa de cierre (ya definidas)' },
  ].forEach(c => {
    const item = document.createElement('div');
    item.className = 'conv-item';
    item.innerHTML = `<div class="conv-pct">${c.valor}</div><div class="conv-label">${c.label}</div>`;
    side.appendChild(item);
  });

  const p = document.createElement('div');
  p.className = 'embudo-perdidas';
  p.innerHTML = `<div class="valor">${perdidas}</div><div class="label">Perdidas</div>`;
  side.appendChild(p);

  layout.appendChild(side);
  wrap.appendChild(layout);

  // Detalle de en qué punto quedaron las que siguen abiertas
  const abiertas = nuevo + enviada + negoc;
  const pie = document.createElement('div');
  pie.className = 'embudo-pie';
  pie.innerHTML = abiertas > 0
    ? `<strong>${abiertas} siguen abiertas:</strong> ${nuevo} sin contactar · ${enviada} esperando respuesta · ${negoc} en negociación`
    : 'No quedan oportunidades abiertas de este período.';
  wrap.appendChild(pie);

  const nota = document.createElement('div');
  nota.className = 'panel-nota';
  nota.innerHTML = '<strong>Nota:</strong> Incluye únicamente oportunidades creadas en este mes, ' +
    'se hayan cerrado o no. Los porcentajes se recalculan a medida que las abiertas se definen, ' +
    'así que los meses recientes son menos representativos.';
  wrap.appendChild(nota);
}

/** Donut de participación */
function renderDonut(containerId, legendId, entries) {
  const wrap = document.getElementById(containerId);
  const legend = document.getElementById(legendId);
  wrap.innerHTML = ''; legend.innerHTML = '';
  const total = entries.reduce((a, e) => a + e.value, 0);
  if (total <= 0) {
    wrap.innerHTML = '<p class="empty-msg">Sin facturación cargada.</p>';
    return;
  }
  const R = 70, STROKE = 26, C = 2 * Math.PI * R, SIZE = 190;
  let offset = 0;
  let svg = `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="100%" style="max-width:190px;display:block" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<g transform="translate(${SIZE / 2},${SIZE / 2}) rotate(-90)">`;
  entries.forEach((e, i) => {
    const frac = e.value / total;
    const color = COLORES_COMERCIAL[i % COLORES_COMERCIAL.length];
    svg += `<circle r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}"
      stroke-dasharray="${frac * C} ${C}" stroke-dashoffset="${-offset}" />`;
    offset += frac * C;
  });
  svg += `</g>`;
  svg += `<text x="${SIZE / 2}" y="${SIZE / 2 - 4}" text-anchor="middle" font-family="Raleway,sans-serif" font-weight="900" font-size="19">${fmtCorto(total)}</text>`;
  svg += `<text x="${SIZE / 2}" y="${SIZE / 2 + 13}" text-anchor="middle" font-family="Raleway,sans-serif" font-weight="700" font-size="8.5" fill="#8A8580" letter-spacing="0.8">TOTAL EQUIPO</text>`;
  svg += `</svg>`;
  wrap.innerHTML = svg;

  entries.forEach((e, i) => {
    const color = COLORES_COMERCIAL[i % COLORES_COMERCIAL.length];
    const pct = Math.round((e.value / total) * 100);
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${e.label}<br><span class="legend-pct">${pct}% del total</span></span>
      <span class="legend-val">${fmt(e.value)}</span>`;
    legend.appendChild(item);
  });
}

/** Anillo de progreso para el bono */
function renderRing(containerId, pct, textoCentro, subtexto) {
  const wrap = document.getElementById(containerId);
  const R = 78, STROKE = 18, C = 2 * Math.PI * R, SIZE = 200;
  const frac = Math.max(0, Math.min(1, pct / 100));
  const color = frac >= 1 ? '#CA151E' : '#1C1B1A';
  let svg = `<svg viewBox="0 0 ${SIZE} ${SIZE}" width="100%" style="max-width:200px;display:block" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<g transform="translate(${SIZE / 2},${SIZE / 2}) rotate(-90)">`;
  svg += `<circle r="${R}" fill="none" stroke="#F7F6F4" stroke-width="${STROKE}" />`;
  svg += `<circle r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round"
    stroke-dasharray="${frac * C} ${C}" />`;
  svg += `</g>`;
  svg += `<text x="${SIZE / 2}" y="${SIZE / 2 - 2}" text-anchor="middle" font-family="Raleway,sans-serif" font-weight="900" font-size="30">${textoCentro}</text>`;
  svg += `<text x="${SIZE / 2}" y="${SIZE / 2 + 18}" text-anchor="middle" font-family="Raleway,sans-serif" font-weight="700" font-size="9" fill="#8A8580" letter-spacing="0.6">${subtexto}</text>`;
  svg += `</svg>`;
  wrap.innerHTML = svg;
}

/**
 * Dos barras por mes: cantidad de oportunidades creadas ese mes (mismo criterio que el
 * Embudo) y facturación de clientes nuevos por mes de factura. Cada barra se escala
 * contra el máximo de SU propia serie, porque mezclar cantidad (unidades) y facturación
 * ($) en la misma escala deja una de las dos ilegible.
 */
function renderMesesDoble(containerId, mesesUnion, cantidadPorMes, facturacionPorMes, mesActivo) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  if (mesesUnion.length === 0) {
    cont.innerHTML = '<p class="empty-msg">Todavía no hay datos cargados.</p>';
    return;
  }
  const maxCant = Math.max(1, ...mesesUnion.map(m => cantidadPorMes[m] || 0));
  const maxFact = Math.max(1, ...mesesUnion.map(m => facturacionPorMes[m] || 0));

  cont.innerHTML = mesesUnion.map(m => {
    const cant = cantidadPorMes[m] || 0;
    const fact = facturacionPorMes[m] || 0;
    const pctCant = Math.round((cant / maxCant) * 100);
    const pctFact = Math.round((fact / maxFact) * 100);
    const activo = m === mesActivo;
    return `
      <div class="mesdoble-row">
        <div class="mesdoble-mes${activo ? ' activo' : ''}">${m}${activo ? ' · mes activo' : ''}</div>
        <div class="mesdoble-linea">
          <span class="mesdoble-tag">Cant.</span>
          <div class="mesdoble-track"><div class="mesdoble-fill mesdoble-fill--cant" style="width:${pctCant}%"></div></div>
          <span class="mesdoble-val">${cant}</span>
        </div>
        <div class="mesdoble-linea">
          <span class="mesdoble-tag">Fact.</span>
          <div class="mesdoble-track"><div class="mesdoble-fill mesdoble-fill--fact" style="width:${pctFact}%"></div></div>
          <span class="mesdoble-val">${fmt(fact)}</span>
        </div>
      </div>`;
  }).join('');
}

function pintarDelta(containerId, actual, anterior, etiquetaAnterior) {
  const cont = document.getElementById(containerId);
  cont.innerHTML = '';
  if (anterior === null || anterior === undefined) {
    cont.innerHTML = `<span class="kpi-sub">Sin mes previo para comparar</span>`;
    return;
  }
  if (anterior === 0) {
    cont.innerHTML = `<span class="kpi-sub">${etiquetaAnterior}: —</span>`;
    return;
  }
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  const clase = pct > 0 ? 'kpi-delta--up' : (pct < 0 ? 'kpi-delta--down' : 'kpi-delta--flat');
  const flecha = pct > 0 ? '▲' : (pct < 0 ? '▼' : '=');
  cont.innerHTML = `<span class="kpi-delta ${clase}">${flecha} ${Math.abs(pct)}%</span><span class="kpi-sub">vs ${etiquetaAnterior}</span>`;
}

/* ---------------- VENTAS GENERAL ----------------
 * Todo se filtra por el mes elegido:
 * - Embudo / ganadas / pendientes: por MES DE CREACIÓN de la oportunidad
 *   (una ganada sin factura todavía no tiene mes de factura, así que
 *   "pendientes" solo puede ser subconjunto de "ganadas" si ambos usan creación).
 * - Facturación / top clientes / etiquetas: por MES DE FACTURA (es plata facturada). */
function renderVentasGeneral() {
  const filas = DATA.filas;
  const meses = [...new Set(filas.flatMap(f => [f.mesCreado, f.mesFactura]).filter(m => m && m !== 'Sin fecha'))].sort();

  const selector = document.getElementById('mes-selector');
  const mesPrevio = MES_ACTUAL;
  selector.innerHTML = meses.map(m => `<option value="${m}">${m}</option>`).join('');
  MES_ACTUAL = meses.includes(mesPrevio) ? mesPrevio : meses[meses.length - 1];
  selector.value = MES_ACTUAL;
  selector.onchange = () => { MES_ACTUAL = selector.value; repintarTodo(); };

  pintarVentasGeneralDelMes(filas, meses);
}

/** El selector de mes es global: al cambiarlo se repintan todas las secciones,
 *  para que nunca queden mostrando períodos distintos entre sí. */
function repintarTodo() {
  const filas = DATA.filas;
  const meses = [...new Set(filas.flatMap(f => [f.mesCreado, f.mesFactura]).filter(m => m && m !== 'Sin fecha'))].sort();
  intentarRenderizar('Ventas General', () => pintarVentasGeneralDelMes(filas, meses));
  intentarRenderizar('Por Comercial', () => {
    const activa = document.querySelector('#comercial-selector .pill.active');
    const nombres = [...new Set(filas.map(f => f.vendedor).filter(Boolean))];
    pintarComercial(activa ? activa.textContent : 'Todos', filas, nombres);
  });
  intentarRenderizar('Progreso al Bono', renderProgresoBono);
}

function pintarVentasGeneralDelMes(filas, meses) {
  const mes = MES_ACTUAL;
  const idx = meses.indexOf(mes);
  const mesAnterior = idx > 0 ? meses[idx - 1] : null;

  // --- Embudo / ganadas / pendientes: mes de CREACIÓN ---
  const delMesCreado = (m) => filas.filter(f => f.mesCreado === m);
  const armarEmbudo = (rows) => {
    const e = { NUEVO: 0, "COTIZACION ENVIADA": 0, NEGOCIACION: 0, GANADA: 0, PERDIDA: 0 };
    rows.forEach(f => { if (e.hasOwnProperty(f.etapa)) e[f.etapa]++; });
    return e;
  };
  const rowsMes = delMesCreado(mes);
  const embudo = armarEmbudo(rowsMes);
  const pendientes = rowsMes.filter(f => f.etapa === 'GANADA' && !f.tieneFactura).length;

  document.getElementById('kpi-ganadas').textContent = embudo.GANADA;
  document.getElementById('kpi-pendientes').textContent = pendientes;
  pintarDelta('kpi-ganadas-foot', embudo.GANADA, mesAnterior ? armarEmbudo(delMesCreado(mesAnterior)).GANADA : null, mesAnterior);
  renderFunnel('embudo-general', embudo);
  renderArrastre('arrastre-general', filas, mes);

  // --- Facturación / top / etiquetas: mes de FACTURA ---
  const facturadasDe = (m) => filas.filter(f => f.califica === 'SI' && f.mesFactura === m);
  const sumar = (rows) => rows.reduce((acc, f) => acc + f.ingresos, 0);
  const rowsFactura = facturadasDe(mes);
  const facturacionTotal = sumar(rowsFactura);

  document.getElementById('kpi-facturacion-label').textContent = `Facturación clientes nuevos · ${mes}`;
  document.getElementById('kpi-facturacion-total').textContent = fmt(facturacionTotal);
  pintarDelta('kpi-facturacion-foot', facturacionTotal, mesAnterior ? sumar(facturadasDe(mesAnterior)) : null, mesAnterior);

  const top10 = [...rowsFactura].sort((a, b) => b.ingresos - a.ingresos).slice(0, 10)
    .map(f => ({ label: f.oportunidad || f.cliente, value: f.ingresos }));
  renderBarras('top-clientes', top10, { formatValue: fmt, ranking: true, vacioMsg: 'No hay facturación de clientes nuevos en este mes.' });

  // Oportunidades y facturación por mes: cantidad por mes de CREACIÓN (mismo criterio
  // y mismo número que el Embudo — todas las etapas, total) + facturación por mes de
  // FACTURA (sin cambios). Se unen ambos listados de meses para no perder ninguno.
  const cantidadPorMes = {};
  filas.forEach(f => {
    if (f.mesCreado && f.mesCreado !== 'Sin fecha') {
      cantidadPorMes[f.mesCreado] = (cantidadPorMes[f.mesCreado] || 0) + 1;
    }
  });
  const facturacionPorMes = {};
  filas.forEach(f => {
    if (f.califica === 'SI' && f.mesFactura && f.mesFactura !== 'Sin fecha') {
      facturacionPorMes[f.mesFactura] = (facturacionPorMes[f.mesFactura] || 0) + f.ingresos;
    }
  });
  const mesesUnion = [...new Set([...Object.keys(cantidadPorMes), ...Object.keys(facturacionPorMes)])].sort();
  renderMesesDoble('meses-doble', mesesUnion, cantidadPorMes, facturacionPorMes, mes);

  // Etiquetas del mes
  const dicc = DATA.diccionarioEtiquetas || {};
  const porCategoria = {};
  rowsFactura.forEach(f => {
    f.etiquetas.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
      const cat = dicc[tag.toLowerCase()] || 'Sin clasificar';
      if (!porCategoria[cat]) porCategoria[cat] = {};
      porCategoria[cat][tag] = (porCategoria[cat][tag] || 0) + f.ingresos;
    });
  });
  window.ETIQUETAS_DEL_MES = porCategoria;
  const tabActiva = document.querySelector('.tag-tab.active');
  renderEtiquetas(porCategoria, tabActiva ? tabActiva.dataset.cat : 'Rubro');
  document.querySelectorAll('.tag-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tag-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEtiquetas(window.ETIQUETAS_DEL_MES, btn.dataset.cat);
    };
  });
}

function renderEtiquetas(porCategoria, categoria) {
  const datos = porCategoria[categoria] || {};
  const entries = Object.entries(datos).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tag, valor]) => ({ label: tag, value: valor }));
  renderBarras('etiquetas-lista', entries, { formatValue: fmt, vacioMsg: 'No hay etiquetas de esta categoría facturadas en este mes.' });
}

/* ---------------- POR COMERCIAL (acumulado) ---------------- */
function renderPorComercial() {
  const filas = DATA.filas;
  const nombres = [...new Set(filas.map(f => f.vendedor).filter(Boolean))];

  const selector = document.getElementById('comercial-selector');
  selector.innerHTML = '';
  ['Todos', ...nombres].forEach((nombre, i) => {
    const btn = document.createElement('button');
    btn.className = 'pill' + (i === 0 ? ' active' : '');
    btn.textContent = nombre;
    btn.onclick = () => {
      document.querySelectorAll('#comercial-selector .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      pintarComercial(nombre, filas, nombres);
    };
    selector.appendChild(btn);
  });
  pintarComercial('Todos', filas, nombres);
}

/**
 * Cuadro de revisión: ganadas marcadas CALIFICA = NO (sin importar el mes — es un backlog
 * a resolver, no una foto de un mes puntual). No suman en ninguna cifra del dashboard hasta
 * que se complete el dato de empresa/monto y se cambie a CALIFICA = SÍ en la Base.
 * Si se pasa "vendedor", se filtra solo a las de ese comercial (vista individual); si se
 * pasa null, se muestran las de todo el equipo (vista Todos).
 * Regla acordada con Florencia: no se borran, solo no se cuentan, y quedan visibles acá
 * para que el comercial correspondiente las revise y dé la devolución que falta.
 */
/**
 * Cuadro de revisión del MES filtrado: ganadas de ESE mes de creación marcadas CALIFICA = NO.
 * No suman en ninguna cifra del dashboard hasta que se complete el dato de empresa/monto y
 * se cambie a CALIFICA = SÍ en la Base. Respeta el selector de mes de arriba — por eso el
 * número puede variar de mes a mes (a diferencia de antes, que siempre mostraba el total
 * acumulado de toda la historia sin importar qué mes estuviera filtrado).
 * Si se pasa "vendedor", se filtra solo a las de ese comercial (vista individual); si se
 * pasa null, se muestran las de todo el equipo (vista Todos).
 */
/** Motivo a mostrar en las tablas de revisión. */
function motivoRevision(f) {
  if (f.califica === 'NO') return f.obs || 'Sin motivo cargado en OBS';
  return 'Todavía sin verificar contra facturación';
}

function renderRevisionNoCalifica(filas, vendedor, mes) {
  const panel = document.getElementById('panel-revision-no-califica');
  if (!panel) return;
  const tbody = document.getElementById('revision-tbody');
  const scroll = document.getElementById('revision-scroll');
  const vacio = document.getElementById('revision-vacio');
  const titulo = document.getElementById('revision-titulo');
  const hint = document.getElementById('revision-hint');

  if (titulo) {
    titulo.textContent = vendedor ? `Pendientes de revisar de ${vendedor}` : 'Pendientes de revisar';
  }
  if (hint) hint.textContent = `ganadas de ${mes} que no computan todavía`;

  const pendientes = filas
    .filter(f => f.etapa === 'GANADA' && f.califica !== 'SI' && f.mesCreado === mes && (!vendedor || f.vendedor === vendedor))
    .sort((a, b) => (a.vendedor || '').localeCompare(b.vendedor || ''));

  if (pendientes.length === 0) {
    scroll.style.display = 'none';
    vacio.style.display = 'block';
    vacio.textContent = vendedor
      ? `${vendedor} no tiene ganadas pendientes de revisar en ${mes}.`
      : `No hay ganadas pendientes de revisar en ${mes}.`;
    return;
  }
  scroll.style.display = '';
  vacio.style.display = 'none';

  tbody.innerHTML = pendientes.map(f => `
    <tr>
      <td>${f.oportunidad || f.cliente}</td>
      <td>${f.vendedor}</td>
      <td>${ETAPAS_LABEL[f.etapa] || f.etapa}</td>
      <td>${motivoRevision(f)}</td>
      <td>${f.mesCreado || '—'}</td>
    </tr>`).join('');
}

/**
 * Abiertas (Nuevo / Cotización enviada / Negociación) de meses ANTERIORES al filtrado, que
 * siguen sin resolverse — hay que retomarlas o mandarlas a Perdida, pero no pueden quedar
 * dando vueltas para siempre sin que nadie las vea. No depende del selector de mes de arriba,
 * para que no se pierdan de vista al cambiar de mes.
 */
const ABIERTAS_ETAPAS = ['NUEVO', 'COTIZACION ENVIADA', 'NEGOCIACION'];
function renderRevisionAnteriores(filas, vendedor, mes) {
  const panel = document.getElementById('panel-revision-anteriores');
  if (!panel) return;
  const tbody = document.getElementById('revision-anteriores-tbody');
  const scroll = document.getElementById('revision-anteriores-scroll');
  const vacio = document.getElementById('revision-anteriores-vacio');
  const titulo = document.getElementById('revision-anteriores-titulo');

  if (titulo) {
    titulo.textContent = vendedor ? `Abiertas de meses anteriores de ${vendedor}` : 'Abiertas de meses anteriores';
  }

  const pendientes = filas
    .filter(f => ABIERTAS_ETAPAS.includes(f.etapa) && f.mesCreado && f.mesCreado < mes && (!vendedor || f.vendedor === vendedor))
    .sort((a, b) => (a.mesCreado || '').localeCompare(b.mesCreado || ''));

  if (pendientes.length === 0) {
    scroll.style.display = 'none';
    vacio.style.display = 'block';
    return;
  }
  scroll.style.display = '';
  vacio.style.display = 'none';

  tbody.innerHTML = pendientes.map(f => `
    <tr>
      <td>${f.oportunidad || f.cliente}</td>
      <td>${f.vendedor}</td>
      <td>${ETAPAS_LABEL[f.etapa] || f.etapa}</td>
      <td>${f.mesCreado}</td>
    </tr>`).join('');
}

function pintarComercial(nombre, filas, nombres) {
  const mes = MES_ACTUAL;
  const esTodos = nombre === 'Todos';
  document.getElementById('comercial-chart-wrap').style.display = esTodos ? 'block' : 'none';
  document.getElementById('comercial-kpis').style.display = esTodos ? 'none' : 'grid';
  document.getElementById('panel-embudo-comercial').style.display = esTodos ? 'none' : 'grid';
  document.getElementById('panel-detalle-comercial').style.display = esTodos ? 'none' : 'grid';

  document.getElementById('comercial-subtitulo').textContent =
    `Desempeño de cada comercial en ${mes}.`;
  const dh = document.getElementById('donut-hint');
  if (dh) dh.textContent = `clientes nuevos facturados en ${mes}`;

  renderRevisionNoCalifica(filas, esTodos ? null : nombre, mes);
  renderRevisionAnteriores(filas, esTodos ? null : nombre, mes);

  // Métricas del mes para un vendedor (o para todos si se pasa null)
  const metricasDe = (v) => {
    const cohorte = filas.filter(f => f.mesCreado === mes && (v === null || f.vendedor === v));

    // "Ganadas" que se muestran en la tabla: por MES DE FACTURA (cuando se confirma la
    // venta de verdad), no por mes de creación. Una ganada sin factura cargada (mesFactura
    // vacío) no cae en ningún mes hasta que se complete el dato — no desaparece del sistema,
    // queda listada en el cuadro "Pendientes de revisar" al final de esta vista.
    const ganadasDelMes = filas.filter(f => f.etapa === 'GANADA' && f.mesFactura === mes && (v === null || f.vendedor === v));
    // La facturación de clientes nuevos ya se calculaba por mes de factura + CALIFICA=SI (sin cambios).
    const facturado = filas.filter(f => f.califica === 'SI' && f.mesFactura === mes && (v === null || f.vendedor === v));

    const cont = (etapa) => cohorte.filter(f => f.etapa === etapa).length;
    const creadas = cohorte.length;
    const nuevas = cont('NUEVO');
    const perdidas = cont('PERDIDA');
    // La tasa de cierre necesita comparar cosas de la MISMA base temporal (si no, vuelve a
    // pasar lo de los porcentajes sin sentido): se calcula con las ganadas de ESTE cohorte,
    // no con las ganadas por factura que se muestran en la columna.
    const ganadasCohorte = cont('GANADA');
    return {
      creadas,
      cotizadas: creadas - nuevas,
      ganadas: ganadasDelMes.length,
      perdidas,
      abiertas: nuevas + cont('COTIZACION ENVIADA') + cont('NEGOCIACION'),
      cierre: (ganadasCohorte + perdidas) > 0 ? Math.round((ganadasCohorte / (ganadasCohorte + perdidas)) * 100) : null,
      facturacion: facturado.reduce((a, f) => a + f.ingresos, 0),
    };
  };

  if (esTodos) {
    // Dona de participación en la facturación DEL MES
    const entries = nombres
      .map(v => ({ label: v, value: metricasDe(v).facturacion }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length) {
      renderDonut('donut-comerciales', 'donut-legend', entries);
    } else {
      document.getElementById('donut-comerciales').innerHTML =
        '<p class="empty-msg">No hay facturación de clientes nuevos en este mes.</p>';
      document.getElementById('donut-legend').innerHTML = '';
    }

    // Tabla comparativa del mes
    const tbody = document.getElementById('comparativa-tbody');
    tbody.innerHTML = '';
    nombres
      .map(v => ({ nombre: v, m: metricasDe(v) }))
      .sort((a, b) => b.m.facturacion - a.m.facturacion)
      .forEach(({ nombre: v, m }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="td-nombre">${v}</td>
          <td class="num">${m.creadas}</td>
          <td class="num">${m.cotizadas}</td>
          <td class="num td-ganadas">${m.ganadas}</td>
          <td class="num">${m.perdidas}</td>
          <td class="num">${m.abiertas}</td>
          <td class="num">${m.cierre === null ? '—' : m.cierre + '%'}</td>
          <td class="num td-facturacion">${fmt(m.facturacion)}</td>`;
        tbody.appendChild(tr);
      });

    const t = metricasDe(null);
    renderRing('comparativa-ring', t.cierre === null ? 0 : t.cierre, t.cierre === null ? '—' : t.cierre + '%', 'CIERRE DEL EQUIPO');
    document.getElementById('comparativa-tfoot').innerHTML = `
      <tr>
        <td class="td-nombre">TOTAL EQUIPO</td>
        <td class="num">${t.creadas}</td>
        <td class="num">${t.cotizadas}</td>
        <td class="num">${t.ganadas}</td>
        <td class="num">${t.perdidas}</td>
        <td class="num">${t.abiertas}</td>
        <td class="num">${t.cierre === null ? '—' : t.cierre + '%'}</td>
        <td class="num">${fmt(t.facturacion)}</td>
      </tr>`;

    return;
  }

  // --- Vista individual ---
  const m = metricasDe(nombre);
  const cohorte = filas.filter(f => f.mesCreado === mes && f.vendedor === nombre);
  const embudo = { NUEVO: 0, "COTIZACION ENVIADA": 0, NEGOCIACION: 0, GANADA: 0, PERDIDA: 0 };
  cohorte.forEach(f => {
    if (embudo.hasOwnProperty(f.etapa)) embudo[f.etapa]++;
  });

  document.getElementById('com-kpi-facturacion').textContent = fmt(m.facturacion);
  document.getElementById('com-kpi-ganadas').textContent = m.ganadas;

  const totalEquipo = metricasDe(null).facturacion;
  const share = totalEquipo > 0 ? Math.round((m.facturacion / totalEquipo) * 100) : 0;
  document.getElementById('com-kpi-facturacion-foot').innerHTML =
    `<span class="kpi-delta kpi-delta--flat">${share}%</span><span class="kpi-sub">del equipo en ${mes}</span>`;

  renderFunnel('embudo-comercial', embudo);
  renderArrastre('arrastre-comercial', filas.filter(f => f.vendedor === nombre), mes);

  // Tablas de detalle: lo mismo que cuenta el embudo del mes (cohorte), pero fila por fila.
  renderTablaOportunidades('tabla-ganadas-mes', cohorte.filter(f => f.etapa === 'GANADA'),
    { mostrarMonto: true, vacioMsg: 'No tiene ganadas creadas este mes.' });
  renderTablaOportunidades('tabla-cotizacion-mes', cohorte.filter(f => f.etapa === 'COTIZACION ENVIADA'),
    { mostrarMonto: false, vacioMsg: 'No tiene oportunidades en cotización este mes.' });
  renderTablaOportunidades('tabla-negociacion-mes', cohorte.filter(f => f.etapa === 'NEGOCIACION'),
    { mostrarMonto: false, vacioMsg: 'No tiene oportunidades en negociación este mes.' });
}

/**
 * Tabla de detalle genérica para las oportunidades de un comercial: Oportunidad + Cliente,
 * y opcionalmente Mes de creación, Etapa y Monto según qué tabla sea.
 */
function renderTablaOportunidades(containerId, rows, opciones = {}) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  if (rows.length === 0) {
    cont.innerHTML = `<p class="empty-msg">${opciones.vacioMsg || 'No hay oportunidades en esta categoría.'}</p>`;
    return;
  }
  const mostrarMes = !!opciones.mostrarMes;
  const mostrarEtapa = !!opciones.mostrarEtapa;
  const mostrarMonto = opciones.mostrarMonto !== false;

  let head = '<th>Oportunidad</th><th>Cliente</th>';
  if (mostrarMes) head += '<th>Mes creación</th>';
  if (mostrarEtapa) head += '<th>Etapa</th>';
  if (mostrarMonto) head += '<th class="num">Monto</th>';

  const cuerpo = rows.map(f => {
    let tds = `<td class="td-nombre">${f.oportunidad || '—'}</td><td>${f.cliente || '—'}</td>`;
    if (mostrarMes) tds += `<td>${f.mesCreado || '—'}</td>`;
    if (mostrarEtapa) tds += `<td>${ETAPAS_LABEL[f.etapa] || f.etapa}</td>`;
    if (mostrarMonto) tds += `<td class="num">${f.ingresos > 0 ? fmt(f.ingresos) : '—'}</td>`;
    return `<tr>${tds}</tr>`;
  }).join('');

  cont.innerHTML = `<table class="tabla-comparativa"><thead><tr>${head}</tr></thead><tbody>${cuerpo}</tbody></table>`;
}

/* ---------------- PROGRESO AL BONO ---------------- */
function renderProgresoBono() {
  const objetivo = DATA.objetivoBono[0]['Objetivo Mensual'];
  document.getElementById('bono-objetivo-label').textContent =
    `Se necesita alcanzar ${fmt(objetivo)} de facturación de clientes nuevos durante 2 meses consecutivos. El bono se paga una sola vez.`;

  const conDatos = DATA.objetivoBono.filter(m => m['Facturación Neta Clientes Nuevos'] > 0);
  const desbloqueado = DATA.objetivoBono.some(m => m['¿2 Meses Consecutivos? (Bono Grupal)'] === 'BONO DESBLOQUEADO');

  // Anillo: mejor mes alcanzado respecto al objetivo
  const mejor = conDatos.reduce((max, m) => Math.max(max, m['Facturación Neta Clientes Nuevos']), 0);
  const pctMejor = objetivo > 0 ? (mejor / objetivo) * 100 : 0;
  renderRing('bono-ring', pctMejor, Math.round(pctMejor) + '%', 'MEJOR MES vs OBJETIVO');

  const banner = document.getElementById('bono-banner');
  const explica = document.getElementById('bono-explica');
  const mesesCumplidos = conDatos.filter(m => m['¿Cumple Objetivo?'] === 'SI').length;

  if (desbloqueado) {
    banner.textContent = 'Bono grupal DESBLOQUEADO';
    banner.className = 'bono-banner bono-banner--ok';
    explica.innerHTML = `Se alcanzó el objetivo <strong>2 meses consecutivos</strong>. El detalle por comercial está en la tabla de abajo.`;
  } else {
    banner.textContent = 'Bono todavía no desbloqueado';
    banner.className = 'bono-banner';
    const faltante = Math.max(0, objetivo - mejor);
    explica.innerHTML = mesesCumplidos === 0
      ? `Ningún mes alcanzó el objetivo todavía. Al mejor mes le faltaron <strong>${fmt(faltante)}</strong> para llegar a la meta.`
      : `Hay <strong>${mesesCumplidos} mes(es)</strong> que cumplieron el objetivo, pero todavía no se dieron <strong>2 meses consecutivos</strong>.`;
  }

  const ruta = document.getElementById('ruta-meses');
  ruta.innerHTML = '';
  if (conDatos.length === 0) {
    ruta.innerHTML = '<p class="empty-msg">Todavía no hay facturación cargada.</p>';
  }
  conDatos.slice(0, 6).forEach(m => {
    const valor = m['Facturación Neta Clientes Nuevos'];
    const pct = Math.min(100, (valor / objetivo) * 100);
    const cumple = m['¿Cumple Objetivo?'] === 'SI';
    const stop = document.createElement('div');
    stop.className = 'ruta-stop';
    stop.innerHTML = `
      <div class="ruta-top">
        <span class="ruta-mes">${m['Mes']}</span>
        <span>
          <span class="ruta-monto">${fmt(valor)}</span>
          <span class="ruta-pct">de ${fmt(objetivo)} · ${pct.toFixed(0)}%</span>
          <span class="ruta-badge ${cumple ? 'ruta-badge--ok' : ''}">${cumple ? 'Cumplido' : 'No cumplido'}</span>
        </span>
      </div>
      <div class="ruta-track">
        <div class="ruta-fill ${cumple ? 'ruta-fill--ok' : ''}" style="width:${pct}%"></div>
        <div class="ruta-truck" style="left:${pct}%">🚚</div>
      </div>`;
    ruta.appendChild(stop);
  });

  // Deja explícito de qué meses sale la base del bono (la racha vigente).
  // Se busca la columna de forma tolerante, por si el encabezado tiene un typo.
  const claveCuenta = DATA.objetivoBono.length
    ? Object.keys(DATA.objetivoBono[0]).find(k => k.toLowerCase().replace(/[^a-z]/g, '').startsWith('cuentaparaelb'))
    : null;
  const mesesQueCuentan = claveCuenta
    ? DATA.objetivoBono
        .filter(m => String(m[claveCuenta] || '').toUpperCase().trim() === 'SI')
        .map(m => m['Mes'])
    : [];
  const hint = document.getElementById('comisiones-hint');
  if (hint) {
    hint.textContent = mesesQueCuentan.length
      ? `base: ${mesesQueCuentan.join(' + ')} · la racha se resetea si un mes no llega`
      : 'bono único · la base se resetea si un mes no llega';
  }

  const tbody = document.getElementById('comisiones-tbody');
  tbody.innerHTML = '';

  // Las columnas se ubican por cómo EMPIEZA el encabezado, no por el texto exacto.
  // Así, si mañana se le cambia el final al título en el Sheet, el dashboard no se rompe.
  const colFacturacion = buscarColumna(DATA.comisiones, 'facturacionnetaclientesnuevos');
  const colBonoBruto   = buscarColumna(DATA.comisiones, 'bonobruto');
  const colBonoFinal   = buscarColumna(DATA.comisiones, 'bonofinal');

  DATA.comisiones.forEach(row => {
    const tr = document.createElement('tr');
    if (row.Vendedor === 'TOTAL') tr.className = 'fila-total';
    const bonoFinal = colBonoFinal ? row[colBonoFinal] : 0;
    tr.innerHTML = `
      <td>${row.Vendedor}</td>
      <td>${fmt(colFacturacion ? row[colFacturacion] : 0)}</td>
      <td>${fmt(colBonoBruto ? row[colBonoBruto] : 0)}</td>
      <td class="${bonoFinal > 0 ? 'td-destacado' : ''}">${fmt(bonoFinal)}</td>`;
    tbody.appendChild(tr);
  });
}

/** Busca el nombre real de una columna a partir de cómo empieza su encabezado,
 *  ignorando mayúsculas, tildes, espacios y signos. */
function buscarColumna(filas, prefijoNormalizado) {
  if (!filas || !filas.length) return null;
  return Object.keys(filas[0]).find(k =>
    k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
     .toLowerCase().replace(/[^a-z0-9]/g, '')
     .startsWith(prefijoNormalizado)
  ) || null;
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

/**
 * Lleva de una tarjeta KPI a su tabla/panel de detalle correspondiente: cambia de pestaña
 * si hace falta, fuerza "Todos" en Por Comercial si hace falta, y hace scroll suave hasta
 * el elemento. El pequeño delay es para darle tiempo a la vista a pintarse antes de scrollear.
 */
function irADetalle(elementoId, opciones = {}) {
  if (opciones.vista) {
    const tab = document.querySelector(`.nav-tab[data-view="${opciones.vista}"]`);
    if (tab && !tab.classList.contains('active')) tab.click();
  }
  if (opciones.comercialTodos) {
    const pillTodos = document.querySelector('#comercial-selector .pill');
    if (pillTodos && !pillTodos.classList.contains('active')) pillTodos.click();
  }
  setTimeout(() => {
    const el = document.getElementById(elementoId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

document.getElementById('kpi-card-pendientes')?.addEventListener('click', () =>
  irADetalle('panel-revision-no-califica', { vista: 'view-comercial', comercialTodos: true }));
document.getElementById('kpi-card-ganadas')?.addEventListener('click', () =>
  irADetalle('embudo-general', { }));
document.getElementById('kpi-card-facturacion')?.addEventListener('click', () =>
  irADetalle('top-clientes', { }));
document.getElementById('com-kpi-card-ganadas')?.addEventListener('click', () =>
  irADetalle('tabla-ganadas-mes', { }));


/* ============================================================
   EXPORTACIÓN A PDF
   Usa la impresión nativa del navegador (destino "Guardar como PDF").
   No depende de ninguna librería externa, así que ningún bloqueador
   de anuncios puede romperla.
   ============================================================ */

const TITULOS_VISTA = {
  'view-ventas': 'Ventas General',
  'view-comercial': 'Por Comercial',
  'view-bono': 'Progreso al Bono',
};

function vistaActiva() {
  const v = document.querySelector('.view.active');
  return v ? v.id : 'view-ventas';
}

function comercialActivo() {
  const pill = document.querySelector('#comercial-selector .pill.active');
  return pill ? pill.textContent : null;
}

/** Arma el encabezado que aparece en el PDF: logo, título, filtros y fecha */
function prepararEncabezadoPdf(completo) {
  const logo = document.querySelector('.logo-img');
  const printLogo = document.querySelector('.print-logo');
  if (logo && printLogo) printLogo.src = logo.src;

  document.getElementById('print-fecha').textContent =
    'Generado el ' + new Date().toLocaleString('es-AR');

  document.getElementById('print-title').textContent =
    completo ? 'Reporte de Ventas · Informe completo' : TITULOS_VISTA[vistaActiva()];

  // Filtros aplicados, para que quien reciba el PDF sepa qué está mirando
  const filtros = [];
  if (completo || vistaActiva() === 'view-ventas') {
    filtros.push('Mes: ' + (MES_ACTUAL || '—'));
  }
  if (completo || vistaActiva() === 'view-comercial') {
    const com = comercialActivo();
    filtros.push('Comercial: ' + (com && com !== 'Todos' ? com : 'Todos'));
  }
  document.getElementById('print-filtros').innerHTML =
    filtros.map(f => `<span>${f}</span>`).join('');
}

/** Arma la tabla de detalle de oportunidades que va al final del PDF */
function prepararDetallePdf(completo) {
  if (!DATA || !DATA.filas) return;

  const vista = vistaActiva();
  const com = comercialActivo();
  let filas = DATA.filas.slice();
  let descripcion;

  if (!completo && vista === 'view-comercial' && com && com !== 'Todos') {
    // Detalle del comercial elegido (acumulado, igual que la vista)
    filas = filas.filter(f => f.vendedor === com);
    descripcion = `Oportunidades de ${com}, acumulado desde el lanzamiento del programa.`;
  } else if (!completo && vista === 'view-bono') {
    // Sólo lo que suma al bono
    filas = filas.filter(f => f.califica === 'SI');
    descripcion = 'Oportunidades de clientes nuevos que computan para el bono, acumulado desde el lanzamiento.';
  } else if (!completo && vista === 'view-ventas') {
    // Lo del mes elegido, con el mismo criterio que la pantalla
    filas = filas.filter(f => f.mesCreado === MES_ACTUAL || (f.califica === 'SI' && f.mesFactura === MES_ACTUAL));
    descripcion = `Oportunidades creadas o facturadas en ${MES_ACTUAL}.`;
  } else {
    descripcion = 'Todas las oportunidades cargadas, acumulado desde el lanzamiento del programa.';
  }

  // Primero las que facturaron (de mayor a menor), después el resto
  filas.sort((a, b) => b.ingresos - a.ingresos);

  const tbody = document.getElementById('detalle-tbody');
  tbody.innerHTML = '';
  filas.forEach((f, i) => {
    const tr = document.createElement('tr');
    if (f.califica === 'SI') tr.className = 'es-nuevo';

    // Tres estados: califica, no califica, o todavía sin verificar
    let califica, claseCal, motivo;
    if (f.califica === 'SI') {
      califica = 'Sí'; claseCal = 'cal-si';
      motivo = f.obs || '';
    } else if (f.califica === 'NO') {
      califica = 'No'; claseCal = 'cal-no';
      motivo = f.obs || 'Sin motivo cargado en OBS';
    } else {
      califica = 'Pendiente'; claseCal = 'cal-pend';
      if (f.obs) {
        motivo = f.obs;
      } else if (f.etapa === 'GANADA') {
        motivo = 'Ganada, falta verificar contra facturación';
      } else if (f.etapa === 'PERDIDA') {
        motivo = 'Oportunidad perdida, no aplica';
      } else {
        motivo = 'Todavía en ' + (ETAPAS_LABEL[f.etapa] || f.etapa).toLowerCase() + ', sin facturar';
      }
    }

    tr.innerHTML = `
      <td class="col-num">${i + 1}</td>
      <td>${f.oportunidad || f.cliente}</td>
      <td>${f.vendedor}</td>
      <td>${ETAPAS_LABEL[f.etapa] || f.etapa}</td>
      <td class="${claseCal}">${califica}</td>
      <td class="num">${f.ingresos > 0 ? fmt(f.ingresos) : '—'}</td>
      <td class="col-obs">${motivo}</td>`;
    tbody.appendChild(tr);
  });

  const total = filas.reduce((acc, f) => acc + f.ingresos, 0);
  const califican = filas.filter(f => f.califica === 'SI').length;
  const noCalifican = filas.filter(f => f.califica === 'NO').length;
  const pendientes = filas.length - califican - noCalifican;
  document.getElementById('detalle-tfoot').innerHTML = `
    <tr>
      <td colspan="5">Total: ${filas.length} oportunidades · ${califican} califican · ${noCalifican} no califican · ${pendientes} pendientes de verificar</td>
      <td class="num">${fmt(total)}</td>
      <td></td>
    </tr>`;

  document.getElementById('detalle-nota').textContent =
    descripcion + ' "Califica" significa que se verificó contra facturación y cumple el criterio de cliente nuevo (sin factura emitida en los 6 meses previos). Las filas con línea roja a la izquierda son las que computan para el bono.';
}

function descargarPdf(completo) {
  prepararEncabezadoPdf(completo);
  prepararDetallePdf(completo);
  document.body.classList.toggle('print-all', !!completo);
  window.print();
}

// Al cerrar el diálogo de impresión, se vuelve a dejar la pantalla como estaba
window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-all');
});

document.getElementById('btn-pdf-vista').addEventListener('click', () => descargarPdf(false));
document.getElementById('btn-pdf-todo').addEventListener('click', () => descargarPdf(true));


cargarDatos();
setInterval(cargarDatos, 5 * 60 * 1000);
