import { Chart } from 'chart.js/auto';
import { showToast } from '../shared/presentation/notifications/index';
import { db } from '../config/firebase.js';
import { doc, setDoc } from 'firebase/firestore';
import { currentUid } from '../features/auth/application/auth-service';
import { mergeLegacyCustomers } from '../features/customers/application/merge-legacy-customers';
import { clientsHydrated, motoHydrated } from '../shared/application/panel-hydration';
import { createFirestoreWriter } from '../shared/infrastructure/firestore-writer';
import { applyReceiptDual, createClientDual, updateClientDual, removeClientDual } from '../features/customers/infrastructure/client-writer';
import { createRouteConfirmationOrchestrator } from '../features/rotas/application/route-confirmation-orchestrator';
import { applyRouteFinancialPendings } from '../features/rotas/infrastructure/client-pendings-gateway';

export function bootstrapPanel() {
  // ---------- estado local do aplicativo ----------
  const APP_NOW = new Date();
  // A chave v2 inicia uma base limpa e mantém a versão antiga recuperável no navegador.
  const LOCAL_STATE_KEY = 'motoboy-front-etapa1-v2-clean';
  let localStorageAvailable = true;

  function readLocalState(){
    try{
      const saved = localStorage.getItem(LOCAL_STATE_KEY);
      return saved ? JSON.parse(saved) : {};
    }catch(error){
      localStorageAvailable = false;
      return {};
    }
  }

  const localState = readLocalState();

  function pad2(value){ return value < 10 ? '0' + value : String(value); }
  function toISODateLocal(date){
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
  }
  function daysAgoISO(days){
    const date = new Date(APP_NOW);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return toISODateLocal(date);
  }
  // ---------- data escolhida pelo motoboy (ponto 8) ----------
  // Todos os registros passam a aceitar uma data. Se o motoboy não mexer, fica "hoje".
  // Internamente as datas são "AAAA-MM-DD" (dateISO). A apresentação usa o campo
  // segmentado dia/mês/ano; a conversão fica em setBrDateValue/readBrDateISO.
  // Data de hoje no fuso LOCAL do dispositivo (nunca UTC), calculada na hora.
  function localTodayISO(){
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Transforma um dateISO num rótulo curto e humano: "Hoje", "Ontem" ou "12/06/2026".
  function dateLabelFromISO(iso){
    if(!iso) return 'Hoje';
    const hoje = toISODateLocal(APP_NOW);
    const ontem = daysAgoISO(1);
    if(iso === hoje) return 'Hoje';
    if(iso === ontem) return 'Ontem';
    const d = localDateFromISO(iso);
    if(!d) return 'Hoje';
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
  }


  // ---------- Etapa 1C: campo de data segmentado (dia / mês / ano) ----------
  // Conversões puras, sem Date e sem timezone.
  function formatISODateToBR(iso){
    if(typeof iso !== 'string') return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if(!m) return '';
    return m[3] + '/' + m[2] + '/' + m[1];
  }
  function isLeapYear(y){ return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0); }
  // Converte dd/mm/aaaa -> aaaa-mm-dd validando data real (mês, dia, bissexto).
  // Retorna '' se estiver incompleta ou inválida (ex.: 31/02).
  function brToISO(br){
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || '').trim());
    if(!m) return '';
    const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
    if(month < 1 || month > 12) return '';
    const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if(day < 1 || day > daysInMonth) return '';
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  // Os três inputs (dia/mês/ano) dentro do contorno único (wrap com id do campo).
  function dateSegs(wrap){
    return {
      day: wrap.querySelector('[data-seg="day"]'),
      month: wrap.querySelector('[data-seg="month"]'),
      year: wrap.querySelector('[data-seg="year"]')
    };
  }
  // Escrita: um ISO (aaaa-mm-dd) preenche os três segmentos; vazio limpa.
  function setBrDateValue(wrap, isoValue){
    if(!wrap) return;
    const s = dateSegs(wrap);
    if(!s.day || !s.month || !s.year) return;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoValue || ''));
    if(m){ s.day.value = m[3]; s.month.value = m[2]; s.year.value = m[1]; }
    else { s.day.value = ''; s.month.value = ''; s.year.value = ''; }
    clearDateError(wrap);
  }
  // Leitura: junta os três segmentos em aaaa-mm-dd validado ('' se incompleto/inválido).
  function readBrDateISO(wrap){
    if(!wrap) return '';
    const s = dateSegs(wrap);
    if(!s.day || !s.month || !s.year) return '';
    const d = s.day.value, mo = s.month.value, y = s.year.value;
    if(!d || !mo || y.length !== 4) return ''; // incompleto
    return brToISO(d.padStart(2, '0') + '/' + mo.padStart(2, '0') + '/' + y);
  }
  // Erro inline abaixo do campo (sem alert). Marca aria-invalid no componente.
  function showDateError(wrap, msg, focusYear){
    if(!wrap) return;
    const err = document.getElementById(wrap.id + '-error');
    if(err) err.textContent = msg;
    wrap.setAttribute('aria-invalid', 'true');
    if(focusYear){ const y = dateSegs(wrap).year; if(y) y.focus(); }
  }
  function clearDateError(wrap){
    if(!wrap) return;
    const err = document.getElementById(wrap.id + '-error');
    if(err) err.textContent = '';
    wrap.removeAttribute('aria-invalid');
  }
  function initDateSegments(wrap){
    const s = dateSegs(wrap);
    const order = [s.day, s.month, s.year];
    order.forEach(function(input, idx){
      if(!input) return;
      const max = input === s.year ? 4 : 2;
      input.addEventListener('input', function(){
        input.value = input.value.replace(/\D/g, '').slice(0, max); // só dígitos, tamanho fixo
        clearDateError(wrap); // limpa erro/aria-invalid ao editar
        if(input.value.length >= max && idx < order.length - 1){ // avança ao completar
          const next = order[idx + 1];
          if(next){ next.focus(); try { next.select(); } catch(e){} }
        }
      });
      input.addEventListener('keydown', function(e){
        // backspace em segmento vazio volta ao anterior
        if(e.key === 'Backspace' && input.value === '' && idx > 0){
          e.preventDefault();
          const prev = order[idx - 1];
          if(prev){ prev.focus(); try { prev.setSelectionRange(prev.value.length, prev.value.length); } catch(err){} }
        }
      });
      input.addEventListener('blur', function(){
        // normaliza dia/mês de 1 dígito para 2 (quando preenchido)
        if(input !== s.year && input.value.length === 1){ input.value = input.value.padStart(2, '0'); }
      });
      input.addEventListener('paste', function(e){
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const digits = String(text || '').replace(/\D/g, '');
        if(digits.length >= 3){ // data completa/parcial colada: distribui nos três segmentos
          e.preventDefault();
          s.day.value = digits.slice(0, 2);
          s.month.value = digits.slice(2, 4);
          s.year.value = digits.slice(4, 8);
          (s.year.value.length === 4 ? s.year : s.month).focus();
        }
      });
    });
  }
  function initBrDateFields(){
    ['refuelDate', 'maintDate', 'entradaDate', 'recebimentoDate'].forEach(function(id){
      const wrap = document.getElementById(id);
      if(wrap) initDateSegments(wrap);
    });
  }

  function safeText(value){
    const text = value === null || value === undefined ? '' : String(value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  let refuels = Array.isArray(localState.refuels) ? localState.refuels : [];

  const fuelIcon = `<svg class="icon" viewBox="0 0 24 24"><path d="M4 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15"/><path d="M4 11h8"/><path d="M14 8h2.5L19 11v6a1.5 1.5 0 0 1-3 0v-2a1 1 0 0 0-1-1h-1"/><path d="M2 21h14"/></svg>`;
  const wrenchIcon = `<svg class="icon" viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2-2Z"/></svg>`;
  const cashIcon = `<svg class="icon" viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M12 3v18"/></svg>`;
  const routeIcon = `<svg class="icon" viewBox="0 0 24 24"><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M6 16.8V13a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4"/></svg>`;
  const clientIcon = `<svg class="icon" viewBox="0 0 24 24" style="width:18px;height:18px;"><circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`;
  const washIcon = `<svg class="icon" viewBox="0 0 24 24"><path d="M12 3s5 5.7 5 10a5 5 0 0 1-10 0c0-4.3 5-10 5-10Z"/><path d="M9.5 14.5c.6 1 1.4 1.5 2.5 1.5"/></svg>`;
  const tollIcon = `<svg class="icon" viewBox="0 0 24 24"><path d="M5 21 9 3M15 3l4 18"/><path d="M12 6v3M12 12v3M12 18v3"/></svg>`;
  const parkingIcon = `<svg class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>`;
  const editIcon = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/></svg>`;
  const trashIcon = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>`;

  function round2(v){ return Math.round((v || 0) * 100) / 100; }

  // ---------- rastro de alterações (RD-013) ----------
  // Sempre que um valor histórico é editado, guardamos o que mudou, quando e (se houver)
  // o motivo. Assim o fechamento do mês nunca muda "no escuro": dá pra ver que um registro
  // foi alterado e do que pra quê. O rastro fica dentro do próprio registro, em editLog.
  function nowStamp(){
    const d = new Date();
    return {
      iso: d.toISOString(),
      label: d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    };
  }

  // Compara os campos que importam entre o registro antigo e o novo e devolve uma
  // lista legível de mudanças, ex: "valor: R$ 25,00 → R$ 52,00".
  function diffCampos(previous, atual, campos){
    const mudancas = [];
    campos.forEach(({ chave, rotulo, tipo }) => {
      const antes = previous ? previous[chave] : undefined;
      const depois = atual[chave];
      const norm = v => tipo === 'money' ? round2(v || 0) : (v ?? '');
      if(norm(antes) !== norm(depois)){
        const fmt = v => tipo === 'money' ? fmtBRL(v || 0) : (v || '—');
        mudancas.push(`${rotulo}: ${fmt(antes)} → ${fmt(depois)}`);
      }
    });
    return mudancas;
  }

  // Anexa uma entrada de rastro ao registro editado. Recebe o registro anterior (pra saber
  // o estado de origem), o novo, a lista de campos a comparar e um motivo opcional.
  function registrarEdicao(record, previous, campos, motivo){
    const mudancas = diffCampos(previous, record, campos);
    if(mudancas.length === 0 && !motivo) return; // nada mudou de fato
    const stamp = nowStamp();
    record.editLog = (previous && Array.isArray(previous.editLog)) ? previous.editLog.slice() : [];
    record.editLog.push({
      quando: stamp.label,
      quandoISO: stamp.iso,
      mudancas,
      motivo: (motivo || '').trim() || null
    });
  }

  // Monta o trechinho de HTML que mostra "editado" num registro que tem rastro.
  function editBadgeHTML(record){
    if(!record || !Array.isArray(record.editLog) || record.editLog.length === 0) return '';
    const ultima = record.editLog[record.editLog.length - 1];
    const n = record.editLog.length;
    const titulo = safeText(`Editado ${n}x. Última: ${ultima.quando}. ${ultima.mudancas.join('; ')}${ultima.motivo ? ' — motivo: ' + ultima.motivo : ''}`);
    return `<span class="edit-badge" title="${titulo}">editado</span>`;
  }

  function fmtBRL(v){ return 'R$ ' + round2(v).toFixed(2).replace('.', ','); }
  function parseNum(v){
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function parseBrazilianInput(value){
    let normalized = String(value || '').trim().replace(/\s/g, '').replace(/R\$/gi, '');
    if(!normalized) return null;
    normalized = normalized.replace(/[^0-9,.-]/g, '');
    if(normalized.includes(',')){
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    }else if(/^\-?\d{1,3}(\.\d{3})+$/.test(normalized)){
      normalized = normalized.replace(/\./g, '');
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  function editableNumber(value, digits){
    if(value === null || value === undefined || !Number.isFinite(Number(value))) return '';
    return Number(value).toFixed(digits).replace('.', ',');
  }
  function recordActionsHTML(kind, index, label){
    const safeLabel = safeText(label);
    return `<div class="record-actions">
      <button type="button" class="record-action-btn edit" data-record-action="edit" data-record-kind="${kind}" data-index="${index}" aria-label="Editar ${safeLabel}">${editIcon}</button>
      <button type="button" class="record-action-btn delete" data-record-action="delete" data-record-kind="${kind}" data-index="${index}" aria-label="Excluir ${safeLabel}">${trashIcon}</button>
    </div>`;
  }
  function wireRecordActions(container, onEdit, onDelete){
    container.querySelectorAll('[data-record-action]').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        if(button.dataset.recordAction === 'edit') onEdit(index);
        if(button.dataset.recordAction === 'delete') onDelete(index);
      });
    });
  }

  function updateStorageStatus(){
    const status = document.getElementById('billingStorageStatus');
    if(!status) return;
    status.textContent = localStorageAvailable
      ? 'O novo mês começa em zero e o histórico fica salvo neste dispositivo.'
      : 'O navegador bloqueou o armazenamento local. Os dados durarão somente enquanto esta página estiver aberta.';
  }

  const motoWriter = createFirestoreWriter(
    (uid) => ['users', uid, 'moto', 'data'],
    { gate: motoHydrated, onError(err){ showToast('Erro ao sincronizar dados da moto no servidor.', {kind:'error'}); } },
  );
  function saveMotoToFirestore(){
    if(!motoHydrated.isOpen) return;
    motoWriter.schedule({
      currentKm: motoKm,
      consumption: CONSUMO_ATUAL,
      consumptionIsManual: consumoManualDefinido
    });
  }

  function saveLocalState(){
    try{
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify({
        refuels,
        maintenances,
        entradas,
        confirmedRoutes,
        clientes,
        motoKm,
        consumoManualDefinido,
        manualConsumption: consumoManualDefinido ? CONSUMO_ATUAL : null
      }));
      localStorageAvailable = true;
    }catch(error){
      localStorageAvailable = false;
    }
    updateStorageStatus();
  }

  // ---------- sincronização explícita com Firestore ----------
  // Só é chamada após mutações reais do usuário, nunca dentro de saveLocalState().
  function syncMotoToFirestore(){
    if(!motoHydrated.isOpen) return;
    saveMotoToFirestore();
  }

  // ---------- hidratação individual ----------
  // Chamado por main.ts quando os dados remotos chegam (sucesso ou falha).
  function hydrateMoto(data){
    if(motoHydrated.isOpen) return;
    if(data && typeof data === 'object'){
      if(Number(data.currentKm) > motoKm){
        motoKm = Number(data.currentKm);
        const el = document.getElementById('motoKmValue');
        if(el) el.textContent = fmtKm(motoKm);
      }
      if(typeof data.consumption === 'number' && data.consumption > 0){
        CONSUMO_ATUAL = data.consumption;
      }
      if(typeof data.consumptionIsManual === 'boolean'){
        consumoManualDefinido = data.consumptionIsManual;
      }
    }
    saveLocalState();
  }
  function hydrateClientes(remoteClientes){
    if(clientsHydrated.isOpen) return;
    if(Array.isArray(remoteClientes)){
      clientes = remoteClientes;
      clientes.forEach(syncClientBalance);
    }
    saveLocalState();
  }

  // ---------- bloqueio de interação antecipada ----------
  // Enquanto a feature não está hidratada, ações que ALTERAM seus dados ficam
  // bloqueadas — o cache local continua visível em leitura. Nunca marcamos como
  // hidratado só para liberar a interface, nem sincronizamos dados antigos como
  // fallback. Em falha, o próprio ato de tentar dispara um novo retry.
  function notifySyncing(feature){
    showToast('Sincronizando dados. Aguarde ou tente novamente.', { kind: 'warning' });
    if(typeof window.__isFeatureFailed === 'function' && window.__isFeatureFailed(feature)
       && typeof window.__retryLoadFeature === 'function'){
      window.__retryLoadFeature(feature);
    }
  }
  // true quando a ação pode prosseguir; false (e avisa) quando ainda sincronizando.
  function ensureClientesInteractive(){
    if(clientsHydrated.isOpen) return true;
    notifySyncing('clientes');
    return false;
  }
  function ensureMotoInteractive(){
    if(motoHydrated.isOpen) return true;
    notifySyncing('moto');
    return false;
  }

  // Expõe para main.ts orquestrar a hidratação.
  window.__hydrateMoto = hydrateMoto;
  window.__hydrateClientes = hydrateClientes;
  window.__isHydrated = function(){
    return motoHydrated.isOpen && clientsHydrated.isOpen;
  };

  function renderRefuelList(el, items, withActions){
    if(items.length === 0){
      el.innerHTML = '<div class="trip-empty">Nenhum abastecimento registrado.</div>';
      return;
    }
    el.innerHTML = items.map(r => {
      const refuelIndex = refuels.indexOf(r);
      return `
      <div class="list-item">
        <div class="badge">${fuelIcon}</div>
        <div class="info">
          <div class="title">${safeText(r.local)} ${editBadgeHTML(r)}</div>
          <div class="sub">${safeText(r.quando)} · ${safeText(r.litros)}</div>
        </div>
        <div class="record-side">
          <div class="amount">${fmtBRL(r.valor)}</div>
          ${withActions ? recordActionsHTML('refuel', refuelIndex, 'abastecimento em ' + r.local) : ''}
        </div>
      </div>
    `}).join('');
    if(withActions) wireRecordActions(el, editRefuel, deleteRefuel);
  }
  function refuelTotal(){ return refuels.reduce((s, r) => s + r.valor, 0); }
  function latestRefuelPrice(){
    const latest = refuels.find(item => item.litrosValue > 0 && item.valor > 0);
    return latest ? (latest.pricePerLiter || latest.valor / latest.litrosValue) : null;
  }
  function localDateFromISO(iso){
    const parts = String(iso || '').split('-').map(Number);
    if(parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }
  function startOfWeek(date){
    const result = new Date(date);
    result.setHours(12, 0, 0, 0);
    const daysSinceMonday = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - daysSinceMonday);
    return result;
  }
  function weeklyRefuelCounts(){
    const currentWeekStart = startOfWeek(APP_NOW);
    const firstWeekStart = new Date(currentWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - 21);
    const periodEnd = new Date(currentWeekStart);
    periodEnd.setDate(periodEnd.getDate() + 7);
    const counts = [0, 0, 0, 0];

    refuels.forEach(item => {
      const date = localDateFromISO(item.dateISO);
      if(!date || date < firstWeekStart || date >= periodEnd) return;
      const elapsedDays = Math.floor((date - firstWeekStart) / 86400000);
      const bucket = Math.min(3, Math.floor(elapsedDays / 7));
      counts[bucket] += 1;
    });
    return counts;
  }
  function renderWeeklyRefuelChart(){
    const chart = document.getElementById('weeklyRefuelChart');
    if(!chart) return;
    const counts = weeklyRefuelCounts();
    const labels = ['3 sem. atrás', '2 sem. atrás', 'Semana passada', 'Esta semana'];
    const spokenLabels = ['três semanas atrás', 'duas semanas atrás', 'semana passada', 'esta semana'];
    const maxCount = Math.max.apply(null, counts.concat([1]));
    const total = counts.reduce((sum, value) => sum + value, 0);

    chart.innerHTML = counts.map((count, index) => {
      const width = count === 0 ? 0 : Math.max(12, Math.round((count / maxCount) * 100));
      return `<div class="weekly-refuel-row${index === 3 ? ' current' : ''}">
        <div class="weekly-refuel-period">${labels[index]}</div>
        <div class="weekly-refuel-bar-track"><div class="weekly-refuel-bar-fill" style="width:${width}%"></div></div>
        <div class="weekly-refuel-count">${count}</div>
      </div>`;
    }).join('');

    document.getElementById('weeklyRefuelTotal').textContent = total + (total === 1 ? ' visita' : ' visitas');
    const weeklyDifference = counts[3] - counts[2];
    document.getElementById('weeklyRefuelTrend').textContent = weeklyDifference === 0
      ? 'Mesma frequência'
      : (weeklyDifference > 0 ? '+' : '') + weeklyDifference + ' vs semana passada';
    chart.setAttribute('aria-label', 'Visitas ao posto: ' + counts.map((count, index) =>
      spokenLabels[index] + ', ' + count + (count === 1 ? ' visita' : ' visitas')
    ).join('; ') + '.');
  }
  function normalizedStationName(name){
    let normalized = String(name || '').toLowerCase().trim();
    if(typeof normalized.normalize === 'function'){
      normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return normalized
      .replace(/\bposto\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function refuelPricePerLiter(item){
    if(item.pricePerLiter && item.pricePerLiter > 0) return item.pricePerLiter;
    return item.litrosValue > 0 && item.valor > 0 ? item.valor / item.litrosValue : null;
  }
  function stationUpdateLabel(date){
    const today = new Date(APP_NOW);
    today.setHours(12, 0, 0, 0);
    const diff = Math.max(0, Math.round((today - date) / 86400000));
    if(diff === 0) return 'hoje';
    if(diff === 1) return 'ontem';
    return 'há ' + diff + ' dias';
  }
  function recentStationPrices(){
    const cutoff = new Date(APP_NOW);
    cutoff.setHours(12, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 13);
    const latestByStation = {};

    refuels.forEach(item => {
      const name = String(item.local || '').trim();
      const key = normalizedStationName(name);
      const date = localDateFromISO(item.dateISO);
      const price = refuelPricePerLiter(item);
      if(!key || /nao informado/.test(key) || !date || date < cutoff || !price || price <= 0) return;
      if(!latestByStation[key] || date > latestByStation[key].date){
        latestByStation[key] = { name, date, price };
      }
    });

    return Object.keys(latestByStation)
      .map(key => latestByStation[key])
      .sort((a, b) => a.price - b.price || b.date - a.date);
  }
  // ---------- Etapa 2C: combobox de posto (substitui o datalist nativo) ----------
  // Fonte dos nomes: refuels[].local (dedupe case-insensitive; ignora vazio/"não
  // informado"). Segurança: opções criadas com createElement + textContent — nunca
  // innerHTML com nomes de postos. Nenhuma API é exposta em window.
  let stationNames = [];
  let stationFiltered = [];
  let stationComboOpen = false;
  let stationActiveIndex = -1;
  let stationComboInstalled = false;
  function refreshStationNames(){
    const seen = {};
    const names = [];
    refuels.forEach(item => {
      const key = normalizedStationName(item.local);
      if(!key || seen[key] || /nao informado/.test(key)) return;
      seen[key] = true;
      names.push(item.local);
    });
    stationNames = names;
  }
  function stationEls(){
    return {
      combo: document.getElementById('refuelStationCombo'),
      input: document.getElementById('refuelLocation'),
      arrow: document.getElementById('refuelStationArrow'),
      list: document.getElementById('refuelStationList')
    };
  }
  function renderStationList(){
    const { input, list } = stationEls();
    if(!input || !list) return;
    const termo = normalizedStationName(input.value);
    stationFiltered = stationNames.filter(name => !termo || normalizedStationName(name).indexOf(termo) !== -1);
    list.textContent = ''; // limpa filhos sem innerHTML
    if(stationFiltered.length === 0){
      const li = document.createElement('li');
      li.className = 'combo-empty';
      li.setAttribute('aria-disabled', 'true');
      li.textContent = 'Nenhum posto salvo. Digite para cadastrar.';
      list.appendChild(li);
      stationActiveIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    stationFiltered.forEach((name, i) => {
      const li = document.createElement('li');
      li.className = 'combo-option' + (i === stationActiveIndex ? ' active' : '');
      li.id = 'refuelStationOption-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === stationActiveIndex ? 'true' : 'false');
      li.textContent = name; // seguro: nome inserido como texto
      list.appendChild(li);
    });
    if(stationActiveIndex >= 0 && stationActiveIndex < stationFiltered.length){
      input.setAttribute('aria-activedescendant', 'refuelStationOption-' + stationActiveIndex);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  function openStationList(){
    const { combo, input, list } = stationEls();
    if(!combo || !input || !list) return;
    renderStationList();
    list.hidden = false;
    combo.setAttribute('data-open', 'true');
    input.setAttribute('aria-expanded', 'true');
    stationComboOpen = true;
  }
  function closeStationList(){
    const { combo, input, list } = stationEls();
    stationComboOpen = false;
    stationActiveIndex = -1;
    if(list){ list.hidden = true; list.textContent = ''; }
    if(combo) combo.removeAttribute('data-open');
    if(input){ input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  }
  function setStationActive(index){
    if(stationFiltered.length === 0){ stationActiveIndex = -1; return; }
    const n = stationFiltered.length;
    stationActiveIndex = ((index % n) + n) % n; // navegação circular
    renderStationList();
    const opt = document.getElementById('refuelStationOption-' + stationActiveIndex);
    if(opt && opt.scrollIntoView) opt.scrollIntoView({ block:'nearest' });
  }
  function selectStation(name){
    const { input } = stationEls();
    if(!input) return;
    input.value = name;   // valor final = refuelLocation.value (formato do nome preservado)
    closeStationList();
  }
  // Mantém o nome usado por renderRefuelViews (salvar/editar/excluir/apply remoto).
  function renderStationOptions(){
    refreshStationNames();
    if(stationComboOpen) renderStationList(); // re-filtra se estiver aberta
  }
  function installStationCombobox(){
    if(stationComboInstalled) return; // listeners instalados uma única vez
    const { combo, input, arrow, list } = stationEls();
    if(!combo || !input || !arrow || !list) return;
    stationComboInstalled = true;
    input.addEventListener('focus', function(){ openStationList(); });
    input.addEventListener('input', function(){
      stationActiveIndex = -1;
      if(!stationComboOpen) openStationList(); else renderStationList();
    });
    input.addEventListener('keydown', function(e){
      if(e.key === 'ArrowDown'){ e.preventDefault(); if(!stationComboOpen) openStationList(); setStationActive(stationActiveIndex + 1); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); if(!stationComboOpen) openStationList(); setStationActive(stationActiveIndex - 1); }
      else if(e.key === 'Enter'){
        if(stationComboOpen && stationActiveIndex >= 0 && stationActiveIndex < stationFiltered.length){
          e.preventDefault(); // seleciona sem enviar o formulário
          selectStation(stationFiltered[stationActiveIndex]);
        }
      }
      else if(e.key === 'Escape'){ if(stationComboOpen){ e.preventDefault(); closeStationList(); } }
    });
    // mousedown na lista mantém o foco no input, para o clique/toque na opção registrar.
    list.addEventListener('mousedown', function(e){ if(e.target.closest('.combo-option')) e.preventDefault(); });
    list.addEventListener('click', function(e){
      const li = e.target.closest('.combo-option');
      if(!li) return;
      const idx = Number(li.id.replace('refuelStationOption-', ''));
      if(!Number.isNaN(idx) && stationFiltered[idx] !== undefined) selectStation(stationFiltered[idx]);
    });
    // Seta: alterna a lista sem forçar foco no input (funciona com teclado virtual fechado).
    arrow.addEventListener('mousedown', function(e){ e.preventDefault(); });
    arrow.addEventListener('click', function(){ if(stationComboOpen) closeStationList(); else openStationList(); });
    // Clicar/tocar fora fecha.
    document.addEventListener('mousedown', function(e){ if(stationComboOpen && !combo.contains(e.target)) closeStationList(); });
  }
  function renderCheapestStation(){
    const stations = recentStationPrices();
    const card = document.getElementById('cheapestStationCard');
    const nameEl = document.getElementById('cheapestStationName');
    const dateEl = document.getElementById('cheapestStationDate');
    const priceEl = document.getElementById('cheapestStationPrice');
    const savingEl = document.getElementById('cheapestStationSaving');
    const rankingEl = document.getElementById('stationRanking');
    if(!card || !nameEl || !dateEl || !priceEl || !savingEl || !rankingEl) return;

    if(stations.length === 0){
      nameEl.textContent = 'Ainda não há comparação';
      dateEl.textContent = 'Registre abastecimentos em postos diferentes';
      priceEl.innerHTML = '— <small>/L</small>';
      savingEl.textContent = 'Precisamos de preços recentes de pelo menos dois postos para indicar o mais barato.';
      rankingEl.innerHTML = '';
      card.setAttribute('aria-label', 'Nenhum posto disponível para comparação.');
      return;
    }

    const cheapest = stations[0];
    nameEl.textContent = cheapest.name;
    dateEl.textContent = 'Atualizado ' + stationUpdateLabel(cheapest.date);
    priceEl.innerHTML = fmtBRL(cheapest.price) + ' <small>/L</small>';
    if(stations.length === 1){
      savingEl.textContent = 'Registre outro posto para comparar e descobrir a diferença de preço.';
    }else{
      const difference = stations[1].price - cheapest.price;
      savingEl.textContent = difference > 0
        ? fmtBRL(difference) + ' por litro abaixo do segundo posto mais barato registrado.'
        : 'Mesmo preço do segundo posto mais barato registrado.';
    }

    rankingEl.innerHTML = stations.slice(0, 3).map((station, index) => `
      <div class="station-ranking-row">
        <span class="station-rank">${index + 1}</span>
        <span class="station-ranking-name">${safeText(station.name)}<span class="station-ranking-date">${safeText(stationUpdateLabel(station.date))}</span></span>
        <span class="station-ranking-price">${fmtBRL(station.price)}</span>
      </div>
    `).join('');
    card.setAttribute('aria-label', 'Posto mais barato registrado: ' + cheapest.name + ', ' + fmtBRL(cheapest.price) + ' por litro.');
  }
  function renderRefuelViews(){
    renderRefuelList(document.getElementById('dashRefuelList'), refuels.slice(0,3));
    renderRefuelList(document.getElementById('fullRefuelList'), refuels, true);
    document.getElementById('refuelTotalValue').textContent = fmtBRL(refuelTotal());
    const latestPrice = latestRefuelPrice();
    document.getElementById('refuelLatestPriceValue').textContent = latestPrice ? fmtBRL(latestPrice) : 'Não informado';
    renderStationOptions();
    renderCheapestStation();
    renderWeeklyRefuelChart();
  }
  renderRefuelViews();

  let editingRefuelIndex = null;
  function resetRefuelForm(){
    editingRefuelIndex = null;
    document.getElementById('refuelLocation').value = '';
    document.getElementById('refuelLiterPriceInput').value = '';
    document.getElementById('refuelPaidValue').value = '';
    document.getElementById('refuelOdometer').value = '';
    setBrDateValue(document.getElementById('refuelDate'), localTodayISO());
    document.getElementById('refuelEditReason').value = '';
    document.getElementById('refuelEditReasonField').hidden = true;
    document.getElementById('btnSaveRefuel').textContent = 'Salvar abastecimento';
    document.getElementById('btnCancelRefuelEdit').hidden = true;
    closeStationList(); // 2C: reset não deixa o combobox aberto/inconsistente
    updateCalculatedRefuelLiters();
  }
  // Etapa 2B: no formulário FIXO de abastecimento, a data de hoje só era escrita
  // por resetRefuelForm (cancelar/salvar/excluir). Na primeira carga e ao entrar
  // na aba ela ficava vazia. Este helper preenche HOJE apenas quando os três
  // segmentos estão totalmente vazios e não há edição em andamento — sem tocar em
  // nenhum outro campo e sem sobrescrever data parcialmente digitada.
  function ensureRefuelDateDefault(){
    if(editingRefuelIndex !== null) return;              // em edição: preserva item.dateISO
    const wrap = document.getElementById('refuelDate');
    if(!wrap) return;
    const s = dateSegs(wrap);
    if(!s.day || !s.month || !s.year) return;
    if(s.day.value || s.month.value || s.year.value) return; // já há conteúdo: não mexe
    setBrDateValue(wrap, localTodayISO());                // fuso local, nunca UTC
  }
  function editRefuel(index){
    const item = refuels[index];
    if(!item) return;
    editingRefuelIndex = index;
    document.getElementById('refuelLocation').value = item.local === 'Posto não informado' ? '' : item.local;
    document.getElementById('refuelLiterPriceInput').value = editableNumber(refuelPricePerLiter(item), 2);
    document.getElementById('refuelPaidValue').value = editableNumber(item.valor, 2);
    document.getElementById('refuelOdometer').value = item.odometer ? String(item.odometer) : '';
    setBrDateValue(document.getElementById('refuelDate'), item.dateISO || localTodayISO());
    document.getElementById('refuelEditReason').value = '';
    document.getElementById('refuelEditReasonField').hidden = false;
    document.getElementById('btnSaveRefuel').textContent = 'Atualizar abastecimento';
    document.getElementById('btnCancelRefuelEdit').hidden = false;
    updateCalculatedRefuelLiters();
    document.getElementById('refuelFormCard').scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('refuelLocation').focus();
  }
  function deleteRefuel(index){
    if(!ensureMotoInteractive()) return;
    const item = refuels[index];
    if(!item) return;
    requestDeleteConfirmation(
      'Excluir abastecimento?',
      `${item.local} · ${fmtBRL(item.valor)}. O painel, o preço do litro e os gráficos serão recalculados.`,
      () => {
        const currentIndex = refuels.indexOf(item);
        if(currentIndex < 0) return;
        refuels.splice(currentIndex, 1);
        // Ponte: remove no Firestore.
        if(window.__motoboyAbastecimentos && item.fsId) window.__motoboyAbastecimentos.remove(item.fsId);
        if(editingRefuelIndex === currentIndex) resetRefuelForm();
        else if(editingRefuelIndex !== null && currentIndex < editingRefuelIndex) editingRefuelIndex -= 1;
        PRECO_ATUAL = latestRefuelPrice();
        const prevMotoKm = motoKm;
        const prevConsumo = CONSUMO_ATUAL;
        const prevManual = consumoManualDefinido;
        recalculateMotoKmFromRecords();
        recalcConsumoReal();
        saveLocalState();
        if(motoKm !== prevMotoKm || CONSUMO_ATUAL !== prevConsumo || consumoManualDefinido !== prevManual){
          syncMotoToFirestore();
        }
        renderRefuelViews();
        renderMotoConsumo();
        renderFaturamento();
        renderDashboard();
        renderRouteSummary();
      }
    );
  }
  document.getElementById('btnCancelRefuelEdit').addEventListener('click', resetRefuelForm);

  function updateCalculatedRefuelLiters(){
    const paid = parseBrazilianInput(document.getElementById('refuelPaidValue').value);
    const price = parseBrazilianInput(document.getElementById('refuelLiterPriceInput').value);
    const liters = paid && paid > 0 && price && price > 0 ? paid / price : 0;
    document.getElementById('refuelCalculatedLiters').textContent = liters > 0
      ? liters.toFixed(2).replace('.', ',') + ' L'
      : '0,0 L';
    return { liters, paid, price };
  }
  document.getElementById('refuelLiterPriceInput').addEventListener('input', updateCalculatedRefuelLiters);
  document.getElementById('refuelPaidValue').addEventListener('input', updateCalculatedRefuelLiters);
  document.getElementById('btnSaveRefuel').addEventListener('click', () => {
    if(!ensureMotoInteractive()) return;
    const local = document.getElementById('refuelLocation').value.trim() || 'Posto não informado';
    const { liters, paid, price } = updateCalculatedRefuelLiters();
    if(!price || price <= 0 || !paid || paid <= 0){
      showToast('Informe o preço do litro e o valor total pago.', {kind:'warning'});
      return;
    }
    const odometer = parseBrazilianInput(document.getElementById('refuelOdometer').value);
    const lastOdometer = refuels.find((r, index) => index !== editingRefuelIndex && r.odometer && r.odometer > 0)?.odometer;
    if(editingRefuelIndex === null && odometer && lastOdometer && odometer < lastOdometer){
      showToast(`O km do painel (${fmtKm(odometer)}) está menor que o do último abastecimento (${fmtKm(lastOdometer)}). Confere o número — o hodômetro só aumenta.`, {kind:'warning'});
      return;
    }
    const previous = editingRefuelIndex === null ? null : refuels[editingRefuelIndex];
    const chosenDateEl = document.getElementById('refuelDate');
    const chosenISO = readBrDateISO(chosenDateEl);
    if(!chosenISO){ showDateError(chosenDateEl, 'Informe uma data válida no formato DD/MM/AAAA.'); return; }
    if(chosenISO > localTodayISO()){ showDateError(chosenDateEl, 'A data não pode ser futura.', true); return; }
    clearDateError(chosenDateEl);
    const record = {
      local,
      quando: dateLabelFromISO(chosenISO),
      litros:`${liters.toFixed(1).replace('.', ',')} L`,
      litrosValue:liters,
      valor:paid,
      pricePerLiter:price,
      odometer:odometer || null,
      dateISO: chosenISO,
      fsId: previous ? (previous.fsId || null) : null
    };
    const wasEditing = editingRefuelIndex !== null;
    if(wasEditing){
      registrarEdicao(record, previous, [
        { chave:'local', rotulo:'Posto', tipo:'text' },
        { chave:'valor', rotulo:'Valor', tipo:'money' },
        { chave:'litrosValue', rotulo:'Litros', tipo:'text' },
        { chave:'odometer', rotulo:'Km do painel', tipo:'text' }
      ], document.getElementById('refuelEditReason') ? document.getElementById('refuelEditReason').value : '');
      refuels[editingRefuelIndex] = record;
    }
    else refuels.unshift(record);
    // Ponte: grava no Firestore (por uid). O cache local segue via saveLocalState().
    if(wasEditing){
      if(window.__motoboyAbastecimentos) window.__motoboyAbastecimentos.update(record.fsId, record);
    } else {
      const addPromise = window.__motoboyAbastecimentos && window.__motoboyAbastecimentos.add(record);
      if(addPromise && addPromise.then){
        addPromise.then(function(id){
          if(typeof id !== 'string' || id === '') return;   // id remoto inválido: não persiste fsId
          if(refuels.indexOf(record) === -1) return;         // registro excluído/substituído: não altera
          record.fsId = id;
          saveLocalState();                                  // persiste o cache só depois do fsId
        }).catch(function(){ /* falha remota: mantém o cache local sem fsId */ });
      }
    }
    PRECO_ATUAL = price;
    const prevMotoKm = motoKm;
    const prevConsumo = CONSUMO_ATUAL;
    const prevManual = consumoManualDefinido;
    recalculateMotoKmFromRecords();
    recalcConsumoReal();
    saveLocalState();
    // Sincroniza moto somente se o abastecimento alterou efetivamente o estado.
    if(motoKm !== prevMotoKm || CONSUMO_ATUAL !== prevConsumo || consumoManualDefinido !== prevManual){
      syncMotoToFirestore();
    }
    renderRefuelViews();
    renderMotoConsumo();
    renderFaturamento();
    renderDashboard();
    renderRouteSummary();
    resetRefuelForm();
    showToast(`${wasEditing ? 'Abastecimento atualizado' : 'Abastecimento salvo'}. O preço usado nas rotas agora é ${fmtBRL(price)} por litro.`, {kind:'success'});
  });

  // Ponte: recebe os abastecimentos do Firestore (dono atual) e re-renderiza.
  function abastecimentoEntityToVM(e){
    const liters = Number(e.liters) || 0;
    return {
      fsId: e.id,
      local: e.location || 'Posto não informado',
      quando: dateLabelFromISO(e.dateISO),
      litros: liters.toFixed(1).replace('.', ',') + ' L',
      litrosValue: liters,
      valor: Number(e.paidValue) || 0,
      pricePerLiter: Number(e.pricePerLiter) || 0,
      odometer: e.odometer || null,
      dateISO: e.dateISO
    };
  }
  window.__applyRemoteAbastecimentos = function(entities){
    if(!Array.isArray(entities)) return;
    refuels = entities.map(abastecimentoEntityToVM);
    PRECO_ATUAL = latestRefuelPrice();
    recalculateMotoKmFromRecords();
    recalcConsumoReal();
    saveLocalState();
    renderRefuelViews();
    renderMotoConsumo();
    renderFaturamento();
    renderDashboard();
    renderRouteSummary();
  };

  // ---------- menu / drawer ----------
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('backdrop');
  const menuBtn = document.getElementById('menuBtn');
  const drawerClose = document.getElementById('drawerClose');

  function openDrawer(){
    drawer.classList.add('open');
    backdrop.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    const activeItem = drawer.querySelector('.drawer-item.active');
    if(activeItem) activeItem.focus();
  }
  function closeDrawer(){
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    const activeItem = drawer.querySelector('.drawer-item.active');
    if(activeItem && drawer.contains(document.activeElement)) activeItem.blur();
  }

  menuBtn.addEventListener('click', openDrawer);
  drawerClose.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && drawer.classList.contains('open')){
      closeDrawer();
      menuBtn.focus();
    }
  });

  // ---------- navegação entre telas ----------
  const titles = {
    dashboard: { title:"Painel", sub:"visão geral do mês" },
    faturamento: { title:"Faturamento", sub:"entradas e despesas do mês" },
    abastecimentos: { title:"Abastecimentos", sub:"histórico completo" },
    moto: { title:"Minha Moto", sub:"dados e manutenções" },
    rotas: { title:"Rotas", sub:"organize as coletas e entregas" },
    'historico-rotas': { title:"Histórico de rotas", sub:"rotas confirmadas por mês" },
    clientes: { title:"Clientes", sub:"quem já pagou e quem ficou devendo" },
  };
  function setView(view){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const targetView = document.getElementById('view-' + view);
    if(!targetView || !titles[view]) return;
    targetView.classList.add('active');
    document.querySelectorAll('.drawer-item').forEach(b => {
      if(b.dataset.view === view) b.classList.add('active');
      else b.classList.remove('active');
    });
    document.getElementById('viewTitle').textContent = titles[view].title;
    document.getElementById('viewSub').textContent = titles[view].sub;
    closeDrawer();
    closeStationList(); // 2C: fecha o combobox de posto ao navegar entre abas
    if(view === 'dashboard'){ renderDashboard(); }
    if(view === 'abastecimentos'){ ensureRefuelDateDefault(); } // 2B: garante data só se totalmente vazia (não é reset)
    if(view === 'rotas'){
      autoLocateOnce(); // localiza o usuário de forma real ao abrir a aba
      // Inicializa mapa se GPS já disponível (segunda+ visita)
      if(startCoords && !routeMapInitialized){
        initRouteMap(startCoords, 15);
      }
      if(routeMapInitialized && window.__motoboyMap){
        window.__motoboyMap.invalidateSize();
        setTimeout(function(){
          updateRouteMap();
          if(window.__motoboyMap) window.__motoboyMap.invalidateSize();
        }, 50);
      }
    }
    if(view === 'faturamento'){ renderFaturamento(); }
    if(view === 'clientes'){ renderClientes(); }
    if(view === 'moto'){ renderMotoConsumo(); }
    if(view === 'historico-rotas'){ renderRouteHistory(); }
  }
  document.querySelectorAll('.drawer-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if(!btn.dataset.view) return;
      setView(btn.dataset.view);
    });
  });
  document.getElementById('dashboardRouteShortcut').addEventListener('click', () => setView('rotas'));
  document.getElementById('dashboardFuelShortcut').addEventListener('click', () => setView('abastecimentos'));

  // No celular, recolhe o painel de confirmação enquanto o teclado ocupa a tela.
  function syncRouteDockWithKeyboard(){
    if(!window.visualViewport) return;
    const keyboardOpen = window.innerHeight - window.visualViewport.height > 150;
    if(keyboardOpen) document.body.classList.add('route-keyboard-open');
    else document.body.classList.remove('route-keyboard-open');
  }
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', syncRouteDockWithKeyboard);
    window.visualViewport.addEventListener('scroll', syncRouteDockWithKeyboard);
    syncRouteDockWithKeyboard();
  }

  // O gráfico mensal é criado depois que entradas, despesas, rotas e clientes já existem.
  let monthlyResultChart = null;
  let billingHistoryChart = null;

  // ---------- minha moto / manutenções ----------
  const DEFAULT_MOTO_KM = 0;
  let motoKm = Number(localState.motoKm) > 0 ? Number(localState.motoKm) : DEFAULT_MOTO_KM;
  let maintenances = Array.isArray(localState.maintenances) ? localState.maintenances : [];
  const expenseCategories = {
    maintenance:{ label:'Manutenção', tag:'maint', icon:wrenchIcon, needsDescription:true, fieldLabel:'O QUE VOCÊ CONSERTOU OU TROCOU?', placeholder:'Ex: Troca de óleo' },
    wash:{ label:'Lavagem', tag:'wash', icon:washIcon, needsDescription:false },
    toll:{ label:'Pedágio', tag:'toll', icon:tollIcon, needsDescription:false },
    parking:{ label:'Estacionamento', tag:'parking', icon:parkingIcon, needsDescription:false },
    other:{ label:'Outro', tag:'other', icon:cashIcon, needsDescription:true, fieldLabel:'DESCREVA O GASTO', placeholder:'Ex: Compra de capa de chuva' }
  };
  function normalizeExpenseCategory(category){
    return expenseCategories[category] ? category : 'maintenance';
  }
  function expenseCategoryInfo(item){
    return expenseCategories[normalizeExpenseCategory(item && item.category)];
  }
  maintenances.forEach(item => { item.category = normalizeExpenseCategory(item.category); });

  function fmtKm(km){ return km.toLocaleString('pt-BR') + ' km'; }
  function recalculateMotoKmFromRecords(){
    const recordedKm = [
      ...refuels.map(item => Number(item.odometer) || 0),
      ...maintenances.map(item => Number(item.km) || 0)
    ];
    motoKm = Math.max(DEFAULT_MOTO_KM, ...recordedKm);
    const el = document.getElementById('motoKmValue');
    if(el) el.textContent = fmtKm(motoKm);
  }

  // A quilometragem atual da moto é sempre o maior km já visto — venha ele de um
  // abastecimento ou de uma manutenção. O hodômetro só anda pra frente, então nunca
  // deixamos um número novo menor sobrescrever um maior.
  function registrarKm(km){
    if(km && km > motoKm){
      motoKm = km;
      const el = document.getElementById('motoKmValue');
      if(el) el.textContent = fmtKm(motoKm);
    }
  }

  // Callback de sincronização: recebe dados da moto do Firestore.
  window.__applyRemoteMoto = function(data){
    if(!data || typeof data !== 'object') return;
    if(Number(data.currentKm) > motoKm){
      motoKm = Number(data.currentKm);
      const el = document.getElementById('motoKmValue');
      if(el) el.textContent = fmtKm(motoKm);
    }
    if(typeof data.consumption === 'number' && data.consumption > 0){
      CONSUMO_ATUAL = data.consumption;
    }
    if(typeof data.consumptionIsManual === 'boolean'){
      consumoManualDefinido = data.consumptionIsManual;
    }
  };

  function maintTotal(){ return maintenances.reduce((s, m) => s + m.valor, 0); }

  function renderMaint(){
    const list = document.getElementById('maintList');
    document.getElementById('maintTotalValue').textContent = fmtBRL(maintTotal());
    document.getElementById('maintCountValue').textContent = maintenances.length;
    document.getElementById('motoKmValue').textContent = fmtKm(motoKm);

    if(maintenances.length === 0){
      list.innerHTML = '<div class="trip-empty">Nenhuma manutenção registrada ainda. Toca no + acima pra adicionar.</div>';
      return;
    }
    list.innerHTML = maintenances.map((m, index) => {
      const category = expenseCategoryInfo(m);
      const showCategoryTag = category.needsDescription || m.desc !== category.label;
      return `
      <div class="list-item maint-item">
        <div class="badge">${category.icon}</div>
        <div class="info">
          <div class="title">${safeText(m.desc)} ${editBadgeHTML(m)}</div>
          <div class="sub">${showCategoryTag ? `<span class="cat-tag ${category.tag}">${category.label}</span> ` : ''}${safeText(m.data)}${m.km ? ' · ' + fmtKm(m.km) : ''}</div>
        </div>
        <div class="record-side">
          <div class="amount">${fmtBRL(m.valor)}</div>
          ${recordActionsHTML('maintenance', index, 'gasto ' + m.desc)}
        </div>
      </div>
    `}).join('');
    wireRecordActions(list, editMaintenance, deleteMaintenance);
  }
  renderMaint();

  // ---------- modal genérico (abrir/fechar) ----------
  function wireModal(openBtnId, modalId, backdropId, closeBtnId, cancelBtnId){
    const modal = document.getElementById(modalId);
    const bd = document.getElementById(backdropId);
    let returnFocusEl = null;
    function open(){
      returnFocusEl = document.activeElement;
      modal.classList.add('open');
      bd.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      modal.focus();
    }
    function close(){
      modal.classList.remove('open');
      bd.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if(returnFocusEl && typeof returnFocusEl.focus === 'function') returnFocusEl.focus();
    }
    const openButton = openBtnId ? document.getElementById(openBtnId) : null;
    if(openButton) openButton.addEventListener('click', open);
    document.getElementById(closeBtnId).addEventListener('click', close);
    document.getElementById(cancelBtnId).addEventListener('click', close);
    bd.addEventListener('click', close);
    modal.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') close();
    });
    return { open, close };
  }

  const deleteModalCtl = wireModal(null, 'deleteModal', 'deleteBackdrop', 'deleteClose', 'deleteCancel');
  let pendingDeleteAction = null;
  function clearPendingDelete(){ pendingDeleteAction = null; }
  function requestDeleteConfirmation(title, message, onConfirm){
    document.getElementById('deleteModalTitle').textContent = title;
    document.getElementById('deleteModalMessage').textContent = message;
    pendingDeleteAction = onConfirm;
    deleteModalCtl.open();
    document.getElementById('deleteConfirm').focus();
  }
  document.getElementById('deleteConfirm').addEventListener('click', async () => {
    const action = pendingDeleteAction;
    clearPendingDelete();
    deleteModalCtl.close();
    if(typeof action === 'function') await action();
  });
  ['deleteCancel', 'deleteClose', 'deleteBackdrop'].forEach(id => {
    document.getElementById(id).addEventListener('click', clearPendingDelete);
  });
  document.getElementById('deleteModal').addEventListener('keydown', event => {
    if(event.key === 'Escape') clearPendingDelete();
  });

  const maintModalCtl = wireModal('btnOpenMaint','maintModal','modalBackdrop','modalClose','maintCancel');
  const entradaModalCtl = wireModal('btnOpenEntrada','entradaModal','entradaBackdrop','entradaClose','entradaCancel');
  let editingMaintenanceIndex = null;
  function setMaintFormError(message){
    const status = document.getElementById('maintFormMessage');
    status.textContent = message;
    status.classList.add('visible');
  }
  function clearMaintFormError(){
    const status = document.getElementById('maintFormMessage');
    status.textContent = '';
    status.classList.remove('visible');
  }
  function updateMaintenanceCategoryUI(){
    const categoryKey = normalizeExpenseCategory(document.getElementById('maintCategory').value);
    const category = expenseCategories[categoryKey];
    const descGroup = document.getElementById('maintDescGroup');
    const kmGroup = document.getElementById('maintKmGroup');
    const isMaintenance = categoryKey === 'maintenance';
    descGroup.hidden = !category.needsDescription;
    kmGroup.hidden = !isMaintenance;
    if(!category.needsDescription) document.getElementById('maintDesc').value = '';
    if(!isMaintenance) document.getElementById('maintKm').value = '';
    if(category.needsDescription){
      document.getElementById('maintDescLabel').textContent = category.fieldLabel;
      document.getElementById('maintDesc').placeholder = category.placeholder;
    }
  }
  function resetMaintenanceFormMode(){
    editingMaintenanceIndex = null;
    document.getElementById('maintModalTitle').textContent = 'Registrar gasto';
    document.getElementById('maintModalDesc').textContent = 'Manutenção, lavagem ou gasto da operação';
    document.getElementById('maintSave').textContent = 'Salvar gasto';
    document.getElementById('maintCategory').value = 'maintenance';
    document.getElementById('maintDesc').value = '';
    document.getElementById('maintValor').value = '';
    document.getElementById('maintKm').value = '';
    setBrDateValue(document.getElementById('maintDate'), localTodayISO());
    document.getElementById('maintEditReason').value = '';
    document.getElementById('maintEditReasonField').hidden = true;
    updateMaintenanceCategoryUI();
    clearMaintFormError();
  }
  function editMaintenance(index){
    const item = maintenances[index];
    if(!item) return;
    editingMaintenanceIndex = index;
    document.getElementById('maintModalTitle').textContent = 'Editar gasto';
    document.getElementById('maintModalDesc').textContent = 'Corrija os dados deste registro';
    document.getElementById('maintSave').textContent = 'Atualizar gasto';
    document.getElementById('maintCategory').value = normalizeExpenseCategory(item.category);
    document.getElementById('maintDesc').value = item.desc;
    document.getElementById('maintValor').value = editableNumber(item.valor, 2);
    document.getElementById('maintKm').value = item.km ? String(item.km) : '';
    setBrDateValue(document.getElementById('maintDate'), item.dateISO || localTodayISO());
    document.getElementById('maintEditReason').value = '';
    document.getElementById('maintEditReasonField').hidden = false;
    updateMaintenanceCategoryUI();
    clearMaintFormError();
    maintModalCtl.open();
    document.getElementById(item && expenseCategoryInfo(item).needsDescription ? 'maintDesc' : 'maintValor').focus();
  }
  function deleteMaintenance(index){
    if(!ensureMotoInteractive()) return;
    const item = maintenances[index];
    if(!item) return;
    requestDeleteConfirmation(
      'Excluir gasto?',
      `${item.desc} · ${fmtBRL(item.valor)}. O financeiro será recalculado.`,
      () => {
        const currentIndex = maintenances.indexOf(item);
        if(currentIndex < 0) return;
        maintenances.splice(currentIndex, 1);
        // Ponte: remove no Firestore.
        if(window.__motoboyManutencoes && item.fsId) window.__motoboyManutencoes.remove(item.fsId);
        if(editingMaintenanceIndex === currentIndex) resetMaintenanceFormMode();
        const prevMotoKm = motoKm;
        recalculateMotoKmFromRecords();
        saveLocalState();
        if(motoKm !== prevMotoKm){
          syncMotoToFirestore();
        }
        renderMaint();
        renderFaturamento();
        renderDashboard();
      }
    );
  }
  document.getElementById('maintCategory').addEventListener('change', updateMaintenanceCategoryUI);
  document.getElementById('btnOpenMaint').addEventListener('click', resetMaintenanceFormMode);
  document.getElementById('dashboardMaintShortcut').addEventListener('click', () => {
    setView('moto');
    resetMaintenanceFormMode();
    maintModalCtl.open();
  });

  document.getElementById('maintSave').addEventListener('click', () => {
    if(!ensureMotoInteractive()) return;
    const category = normalizeExpenseCategory(document.getElementById('maintCategory').value);
    const categoryInfo = expenseCategories[category];
    const typedDesc = document.getElementById('maintDesc').value.trim();
    const desc = categoryInfo.needsDescription ? typedDesc : categoryInfo.label;
    const valor = parseBrazilianInput(document.getElementById('maintValor').value);
    const km = category === 'maintenance' ? parseBrazilianInput(document.getElementById('maintKm').value) : null;

    if(categoryInfo.needsDescription && !typedDesc){
      setMaintFormError('Descreva este gasto para você conseguir identificá-lo depois.');
      document.getElementById('maintDesc').focus();
      return;
    }
    if(valor === null || valor <= 0){
      setMaintFormError('Informe quanto foi gasto. Você pode digitar, por exemplo, 45,00.');
      document.getElementById('maintValor').focus();
      return;
    }
    if(category === 'maintenance' && km !== null && km <= 0){
      setMaintFormError('A quilometragem precisa ser maior que zero ou pode ficar em branco.');
      document.getElementById('maintKm').focus();
      return;
    }
    if(category === 'maintenance' && editingMaintenanceIndex === null && km !== null && km < motoKm){
      setMaintFormError(`O km informado (${fmtKm(km)}) é menor que a quilometragem atual (${fmtKm(motoKm)}). Digite o número atual do painel ou deixe o campo em branco.`);
      document.getElementById('maintKm').focus();
      return;
    }
    clearMaintFormError();
    const previous = editingMaintenanceIndex === null ? null : maintenances[editingMaintenanceIndex];
    const maintDateEl = document.getElementById('maintDate');
    const maintISO = readBrDateISO(maintDateEl);
    if(!maintISO){ showDateError(maintDateEl, 'Informe uma data válida no formato DD/MM/AAAA.'); return; }
    if(maintISO > localTodayISO()){ showDateError(maintDateEl, 'A data não pode ser futura.', true); return; }
    clearDateError(maintDateEl);
    const record = {
      category,
      desc,
      valor,
      km:km || null,
      data: dateLabelFromISO(maintISO),
      dateISO: maintISO,
      fsId: previous ? (previous.fsId || null) : null
    };
    if(previous){
      registrarEdicao(record, previous, [
        { chave:'desc', rotulo:'Descrição', tipo:'text' },
        { chave:'valor', rotulo:'Valor', tipo:'money' },
        { chave:'km', rotulo:'Km', tipo:'text' }
      ], document.getElementById('maintEditReason') ? document.getElementById('maintEditReason').value : '');
      maintenances[editingMaintenanceIndex] = record;
    }
    else maintenances.unshift(record);
    // Ponte: grava no Firestore (por uid).
    if(previous){
      if(window.__motoboyManutencoes) window.__motoboyManutencoes.update(record.fsId, record);
    } else {
      const addPromise = window.__motoboyManutencoes && window.__motoboyManutencoes.add(record);
      if(addPromise && addPromise.then){
        addPromise.then(function(id){
          if(typeof id !== 'string' || id === '') return;   // id remoto inválido: não persiste fsId
          if(maintenances.indexOf(record) === -1) return;    // registro excluído/substituído: não altera
          record.fsId = id;
          saveLocalState();                                  // persiste o cache só depois do fsId
        }).catch(function(){ /* falha remota: mantém o cache local sem fsId */ });
      }
    }
    const prevMotoKm = motoKm;
    recalculateMotoKmFromRecords();
    saveLocalState();
    // Sincroniza moto somente se a manutenção alterou efetivamente o estado.
    if(motoKm !== prevMotoKm){
      syncMotoToFirestore();
    }
    renderMaint();
    renderFaturamento();
    renderDashboard();
    maintModalCtl.close();
    resetMaintenanceFormMode();
  });

  // Ponte: recebe as manutenções do Firestore (dono atual) e re-renderiza.
  function manutencaoEntityToVM(e){
    return {
      fsId: e.id,
      category: e.category || 'maintenance',
      desc: e.desc || '',
      valor: Number(e.valor) || 0,
      km: e.km || null,
      data: dateLabelFromISO(e.dateISO),
      dateISO: e.dateISO
    };
  }
  window.__applyRemoteManutencoes = function(entities){
    if(!Array.isArray(entities)) return;
    maintenances = entities.map(manutencaoEntityToVM);
    recalculateMotoKmFromRecords();
    saveLocalState();
    renderMaint();
    renderFaturamento();
    renderDashboard();
  };

  // ---------- faturamento: entradas + despesas ----------
  let entradas = Array.isArray(localState.entradas) ? localState.entradas : [];
  let editingEntryIndex = null;

  function resetEntryFormMode(){
    editingEntryIndex = null;
    document.getElementById('entradaModalTitle').textContent = 'Registrar entrada';
    document.getElementById('entradaModalDesc').textContent = 'Quanto você recebeu e de onde';
    document.getElementById('entradaSave').textContent = 'Salvar entrada';
    document.getElementById('entradaDesc').value = '';
    document.getElementById('entradaValor').value = '';
    setBrDateValue(document.getElementById('entradaDate'), localTodayISO());
    document.getElementById('entradaEditReason').value = '';
    document.getElementById('entradaEditReasonField').hidden = true;
  }
  function editEntry(index){
    const item = entradas[index];
    if(!item || item.routeId || item.clientName) return;
    editingEntryIndex = index;
    document.getElementById('entradaModalTitle').textContent = 'Editar entrada';
    document.getElementById('entradaModalDesc').textContent = 'Corrija a descrição ou o valor recebido';
    document.getElementById('entradaSave').textContent = 'Atualizar entrada';
    document.getElementById('entradaDesc').value = item.desc;
    document.getElementById('entradaValor').value = editableNumber(item.valor, 2);
    setBrDateValue(document.getElementById('entradaDate'), item.dateISO || localTodayISO());
    document.getElementById('entradaEditReason').value = '';
    document.getElementById('entradaEditReasonField').hidden = false;
    entradaModalCtl.open();
    document.getElementById('entradaDesc').focus();
  }
  function deleteEntry(index){
    const item = entradas[index];
    if(!item || item.routeId || item.clientName) return;
    requestDeleteConfirmation(
      'Excluir entrada?',
      `${item.desc} · ${fmtBRL(item.valor)}. O painel e os gráficos serão recalculados.`,
      () => {
        const currentIndex = entradas.indexOf(item);
        if(currentIndex < 0) return;
        entradas.splice(currentIndex, 1);
        // Ponte: remove a entrada MANUAL no Firestore.
        if(window.__motoboyEntradas && item.fsId) window.__motoboyEntradas.remove(item.fsId);
        if(editingEntryIndex === currentIndex) resetEntryFormMode();
        saveLocalState();
        renderFaturamento();
        renderDashboard();
      }
    );
  }
  document.getElementById('btnOpenEntrada').addEventListener('click', resetEntryFormMode);

  // Ponte: recebe as entradas MANUAIS do Firestore e mescla com as locais
  // (preserva as de rota — routeId/clientName — e as ainda não sincronizadas).
  function entradaEntityToVM(e){
    return {
      fsId: e.id,
      desc: e.desc || '',
      valor: Number(e.valor) || 0,
      data: dateLabelFromISO(e.dateISO),
      dateISO: e.dateISO
    };
  }
  window.__applyRemoteEntradas = function(entities){
    if(!Array.isArray(entities)) return;
    const remoto = entities.map(entradaEntityToVM);
    const locaisPreservadas = entradas.filter(function(e){ return e.routeId || e.clientName || !e.fsId; });
    entradas = remoto.concat(locaisPreservadas);
    entradas.sort(function(a,b){ return String(b.dateISO||'').localeCompare(String(a.dateISO||'')); });
    saveLocalState();
    renderFaturamento();
    renderDashboard();
  };

  function currentMonthKey(){ return toISODateLocal(APP_NOW).slice(0, 7); }
  function billingMonthKey(){
    const select = document.getElementById('billingMonth');
    return select && select.value ? select.value : currentMonthKey();
  }
  function billingYearValue(){
    const select = document.getElementById('billingYear');
    return select && select.value ? Number(select.value) : APP_NOW.getFullYear();
  }
  function billingYearMonthKeys(year){
    const selectedYear = Number(year) || APP_NOW.getFullYear();
    return Array.from({ length:12 }, (_, index) => `${selectedYear}-${pad2(index + 1)}`);
  }
  function availableBillingYears(){
    const years = new Set([APP_NOW.getFullYear()]);
    [...entradas, ...refuels, ...maintenances].forEach(item => {
      const year = Number(String(item.dateISO || '').slice(0, 4));
      if(year > 2000) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
  }
  function formatMonthKey(monthKey, short){
    const parts = String(monthKey).split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, 1);
    const options = short ? { month:'short' } : { month:'long', year:'numeric' };
    const label = new Intl.DateTimeFormat('pt-BR', options).format(date).replace('.', '');
    return label.replace(/^./, letter => letter.toUpperCase());
  }
  function fillBillingMonthSelector(year, preferredMonth){
    const select = document.getElementById('billingMonth');
    const keys = billingYearMonthKeys(year);
    select.innerHTML = keys.map(key =>
      `<option value="${key}">${formatMonthKey(key, false)}</option>`
    ).join('');
    const preferredIsValid = preferredMonth && keys.includes(preferredMonth);
    const latestWithMovement = keys.slice().reverse().find(key => financialMonthSummary(key).hasMovement);
    select.value = preferredIsValid
      ? preferredMonth
      : Number(year) === APP_NOW.getFullYear() ? currentMonthKey() : latestWithMovement || keys[11];
  }
  function initBillingMonthSelector(){
    const yearSelect = document.getElementById('billingYear');
    yearSelect.innerHTML = availableBillingYears().map(year => `<option value="${year}">${year}</option>`).join('');
    yearSelect.value = String(APP_NOW.getFullYear());
    fillBillingMonthSelector(APP_NOW.getFullYear(), currentMonthKey());
    const select = document.getElementById('billingMonth');
    select.addEventListener('change', renderFaturamento);
    yearSelect.addEventListener('change', () => {
      fillBillingMonthSelector(billingYearValue(), null);
      renderFaturamento();
    });
    updateStorageStatus();
  }
  function monthRecords(items, monthKey){
    return items.filter(item => String(item.dateISO || '').startsWith(monthKey));
  }
  function entradaTotal(monthKey){
    return monthRecords(entradas, monthKey).reduce((sum, item) => sum + item.valor, 0);
  }

  function getDespesas(monthKey){
    const combustivel = monthRecords(refuels, monthKey).map(r => ({ tipo:'Combustível', tag:'fuel', desc:r.local, data:r.quando, valor:r.valor, dateISO:r.dateISO, icon:fuelIcon }));
    const manutencao = monthRecords(maintenances, monthKey).map(m => {
      const category = expenseCategoryInfo(m);
      return { tipo:category.label, tag:category.tag, desc:m.desc, data:m.data, valor:m.valor, dateISO:m.dateISO, icon:category.icon };
    });
    return [...combustivel, ...manutencao];
  }

  function financialMonthSummary(monthKey){
    const totalEntradas = entradaTotal(monthKey);
    const totalDespesas = getDespesas(monthKey).reduce((sum, item) => sum + item.valor, 0);
    return {
      key:monthKey,
      entradas:totalEntradas,
      despesas:totalDespesas,
      resultado:round2(totalEntradas - totalDespesas),
      hasMovement:totalEntradas > 0 || totalDespesas > 0
    };
  }

  function resultBRL(value){
    if(value === 0) return fmtBRL(0);
    return (value > 0 ? '+ ' : '- ') + fmtBRL(Math.abs(value));
  }

  function centerSelectedBillingMonth(selectedMonth){
    const scroll = document.getElementById('billingHistoryScroll');
    const monthIndex = Math.max(0, Number(String(selectedMonth).slice(5, 7)) - 1);
    if(!scroll) return;
    requestAnimationFrame(() => {
      const monthCenter = ((monthIndex + .5) / 12) * scroll.scrollWidth;
      scroll.scrollLeft = Math.max(0, monthCenter - (scroll.clientWidth / 2));
    });
  }

  function renderBillingHistoryChart(selectedMonth){
    const chartYear = Number(String(selectedMonth).slice(0, 4)) || billingYearValue();
    const summaries = billingYearMonthKeys(chartYear).map(financialMonthSummary);
    const selected = summaries.find(item => item.key === selectedMonth) || financialMonthSummary(selectedMonth);
    const valueEl = document.getElementById('billingHistoryValue');
    const statusEl = document.getElementById('billingHistoryStatus');

    valueEl.textContent = resultBRL(selected.resultado);
    valueEl.style.color = selected.resultado < 0 ? 'var(--red)' : selected.resultado > 0 ? 'var(--green)' : 'var(--text)';
    document.getElementById('billingHistoryDetail').textContent = selected.hasMovement
      ? `${fmtBRL(selected.entradas)} em entradas · ${fmtBRL(selected.despesas)} em despesas`
      : 'Nenhuma entrada ou despesa registrada neste mês.';
    statusEl.textContent = !selected.hasMovement ? 'SEM MOVIMENTO' : selected.resultado < 0 ? 'PREJUÍZO' : selected.resultado > 0 ? 'LUCRO' : 'EQUILÍBRIO';
    statusEl.className = 'billing-history-status' + (selected.resultado < 0 ? ' negative' : selected.resultado === 0 ? ' balanced' : '');

    const canvas = document.getElementById('billingHistoryChart');
    canvas.setAttribute('aria-label', summaries.map(item =>
      `${formatMonthKey(item.key, false)}: entradas ${fmtBRL(item.entradas)}, despesas ${fmtBRL(item.despesas)}, resultado ${resultBRL(item.resultado)}`
    ).join('. '));
    if(typeof Chart === 'undefined'){
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';
    if(billingHistoryChart) billingHistoryChart.destroy();

    billingHistoryChart = new Chart(canvas.getContext('2d'), {
      type:'bar',
      data:{
        labels:summaries.map(item => formatMonthKey(item.key, true)),
        datasets:[
          {
            type:'bar',
            label:'Entradas',
            data:summaries.map(item => item.entradas),
            backgroundColor:summaries.map(item => item.key === selectedMonth ? 'rgba(63,178,127,.94)' : 'rgba(63,178,127,.62)'),
            borderColor:summaries.map(item => item.key === selectedMonth ? '#A5E7C8' : '#3FB27F'),
            borderWidth:summaries.map(item => item.key === selectedMonth ? 2 : 1),
            borderRadius:6,
            borderSkipped:false,
            maxBarThickness:28,
            categoryPercentage:.76,
            barPercentage:.84,
            order:2
          },
          {
            type:'bar',
            label:'Despesas',
            data:summaries.map(item => item.despesas),
            backgroundColor:summaries.map(item => item.key === selectedMonth ? 'rgba(255,107,118,.92)' : 'rgba(255,107,118,.60)'),
            borderColor:summaries.map(item => item.key === selectedMonth ? '#FFB0B7' : '#FF6B76'),
            borderWidth:summaries.map(item => item.key === selectedMonth ? 2 : 1),
            borderRadius:6,
            borderSkipped:false,
            maxBarThickness:28,
            categoryPercentage:.76,
            barPercentage:.84,
            order:2
          },
          {
            type:'line',
            label:'Resultado',
            data:summaries.map(item => item.resultado),
            borderColor:'#828B99',
            backgroundColor:'#828B99',
            borderWidth:2.5,
            pointRadius:summaries.map(item => item.key === selectedMonth ? 5 : 3.5),
            pointHoverRadius:6,
            pointHitRadius:14,
            pointBackgroundColor:summaries.map(item => item.resultado < 0 ? '#FF6B76' : item.resultado > 0 ? '#3FB27F' : '#828B99'),
            pointBorderColor:'#14171C',
            pointBorderWidth:2,
            segment:{
              borderColor:ctx => {
                // cada trecho da linha usa a cor do ponto de destino: verde sobe pro lucro,
                // vermelho desce pro prejuízo
                const v = ctx.p1.parsed.y;
                return v < 0 ? '#FF6B76' : v > 0 ? '#3FB27F' : '#828B99';
              }
            },
            tension:.28,
            fill:false,
            order:1
          }
        ]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{ duration:360 },
        interaction:{ mode:'index', intersect:false },
        onHover:(event, elements) => {
          if(event.native && event.native.target) event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
        },
        onClick:(event, elements) => {
          if(!elements.length) return;
          const picked = summaries[elements[0].index];
          requestAnimationFrame(() => {
            const select = document.getElementById('billingMonth');
            select.value = picked.key;
            renderFaturamento();
          });
        },
        plugins:{
          legend:{ display:false },
          tooltip:{
            displayColors:true,
            position:'nearest',
            backgroundColor:'#111419',
            borderColor:'#3A414B',
            borderWidth:1,
            titleColor:'#8B92A0',
            bodyColor:'#F2F0EB',
            padding:11,
            caretPadding:8,
            callbacks:{
              title:items => formatMonthKey(summaries[items[0].dataIndex].key, false),
              labelTextColor:context => {
                if(context.dataset.label === 'Resultado'){
                  const v = context.parsed.y;
                  return v < 0 ? '#FF6B76' : v > 0 ? '#3FB27F' : '#F2F0EB';
                }
                return '#F2F0EB';
              },
              label:context => context.dataset.label === 'Resultado'
                ? `Resultado: ${resultBRL(context.parsed.y)}`
                : `${context.dataset.label}: ${fmtBRL(context.parsed.y)}`
            }
          }
        },
        scales:{
          x:{ grid:{ display:false }, ticks:{ color:'#9AA1AD', font:{ size:11, weight:'600' } } },
          y:{
            beginAtZero:true,
            grace:'12%',
            grid:{ color:context => context.tick.value === 0 ? 'rgba(242,240,235,.28)' : 'rgba(49,55,63,.7)' },
            ticks:{
              color:'#9AA1AD', font:{ size:10.5, weight:'600' }, maxTicksLimit:5,
              callback:value => (value < 0 ? '- ' : '') + 'R$ ' + Math.abs(value).toLocaleString('pt-BR')
            }
          }
        }
      }
    });
    centerSelectedBillingMonth(selectedMonth);
  }

  function renderFaturamento(){
    const monthKey = billingMonthKey();
    const monthEntries = monthRecords(entradas, monthKey);
    const totalEntradas = entradaTotal(monthKey);
    const despesas = getDespesas(monthKey);
    const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
    const resultado = totalEntradas - totalDespesas;

    document.getElementById('billingPeriodLabel').textContent = monthKey === currentMonthKey()
      ? `${formatMonthKey(monthKey, false)} · mês atual`
      : formatMonthKey(monthKey, false);
    document.getElementById('balEntradas').textContent = fmtBRL(totalEntradas);
    document.getElementById('balDespesas').textContent = fmtBRL(totalDespesas);
    const resEl = document.getElementById('balResultado');
    resEl.textContent = resultBRL(resultado);
    resEl.style.color = resultado < 0 ? 'var(--red)' : resultado > 0 ? 'var(--green)' : 'var(--text)';

    const entradaListEl = document.getElementById('entradaList');
    entradaListEl.innerHTML = monthEntries.length === 0
      ? '<div class="trip-empty">Nenhuma entrada registrada neste mês.</div>'
      : monthEntries.map(e => {
        const entryIndex = entradas.indexOf(e);
        const editable = !e.routeId && !e.clientName;
        return `
        <div class="list-item">
          <div class="badge green">${cashIcon}</div>
          <div class="info">
            <div class="title">${safeText(e.desc)} ${editBadgeHTML(e)}</div>
            <div class="sub">${safeText(e.data)}</div>
          </div>
          <div class="record-side">
            <div class="amount green">+ ${fmtBRL(e.valor)}</div>
            ${editable ? recordActionsHTML('entry', entryIndex, 'entrada ' + e.desc) : ''}
          </div>
        </div>
      `}).join('');
    wireRecordActions(entradaListEl, editEntry, deleteEntry);

    const despesaListEl = document.getElementById('despesaList');
    despesaListEl.innerHTML = despesas.length === 0
      ? '<div class="trip-empty">Nenhuma despesa registrada neste mês.</div>'
      : despesas.map(d => {
        const showCategoryTag = d.tag === 'fuel' || d.desc !== d.tipo;
        return `
        <div class="list-item">
          <div class="badge">${d.icon}</div>
          <div class="info">
            <div class="title">${safeText(d.desc)}</div>
            <div class="sub">${showCategoryTag ? `<span class="cat-tag ${d.tag}">${safeText(d.tipo)}</span> ` : ''}${safeText(d.data)}</div>
          </div>
          <div class="amount">- ${fmtBRL(d.valor)}</div>
        </div>
      `}).join('');

    renderBillingHistoryChart(monthKey);
  }

  document.getElementById('entradaSave').addEventListener('click', () => {
    const desc = document.getElementById('entradaDesc').value.trim();
    const valor = parseBrazilianInput(document.getElementById('entradaValor').value);

    if(!desc || valor === null || valor <= 0){
      showToast('Preenche de onde veio o valor e quanto foi recebido.', {kind:'warning'});
      return;
    }

    const previous = editingEntryIndex === null ? null : entradas[editingEntryIndex];
    const entradaDateEl = document.getElementById('entradaDate');
    const entradaISO = readBrDateISO(entradaDateEl);
    if(!entradaISO){ showDateError(entradaDateEl, 'Informe uma data válida no formato DD/MM/AAAA.'); return; }
    if(entradaISO > localTodayISO()){ showDateError(entradaDateEl, 'A data não pode ser futura.', true); return; }
    clearDateError(entradaDateEl);
    const record = {
      desc,
      valor,
      data: dateLabelFromISO(entradaISO),
      dateISO: entradaISO,
      fsId: previous ? (previous.fsId || null) : null
    };
    if(previous){
      registrarEdicao(record, previous, [
        { chave:'desc', rotulo:'Descrição', tipo:'text' },
        { chave:'valor', rotulo:'Valor', tipo:'money' }
      ], document.getElementById('entradaEditReason') ? document.getElementById('entradaEditReason').value : '');
      entradas[editingEntryIndex] = record;
    }
    else entradas.unshift(record);
    // Ponte: grava a entrada MANUAL no Firestore (por uid).
    if(previous){
      if(window.__motoboyEntradas) window.__motoboyEntradas.update(record.fsId, record);
    } else {
      const addPromise = window.__motoboyEntradas && window.__motoboyEntradas.add(record);
      if(addPromise && addPromise.then){
        addPromise.then(function(id){
          if(typeof id !== 'string' || id === '') return;   // id remoto inválido: não persiste fsId
          if(entradas.indexOf(record) === -1) return;        // registro excluído/substituído: não altera
          record.fsId = id;
          saveLocalState();                                  // persiste o cache só depois do fsId
        }).catch(function(){ /* falha remota: mantém o cache local sem fsId */ });
      }
    }
    if(!previous){
      const billingYearSelect = document.getElementById('billingYear');
      const chosenYear = Number(entradaISO.slice(0, 4)) || APP_NOW.getFullYear();
      if(billingYearSelect) billingYearSelect.value = String(chosenYear);
      fillBillingMonthSelector(chosenYear, entradaISO.slice(0, 7));
    }
    saveLocalState();
    renderFaturamento();
    renderDashboard();
    entradaModalCtl.close();
    resetEntryFormMode();
  });

  // ---------- rotas: montador de serviços (1 coleta + N entregas) ----------
  // O consumo vem de Minha Moto e o preço por litro vem do último abastecimento.
  // Um serviço = 1 coleta que pode gerar várias entregas (motoboy pega vários pacotes
  // no mesmo lugar e entrega em endereços diferentes).
  let CONSUMO_ATUAL = Number(localState.manualConsumption) > 0 ? Number(localState.manualConsumption) : 0; // informado em Minha Moto ou calculado pelos abastecimentos
  let PRECO_ATUAL = latestRefuelPrice(); // calculado em Abastecimentos
  let consumoReal = null;                // km/L calculado a partir dos abastecimentos com km do painel
  let consumoManualDefinido = Boolean(localState.consumoManualDefinido && Number(localState.manualConsumption) > 0); // se o motoboy digitou um consumo à mão, respeitamos a escolha dele

  // Calcula o consumo real (km/L) usando os abastecimentos que têm km do painel anotado.
  // Entre dois abastecimentos consecutivos, o motoboy rodou (km maior - km menor) e, pra
  // andar isso, gastou os litros do abastecimento mais recente. Consumo = distância ÷ litros.
  // Fazemos a média de todos os trechos disponíveis pra suavizar variação de trânsito/mão pesada.
  function calcularConsumoReal(){
    const comKm = refuels
      .filter(r => r.odometer && r.odometer > 0 && r.litrosValue > 0)
      .sort((a, b) => a.odometer - b.odometer);
    if(comKm.length < 2) return null;

    const trechos = [];
    for(let i = 1; i < comKm.length; i++){
      const distancia = comKm[i].odometer - comKm[i - 1].odometer;
      const litros = comKm[i].litrosValue;
      if(distancia > 0 && litros > 0){
        trechos.push({ kmpl: distancia / litros, dateISO: comKm[i].dateISO });
      }
    }
    if(trechos.length === 0) return null;
    const media = trechos.reduce((s, t) => s + t.kmpl, 0) / trechos.length;
    return { media, trechos };
  }

  function recalcConsumoReal(){
    const resultado = calcularConsumoReal();
    consumoReal = resultado ? resultado.media : null;
    // Só assume o consumo real automaticamente se o motoboy ainda não fixou um valor à mão.
    if(consumoReal && !consumoManualDefinido){
      CONSUMO_ATUAL = consumoReal;
    }
    return resultado;
  }

  let consumoChart = null;
  function renderMotoConsumo(){
    const resultado = calcularConsumoReal();
    consumoReal = resultado ? resultado.media : null;
    if(consumoReal && !consumoManualDefinido){ CONSUMO_ATUAL = consumoReal; }

    const valueEl = document.getElementById('consumoRealValue');
    const noteEl = document.getElementById('consumoRealNote');
    const badgeEl = document.getElementById('consumoRealBadge');
    if(!valueEl) return;

    if(!consumoReal){
      valueEl.textContent = '—';
      badgeEl.textContent = 'faltam dados';
      const comKm = refuels.filter(r => r.odometer && r.odometer > 0).length;
      noteEl.textContent = comKm === 0
        ? 'Anote o km do painel ao abastecer pra ver aqui quantos km por litro sua moto faz de verdade. Precisa de pelo menos dois abastecimentos com km.'
        : 'Já tem 1 abastecimento com km do painel. No próximo que você anotar o km, o consumo real aparece aqui.';
    }else{
      valueEl.textContent = consumoReal.toFixed(1).replace('.', ',') + ' km/L';
      badgeEl.textContent = consumoManualDefinido ? 'calculado (usando o manual nas rotas)' : 'usado nas rotas';
      const litroPreco = latestRefuelPrice();
      const custoPorKm = (litroPreco && consumoReal) ? litroPreco / consumoReal : null;
      noteEl.textContent = custoPorKm
        ? `Na média dos seus abastecimentos, cada km custa cerca de ${fmtBRL(custoPorKm)} só de gasolina.`
        : 'Consumo calculado pela distância rodada entre abastecimentos.';
    }

    // gráfico da evolução do consumo por abastecimento
    const canvas = document.getElementById('consumoChart');
    if(!canvas) return;
    if(consumoChart){ consumoChart.destroy(); consumoChart = null; }
    if(!resultado || resultado.trechos.length === 0){
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    const trechos = resultado.trechos;
    const labels = trechos.map((t, i) => 'Ab. ' + (i + 2)); // trecho i usa o abastecimento i+1 (base 1 = 2)
    const dados = trechos.map(t => round2(t.kmpl));

    consumoChart = new Chart(canvas.getContext('2d'), {
      type:'line',
      data:{
        labels,
        datasets:[{
          label:'km/L',
          data:dados,
          borderColor:'#3FB27F',
          backgroundColor:'rgba(63,178,127,.14)',
          borderWidth:3,
          pointRadius:4,
          pointHoverRadius:6,
          pointBackgroundColor:'#3FB27F',
          pointBorderColor:'#14171C',
          pointBorderWidth:1.5,
          tension:0.3,
          fill:true
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{ duration:380 },
        plugins:{
          legend:{ display:false },
          tooltip:{
            displayColors:false,
            backgroundColor:'#111419',
            borderColor:'#3A414B',
            borderWidth:1,
            titleColor:'#8B92A0',
            bodyColor:'#F2F0EB',
            padding:11,
            callbacks:{
              title:items => items[0].label,
              label:context => context.parsed.y.toFixed(1).replace('.', ',') + ' km/L nesse trecho'
            }
          }
        },
        scales:{
          x:{ grid:{ display:false }, ticks:{ color:'#8B92A0', font:{ size:11 } } },
          y:{ grid:{ color:'#262B33' }, ticks:{ color:'#8B92A0', font:{ size:11 }, callback:v => v + ' km/L' } }
        }
      }
    });
  }

  document.getElementById('btnSaveConsumption').addEventListener('click', () => {
    if(!ensureMotoInteractive()) return;
    const consumption = parseBrazilianInput(document.getElementById('motoConsumptionInput').value);
    if(!consumption || consumption <= 0){
      showToast('Informe um consumo médio maior que zero.', {kind:'warning'});
      return;
    }
    CONSUMO_ATUAL = consumption;
    consumoManualDefinido = true;
    saveLocalState();
    syncMotoToFirestore();
    document.getElementById('motoConsumptionStatus').textContent = `${consumption.toFixed(1).replace('.', ',')} km/L salvos à mão e usados nas rotas.`;
    renderMotoConsumo();
    renderRouteSummary();
    routeServices.forEach((s, i) => s.entregas.forEach((_, j) => updateServiceVerdict(i, j)));
  });

  function newEntrega(){ return { entrega:'', entregaCoords:null, distancia:null, tempo:null, valor:null, status:'idle', errorMsg:'', approx:false, approxConfirmed:false }; }
  function newService(){ return { serviceId:'svc-'+crypto.randomUUID(), coleta:'', coletaCoords:null, cliente:'', paymentStatus:'received', entregas:[ newEntrega() ] }; }
  let routeServices = [ newService() ];
  let confirmedRoutes = Array.isArray(localState.confirmedRoutes) ? localState.confirmedRoutes : [];
  let dragSrcIndex = null;
  let startCoords = null;

  // ---------- geocodificação, sugestões e rota via OpenStreetMap ----------
  // Sugestões de endereço (autocomplete): usamos o Photon (komoot.io), que é feito
  // exatamente pra isso — "search-as-you-type". O Nominatim (que eu tinha usado antes)
  // proíbe explicitamente esse uso na política dele, por isso troquei.
  // Cálculo de rota: continua no OSRM público. Como ele às vezes cai ou demora
  // (é um servidor de demonstração, sem garantia), se ele falhar calculamos uma
  // distância aproximada em linha reta só pra não travar o app.
  function debounce(fn, wait){
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function formatPhotonLabel(p){
    // Rua+numero quando existe (GPS de verdade); senão nome do POI/bairro;
    // cidade por último. Sem misturar tudo.
    if(p.street){
      const rua = p.housenumber ? `${p.street}, ${p.housenumber}` : p.street;
      const local = [p.district, p.city || p.county || p.locality].filter(Boolean);
      return [rua, ...local].slice(0, 3).join(', ');
    }
    const local = [p.district, p.city || p.county || p.locality].filter(Boolean);
    return [p.name, ...local].filter(Boolean).slice(0, 3).join(', ') || 'Endereço';
  }

  // Busca pela CIDADE ATUAL do motoboy: pega o GPS, descobre a cidade por
  // geocodificação reversa e passa a filtrar os endereços apenas dessa cidade
  // (sempre no Brasil). Se o GPS for negado/indisponível, cai para "só Brasil".
  // A cidade NÃO é fixada no código — vem da posição real do aparelho.
  let regionCenter = null;    // { lat, lon } do aparelho, quando disponível
  let regionPlace = null;     // { city, state } da posição atual (reverse geocode)
  let regionGeoTried = false; // já tentou pedir a permissão de localização nesta sessão

  /** Locais equivalentes à "cidade" no Photon (varia por município/OSM). */
  function sameCity(props, place){
    if(!place || !place.city) return true; // sem cidade conhecida: não filtra
    // POIs (lojas, restaurantes) têm coordenadas válidas mesmo sem campo city — não filtra
    var osmKey = (props.osm_key || '').toLowerCase();
    if(['shop','amenity','leisure','commercial','retail','tourism'].indexOf(osmKey) >= 0) return true;
    const alvo = place.city.toLowerCase();
    const candidatos = [props.city, props.county, props.locality, props.district]
      .filter(v => typeof v === 'string')
      .map(v => v.toLowerCase());
    const estadoOk = !place.state || props.state === place.state;
    return estadoOk && candidatos.includes(alvo);
  }

  async function reverseCity(center){
    try{
      const url = `https://photon.komoot.io/reverse/?lon=${center.lon}&lat=${center.lat}&lang=default`;
      const res = await fetch(url);
      const data = await res.json();
      const p = data.features && data.features[0] && data.features[0].properties;
      // Photon pode devolver a cidade em city, county (interior) ou locality
      const cidade = p && (p.city || p.county || p.locality);
      if(cidade) regionPlace = { city: cidade, state: p.state || null };
    }catch(e){ /* sem cidade: segue com a caixa + Brasil */ }
  }

  /** Pede o GPS. `retry` permite tentar de novo após negar (botão na UI). */
  function requestRegionCenter(retry = false){
    if(!navigator.geolocation) return;
    if(regionCenter) return;
    if(!retry && regionGeoTried) return;
    regionGeoTried = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        regionCenter = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        reverseCity(regionCenter);
      },
      () => { /* negado/indisponível: usuário pode tentar de novo pelo botão */ },
      { maximumAge: 5 * 60 * 1000, timeout: 10000, enableHighAccuracy: true }
    );
  }

  /**
   * GPS de precisão: fica ouvindo o aparelho (watchPosition) em vez de pegar
   * a primeira fixa (que pode ser grossa, via Wi-Fi). Chama onUpdate na 1ª
   * fixa e a cada melhora relevante; para quando a precisão fica boa (<30m).
   */
  function preciseFix(onUpdate, onError){
    if(!navigator.geolocation){ onError({ code: 0 }); return () => {}; }
    let bestAcc = Infinity;
    let watchId = null;
    const stop = () => { if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; } };
    watchId = navigator.geolocation.watchPosition((pos) => {
      const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity;
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const first = bestAcc === Infinity;
      const improved = acc < bestAcc * 0.8; // só vale se melhorar bastante
      if(!first && !improved) return;
      bestAcc = Math.min(bestAcc, acc);
      onUpdate(coords, acc, first);
      if(acc <= 30) stop(); // preciso o bastante — para de ouvir
    }, (err) => { stop(); onError(err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    return stop;
  }

  /**
   * Localização real e automática ao abrir a aba Rotas: pega o GPS do
   * aparelho, refina até precisão de rua e mostra o endereço no cartão
   * "Ponto de partida". Uma única vez por sessão; o botão repete quando quiser.
   */
  let autoLocateDone = false;
  function autoLocateOnce(){
    if(autoLocateDone || !navigator.geolocation) return;
    autoLocateDone = true;
    const valueEl = document.getElementById('startValue');
    if(valueEl && !startCoords) valueEl.textContent = 'Localizando você automaticamente...';
    let lastGeocodeAcc = Infinity;
    let geocoded = false;
    let bestCoords = null;
    let bestAcc = Infinity;
    preciseFix(async (coords, acc, first) => {
      regionCenter = coords;
      regionGeoTried = true;

      if(acc < bestAcc){
        bestAcc = acc;
        bestCoords = coords;
      }

      // Define startCoords quando precisão for razoável (<=200m) — cobre desktop e celular.
      if(acc <= 200){
        startCoords = coords;
        onFirstGpsFix(coords);
      }

      // Geocoda na 1ª fixa (para regionPlace) e quando precisão melhora
      const shouldGeocode = first || (acc <= 50 && lastGeocodeAcc > 50) || (!geocoded && acc <= 200);
      if(shouldGeocode){
        if(acc <= 50) lastGeocodeAcc = acc;
        geocoded = true;
        try{
          const photonRes = await fetch(`https://photon.komoot.io/reverse/?lon=${coords.lon}&lat=${coords.lat}&lang=default`)
            .then(r => r.ok ? r.json() : null).catch(() => null);

          const photonFeat = photonRes?.features?.[0];
          const photonProps = photonFeat?.properties || {};

          const bestLabel = photonFeat ? formatPhotonLabel(photonProps) : null;

          const cidade = photonProps.city || photonProps.county || photonProps.locality;
          if(cidade) regionPlace = { city: cidade, state: photonProps.state || null };

          if(valueEl && valueEl.isConnected){
            const base = bestLabel || 'Localização encontrada';
            valueEl.textContent = acc <= 50 ? base : `${base} (aprox.)`;
          }
        }catch(e){
          if(valueEl && valueEl.isConnected) valueEl.textContent = startCoords ? 'Localização encontrada (aprox.)' : 'Localizando você automaticamente...';
        }
      }
    }, () => {
      if(!startCoords && bestCoords){
        startCoords = bestCoords;
        regionCenter = bestCoords;
        onFirstGpsFix(bestCoords);
        if(valueEl && valueEl.isConnected) valueEl.textContent = 'Localização aproximada (' + Math.round(bestAcc) + 'm)';
      } else if(valueEl && !startCoords){
        valueEl.textContent = 'Toque no ✓ para liberar a localização (ou digite o endereço direto).';
      }
    });
  }
  function regionBbox(center, delta){
    const d = delta || 0.3; // ~30 km: cobre a cidade e o entorno imediato
    return `${center.lon - d},${center.lat - d},${center.lon + d},${center.lat + d}`;
  }

  async function photonFetch(query, fetchLimit, center, signal, osmTag){
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${fetchLimit}&lang=default`;
    if(center) url += `&bbox=${encodeURIComponent(regionBbox(center))}`;
    // Photon aceita múltiplos osm_tag como parâmetros separados
    if(osmTag){
      const tags = osmTag.split('|');
      for(var t = 0; t < tags.length; t++){
        url += `&osm_tag=${encodeURIComponent(tags[t])}`;
      }
    }
    const res = await fetch(url, signal ? { signal } : undefined);
    if(!res.ok) throw new Error('photon-fail');
    const data = await res.json();
    return (data.features || []).filter(f => f.properties && f.properties.countrycode === 'BR');
  }

  /**
   * Segunda fonte: Nominatim (mesmo dado OSM, índice de busca diferente —
   * acha ruas/bairros que o Photon perde em cidades pequenas). Resultado no
   * MESMO formato do Photon (properties.type/name/street/city/state...).
   */
  async function nominatimFetch(query, fetchLimit, signal){
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=br&limit=${fetchLimit}&addressdetails=1&format=json`;
    const res = await fetch(url, signal ? { signal } : undefined);
    if(!res.ok) throw new Error('nominatim-fail');
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(item => {
      const a = item.address || {};
      const cidade = a.city || a.town || a.village || a.municipality || a.suburb;
      return {
        properties: {
          type: item.type === 'house' ? 'house' : (a.road ? 'street' : (a.suburb || a.neighbourhood ? 'district' : 'other')),
          name: item.name || null,
          street: a.road || null,
          housenumber: a.house_number || null,
          district: a.suburb || a.neighbourhood || a.city_district || null,
          city: cidade || null,
          county: a.county || null,
          state: a.state || null,
          countrycode: (a.country_code || 'br').toUpperCase(),
        },
        geometry: { coordinates: [parseFloat(item.lon), parseFloat(item.lat)] },
      };
    }).filter(f => f.properties.countrycode === 'BR' && Number.isFinite(f.geometry.coordinates[1]));
  }

  /** Junta fontes sem duplicar (mesmo nome + mesma cidade, ou mesma lat/lon). */
  function mergeSources(...lists){
    const vistos = new Set();
    const result = [];
    for(const list of lists){
      for(const f of list){
        const p = f.properties;
        const nome = (p.name || p.street || '').toLowerCase();
        const cidade = (p.city || p.county || '').toLowerCase();
        const lat = f.geometry?.coordinates?.[1]?.toFixed(5) || '';
        const lon = f.geometry?.coordinates?.[0]?.toFixed(5) || '';
        const chave = nome ? `${nome}|${cidade}` : `${lat},${lon}`;
        if(vistos.has(chave)) continue;
        vistos.add(chave);
        result.push(f);
      }
    }
    return result;
  }

  /** Remove números soltos da busca: "popular 78 569" → "popular" (OSM raramente tem a numeração). */
  function streetWords(query){
    const words = query.trim().split(/\s+/).filter(w => !/^\d+$/.test(w));
    return words.join(' ');
  }

  /** Extrai palavras significativas (>= 3 chars) de uma query para matching. */
  function significantWords(query){
    return query.trim().split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)).map(w => w.toLowerCase());
  }

  /** Verifica se um feature contém alguma palavra-chave da query original. */
  function hasKeywordMatch(props, keywords){
    if(!keywords || keywords.length === 0) return true;
    const candidates = [props.name, props.street, props.district, props.city, props.county, props.locality]
      .filter(v => typeof v === 'string').map(v => v.toLowerCase());
    return keywords.some(kw => candidates.some(c => c.includes(kw)));
  }

  /** Verifica se o match é forte: palavra-chave aparece no campo rua/nome do feature
   *  (não só em bairro/cidade genérica). Ex: "popular" em "Rua Popular" = forte,
   *  "popular" em "Praça do Bairro Popular" = fraco (match só no nome do bairro). */
  function hasStrongMatch(props, keywords){
    if(!keywords || keywords.length === 0) return true;
    const streetFields = [props.street, props.housenumber]
      .filter(v => typeof v === 'string').map(v => v.toLowerCase());
    const nameField = typeof props.name === 'string' ? props.name.toLowerCase() : '';
    // Verifica também o valor OSM (pharmacy, restaurant, bakery, etc.)
    const osmValue = typeof props.osm_value === 'string' ? props.osm_value.toLowerCase() : '';
    // Match forte = keyword aparece no nome/rua/valor-osm do feature
    return keywords.some(kw => {
      const inStreet = streetFields.some(c => c.includes(kw));
      const inName = nameField.includes(kw);
      const inOsm = osmValue.includes(kw);
      return inStreet || inName || inOsm;
    });
  }

  /** Distância até o centro (para ordenar sugestões do mais perto pro mais longe). */
  function distToCenter(f, center){
    if(!center || !f.geometry || !Array.isArray(f.geometry.coordinates)) return Infinity;
    return haversineKm({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }, center);
  }

  async function photonSearch(query, limit, signal){
    const center = regionCenter || startCoords; // GPS, ou o ponto do "usar localização"
    const fetchLimit = Math.min(limit + 12, 20); // pede a mais p/ compensar os filtros
    const nomeRua = streetWords(query);
    const keywords = significantWords(query);

    // Busca com query dupla: normal + filtro POI (lojas, restaurantes, etc.)
    const tentar = async (q, c) => {
      if(!q.trim()) return [];
      const [fotNormal, fotPOI, nom] = await Promise.all([
        photonFetch(q, fetchLimit, c, signal).catch(err => (err && err.name === 'AbortError') ? Promise.reject(err) : []),
        photonFetch(q, fetchLimit, c, signal, 'shop|amenity|leisure').catch(() => []),
        nominatimFetch(q, fetchLimit, signal).catch(() => []),
      ]);
      return mergeSources(fotNormal, fotPOI, nom);
    };

    // 1) caixa do GPS + busca completa (com numeração + POI)
    let lista = await tentar(query, center);

    // 2) Filtro inteligente: se temos resultados mas NENHUM tem match forte
    //    (keyword aparece só em bairro/cidade, não em rua/nome), busca com rua limpa.
    //    Ex: "popular 78 569" → "Praça do Bairro Popular" tem match fraco → busca "popular"
    const hasStrong = lista.some(f => hasStrongMatch(f.properties, keywords));
    if(!hasStrong && nomeRua !== query.trim()){
      const stripped = await tentar(nomeRua, center);
      lista = lista.concat(stripped);
      // Se ainda não tem match forte, busca com cidade appended
      if(!lista.some(f => hasStrongMatch(f.properties, keywords))){
        if(regionPlace && regionPlace.city){
          const comCidade = await tentar(`${nomeRua}, ${regionPlace.city}`, null);
          lista = lista.concat(comCidade);
        }
      }
    }

    // Foca na cidade do usuário quando conhecida; se ela não veio na caixa
    // (cidades pequenas aparecem pouco no OSM), busca "rua, cidade" no Brasil todo.
    if(regionPlace && regionPlace.city){
      const daCidade = lista.filter(f => sameCity(f.properties, regionPlace));
      if(daCidade.length > 0){
        lista = daCidade;
      }else{
        const comCidade = await tentar(`${nomeRua}, ${regionPlace.city}`, null);
        const naCidade = comCidade.filter(f => sameCity(f.properties, regionPlace));
        if(naCidade.length > 0) lista = naCidade;
      }
    }
    // 3) nada em lugar nenhum: busca ampla no Brasil com a busca completa
    if(lista.length === 0){
      lista = await tentar(query, null);
    }

    // Ruas, números e bairros primeiro; POIs com match forte no nome ficam entre rua e bairro;
    // cidade e POIs genéricos depois; mesma cidade antes de fora; mais perto do GPS antes do mais longe.
    function isPOILike(props){
      var t = (props.type || '').toLowerCase();
      if(['shop','amenity','leisure','commercial','retail','tourism'].indexOf(t) >= 0) return true;
      // Photon retorna osm_key e osm_value como campos separados
      var osmKey = (props.osm_key || '').toLowerCase();
      var osmValue = (props.osm_value || '').toLowerCase();
      if(['shop','amenity','leisure','commercial','retail','tourism'].indexOf(osmKey) >= 0) return true;
      // Lojas e restaurante específicos
      var poiValues = ['pharmacy','restaurant','cafe','bar','bakery','supermarket',
        'convenience','clothes','electronics','hairdresser','car_repair','fuel'];
      if(poiValues.indexOf(osmValue) >= 0) return true;
      return false;
    }
    // Detecta se a query é uma categoria de POI (restaurante, farmácia, padaria, etc.)
    // e se o feature pertence a essa categoria via osm_value ou nome
    function categoryMatch(props, kws){
      if(!kws || kws.length === 0) return false;
      var osmVal = (props.osm_value || '').toLowerCase();
      var name = (props.name || '').toLowerCase();
      return kws.some(function(kw){
        if(osmVal && osmVal.indexOf(kw) >= 0) return true;
        if(name && name.indexOf(kw) >= 0) return true;
        return false;
      });
    }
    function rankOf(p){
      if(p.type === 'street' || p.type === 'house') return 0;
      // POIs com match na categoria da busca → entre rua e bairro
      if(isPOILike(p) && (hasStrongMatch(p, keywords) || categoryMatch(p, keywords))) return 0.5;
      if(p.type === 'district' || p.type === 'suburb' || p.type === 'quarter'
        || p.type === 'neighbourhood' || p.type === 'locality') return 1;
      if(p.type === 'city' || p.type === 'town' || p.type === 'village' || p.type === 'hamlet') return 2;
      return 3; // POIs genéricos e outros
    }
    lista = lista
      .map((f, i) => ({ f, i, d: distToCenter(f, center) }))
      .sort((a, b) => {
        const naCidadeA = regionPlace && sameCity(a.f.properties, regionPlace) ? 0 : 1;
        const naCidadeB = regionPlace && sameCity(b.f.properties, regionPlace) ? 0 : 1;
        if(naCidadeA !== naCidadeB) return naCidadeA - naCidadeB;
        const rank = rankOf(a.f.properties) - rankOf(b.f.properties);
        if(rank !== 0) return rank;
        if(a.d !== b.d) return a.d - b.d;
        return a.i - b.i;
      })
      .map((x) => x.f);
    return lista.slice(0, limit).map(f => ({
      label: formatPhotonLabel(f.properties),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0]
    }));
  }

  function haversineKm(a, b){
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  async function routeBetween(origem, destino){
    // 1) Cadeia inteligente: OSRM local (offline) → OSRM público → GraphHopper
    try{
      if(window.__motoboyRouteWithFallback){
        const r = await window.__motoboyRouteWithFallback(origem, destino);
        if(r && typeof r.km === 'number'){
          return { km: r.km, min: r.min, approx: !!r.approx };
        }
      }
    }catch(e){ /* segue para fallback */ }
    // 2) Plano B: linha reta com fator de correção viário + velocidade média urbana
    const km = haversineKm(origem, destino) * 1.3;
    const min = Math.round((km / 28) * 60);
    return { km, min, approx: true };
  }

  // Calcula a rota como uma cadeia sequencial de verdade: ponto de partida (se o motoboy
  // usou a localização) -> coleta do serviço 1 -> cada entrega do serviço 1 na ordem ->
  // coleta do serviço 2 -> entregas do serviço 2 -> ... Antes, a distância era só a soma de
  // trechos isolados coleta->entrega, o que ignorava o caminho até a primeira coleta e o
  // deslocamento entre um serviço e o próximo — subestimando a distância e o custo real.
  let chainToken = 0;

  async function computeRouteChain(){
    const pontos = [];
    if(startCoords) pontos.push(startCoords);
    let completo = true;
    routeServices.forEach(s => {
      if(s.coletaCoords){ pontos.push(s.coletaCoords); } else { completo = false; }
      s.entregas.forEach(e => {
        if(e.entregaCoords){ pontos.push(e.entregaCoords); } else { completo = false; }
      });
    });

    if(pontos.length < 2){
      return { totalKm: 0, totalMin: 0, approx: false, completo, pontos: pontos.length };
    }

    const myToken = ++chainToken;
    let totalKm = 0, totalMin = 0, anyApprox = false;
    for(let i = 0; i < pontos.length - 1; i++){
      const r = await routeBetween(pontos[i], pontos[i + 1]);
      totalKm += r.km;
      totalMin += r.min;
      if(r.approx) anyApprox = true;
    }
    if(myToken !== chainToken) return null; // uma cadeia mais nova começou; descarta esta

    return { totalKm, totalMin, approx: anyApprox, completo, pontos: pontos.length };
  }

  async function resolveColetaCoords(i){
    const s = routeServices[i];
    if(s.coletaCoords) return s.coletaCoords;
    const results = await photonSearch(s.coleta, 1);
    if(results.length === 0) return null;
    s.coletaCoords = { lat: results[0].lat, lon: results[0].lon };
    return s.coletaCoords;
  }

  async function resolveEntregaCoords(i, j){
    const e = routeServices[i].entregas[j];
    if(e.entregaCoords) return e.entregaCoords;
    const results = await photonSearch(e.entrega, 1);
    if(results.length === 0) return null;
    e.entregaCoords = { lat: results[0].lat, lon: results[0].lon };
    return e.entregaCoords;
  }

  async function calcularEntrega(i, j){
    const s = routeServices[i];
    const e = s.entregas[j];
    if(!s.coleta || !e.entrega) return;

    e.status = 'loading';
    updateRouteCalc(i, j);

    try{
      const [origem, destino] = await Promise.all([resolveColetaCoords(i), resolveEntregaCoords(i, j)]);
      if(!origem || !destino){
        e.status = 'error';
        e.errorMsg = 'Não encontramos um desses endereços.';
        updateRouteCalc(i, j);
        return;
      }
      const rota = await routeBetween(origem, destino);
      e.distancia = rota.km;
      e.tempo = rota.min;
      e.approx = rota.approx;
      e.approxConfirmed = false;
      e.status = 'ok';
      updateRouteCalc(i, j);
      renderRouteSummary();
    }catch(err){
      e.status = 'error';
      e.errorMsg = 'Deu um erro ao calcular. Tenta de novo.';
      updateRouteCalc(i, j);
    }
  }

  async function fetchSuggestions(query, boxEl, onPick, signal, isCurrent){
    requestRegionCenter(); // garante o centro regional (GPS) para priorizar a região
    try{
      const results = await photonSearch(query, 8, signal);
      if((signal && signal.aborted) || !isCurrent()) return;
      if(results.length === 0){
        boxEl.innerHTML = '<div class="suggest-empty">Nenhum endereço encontrado</div>';
        boxEl.classList.add('open');
        return;
      }
      boxEl.innerHTML = results.map((r, i) => `<button type="button" class="suggest-item" data-i="${i}">${safeText(r.label)}</button>`).join('');
      boxEl.classList.add('open');
      boxEl.querySelectorAll('.suggest-item').forEach((el, i) => {
        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('click', () => onPick(results[i]));
      });
    }catch(e){
      if(e.name === 'AbortError' || (signal && signal.aborted) || !isCurrent()) return;
      boxEl.innerHTML = '<div class="suggest-empty">Erro ao buscar endereços</div>';
      boxEl.classList.add('open');
    }
  }

  function updateRouteCalc(i, j){
    const el = document.getElementById(`routeCalc-${i}-${j}`);
    if(!el){ renderRouteSummary(); return; }
    const e = routeServices[i].entregas[j];
    const needsConfirm = e.status === 'ok' && e.approx && !e.approxConfirmed;
    el.className = 'route-calc' + (needsConfirm ? ' warn' : e.status === 'ok' ? ' ok' : e.status === 'error' ? ' error' : '');
    el.innerHTML = routeCalcHTML(e);

    const retry = el.querySelector('[data-action="retry"]');
    if(retry) retry.addEventListener('click', () => calcularEntrega(i, j));

    const confirmApprox = el.querySelector('[data-action="confirm-approx"]');
    if(confirmApprox) confirmApprox.addEventListener('click', () => {
      e.approxConfirmed = true;
      updateRouteCalc(i, j);
    });

    const manualKm = el.querySelector('[data-action="manual-km"]');
    if(manualKm) manualKm.addEventListener('change', () => {
      const km = parseBrazilianInput(manualKm.value);
      if(km && km > 0){
        e.distancia = km;
        e.tempo = Math.round((km / 28) * 60);
        e.approx = false;
        e.approxConfirmed = true;
        updateRouteCalc(i, j);
      }
    });

    updateServiceVerdict(i, j);
    renderRouteSummary();
  }

  function updateServiceVerdict(i, j){
    const el = document.getElementById(`verdict-${i}-${j}`);
    if(!el) return;
    const e = routeServices[i].entregas[j];
    if(e.status !== 'ok' || (e.approx && !e.approxConfirmed) || !e.valor || e.valor <= 0){
      el.className = 'service-verdict hidden';
      el.textContent = '';
      return;
    }
    const custo = round2((e.distancia / CONSUMO_ATUAL) * PRECO_ATUAL);
    const resultado = round2(e.valor - custo);
    if(resultado > 0){
      el.className = 'service-verdict profit';
      el.textContent = 'Vale a pena — lucro de ' + fmtBRL(resultado);
    }else if(resultado === 0){
      el.className = 'service-verdict equilibrio';
      el.textContent = 'Ponto de equilíbrio — não dá lucro nem prejuízo';
    }else{
      el.className = 'service-verdict loss';
      el.textContent = 'Não compensa — prejuízo de ' + fmtBRL(Math.abs(resultado));
    }
  }

  function entregaBlockHTML(e, i, j, canRemove){
    const entregaId = `entrega-endereco-${i}-${j}`;
    const valorId = `entrega-valor-${i}-${j}`;
    return `
      <div class="entrega-block">
        <div class="stop-row">
          <div class="stop-dot-col"><div class="stop-dot entrega"></div></div>
          <div class="stop-body">
            <label class="stop-label" for="${entregaId}">ENTREGA ${j + 1}</label>
            <input id="${entregaId}" type="text" class="field-input text" data-entrega-field="entrega" placeholder="Onde entregar? (rua, bairro, cidade)" value="${safeText(e.entrega)}" autocomplete="off" aria-controls="suggest-${i}-${j}-entrega">
            <div class="suggest-list" id="suggest-${i}-${j}-entrega" aria-live="polite"></div>
          </div>
          ${canRemove ? `<button type="button" class="entrega-remove" data-action="remove-entrega" aria-label="Remover entrega ${j + 1}">
            <svg class="icon" viewBox="0 0 24 24" style="width:15px;height:15px;"><path d="M6 6 18 18"/><path d="M18 6 6 18"/></svg>
          </button>` : ''}
        </div>
        <div class="service-meta-row">
          <div class="route-calc" id="routeCalc-${i}-${j}" aria-live="polite">${routeCalcHTML(e)}</div>
          <div class="field-group valor-group">
            <label class="field-label" for="${valorId}">VALOR R$</label>
            <input id="${valorId}" type="text" inputmode="decimal" class="field-input" data-entrega-field="valor" placeholder="0,00" value="${e.valor === null || e.valor === undefined ? '' : e.valor}" autocomplete="off">
          </div>
        </div>
      </div>
    `;
  }

  function serviceCardHTML(s, i){
    const entregasHTML = s.entregas.map((e, j) => entregaBlockHTML(e, i, j, s.entregas.length > 1)).join('');
    const clienteId = `servico-cliente-${i}`;
    const coletaId = `servico-coleta-${i}`;
    const titleId = `servico-titulo-${i}`;
    return `
      <div class="service-card" draggable="true" data-index="${i}" role="group" aria-labelledby="${titleId}">
        <div class="service-head">
          <div class="service-head-left">
            <span class="badge-num">${i + 1}</span>
            <span class="title" id="${titleId}">SERVIÇO ${i + 1}</span>
          </div>
          <button type="button" class="service-remove" data-action="remove" aria-label="Remover serviço ${i + 1}">
            <svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M6 6 18 18"/><path d="M18 6 6 18"/></svg>
          </button>
        </div>

        <div class="stop-row">
          <div class="stop-dot-col"><div class="stop-dot"></div><div class="stop-line"></div></div>
          <div class="stop-body">
            <label class="stop-label" for="${coletaId}">COLETA</label>
            <input id="${coletaId}" type="text" class="field-input text" data-field="coleta" placeholder="Onde buscar? (rua, bairro, cidade)" value="${safeText(s.coleta)}" autocomplete="off" aria-controls="suggest-${i}-coleta">
            <div class="suggest-list" id="suggest-${i}-coleta" aria-live="polite"></div>
          </div>
        </div>

        <div class="entregas-wrap">${entregasHTML}</div>

        <button type="button" class="add-entrega-btn" data-action="add-entrega">
          <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Adicionar outro destino desta coleta
        </button>

        <div class="field-group" style="margin-top:4px;">
          <span class="field-label">SITUAÇÃO DO PAGAMENTO</span>
          <div class="pago-toggle" role="group" aria-label="Situação do pagamento do serviço ${i + 1}">
            <button type="button" class="pago-toggle-btn ${s.paymentStatus === 'received' ? 'active' : ''}" data-action="set-payment" data-value="received">Recebe na hora</button>
            <button type="button" class="pago-toggle-btn ${s.paymentStatus === 'pending' ? 'active' : ''}" data-action="set-payment" data-value="pending">Fica pra depois</button>
          </div>
        </div>
        ${s.paymentStatus === 'pending' ? `
          <div class="field-group pending-client-field">
            <label class="field-label" for="${clienteId}">QUEM VAI PAGAR? (OBRIGATÓRIO)</label>
            <input id="${clienteId}" type="text" class="field-input text" data-field="cliente" placeholder="Ex: Restaurante do Zé" value="${safeText(s.cliente)}" aria-required="true">
            <div class="config-note">Quando você confirmar a rota, esse valor vai pra conta desse cliente na aba Clientes, esperando o pagamento.</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function routeCalcHTML(e){
    if(e.status === 'loading'){
      return `<div class="spinner"></div><span>Calculando distância...</span>`;
    }
    if(e.status === 'error'){
      return `<span>${e.errorMsg}</span> <span class="retry-link" data-action="retry">tentar de novo</span>`;
    }
    if(e.status === 'ok' && e.approx && !e.approxConfirmed){
      return `
        <div class="route-calc-warn-text">O serviço de rota falhou. Usamos uma distância aproximada em linha reta (${e.distancia.toFixed(1).replace('.', ',')} km) — pode estar errada perto de rios, rodovias ou retornos.</div>
        <div class="route-calc-warn-actions">
          <button type="button" class="btn-tiny" data-action="confirm-approx">Usar estimativa mesmo assim</button>
          <input type="text" inputmode="decimal" class="field-input manual-km-input" data-action="manual-km" placeholder="ou km real" aria-label="Informar km real" autocomplete="off">
        </div>
      `;
    }
    if(e.status === 'ok'){
      return '<span>Trajeto calculado</span>';
    }
    return `<span>Preenche a coleta e a entrega pra calcular</span>`;
  }

  function wireEnderecoInput(inp, suggestBox, onResolved){
    let activeController = null;
    let searchVersion = 0;

    const scheduleSearch = debounce(() => {
      const query = inp.value.trim();
      const version = searchVersion;
      if(query.length < 3) return;

      const controller = typeof AbortController !== 'undefined'
        ? new AbortController()
        : { signal:null, abort:function(){} };
      activeController = controller;
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 6000);
      const isCurrent = () => version === searchVersion && inp.value.trim() === query;

      suggestBox.innerHTML = '<div class="suggest-empty">Buscando endereços...</div>';
      suggestBox.classList.add('open');
      const suggestionRequest = fetchSuggestions(query, suggestBox, (picked) => {
        if(!isCurrent()) return;
        inp.value = picked.label;
        onResolved.setText(picked.label);
        onResolved.setCoords(picked.lat, picked.lon);
        suggestBox.classList.remove('open');
        onResolved.tryCalc();
      }, controller.signal, isCurrent);
      const finishSearch = () => {
        clearTimeout(timeoutId);
        if(activeController === controller) activeController = null;
        if(timedOut && isCurrent()){
          suggestBox.innerHTML = '<div class="suggest-empty">A busca demorou demais. Continue digitando ou tente novamente.</div>';
          suggestBox.classList.add('open');
        }
      };
      suggestionRequest.then(finishSearch, finishSearch);
    }, 350);

    inp.addEventListener('input', () => {
      searchVersion += 1;
      if(activeController){ activeController.abort(); activeController = null; }
      onResolved.setText(inp.value);
      onResolved.clearCoords();
      onResolved.setStatus('idle');
      onResolved.refresh();
      if(inp.value.trim().length >= 3){
        scheduleSearch();
      }else{
        suggestBox.classList.remove('open');
      }
    });

    inp.addEventListener('blur', () => {
      setTimeout(() => {
        searchVersion += 1;
        if(activeController){ activeController.abort(); activeController = null; }
        suggestBox.classList.remove('open');
        onResolved.tryCalc();
      }, 150);
    });
  }

  function renderServices(){
    const container = document.getElementById('serviceList');
    container.innerHTML = routeServices.map((s, i) => serviceCardHTML(s, i)).join('');

    container.querySelectorAll('.service-card').forEach(card => {
      const idx = parseInt(card.dataset.index);
      const s = routeServices[idx];

      card.addEventListener('dragstart', () => { dragSrcIndex = idx; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); });
      card.addEventListener('dragover', e => e.preventDefault());
      card.addEventListener('drop', e => {
        e.preventDefault();
        if(dragSrcIndex === null || dragSrcIndex === idx) return;
        const [moved] = routeServices.splice(dragSrcIndex, 1);
        routeServices.splice(idx, 0, moved);
        dragSrcIndex = null;
        renderServices();
        renderRouteSummary();
      });

      card.querySelector('[data-action="remove"]').addEventListener('click', () => {
        if(routeServices.length <= 1){ showToast('A rota precisa ter pelo menos um serviço.', {kind:'warning'}); return; }
        routeServices.splice(idx, 1);
        renderServices();
        renderRouteSummary();
      });

      // cliente pagador / recebimento posterior
      const clienteInp = card.querySelector('[data-field="cliente"]');
      if(clienteInp) clienteInp.addEventListener('input', () => {
        s.cliente = clienteInp.value;
        renderRouteSummary();
      });
      card.querySelectorAll('[data-action="set-payment"]').forEach(btn => {
        btn.addEventListener('click', () => {
          s.paymentStatus = btn.dataset.value;
          renderServices();
          renderRouteSummary();
        });
      });

      // coleta (única por serviço) — recalcula todas as entregas se o endereço mudar
      const coletaInp = card.querySelector('[data-field="coleta"]');
      const coletaSuggest = card.querySelector(`#suggest-${idx}-coleta`);
      wireEnderecoInput(coletaInp, coletaSuggest, {
        setText: (v) => { s.coleta = v; },
        clearCoords: () => { s.coletaCoords = null; s.entregas.forEach(e => e.status = 'idle'); },
        setStatus: () => {},
        setCoords: (lat, lon) => { s.coletaCoords = { lat, lon }; updateRouteMap(); },
        refresh: () => { s.entregas.forEach((e, j) => updateRouteCalc(idx, j)); },
        tryCalc: () => { s.entregas.forEach((e, j) => { if(s.coleta && e.entrega){ calcularEntrega(idx, j); } }); }
      });

      // cada bloco de entrega
      card.querySelectorAll('.entrega-block').forEach((block, j) => {
        const e = s.entregas[j];

        const removeEntregaBtn = block.querySelector('[data-action="remove-entrega"]');
        if(removeEntregaBtn){
          removeEntregaBtn.addEventListener('click', () => {
            if(s.entregas.length <= 1) return;
            s.entregas.splice(j, 1);
            renderServices();
            renderRouteSummary();
          });
        }

        const entregaInp = block.querySelector('[data-entrega-field="entrega"]');
        const entregaSuggest = block.querySelector(`#suggest-${idx}-${j}-entrega`);
        wireEnderecoInput(entregaInp, entregaSuggest, {
          setText: (v) => { e.entrega = v; },
          clearCoords: () => { e.entregaCoords = null; e.status = 'idle'; },
          setStatus: () => {},
          setCoords: (lat, lon) => { e.entregaCoords = { lat, lon }; updateRouteMap(); },
          refresh: () => { updateRouteCalc(idx, j); },
          tryCalc: () => { if(s.coleta && e.entrega){ calcularEntrega(idx, j); } }
        });

        const valorInp = block.querySelector('[data-entrega-field="valor"]');
        valorInp.addEventListener('input', () => {
          e.valor = parseBrazilianInput(valorInp.value);
          updateServiceVerdict(idx, j);
          renderRouteSummary();
        });
      });

      card.querySelector('[data-action="add-entrega"]').addEventListener('click', () => {
        s.entregas.push(newEntrega());
        renderServices();
        renderRouteSummary();
      });
    });
  }

  function shortenAddress(full){
    return full.split(',').slice(0, 3).join(',').trim();
  }

  function locateMe(){
    const valueEl = document.getElementById('startValue');
    if(!navigator.geolocation){
      valueEl.textContent = 'Seu navegador não suporta localização automática.';
      return;
    }
    valueEl.textContent = 'Localizando...';
    let lastGeocodeAcc = Infinity;
    let geocoded = false;
    let bestCoords = null;
    let bestAcc = Infinity;
    preciseFix(async (coords, acc, first) => {
      regionCenter = coords;
      regionGeoTried = true;

      if(acc < bestAcc){
        bestAcc = acc;
        bestCoords = coords;
      }

      if(acc <= 200){
        startCoords = coords;
        onFirstGpsFix(coords);
      }

      const shouldGeocode = first || (acc <= 50 && lastGeocodeAcc > 50) || (!geocoded && acc <= 200);
      if(shouldGeocode){
        if(acc <= 50) lastGeocodeAcc = acc;
        geocoded = true;
        try{
          const photonRes = await fetch(`https://photon.komoot.io/reverse/?lon=${coords.lon}&lat=${coords.lat}&lang=default`)
            .then(r => r.ok ? r.json() : null).catch(() => null);

          const photonFeat = photonRes?.features?.[0];
          const photonProps = photonFeat?.properties || {};

          const bestLabel = photonFeat ? formatPhotonLabel(photonProps) : null;

          const cidade = photonProps.city || photonProps.county || photonProps.locality;
          if(cidade) regionPlace = { city: cidade, state: photonProps.state || null };

          if(valueEl && valueEl.isConnected){
            const base = bestLabel || 'Localização encontrada';
            valueEl.textContent = acc <= 50 ? base : `${base} (aprox.)`;
          }
        }catch(e){
          if(valueEl && valueEl.isConnected) valueEl.textContent = startCoords ? 'Localização encontrada (aprox.)' : 'Localizando...';
        }
      }
    }, (err) => {
      // Se não conseguiu GPS bom, usa a melhor estimativa
      if(!startCoords && bestCoords){
        startCoords = bestCoords;
        regionCenter = bestCoords;
        onFirstGpsFix(bestCoords);
        if(valueEl && valueEl.isConnected) valueEl.textContent = 'Localização aproximada (' + Math.round(bestAcc) + 'm)';
      } else if(err && err.code === 1){
        valueEl.textContent = 'Permissão de localização negada — libere nas configurações do navegador e toque de novo.';
      }else if(err && err.code === 2){
        valueEl.textContent = 'Sinal de GPS indisponível agora — tente novamente em instantes.';
      }else{
        valueEl.textContent = 'Não deu para localizar — toque no botão para tentar de novo.';
      }
    });
  }
  document.getElementById('btnUseLocation').addEventListener('click', locateMe);

  function allEntregas(){
    return routeServices.reduce((items, s) => {
      s.entregas.forEach(e => items.push(Object.assign({}, e, { cliente:s.cliente, paymentStatus:s.paymentStatus })));
      return items;
    }, []);
  }

  function renderRouteSummary(){
    const all = allEntregas();
    const totalValue = all.reduce((s, x) => s + (x.valor || 0), 0);
    const hasFuelConfig = CONSUMO_ATUAL > 0 && PRECO_ATUAL > 0;
    const hasMissingFields = routeServices.some(service =>
      !service.coleta.trim() || service.entregas.some(entrega =>
        !entrega.entrega.trim() || !entrega.valor || entrega.valor <= 0
      )
    );
    const isCalculating = all.some(item => item.status === 'loading');
    const hasCalculationError = all.some(item => item.status === 'error');
    const allCalculated = all.length > 0 && all.every(item => item.status === 'ok');
    const missingClient = routeServices.some(service =>
      service.paymentStatus === 'pending' && !service.cliente.trim()
    );
    const needsApproxConfirm = all.some(item => item.status === 'ok' && item.approx && !item.approxConfirmed);

    // dispara o cálculo em cadeia (partida -> coleta -> entregas na ordem) de forma assíncrona;
    // enquanto não volta, mostramos o último total conhecido
    if(allCalculated){
      computeRouteChain().then(chain => {
        if(!chain) return; // token velho, ignora
        lastChain = chain;
        paintRouteTotals(chain, totalValue, hasFuelConfig, allCalculated && !needsApproxConfirm);
      });
      // Se ainda não temos dados (primeiro cálculo), mostra loading
      if(lastChain.pontos === 0 || lastChain.totalKm === 0){
        document.getElementById('routeTotalKm').textContent = 'Calculando...';
        document.getElementById('routeTotalMin').textContent = '...';
        document.getElementById('routeTotalCusto').textContent = '—';
        document.getElementById('routeResultado').textContent = '—';
        document.getElementById('routeResultado').style.color = 'var(--muted)';
      } else {
        paintRouteTotals(lastChain, totalValue, hasFuelConfig, allCalculated && !needsApproxConfirm);
      }
    } else if(isCalculating){
      // Mostra loading enquanto calcula individualmente
      if(lastChain.totalKm === 0){
        document.getElementById('routeTotalKm').textContent = 'Calculando...';
        document.getElementById('routeTotalMin').textContent = '...';
      } else {
        paintRouteTotals(lastChain, totalValue, hasFuelConfig, false);
      }
    } else {
      paintRouteTotals(lastChain, totalValue, hasFuelConfig, allCalculated && !needsApproxConfirm);
    }

    const confirmButton = document.getElementById('btnConfirmRoute');
    const confirmLabel = document.getElementById('confirmRouteLabel');
    const dockStatus = document.getElementById('routeDockStatus');
    let ready = false;
    let buttonText = 'Complete os dados';
    let statusText = 'Preencha os endereços e os valores da rota.';

    if(isCalculating){
      buttonText = 'Calculando rota...';
      statusText = 'Aguarde o cálculo da distância e do tempo.';
    }else if(hasMissingFields){
      buttonText = 'Complete os dados';
      statusText = 'Preencha os endereços e os valores da rota.';
    }else if(hasCalculationError){
      buttonText = 'Revise os endereços';
      statusText = 'Existe um endereço que não pôde ser calculado.';
    }else if(!allCalculated){
      buttonText = 'Aguarde o cálculo';
      statusText = 'A rota ainda precisa concluir o cálculo.';
    }else if(needsApproxConfirm){
      buttonText = 'Confirme a distância estimada';
      statusText = 'A rota usou distância aproximada. Confirme ou informe o km real antes de seguir.';
    }else if(!hasFuelConfig){
      buttonText = 'Configure moto e combustível';
      statusText = 'Informe o consumo da moto e registre um abastecimento.';
    }else if(missingClient){
      buttonText = 'Informe o cliente';
      statusText = 'Uma entrega a receber precisa estar vinculada a um cliente.';
    }else{
      ready = true;
      buttonText = 'Confirmar rota';
      statusText = 'Rota completa e pronta para confirmação.';
    }

    confirmButton.disabled = !ready;
    confirmLabel.textContent = buttonText;
    dockStatus.textContent = statusText;

    const confirmation = document.getElementById('routeConfirmation');
    if(confirmation) confirmation.classList.remove('open');
  }

  let lastChain = { totalKm: 0, totalMin: 0, approx: false, completo: true, pontos: 0 };

  function paintRouteTotals(chain, totalValue, hasFuelConfig, custoValido){
    const totalKm = chain ? chain.totalKm : 0;
    const totalMin = chain ? chain.totalMin : 0;
    const prefix = chain && chain.approx ? '≈ ' : '';
    const parcial = chain && !chain.completo ? ' · parcial' : '';

    // Se está calculando e não tem dados ainda, não sobrescreve "Calculando..."
    if(!chain || (chain.pontos === 0 && !chain.completo)){
      return;
    }

    document.getElementById('routeTotalKm').textContent = prefix + totalKm.toFixed(1).replace('.', ',') + ' km' + parcial;
    document.getElementById('routeTotalMin').textContent = prefix + totalMin + ' min';

    const custo = (hasFuelConfig && custoValido) ? round2((totalKm / CONSUMO_ATUAL) * PRECO_ATUAL) : null;
    const resultado = custo === null ? null : round2(totalValue - custo);

    document.getElementById('routeTotalCusto').textContent = custo === null ? '—' : fmtBRL(custo);
    const resEl = document.getElementById('routeResultado');
    resEl.textContent = resultado === null ? '—' : fmtBRL(resultado);
    resEl.style.color = resultado === null ? 'var(--muted)' : resultado > 0 ? 'var(--green)' : resultado < 0 ? 'var(--red)' : 'var(--text)';
  }

  document.getElementById('btnAddService').addEventListener('click', () => {
    routeServices.push(newService());
    renderServices();
    renderRouteSummary();
  });

  let routeHistoryFiltersReady = false;
  function routeHistoryMonthLabel(month){
    const date = new Date(2026, Number(month) - 1, 1);
    const label = new Intl.DateTimeFormat('pt-BR', { month:'long' }).format(date);
    return label.replace(/^./, letter => letter.toUpperCase());
  }
  function routeHistoryYears(){
    const years = new Set([APP_NOW.getFullYear()]);
    confirmedRoutes.forEach(route => {
      const year = Number(String(route.dateISO || '').slice(0, 4));
      if(year > 2000) years.add(year);
    });
    return [...years].sort((a, b) => b - a);
  }
  function initRouteHistoryFilters(){
    const monthSelect = document.getElementById('routeHistoryMonth');
    const yearSelect = document.getElementById('routeHistoryYear');
    if(!monthSelect || !yearSelect) return;
    const selectedMonth = monthSelect.value || pad2(APP_NOW.getMonth() + 1);
    const selectedYear = yearSelect.value || String(APP_NOW.getFullYear());
    monthSelect.innerHTML = Array.from({ length:12 }, (_, index) => {
      const value = pad2(index + 1);
      return `<option value="${value}">${routeHistoryMonthLabel(value)}</option>`;
    }).join('');
    yearSelect.innerHTML = routeHistoryYears().map(year => `<option value="${year}">${year}</option>`).join('');
    monthSelect.value = selectedMonth;
    yearSelect.value = routeHistoryYears().includes(Number(selectedYear)) ? selectedYear : String(APP_NOW.getFullYear());
    if(!routeHistoryFiltersReady){
      monthSelect.addEventListener('change', renderRouteHistory);
      yearSelect.addEventListener('change', renderRouteHistory);
      routeHistoryFiltersReady = true;
    }
  }
  function routeHistoryNumber(value){
    if(value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function routeHistoryDate(route){
    const date = localDateFromISO(route.dateISO);
    if(!date) return safeText(route.data || 'Data não registrada');
    const formatted = new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(date);
    return formatted + (route.hora ? ` · ${safeText(route.hora)}` : '');
  }
  function routeHistoryResult(route){
    const stored = routeHistoryNumber(route.resultado);
    if(stored !== null) return stored;
    const total = routeHistoryNumber(route.valorTotal);
    const fuel = routeHistoryNumber(route.custoCombustivel);
    return total !== null && fuel !== null ? round2(total - fuel) : null;
  }
  function routeHistoryDetailsHTML(route){
    const services = Array.isArray(route.services) ? route.services : [];
    const routeTotal = routeHistoryNumber(route.valorTotal);
    const inferredTotal = routeTotal !== null
      ? routeTotal
      : round2((routeHistoryNumber(route.recebidoNaHora) || 0) + (routeHistoryNumber(route.pendente) || 0));
    const servicesHTML = services.length === 0
      ? '<div class="route-history-legacy">Esta rota foi registrada antes do histórico detalhado. Tempo, combustível e endereços não estavam sendo salvos.</div>'
      : `<div class="route-history-section-title">ORDEM DA ROTA</div>${services.map((service, serviceIndex) => {
          const isPending = service.paymentStatus === 'pending';
          const paymentText = isPending
            ? `A receber${service.cliente ? ' de ' + safeText(service.cliente) : ''}`
            : 'Recebido na hora';
          const deliveries = Array.isArray(service.entregas) ? service.entregas : [];
          return `<div class="route-history-service">
            <div class="route-history-service-head">
              <b>Serviço ${serviceIndex + 1}</b>
              <span class="route-history-payment">${paymentText}</span>
            </div>
            <div class="route-history-stop">
              <span class="route-history-stop-dot"></span>
              <div class="route-history-stop-main">
                <div class="route-history-stop-label">COLETA</div>
                <div class="route-history-stop-value">${safeText(service.coleta || 'Endereço não registrado')}</div>
              </div>
            </div>
            ${deliveries.map((delivery, deliveryIndex) => `<div class="route-history-stop delivery">
              <span class="route-history-stop-dot"></span>
              <div class="route-history-stop-main">
                <div class="route-history-stop-label">ENTREGA ${deliveryIndex + 1}</div>
                <div class="route-history-stop-value">${safeText(delivery.endereco || 'Endereço não registrado')}</div>
              </div>
              <div class="route-history-stop-price">${fmtBRL(routeHistoryNumber(delivery.valor) || 0)}</div>
            </div>`).join('')}
          </div>`;
        }).join('')}`;
    return `${servicesHTML}
      <div class="route-history-section-title">VALORES DA ROTA</div>
      <div class="route-history-finance">
        <div class="route-history-finance-row"><span>Valor total</span><b>${fmtBRL(inferredTotal)}</b></div>
        <div class="route-history-finance-row"><span>Recebido na hora</span><b>${fmtBRL(routeHistoryNumber(route.recebidoNaHora) || 0)}</b></div>
        <div class="route-history-finance-row"><span>A receber</span><b>${fmtBRL(routeHistoryNumber(route.pendente) || 0)}</b></div>
      </div>
      ${route.id && route.status === 'pending' ? `<button type="button" class="route-resume-btn" data-resume-route="${safeText(route.id)}">Retomar confirmação</button>` : ''}
      ${route.id ? `<button type="button" class="route-cancel-btn" data-cancel-route="${safeText(route.id)}">Cancelar esta rota</button>
      <div class="route-cancel-note">Cancelar desfaz o que entrou no faturamento e a conta criada no cliente. Não dá pra desfazer o cancelamento.</div>` : ''}`;
  }
  function renderRouteHistory(){
    const list = document.getElementById('routeHistoryList');
    const monthSelect = document.getElementById('routeHistoryMonth');
    const yearSelect = document.getElementById('routeHistoryYear');
    if(!list || !monthSelect || !yearSelect) return;
    if(!monthSelect.options.length || !yearSelect.options.length) initRouteHistoryFilters();
    const monthKey = `${yearSelect.value}-${monthSelect.value}`;
    const routes = confirmedRoutes.filter(route => String(route.dateISO || '').slice(0, 7) === monthKey);
    if(routes.length === 0){
      list.innerHTML = `<div class="route-history-empty">Nenhuma rota confirmada em ${safeText(routeHistoryMonthLabel(monthSelect.value))} de ${safeText(yearSelect.value)}.</div>`;
      return;
    }
    list.innerHTML = routes.map((route, index) => {
      const distance = routeHistoryNumber(route.distancia);
      const time = routeHistoryNumber(route.tempoMin);
      const fuel = routeHistoryNumber(route.custoCombustivel);
      const result = routeHistoryResult(route);
      const resultClass = result === null ? '' : result > 0 ? 'positive' : result < 0 ? 'negative' : '';
      const detailsId = `route-history-details-${index}`;
      return `<article class="route-history-card${route.status === 'pending' ? ' pending' : ''}">
        <button type="button" class="route-history-summary" data-route-history-toggle aria-expanded="false" aria-controls="${detailsId}">
          <div class="route-history-head">
            <div>
              <div class="route-history-title">${route.count || 0} entrega${route.count === 1 ? '' : 's'}${route.status === 'pending' ? ' · <span class="route-pending-badge">Pendente</span>' : ''}</div>
              <div class="route-history-date">${routeHistoryDate(route)}</div>
            </div>
            <span class="route-history-chevron" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
          </div>
          <div class="route-history-metrics">
            <div class="route-history-metric"><div class="label">TEMPO</div><div class="value">${time === null ? 'Não registrado' : Math.round(time) + ' min'}</div></div>
            <div class="route-history-metric"><div class="label">KM</div><div class="value">${distance === null ? 'Não registrado' : distance.toFixed(1).replace('.', ',') + ' km'}</div></div>
            <div class="route-history-metric"><div class="label">COMBUSTÍVEL</div><div class="value">${fuel === null ? 'Não registrado' : fmtBRL(fuel)}</div></div>
            <div class="route-history-metric"><div class="label">RESULTADO</div><div class="value ${resultClass}">${result === null ? 'Não registrado' : resultBRL(result)}</div></div>
          </div>
        </button>
        <div class="route-history-details" id="${detailsId}" hidden>${routeHistoryDetailsHTML(route)}</div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-route-history-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const details = document.getElementById(button.getAttribute('aria-controls'));
        const opening = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(opening));
        details.hidden = !opening;
      });
    });
    list.querySelectorAll('[data-resume-route]').forEach(button => {
      button.addEventListener('click', async () => {
        const route = confirmedRoutes.find(item => item.id === button.dataset.resumeRoute);
        await resumePendingRoute(route);
      });
    });
    list.querySelectorAll('[data-cancel-route]').forEach(button => {
      button.addEventListener('click', () => {
        if(!ensureClientesInteractive()) return;
        const routeId = button.dataset.cancelRoute;
        const bloqueio = routeCancelBlockReason(routeId);
        if(bloqueio){
          showToast(bloqueio, {kind:'warning'});
          return;
        }
        requestDeleteConfirmation(
          'Cancelar esta rota?',
          'A entrada que ela gerou no faturamento e a conta criada no cliente serão desfeitas. Isso não pode ser revertido.',
          () => cancelConfirmedRoute(routeId)
        );
      });
    });
  }

  let activePendingRouteId = null;

  function upsertRouteLocally(route){
    const existingIdx = confirmedRoutes.findIndex(item => item.id === route.id);
    if(existingIdx >= 0) confirmedRoutes[existingIdx] = route;
    else confirmedRoutes.unshift(route);
    saveLocalState();
    initRouteHistoryFilters();
    renderRouteHistory();
    renderDashboard();
  }

  function showRouteConfirmationSuccess(route){
    const confirmation = document.getElementById('routeConfirmation');
    const confirmationMessage = document.getElementById('routeConfirmationMessage');
    const viewClientsButton = document.getElementById('btnViewPendingClients');
    if(!confirmation || !confirmationMessage || !viewClientsButton) return;

    confirmationMessage.innerHTML = route.pendente > 0
      ? `<b>Rota confirmada</b>${fmtBRL(route.recebidoNaHora)} recebido e ${fmtBRL(route.pendente)} enviado para Clientes.`
      : '<b>Rota confirmada</b>O valor recebido já entrou no resultado do mês.';
    viewClientsButton.style.display = route.pendente > 0 ? 'block' : 'none';

    let startRouteBtn = document.getElementById('btnStartActiveRoute');
    if(!startRouteBtn){
      startRouteBtn = document.createElement('button');
      startRouteBtn.type = 'button';
      startRouteBtn.id = 'btnStartActiveRoute';
      startRouteBtn.className = 'view-clients';
      startRouteBtn.style.cssText = 'background:var(--green);color:#fff;margin-top:8px;display:block;width:100%;';
      startRouteBtn.textContent = '📍 Iniciar Rota (Navegação)';
      confirmation.appendChild(startRouteBtn);
    }
    startRouteBtn.style.display = 'block';
    startRouteBtn.onclick = function(){
      confirmation.classList.remove('open');
      startActiveRouteMode();
    };
    confirmation.classList.add('open');
  }

  function completeRouteConfirmationLocally(route){
    activePendingRouteId = null;
    upsertRouteLocally(route);

    const billingAlreadyExists = entradas.some(entry => entry.routeId === route.id);
    if(route.recebidoNaHora > 0 && !billingAlreadyExists){
      entradas.unshift({
        desc:`Rota confirmada · ${route.count} entrega(s)`,
        valor:route.recebidoNaHora,
        data:'Hoje',
        dateISO:route.dateISO,
        routeId:route.id
      });
    }

    routeServices = [ newService() ];
    saveLocalState();
    renderRouteHistory();
    renderClientes();
    renderFaturamento();
    renderDashboard();
    renderServices();
    renderRouteSummary();
    showRouteConfirmationSuccess(route);
  }

  const routeConfirmationOrchestrator = createRouteConfirmationOrchestrator({
    generateRouteId: () => `rota-${crypto.randomUUID()}`,
    generateServiceId: () => `svc-${crypto.randomUUID()}`,
    async saveRoute(route){
      if(!window.__motoboyRotas) throw new Error('Ponte de rotas indisponível.');
      await window.__motoboyRotas.save(route);
    },
    persistPendingLocally(route){
      upsertRouteLocally(route);
    },
    async applyFinancialPendings(items, routeId){
      clientes = await applyRouteFinancialPendings(items, routeId);
      saveLocalState();
      renderClientes();
      renderDashboard();
    },
    completeLocally(route){
      completeRouteConfirmationLocally(route);
    }
  });

  function reportRouteConfirmationFailure(result){
    if(result.outcome === 'busy') return;
    if(result.outcome === 'terminal'){
      showToast('Esta rota já foi confirmada.', {kind:'warning'});
      return;
    }
    if(result.outcome === 'confirmed') return;

    console.error(`[Rota] Falha na confirmação (${result.failedPhase}):`, result.error);
    if(result.outcome === 'pending') activePendingRouteId = result.route.id;

    if(result.outcome === 'confirmed-local-failure'){
      showToast('A rota foi confirmada, mas a tela não concluiu a atualização local. Recarregue o aplicativo.', {kind:'error'});
      return;
    }

    if(result.failedPhase === 'financial-pendings'){
      showToast('Erro ao salvar pendências no servidor. A rota ficou pendente e pode ser retomada.', {kind:'error'});
      return;
    }
    if(result.failedPhase === 'confirmed-route'){
      showToast('Erro ao concluir a confirmação. A rota ficou pendente e pode ser retomada.', {kind:'error'});
      return;
    }
    if(result.failedPhase === 'preparation'){
      showToast('Não foi possível preparar a rota para confirmação.', {kind:'error'});
      return;
    }
    showToast('Erro ao salvar a rota. Tente novamente.', {kind:'error'});
  }

  async function runRouteConfirmation(request){
    const confirmation = document.getElementById('routeConfirmation');
    if(confirmation) confirmation.classList.remove('open');
    const result = await routeConfirmationOrchestrator.confirm(request);
    reportRouteConfirmationFailure(result);
    return result;
  }

  async function resumePendingRoute(route){
    if(!route || route.status !== 'pending') return;
    const hasPending = Array.isArray(route.services)
      && route.services.some(service => service.paymentStatus !== 'received');
    if(hasPending && !ensureClientesInteractive()) return;
    activePendingRouteId = route.id;
    await runRouteConfirmation({ kind:'pending', route });
  }

  document.getElementById('btnConfirmRoute').addEventListener('click', async () => {
    const hasPending = routeServices.some(s => s.paymentStatus === 'pending');
    if(hasPending && !ensureClientesInteractive()) return;

    const pendingAttempt = activePendingRouteId
      ? confirmedRoutes.find(route => route.id === activePendingRouteId && route.status === 'pending')
      : null;
    if(pendingAttempt){
      await resumePendingRoute(pendingAttempt);
      return;
    }

    const all = allEntregas();
    const invalido = all.some(e => e.status !== 'ok' || !e.valor || e.valor <= 0);
    if(invalido || all.length === 0){
      showToast('Preenche a coleta e todas as entregas (esperando o cálculo terminar) e o valor de cada uma antes de confirmar.', {kind:'warning'});
      return;
    }
    const needsApproxConfirm = all.some(e => e.approx && !e.approxConfirmed);
    if(needsApproxConfirm){
      showToast('Tem uma distância que foi só estimada (o serviço de rota falhou). Confirma a estimativa ou informa o km real em cada entrega marcada antes de fechar a rota.', {kind:'warning'});
      return;
    }
    const pendingWithoutClient = routeServices.findIndex(s => s.paymentStatus === 'pending' && !s.cliente.trim());
    if(pendingWithoutClient >= 0){
      showToast(`Informe o cliente pagador do serviço ${pendingWithoutClient + 1} antes de confirmar. Esse nome é necessário para criar a conta a receber.`, {kind:'warning'});
      return;
    }

    // Resolve clientId para serviços pendentes antes de enviar ao orquestrador
    for(const s of routeServices){
      if(s.paymentStatus === 'pending' && s.cliente.trim()){
        const nomeLower = s.cliente.trim().toLowerCase();
        const matches = clientes.filter(c => c.nome.toLowerCase() === nomeLower);
        if(matches.length > 1){
          showToast(`Existem ${matches.length} clientes com o nome "${s.cliente.trim()}". Renomeie um deles na aba Clientes antes de confirmar.`, {kind:'error'});
          return;
        }
        if(matches.length === 1 && matches[0].id){
          s.clientId = matches[0].id;
        }
      }
    }

    await runRouteConfirmation({
      kind:'draft',
      services:routeServices,
      async buildRouteData(servicesSnapshot){
        // distância real da rota inteira (cadeia sequencial), não soma de trechos soltos
        const chain = await computeRouteChain();
        const deliveries = servicesSnapshot.flatMap(service => service.entregas);
        const totalKm = chain ? chain.totalKm : deliveries.reduce((sum, item) => sum + (item.distancia || 0), 0);
        const totalMin = chain ? chain.totalMin : deliveries.reduce((sum, item) => sum + (item.tempo || 0), 0);
        const valorTotal = round2(servicesSnapshot.reduce((sum, service) => sum + service.valorTotal, 0));
        let recebidoNaHora = 0;
        let pendenteTotal = 0;
        servicesSnapshot.forEach(service => {
          if(service.paymentStatus === 'received') recebidoNaHora += service.valorTotal;
          else pendenteTotal += service.valorTotal;
        });
        recebidoNaHora = round2(recebidoNaHora);
        pendenteTotal = round2(pendenteTotal);
        const custoCombustivel = CONSUMO_ATUAL > 0 && PRECO_ATUAL > 0
          ? round2((totalKm / CONSUMO_ATUAL) * PRECO_ATUAL)
          : null;
        const confirmedAt = new Date();
        return {
          count:deliveries.length,
          distancia:totalKm,
          tempoMin:totalMin,
          valorTotal,
          custoCombustivel,
          resultado:custoCombustivel === null ? null : round2(valorTotal - custoCombustivel),
          recebidoNaHora,
          pendente:pendenteTotal,
          data:'Hoje',
          dateISO:toISODateLocal(confirmedAt),
          hora:confirmedAt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
          createdAt:confirmedAt.toISOString(),
          consumoKmL:CONSUMO_ATUAL,
          precoLitro:PRECO_ATUAL,
          aproximada:Boolean(chain && chain.approx)
        };
      }
    });
  });

  document.getElementById('btnViewPendingClients').addEventListener('click', () => setView('clientes'));

  // ============ MAPA NA CRIAÇÃO DE ROTA ============
  let routeMapInitialized = false;

  function initRouteMap(center, zoom){
    if(routeMapInitialized) return;
    if(!window.__motoboyMap) return;
    const canvas = document.getElementById('routeMapCanvas');
    if(!canvas) return;

    const c = center || startCoords || { lat: -17.74, lon: -50.92 };
    const z = zoom || (startCoords ? 15 : 12);
    window.__motoboyMap.create({ container: canvas, center: c, zoom: z });
    routeMapInitialized = true;
  }

  // Chamado quando o GPS resolve pela primeira vez — cria ou centraliza o mapa
  function onFirstGpsFix(coords){
    if(!window.__motoboyMap) return;
    if(!routeMapInitialized){
      // Primeira vez: cria mapa centrado no GPS com zoom alto
      initRouteMap(coords, 15);
    } else {
      // Mapa já existe: centraliza no GPS
      window.__motoboyMap.setCenter(coords, 15);
    }
    updateRouteMap();
  }

  function updateRouteMap(){
    if(!routeMapInitialized || !window.__motoboyMap) return;

    window.__motoboyMap.clearMarkers();
    window.__motoboyMap.clearRoutes();

    const pontos = [];
    let markerNum = 1;

    // Ponto de partida
    if(startCoords){
      pontos.push(startCoords);
      window.__motoboyMap.addNumberedMarker(startCoords, markerNum++, 'Ponto de Partida');
    }

    // Coletas e entregas
    routeServices.forEach(function(s){
      if(s.coletaCoords){
        pontos.push(s.coletaCoords);
        window.__motoboyMap.addNumberedMarker(s.coletaCoords, markerNum++, 'Coleta');
      }
      s.entregas.forEach(function(e){
        if(e.entregaCoords){
          pontos.push(e.entregaCoords);
          window.__motoboyMap.addNumberedMarker(e.entregaCoords, markerNum++, 'Entrega');
        }
      });
    });

    if(pontos.length === 0) return;

    // Se temos 2+ pontos, tenta rota com geometria real (OSRM polyline)
    if(pontos.length >= 2 && window.__motoboyRouteChainWithGeometry){
      window.__motoboyRouteChainWithGeometry(pontos).then(function(result){
        if(!result) return;
        result.segments.forEach(function(seg){
          if(seg.geometry && seg.geometry.length >= 2){
            window.__motoboyMap.drawPolyline(seg.geometry);
          } else {
            const idx = result.segments.indexOf(seg);
            if(idx < pontos.length - 1){
              window.__motoboyMap.drawRoute({
                origin: pontos[idx],
                destination: pontos[idx + 1]
              });
            }
          }
        });
        window.__motoboyMap.fitAll();
      });
    } else if(pontos.length >= 2){
      for(var i = 0; i < pontos.length - 1; i++){
        window.__motoboyMap.drawRoute({
          origin: pontos[i],
          destination: pontos[i + 1]
        });
      }
      window.__motoboyMap.fitAll();
    } else {
      // Só tem GPS — centraliza com zoom alto (mostra rua)
      window.__motoboyMap.setCenter(pontos[0], 15);
      // Força recálculo de tiles após centralizar (garante renderização)
      setTimeout(function(){
        if(window.__motoboyMap) window.__motoboyMap.invalidateSize();
      }, 100);
    }
  }

  // Atualiza mapa quando serviços são renderizados
  renderServices();
  renderRouteSummary();
  initRouteHistoryFilters();
  renderRouteHistory();

  // Ponte: recebe as rotas do Firestore e mescla com as locais (offline).
  window.__applyRemoteRotas = function(entities){
    if(!Array.isArray(entities)) return;
    const remoteIds = new Set(entities.map(function(r){ return r.id; }));
    const locaisOffline = confirmedRoutes.filter(function(r){ return !remoteIds.has(r.id); });
    confirmedRoutes = entities.concat(locaisOffline);
    confirmedRoutes.sort(function(a,b){
      return String(b.dateISO||'').localeCompare(String(a.dateISO||''))
          || String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    });
    saveLocalState();
    initRouteHistoryFilters();
    renderRouteHistory();
    renderRouteSummary();
    renderDashboard();
  };

  // ---------- clientes de coleta (saldo a receber / fiado) ----------
  let clientes = Array.isArray(localState.clientes) ? localState.clientes : [];

  function syncClientBalance(cliente){
    cliente.contas = cliente.contas || [];
    cliente.recebimentos = cliente.recebimentos || [];
    cliente.pendente = cliente.contas.reduce((total, conta) => total + Math.max(0, conta.saldo || 0), 0);
  }

  // Callback de sincronização: recebe clientes do Firestore e mescla com os locais.
  // Usa a mesma função pura de merge que a hidratação.
  window.__applyRemoteClientes = function(remoteClientes){
    if(!Array.isArray(remoteClientes)) return;
    clientes = remoteClientes;
    clientes.forEach(syncClientBalance);
    saveLocalState();
  };

  function clientesTotal(){ return clientes.reduce((s, c) => s + c.pendente, 0); }

  // "A receber" respeitando o mês (ponto 4). No painel de um mês específico, mostramos
  // quanto das contas CRIADAS naquele mês ainda está em aberto — não o saldo devedor de hoje.
  // Assim, ao olhar um mês passado, o número reflete a realidade daquele mês, não a de agora.
  function pendingForMonth(monthKey){
    let total = 0;
    clientes.forEach(c => {
      (c.contas || []).forEach(conta => {
        if(String(conta.dateISO || '').slice(0, 7) === monthKey){
          total += (conta.saldo || 0);
        }
      });
    });
    return round2(total);
  }

  // ---------- cancelamento de rota com estorno em cascata (ponto 2) ----------
  // Cancelar uma rota não pode deixar "restos" espalhados: a entrada que ela gerou no
  // faturamento e a dívida que criou no cliente precisam ser desfeitas junto. E tem uma
  // trava de honestidade: se o cliente já pagou (mesmo que em parte) a conta daquela rota,
  // não dá pra cancelar no clique — porque isso apagaria um dinheiro que de fato entrou.
  function routeCancelBlockReason(routeId){
    for(const c of clientes){
      for(const conta of (c.contas || [])){
        if(conta.routeId === routeId && (conta.recebido || 0) > 0){
          return `O cliente ${c.nome} já pagou ${fmtBRL(conta.recebido)} referente a esta rota. Para cancelar, primeiro trate esse recebimento com o cliente.`;
        }
      }
    }
    return null;
  }

  let cancellingRoute = false;
  async function cancelConfirmedRoute(routeId){
    if(cancellingRoute) return;
    const idx = confirmedRoutes.findIndex(r => r.id === routeId);
    if(idx < 0) return;

    if(!window.__motoboyRotas || !window.__motoboyRotas.cancelAtomic){
      showToast('Ponte de cancelamento atômico indisponível. Recarregue a página.', {kind:'error'});
      return;
    }

    cancellingRoute = true;
    try {
      const updatedClientes = await window.__motoboyRotas.cancelAtomic(routeId);

      // A transação devolve a projeção financeira completa e autoritativa.
      clientes = updatedClientes;
      for(let i = entradas.length - 1; i >= 0; i--){
        if(entradas[i].routeId === routeId) entradas.splice(i, 1);
      }
      confirmedRoutes.splice(idx, 1);

      saveLocalState();
      renderFaturamento();
      renderClientes();
      renderDashboard();
      renderRouteHistory();
    } catch(err){
      showToast('Erro ao cancelar rota no servidor: ' + (err.message || err), {kind:'error'});
    } finally {
      cancellingRoute = false;
    }
  }

  function renderClientes(){
    clientes.forEach(syncClientBalance);
    document.getElementById('clientesTotalValue').textContent = fmtBRL(clientesTotal());
    document.getElementById('clientesCountValue').textContent = clientes.length;

    const list = document.getElementById('clienteList');
    if(clientes.length === 0){
      list.innerHTML = '<div class="cliente-empty">Nenhum cliente cadastrado ainda. Toca no + acima ou marque "Fica pra depois" em um serviço da rota.</div>';
      return;
    }
    list.innerHTML = clientes.map((c, i) => `
      <div class="cliente-card">
        <div class="avatar">${clientIcon}</div>
        <div class="info">
          <div class="name">${safeText(c.nome)}</div>
          <div class="sub ${c.pendente > 0 ? 'owed' : 'clear'}">${c.pendente > 0 ? 'A receber: ' + fmtBRL(c.pendente) : 'Em dia'}</div>
          <span class="account-count">${(c.contas || []).filter(conta => conta.saldo > 0).length} conta(s) em aberto</span>
        </div>
        <div class="cliente-side">
          ${c.pendente > 0 ? `<button type="button" class="btn-charge" data-action="receive" data-i="${i}">Registrar recebimento</button>` : ''}
          ${recordActionsHTML('client', i, 'cliente ' + c.nome)}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-action="receive"]').forEach(btn => {
      btn.addEventListener('click', () => {
        openReceiptForClient(parseInt(btn.dataset.i));
      });
    });
    wireRecordActions(list, editClient, deleteClient);
  }

  let receiptClientIndex = null;
  const receiptModalCtl = wireModal(null, 'recebimentoModal', 'recebimentoBackdrop', 'recebimentoClose', 'recebimentoCancel');

  function openReceiptForClient(clientIndex){
    const cliente = clientes[clientIndex];
    if(!cliente || cliente.pendente <= 0) return;
    receiptClientIndex = clientIndex;
    document.getElementById('recebimentoClienteNome').textContent = cliente.nome;
    document.getElementById('recebimentoSaldo').textContent = fmtBRL(cliente.pendente);
    document.getElementById('recebimentoValor').value = cliente.pendente.toFixed(2);
    setBrDateValue(document.getElementById('recebimentoDate'), localTodayISO());
    receiptModalCtl.open();
    setTimeout(() => document.getElementById('recebimentoValor').focus(), 0);
  }

  let savingReceipt = false;
  document.getElementById('recebimentoSave').addEventListener('click', async () => {
    if(savingReceipt) return;
    if(!ensureClientesInteractive()) return;
    const cliente = clientes[receiptClientIndex];
    const valor = parseBrazilianInput(document.getElementById('recebimentoValor').value);
    if(!cliente){ receiptModalCtl.close(); return; }
    if(valor === null || valor <= 0){
      showToast('Informe um valor recebido maior que zero.', {kind:'warning'});
      return;
    }
    if(valor > cliente.pendente + 0.001){
      showToast(`O valor informado é maior que o saldo pendente de ${fmtBRL(cliente.pendente)}.`, {kind:'warning'});
      return;
    }

    const recebimentoDateEl = document.getElementById('recebimentoDate');
    const receiptISO = readBrDateISO(recebimentoDateEl);
    if(!receiptISO){ showDateError(recebimentoDateEl, 'Informe uma data válida no formato DD/MM/AAAA.'); return; }
    if(receiptISO > localTodayISO()){ showDateError(recebimentoDateEl, 'A data não pode ser futura.', true); return; }
    clearDateError(recebimentoDateEl);

    savingReceipt = true;
    try {
      const updatedClientes = await applyReceiptDual({
        ...(cliente.id ? {clientId: cliente.id} : {legacyLookupName: cliente.nome}),
        valor,
        dateISO: receiptISO,
        dateLabel: dateLabelFromISO(receiptISO),
      });

      // Só altera estado local APÓS commit remoto, usando a projeção completa.
      clientes = updatedClientes;
      const updatedCliente = cliente.id
        ? clientes.find(c => c.id === cliente.id)
        : clientes.find(c => !c.id && c.nome === cliente.nome);
      entradas.unshift({ desc:`Recebimento de ${cliente.nome}`, valor, data: dateLabelFromISO(receiptISO), dateISO: receiptISO, clientName:cliente.nome });
      saveLocalState();
      receiptModalCtl.close();
      receiptClientIndex = null;
      renderClientes();
      renderFaturamento();
      renderDashboard();
      showToast(`${fmtBRL(valor)} recebido de ${cliente.nome}. O saldo restante é ${fmtBRL(updatedCliente?.pendente || 0)}.`, {kind:'success'});
    } catch(err) {
      showToast('Erro ao registrar recebimento no servidor: ' + (err.message || err), {kind:'error'});
    } finally {
      savingReceipt = false;
    }
  });

  const clienteModalCtl = wireModal('btnOpenCliente', 'clienteModal', 'clienteBackdrop', 'clienteClose', 'clienteCancel');
  let editingClientIndex = null;
  function resetClientFormMode(){
    editingClientIndex = null;
    document.getElementById('clienteModalTitle').textContent = 'Adicionar cliente';
    document.getElementById('clienteModalDesc').textContent = 'Cadastra um local de coleta fixo';
    document.getElementById('clienteSave').textContent = 'Salvar cliente';
    document.getElementById('clienteNome').value = '';
  }
  function editClient(index){
    const cliente = clientes[index];
    if(!cliente) return;
    editingClientIndex = index;
    document.getElementById('clienteModalTitle').textContent = 'Editar cliente';
    document.getElementById('clienteModalDesc').textContent = 'Altere o nome sem perder o histórico';
    document.getElementById('clienteSave').textContent = 'Atualizar cliente';
    document.getElementById('clienteNome').value = cliente.nome;
    clienteModalCtl.open();
    document.getElementById('clienteNome').focus();
  }
  function deleteClient(index){
    if(!ensureClientesInteractive()) return;
    const cliente = clientes[index];
    if(!cliente) return;
    const hasFinancialHistory = cliente.pendente > 0 || (cliente.contas || []).length > 0 || (cliente.recebimentos || []).length > 0;
    if(hasFinancialHistory){
      showToast('Este cliente possui saldo ou histórico financeiro. Para não quebrar os valores, ele só poderá ser excluído depois que implementarmos o estorno e o extrato completo. Você ainda pode editar o nome.', {kind:'warning'});
      return;
    }
    requestDeleteConfirmation(
      'Excluir cliente?',
      `${cliente.nome} será removido da lista de clientes.`,
      async () => {
        const currentIndex = clientes.indexOf(cliente);
        if(currentIndex < 0) return;
        try { await removeClientDual(cliente.id || '', { legacyLookupName: cliente.nome }); }
        catch(err){
          console.error('[Clientes] Erro ao remover:', err);
          showToast('Erro ao excluir no servidor. Tente novamente.', {kind:'error'});
          return;
        }
        clientes.splice(currentIndex, 1);
        if(editingClientIndex === currentIndex) resetClientFormMode();
        saveLocalState();
        renderClientes();
        renderDashboard();
      }
    );
  }
  document.getElementById('btnOpenCliente').addEventListener('click', resetClientFormMode);
  document.getElementById('clienteSave').addEventListener('click', async () => {
    if(!ensureClientesInteractive()) return;
    const nome = document.getElementById('clienteNome').value.trim();
    if(!nome){ showToast('Digita o nome do cliente.', {kind:'warning'}); return; }
    if(clientes.find((c, index) => index !== editingClientIndex && c.nome.toLowerCase() === nome.toLowerCase())){
      showToast('Esse cliente já está cadastrado.', {kind:'warning'});
      return;
    }
    const previous = editingClientIndex === null ? null : clientes[editingClientIndex];
    if(previous){
      const oldName = previous.nome;
      let resolvedId = previous.id;
      try { resolvedId = await updateClientDual(previous.id || '', { name: nome, legacyLookupName: oldName }); }
      catch(err){
        console.error('[Clientes] Erro ao atualizar:', err);
        showToast('Erro ao salvar no servidor. Tente novamente.', {kind:'error'});
        return;
      }
      if(resolvedId && !previous.id) previous.id = resolvedId;
      previous.nome = nome;
      entradas.forEach(entry => {
        if(entry.clientName !== oldName) return;
        entry.clientName = nome;
        if(entry.desc === `Recebimento de ${oldName}`) entry.desc = `Recebimento de ${nome}`;
      });
      routeServices.forEach(service => {
        if(service.cliente === oldName) service.cliente = nome;
      });
    }else{
      let remoteId = '';
      try { remoteId = await createClientDual({ name: nome }); }
      catch(err){
        console.error('[Clientes] Erro ao criar:', err);
        showToast('Erro ao salvar no servidor. Tente novamente.', {kind:'error'});
        return;
      }
      const newC = { id: remoteId, nome, pendente:0, contas:[], recebimentos:[] };
      clientes.push(newC);
    }
    saveLocalState();
    renderClientes();
    renderFaturamento();
    renderDashboard();
    clienteModalCtl.close();
    resetClientFormMode();
  });

  // ---------- painel mensal (dados locais, sem backend) ----------
  function selectedMonthKey(){
    return document.getElementById('dashboardMonth').value || toISODateLocal(APP_NOW).slice(0, 7);
  }

  function initMonthSelector(){
    const select = document.getElementById('dashboardMonth');
    const formatter = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric' });
    select.innerHTML = '';
    for(let offset = 0; offset < 6; offset += 1){
      const date = new Date(APP_NOW.getFullYear(), APP_NOW.getMonth() - offset, 1);
      const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
      const option = document.createElement('option');
      option.value = key;
      option.textContent = formatter.format(date).replace(/^./, letter => letter.toUpperCase());
      select.appendChild(option);
    }
    select.value = toISODateLocal(APP_NOW).slice(0, 7);
    select.addEventListener('change', renderDashboard);
  }

  function monthItems(items, monthKey){
    return items.filter(item => String(item.dateISO || '').startsWith(monthKey));
  }

  function signedBRL(value){
    return value < 0 ? '- ' + fmtBRL(Math.abs(value)) : fmtBRL(value);
  }

  function renderDashboard(){
    const monthKey = selectedMonthKey();
    const monthEntries = monthItems(entradas, monthKey);
    const monthRefuels = monthItems(refuels, monthKey);
    const monthMaintenances = monthItems(maintenances, monthKey);
    const received = monthEntries.reduce((total, item) => total + item.valor, 0);
    const expenses = [...monthRefuels, ...monthMaintenances].reduce((total, item) => total + item.valor, 0);
    const result = received - expenses;

    const resultEl = document.getElementById('dashboardResult');
    resultEl.textContent = signedBRL(result);
    resultEl.style.color = result < 0 ? 'var(--red)' : 'var(--text)';
    document.getElementById('dashboardReceived').textContent = fmtBRL(received);
    document.getElementById('dashboardPending').textContent = fmtBRL(pendingForMonth(monthKey));
    document.getElementById('dashboardExpenses').textContent = fmtBRL(expenses);
    const chartValueEl = document.getElementById('dashboardChartValue');
    const chartStatusEl = document.getElementById('dashboardChartStatus');
    chartValueEl.textContent = signedBRL(result);
    chartValueEl.style.color = result < 0 ? 'var(--red)' : 'var(--text)';
    document.getElementById('dashboardChartDetail').textContent = fmtBRL(received) + ' recebido · ' + fmtBRL(expenses) + ' em despesas';
    chartStatusEl.textContent = result < 0 ? 'NEGATIVO' : result > 0 ? 'POSITIVO' : 'EQUILÍBRIO';
    chartStatusEl.className = 'dashboard-chart-status' + (result < 0 ? ' negative' : result === 0 ? ' balanced' : '');

    const todayKey = toISODateLocal(APP_NOW);
    const routesToday = confirmedRoutes.filter(item => item.dateISO === todayKey && item.status !== 'pending');
    document.getElementById('dashboardDeliveriesToday').textContent = routesToday.reduce((total, item) => total + item.count, 0);

    const [year, month] = monthKey.split('-').map(Number);
    const dayCount = new Date(year, month, 0).getDate();
    const currentMonthKey = toISODateLocal(APP_NOW).slice(0, 7);
    const visibleDayCount = monthKey === currentMonthKey ? Math.min(APP_NOW.getDate(), dayCount) : dayCount;
    const dailyMovement = Array.from({ length:visibleDayCount }, () => 0);
    monthEntries.forEach(item => {
      const day = Number(item.dateISO.slice(8, 10));
      if(day >= 1 && day <= dayCount) dailyMovement[day - 1] += item.valor;
    });
    [...monthRefuels, ...monthMaintenances].forEach(item => {
      const day = Number(item.dateISO.slice(8, 10));
      if(day >= 1 && day <= dayCount) dailyMovement[day - 1] -= item.valor;
    });
    let accumulated = 0;
    const accumulatedResult = dailyMovement.map(value => {
      accumulated += value;
      return Number(accumulated.toFixed(2));
    });
    const labels = dailyMovement.map((_, index) => String(index + 1));

    if(typeof Chart === 'undefined') return;
    if(monthlyResultChart) monthlyResultChart.destroy();
    const chartCanvas = document.getElementById('monthlyResultChart');
    const chartContext = chartCanvas.getContext('2d');
    const chartGradient = chartContext.createLinearGradient(0, 0, 0, 238);
    chartGradient.addColorStop(0, 'rgba(255,122,26,.34)');
    chartGradient.addColorStop(.55, 'rgba(255,122,26,.11)');
    chartGradient.addColorStop(1, 'rgba(255,122,26,0)');
    chartCanvas.setAttribute('aria-label', 'Resultado acumulado do dia 1 ao dia ' + visibleDayCount + ': ' + signedBRL(result) + '.');
    const lastDataIndex = accumulatedResult.length - 1;
    monthlyResultChart = new Chart(chartContext, {
      type:'line',
      data:{
        labels,
        datasets:[{
          label:'Resultado acumulado',
          data:accumulatedResult,
          borderColor:'#FF7A1A',
          backgroundColor:chartGradient,
          borderWidth:3,
          pointRadius:context => context.dataIndex === lastDataIndex ? 4 : 1.5,
          pointHoverRadius:5,
          pointHitRadius:14,
          pointBackgroundColor:context => context.raw < 0 ? '#E63946' : '#FF7A1A',
          pointBorderColor:'#14171C',
          pointBorderWidth:1.5,
          segment:{ borderColor:context => context.p0.parsed.y < 0 && context.p1.parsed.y < 0 ? '#E63946' : '#FF7A1A' },
          tension:0.32,
          fill:true
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:{ duration:380 },
        interaction:{ mode:'index', intersect:false },
        layout:{ padding:{ top:8, right:9, left:2, bottom:0 } },
        plugins:{
          legend:{ display:false },
          tooltip:{
            displayColors:false,
            backgroundColor:'#111419',
            borderColor:'#3A414B',
            borderWidth:1,
            titleColor:'#8B92A0',
            bodyColor:'#F2F0EB',
            padding:11,
            callbacks:{
              title:items => 'Dia ' + items[0].label,
              label:context => 'Resultado: ' + signedBRL(context.parsed.y)
            }
          }
        },
        scales:{
          x:{
            grid:{ display:false },
            ticks:{ color:'#9AA1AD', font:{ size:11, weight:'600' }, maxTicksLimit:7, maxRotation:0 }
          },
          y:{
            beginAtZero:true,
            grace:'12%',
            grid:{
              color:context => context.tick.value === 0 ? 'rgba(242,240,235,.28)' : 'rgba(49,55,63,.7)',
              lineWidth:context => context.tick.value === 0 ? 1.5 : 1
            },
            ticks:{
              color:'#9AA1AD', font:{ size:10.5, weight:'600' }, maxTicksLimit:5,
              callback:value => {
                const absValue = Math.abs(value);
                const formatted = absValue >= 1000
                  ? (absValue / 1000).toFixed(absValue >= 10000 ? 0 : 1).replace('.', ',') + ' mil'
                  : String(absValue).replace('.', ',');
                return (value < 0 ? '- ' : '') + 'R$ ' + formatted;
              }
            }
          }
        }
      }
    });
  }

  initMonthSelector();
  initBillingMonthSelector();
  initBrDateFields();
  ensureRefuelDateDefault(); // 2B: preenche a data de hoje na carga (form fixo de abastecimento)
  installStationCombobox(); // 2C: instala o combobox de posto (listeners uma única vez)
  if(consumoManualDefinido){
    document.getElementById('motoConsumptionInput').value = CONSUMO_ATUAL;
    document.getElementById('motoConsumptionStatus').textContent = `${CONSUMO_ATUAL.toFixed(1).replace('.', ',')} km/L salvos à mão e usados nas rotas.`;
  }
  recalculateMotoKmFromRecords();
  recalcConsumoReal();
  renderMotoConsumo();
  renderClientes();
  renderFaturamento();
  renderDashboard();

  // ============ ROTA ATIVA: MODO NAVEGAÇÃO ============

  function startActiveRouteMode(){
    if(!window.__motoboyActiveRoute) return;
    const overlay = document.getElementById('activeRouteOverlay');
    if(!overlay) return;

    // Coleta waypoints do planejamento
    const waypoints = [];
    let wpId = 0;
    // Coleta GPS como primeira posição se disponível
    if(startCoords){
      waypoints.push({
        id:'wp-start-'+wpId++, type:'pickup', label:'Posição Atual',
        address:'Sua localização', coordinates:startCoords, value:0,
        serviceIndex:-1, entregaIndex:-1, status:'completed'
      });
    }
    routeServices.forEach(function(s, si){
      if(s.coletaCoords){
        waypoints.push({
          id:'wp-col-'+wpId++, type:'pickup', label:'Coleta',
          address:s.coleta, coordinates:s.coletaCoords, value:0,
          serviceIndex:si, entregaIndex:-1, status:'pending'
        });
      }
      s.entregas.forEach(function(e, ei){
        if(e.entregaCoords && e.status === 'ok'){
          waypoints.push({
            id:'wp-ent-'+wpId++, type:'delivery', label:'Entrega',
            address:e.entrega, coordinates:e.entregaCoords, value:e.valor||0,
            serviceIndex:si, entregaIndex:ei, status:'pending'
          });
        }
      });
    });

    if(waypoints.length < 2){
      showToast('Adicione pelo menos um endereço de coleta e entrega.', {kind:'warning'});
      return;
    }

    // Inicia rota ativa
    window.__motoboyActiveRoute.start(waypoints);

    // Mostra overlay
    overlay.hidden = false;
    setView('rotas'); // mantém na view de rotas

    // Inicializa mapa Leaflet no overlay — defer para garantir layout computado
    function initActiveRouteMap(){
      const mapContainer = document.getElementById('armoMapContainer');
      if(!mapContainer || !window.__motoboyMap) return;
      mapContainer.innerHTML = '';
      const mapDiv = document.createElement('div');
      mapDiv.style.cssText = 'width:100%;height:100%;';
      mapContainer.appendChild(mapDiv);
      window.__motoboyMap.create({ container:mapDiv, center:startCoords || waypoints[0].coordinates, zoom:14 });

      // Desenha marcadores com números
      var mkNum = 1;
      waypoints.forEach(function(wp){
        if(wp.status !== 'completed'){
          window.__motoboyMap.addNumberedMarker(wp.coordinates, mkNum++, wp.label + ' - ' + wp.address);
        }
      });

      // Desenha rota com geometria real (OSRM polyline) quando disponível
      if(waypoints.length >= 2){
        var wpCoords = waypoints.map(function(wp){ return wp.coordinates; });
        if(window.__motoboyRouteChainWithGeometry){
          window.__motoboyRouteChainWithGeometry(wpCoords).then(function(result){
            if(!result) {
              // Fallback: linhas retas
              for(var i=0; i<waypoints.length-1; i++){
                window.__motoboyMap.drawRoute({
                  origin:waypoints[i].coordinates,
                  destination:waypoints[i+1].coordinates,
                  originLabel:waypoints[i].label,
                  destinationLabel:waypoints[i+1].label
                });
              }
              return;
            }
            result.segments.forEach(function(seg){
              if(seg.geometry && seg.geometry.length >= 2){
                window.__motoboyMap.drawPolyline(seg.geometry);
              } else {
                var idx = result.segments.indexOf(seg);
                if(idx < waypoints.length - 1){
                  window.__motoboyMap.drawRoute({
                    origin:waypoints[idx].coordinates,
                    destination:waypoints[idx+1].coordinates
                  });
                }
              }
            });
            window.__motoboyMap.fitAll();
          });
        } else {
          for(var i=0; i<waypoints.length-1; i++){
            window.__motoboyMap.drawRoute({
              origin:waypoints[i].coordinates,
              destination:waypoints[i+1].coordinates,
              originLabel:waypoints[i].label,
              destinationLabel:waypoints[i+1].label
            });
          }
        }
      }
    }

    // Garante que o browser computou o layout flex do overlay antes de criar o mapa
    requestAnimationFrame(function(){
      setTimeout(initActiveRouteMap, 60);
    });

    // Painel de rota ativa
    var panelContainer = document.getElementById('activeRoutePanelContainer');
    if(panelContainer){
      var panel = new (window.__ActiveRoutePanel || function(callbacks){
        this.mount = function(el){ el.innerHTML = '<div style="padding:16px;">Painel de rota ativa</div>'; };
        this.unmount = function(){};
        this.update = function(){};
        this.updateNavigationStep = function(){};
      })({
        onCompleteStop: function(){
          window.__motoboyActiveRoute.completeStop();
        },
        onSkipStop: function(){
          window.__motoboyActiveRoute.skipStop();
        },
        onOptimize: function(){
          var result = window.__motoboyActiveRoute.optimize();
          if(result && result.savingsPercent > 0){
            showToast('Rota otimizada! Economia de ' + result.savingsPercent + '% no percurso.', {kind:'success'});
          } else {
            showToast('A rota já está na ordem mais eficiente.', {kind:'info'});
          }
        },
        onShare: async function(){
          var route = window.__motoboyActiveRoute.getActiveRoute();
          if(!route) return;
          if(!window.__motoboySharing) return;
          var token = await window.__motoboySharing.start(route.id);
          if(token){
            var baseUrl = window.location.origin;
            var shareUrl = baseUrl + '/compartilhar/' + token;
            document.getElementById('shareUrlInput').value = shareUrl;
            document.getElementById('shareBackdrop').classList.add('open');
            document.getElementById('shareDialog').classList.add('open');
            document.getElementById('shareDialog').setAttribute('aria-hidden','false');
          }
        },
        onPause: function(){
          window.__motoboyActiveRoute.pause();
        },
        onResume: function(){
          window.__motoboyActiveRoute.resume();
        },
        onStop: function(){
          window.__motoboyActiveRoute.stop();
          if(window.__motoboySharing) window.__motoboySharing.stop();
          if(window.__motoboyMap) window.__motoboyMap.removePositionMarker();
          overlay.hidden = true;
          showToast('Rota finalizada.', {kind:'info'});
        }
      });
      panel.mount(panelContainer);

      // Inscreve para atualizações
      window.__motoboyActiveRoute.subscribe(function(){
        var progress = window.__motoboyActiveRoute.getProgress();
        var route = window.__motoboyActiveRoute.getActiveRoute();
        panel.update(progress, route);

        // Atualiza HUD
        var hudContainer = document.getElementById('navHudContainer');
        if(hudContainer){
          var step = route && route.currentSteps ? route.currentSteps[route.currentStepIndex] : null;
          panel.updateNavigationStep(step ? step.text : null);
        }

        // Atualiza topo do overlay
        var etaEl = document.getElementById('armo-eta');
        var distEl = document.getElementById('armo-distance');
        var progEl = document.getElementById('armo-progress');
        if(progress){
          if(etaEl) etaEl.textContent = progress.ETA;
          if(distEl) distEl.textContent = (progress.distanceRemainingMeters/1000).toFixed(1).replace('.',',') + ' km restante';
          if(progEl) progEl.textContent = progress.percentComplete + '%';
        }

        // Atualiza marcador de posição GPS no mapa em tempo real
        if(window.__motoboyMap && route && route.status === 'navigating'){
          try {
            var trackingState = window.__motoboyActiveRoute.getTrackingState();
            if(trackingState && trackingState.position){
              window.__motoboyMap.addPositionMarker(trackingState.position, trackingState.accuracy);
              window.__motoboyMap.centerOnPosition(trackingState.position);
            }
          } catch(e){ /* ignora se tracking não disponível */ }
        }

        // Rota concluída
        if(route && route.status === 'completed'){
          if(window.__motoboyMap) window.__motoboyMap.removePositionMarker();
          overlay.hidden = true;
          showToast('Todas as entregas foram concluídas!', {kind:'success'});
        }
      });

      // Trigger inicial
      window.__motoboyActiveRoute.subscribe(function(){})();
    }

    // Share dialog close
    var shareBackdrop = document.getElementById('shareBackdrop');
    var shareDialog = document.getElementById('shareDialog');
    function closeShareDialog(){
      shareBackdrop.classList.remove('open');
      shareDialog.classList.remove('open');
      shareDialog.setAttribute('aria-hidden','true');
    }
    if(shareBackdrop) shareBackdrop.onclick = closeShareDialog;
    var shareCloseBtn = document.getElementById('shareCloseBtn');
    if(shareCloseBtn) shareCloseBtn.onclick = closeShareDialog;
    var shareCopyBtn = document.getElementById('shareCopyBtn');
    if(shareCopyBtn){
      shareCopyBtn.onclick = function(){
        var input = document.getElementById('shareUrlInput');
        if(input && input.value){
          navigator.clipboard.writeText(input.value).then(function(){
            shareCopyBtn.textContent = 'Copiado!';
            setTimeout(function(){ shareCopyBtn.textContent = 'Copiar'; }, 2000);
          }).catch(function(){
            input.select();
            document.execCommand('copy');
            shareCopyBtn.textContent = 'Copiado!';
            setTimeout(function(){ shareCopyBtn.textContent = 'Copiar'; }, 2000);
          });
        }
      };
    }
  }

  window.setView = setView;
}
