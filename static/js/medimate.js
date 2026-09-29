
  // Backend-backed application state. The supplied UI is retained; only persistence changes.
  let appState = {
    user: { name: '', email: '', role: 'MediMate User' },
    medicines: [],
    todaySchedules: [],
    history: [],
    settings: { medicineReminders: true, browserNotifications: true, reminderSound: false, dailySummary: true },
    notifications: [],
    auth: { isLoggedIn: false }
  };

  async function apiRequest(url, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    opts.headers = { 'Accept': 'application/json', ...(options.headers || {}) };
    if (csrfToken) opts.headers['X-CSRFToken'] = csrfToken;
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(url, opts);
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      throw new Error(data.message || 'Request failed.');
    }
    return data;
  }

  async function loadState() {
    try {
      appState = await apiRequest('/api/state');
      return true;
    } catch (e) {
      appState = {
        user: { name: '', email: '', role: 'MediMate User' },
        medicines: [], todaySchedules: [], history: [],
        settings: { medicineReminders: true, browserNotifications: true, reminderSound: false, dailySummary: true },
        notifications: [], auth: { isLoggedIn: false }
      };
      return false;
    }
  }

  async function saveState() {
    // Persistence is handled by Flask/MySQL. Kept as a compatibility no-op.
    return true;
  }

  async function resetPrototypeData() {
    showToast("Demo data is stored in MySQL and is not reset from the browser.", "info");
  }

  // Active View State
  let currentView = 'dashboard';
  let activeMedicineFilter = 'All';
  let medicinePendingDeleteId = null;
  let activeReminderDose = null;
  let reminderPollTimer = null;
  const shownReminderKeys = new Set();

  // View Navigation
  function navigateTo(viewId) {
    if (!appState.auth.isLoggedIn && viewId !== 'login') {
      showAuthScreen('login');
      return;
    }

    currentView = viewId;

    // Hide all view sections
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));

    // Highlight current sidebar tab
    document.querySelectorAll('.nav-item').forEach(btn => {
      const navTarget = btn.getAttribute('data-nav');
      if (navTarget === viewId) {
        btn.className = "nav-item flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container-high text-primary font-medium transition-colors duration-150 ease-in-out text-left w-full";
      } else {
        btn.className = "nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-normal transition-colors duration-150 ease-in-out text-left w-full";
      }
    });

    const targetEl = document.getElementById(`view-${viewId}`);
    if (targetEl) {
      targetEl.classList.remove('hidden');
    }

    // Refresh view specific components
    if (viewId === 'dashboard') renderDashboardView();
    if (viewId === 'medicines') renderMedicinesCatalog();
    if (viewId === 'history') renderHistoryTable();
    if (viewId === 'reports') renderReportsView();
    if (viewId === 'settings') renderSettingsView();

    // Close mobile sidebar on select
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobile-backdrop');
    if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
      toggleMobileSidebar();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('mobile-backdrop');
    const isOpen = !sidebar.classList.contains('-translate-x-full');

    if (isOpen) {
      sidebar.classList.add('-translate-x-full');
      backdrop.classList.add('hidden');
    } else {
      sidebar.classList.remove('-translate-x-full');
      backdrop.classList.remove('hidden');
    }
  }

  // ================= DASHBOARD RENDERING =================
    function renderDashboardView() {
    const schedules = appState.todaySchedules || [];
    const total = schedules.length;
    const taken = schedules.filter(m => m.status === 'Taken').length;
    const pending = schedules.filter(m => m.status === 'Pending').length;
    const skipped = schedules.filter(m => m.status === 'Skipped').length;
    const missed = schedules.filter(m => m.status === 'Missed').length;

    document.getElementById('stat-total-medicines').textContent = appState.medicines.filter(m => m.status === 'Active').length;
    document.getElementById('stat-taken-today').textContent = taken;
    document.getElementById('stat-pending-today').textContent = pending;
    document.getElementById('stat-skipped-today').textContent = skipped;

    const adherencePct = total > 0 ? Math.round((taken / total) * 100) : 0;
    document.getElementById('progress-percentage-text').textContent = `${adherencePct}%`;
    document.getElementById('progress-bar-fill').style.width = `${adherencePct}%`;
    document.getElementById('progress-summary-count').textContent = `${taken} of ${total} scheduled doses completed`;

    const badge = document.getElementById('progress-status-badge');
    if (adherencePct >= 75) {
      badge.textContent = "On Track";
      badge.className = "text-label-sm font-label-sm text-secondary font-semibold";
    } else if (adherencePct >= 50) {
      badge.textContent = "Moderate";
      badge.className = "text-label-sm font-label-sm text-[#b45309] font-semibold";
    } else {
      badge.textContent = "Attention Needed";
      badge.className = "text-label-sm font-label-sm text-error font-semibold";
    }

    renderNextMedicineCard();
    renderTodayScheduleTable();
    renderDashboardEnhancements();
  }


  async function renderDashboardEnhancements() {
    let box = document.getElementById('dashboard-enhancements');
    if (!box) {
      box = document.createElement('section');
      box.id = 'dashboard-enhancements';
      box.className = 'grid grid-cols-1 lg:grid-cols-3 gap-4';
      const dashboard = document.getElementById('view-dashboard');
      const scheduleSection = dashboard?.querySelector('section[aria-label="Full Medication Schedule"]');
      if (scheduleSection) scheduleSection.parentNode.insertBefore(box, scheduleSection);
    }
    const active = appState.medicines.filter(m => m.status === 'Active');
    const expiry = active.filter(m => m.endDate).map(m => ({...m, days: Math.ceil((new Date(m.endDate)-new Date(new Date().toISOString().slice(0,10)))/86400000)})).filter(m => m.days >= 0 && m.days <= 7).sort((a,b)=>a.days-b.days);
    let streak = 0;
    try { const r = await apiRequest('/api/streak'); streak = r.streak || 0; } catch (_) {}
    box.innerHTML = `
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 custom-shadow-card">
        <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center"><span class="material-symbols-outlined">local_fire_department</span></div><div><p class="text-xs text-outline">Medication streak</p><p class="text-xl font-bold text-on-surface">🔥 ${streak} Day${streak===1?'':'s'}</p></div></div>
        <p class="text-xs text-on-surface-variant mt-3">Consecutive days with every scheduled dose completed.</p>
      </div>
      <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 custom-shadow-card lg:col-span-2">
        <div class="flex items-center justify-between"><div><p class="text-xs text-outline">Upcoming medicines</p><p class="text-lg font-semibold text-on-surface">Next scheduled doses</p></div><span class="material-symbols-outlined text-primary">event_upcoming</span></div>
        <div id="upcoming-list" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2"><span class="text-xs text-outline">Loading upcoming doses…</span></div>
        ${expiry.length ? `<div class="mt-3 pt-3 border-t border-outline-variant/60"><p class="text-xs font-semibold text-amber-700">⚠️ Medicine ending soon</p><p class="text-xs text-on-surface-variant mt-1">${expiry.slice(0,3).map(m=>`${escapeHtml(m.name)} ends in ${m.days} day${m.days===1?'':'s'}`).join(' • ')}</p></div>` : ''}
      </div>`;
    try {
      const upcoming = await apiRequest('/api/upcoming');
      const list = document.getElementById('upcoming-list');
      if (list) list.innerHTML = upcoming.slice(0,4).map(x=>`<div class="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2"><div><p class="text-xs font-semibold text-on-surface">${escapeHtml(x.medicine_name)}</p><p class="text-[11px] text-outline">${escapeHtml(x.dosage)}</p></div><div class="text-right"><p class="text-xs font-semibold text-primary">${escapeHtml(x.scheduled_time)}</p><p class="text-[10px] text-outline">${escapeHtml(formatCountdown(new Date(x.target)-new Date()))}</p></div></div>`).join('') || '<span class="text-xs text-outline">No pending scheduled doses.</span>';
    } catch (_) {}
  }


    function formatCountdown(ms) {
    if (ms <= 0) return 'Due now';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${minutes}m`;
    return `in ${Math.max(1, minutes)}m`;
  }

  function getNextDoseCountdown(timeText) {
    if (!timeText) return '';
    const match = timeText.match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)?$/i);
    if (!match) return '';
    let hour = Number(match[1]), minute = Number(match[2]);
    const meridiem = match[3]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return formatCountdown(target - now);
  }

    function renderNextMedicineCard() {
    const container = document.getElementById('next-medicine-card');
    const pendingMed = (appState.todaySchedules || []).find(m => m.status === 'Pending') ||
                       (appState.todaySchedules || []).find(m => m.status === 'Missed');

    if (!pendingMed) {
      container.innerHTML = `
        <div class="py-8 text-center text-outline">
          <span class="material-symbols-outlined text-4xl mb-1 text-secondary">verified</span>
          <p class="font-medium text-on-surface">All Medicines Completed for Today</p>
          <p class="text-xs text-outline">Great adherence streak! Keep it up.</p>
        </div>`;
      return;
    }

    const isPending = pendingMed.status === 'Pending';
    container.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-label-sm font-label-sm font-semibold uppercase tracking-wider text-primary">${isPending ? 'Upcoming Dose' : 'Missed Dose'}</span>
            <span class="w-1.5 h-1.5 rounded-full bg-primary inline-block"></span>
          </div>
          <h3 class="text-headline-md font-headline-md font-bold text-on-surface">${escapeHtml(pendingMed.name)}</h3>
          <p class="text-body-sm font-body-sm text-on-surface-variant">${escapeHtml(pendingMed.dosage)}</p>
        </div>
        <div class="text-right">
          <div class="inline-flex items-center gap-1.5 text-headline-sm font-headline-sm font-bold text-on-surface">
            <span class="material-symbols-outlined text-[18px] text-outline">schedule</span>
            ${escapeHtml(pendingMed.time)}
          </div>
          <p id="next-dose-countdown" class="text-label-sm font-label-sm text-primary mt-0.5">${escapeHtml(getNextDoseCountdown(pendingMed.time))}</p>
          <p class="text-label-sm font-label-sm text-outline mt-0.5">${isPending ? 'Action Required' : 'Missed'}</p>
        </div>
      </div>
      <div class="mt-4 pt-3 border-t border-outline-variant/60 flex items-center justify-between flex-wrap gap-2">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-surface-container text-on-surface-variant border border-outline-variant">
          ${escapeHtml(pendingMed.instructions || 'Standard dosage')}
        </span>
        <div class="flex items-center gap-2">
          ${isPending ? `
            <button onclick="skipMedicine(${pendingMed.medicineId}, ${pendingMed.scheduleId})" class="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-outline-variant text-outline hover:text-error text-label-sm font-label-sm transition-colors">Skip</button>
            <button onclick="markMedicineTaken(${pendingMed.medicineId}, ${pendingMed.scheduleId})" class="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-primary-container text-on-primary text-label-sm font-label-sm transition-colors">Mark Taken</button>
          ` : ''}
        </div>
      </div>`;
  }


    function renderTodayScheduleTable() {
    const tbody = document.getElementById('schedule-tbody');
    const scheduleCount = document.getElementById('today-schedule-count');
    const list = appState.todaySchedules || [];
    tbody.innerHTML = '';
    scheduleCount.textContent = `${list.length} items scheduled`;
    list.forEach(med => {
      let statusBadge = '';
      if (med.status === 'Taken') statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-[#dcfce7] text-[#16a34a] border border-[#bbf7d0]"><span class="material-symbols-outlined text-[14px]">check</span> Taken</span>`;
      else if (med.status === 'Skipped' || med.status === 'Missed') statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-error-container text-[#b91c1c] border border-red-200"><span class="material-symbols-outlined text-[14px]">${med.status === 'Skipped' ? 'close' : 'schedule'}</span> ${med.status}</span>`;
      else statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-label-sm font-label-sm bg-[#fef3c7] text-[#d97706] border border-[#fde68a]"><span class="material-symbols-outlined text-[14px]">schedule</span> Pending</span>`;
      const actionCell = med.status === 'Pending' ? `<div class="flex items-center justify-end gap-1.5"><button onclick="skipMedicine(${med.medicineId}, ${med.scheduleId})" class="px-2.5 py-1 text-xs text-outline hover:text-error rounded hover:bg-surface-container transition-colors">Skip</button><button onclick="markMedicineTaken(${med.medicineId}, ${med.scheduleId})" class="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-primary-container text-primary-container hover:bg-surface-container-high text-label-sm font-label-sm transition-colors duration-150" type="button">Mark Taken</button></div>` : `<span class="text-outline font-medium">—</span>`;
      const tr = document.createElement('tr');
      tr.className = "hover:bg-surface transition-colors duration-150";
      tr.innerHTML = `<td class="py-4 px-6 font-semibold text-on-surface">${escapeHtml(med.name)}</td><td class="py-4 px-6 text-on-surface-variant">${escapeHtml(med.dosage)}</td><td class="py-4 px-6 font-medium text-on-surface">${escapeHtml(med.time)}</td><td class="py-4 px-6"><span class="inline-block px-2 py-0.5 rounded text-label-sm font-label-sm bg-surface-container text-on-surface-variant">${escapeHtml(med.instructions || 'Standard routine')}</span></td><td class="py-4 px-6">${statusBadge}</td><td class="py-4 px-6 text-right">${actionCell}</td>`;
      tbody.appendChild(tr);
    });
  }

  async function refreshBackendState() {
    try { appState = await apiRequest('/api/state'); updateUserHeaderDisplays(); renderNotificationMenu(); return true; }
    catch (e) { showAuthScreen('login'); return false; }
  }


  // Direct Dose Interactions
  let nextDoseTimer = null;
  function startNextDoseCountdown() {
    if (nextDoseTimer) clearInterval(nextDoseTimer);
    nextDoseTimer = setInterval(() => {
      const el = document.getElementById('next-dose-countdown');
      if (!el) return;
      const pending = (appState.todaySchedules || []).find(m => m.status === 'Pending');
      if (pending) el.textContent = getNextDoseCountdown(pending.time);
    }, 30000);
  }

    async function markMedicineTaken(id, scheduleId = null) {
    try {
      const data = await apiRequest(`/take-medicine/${id}`, { method: 'POST', body: { medicine_id: id, schedule_id: scheduleId } });
      await refreshBackendState(); renderDashboardView(); renderMedicinesCatalog();
      showToast('Dose marked as taken!', 'success');
    } catch (e) { showToast(e.message, 'error'); }
  }


    async function skipMedicine(id, scheduleId = null) {
    try {
      await apiRequest('/skip-medicine', { method: 'POST', body: { medicine_id: id, schedule_id: scheduleId } });
      await refreshBackendState(); renderDashboardView(); renderMedicinesCatalog();
      showToast('Dose skipped.', 'warning');
    } catch (e) { showToast(e.message, 'error'); }
  }


  // ================= MEDICINES CATALOG VIEW =================
  function setMedicineFilter(tab) {
    activeMedicineFilter = tab;
    document.querySelectorAll('.med-filter-btn').forEach(btn => {
      if (btn.textContent.trim() === tab) {
        btn.className = "med-filter-btn px-3 py-1.5 text-xs font-semibold rounded bg-surface-container-lowest text-primary shadow-sm";
      } else {
        btn.className = "med-filter-btn px-3 py-1.5 text-xs font-semibold rounded text-on-surface-variant hover:text-on-surface";
      }
    });
    renderMedicinesCatalog();
  }

  function ensureMedicineFilterOptions() {
    const tabs = document.getElementById('medicine-filter-tabs');
    if (!tabs || tabs.querySelector('[data-filter="As Needed"]')) return;
    const btn = document.createElement('button');
    btn.dataset.filter = 'As Needed'; btn.className='med-filter-btn px-3 py-1.5 text-xs font-semibold rounded text-on-surface-variant hover:text-on-surface'; btn.textContent='As Needed'; btn.onclick=()=>setMedicineFilter('As Needed');
    tabs.appendChild(btn);
  }

  function renderMedicinesCatalog() {
    const tbody = document.getElementById('catalog-tbody');
    const emptyMsg = document.getElementById('catalog-empty-msg');
    const query = (document.getElementById('medicine-search-input')?.value || '').toLowerCase();
    ensureMedicineFilterOptions();
    tbody.innerHTML = '';
    let list = appState.medicines.filter(m => {
      const matchSearch = m.name.toLowerCase().includes(query) || m.dosage.toLowerCase().includes(query) || (m.instructions && m.instructions.toLowerCase().includes(query));
      let matchFilter = true;
      if (activeMedicineFilter === 'Active') matchFilter = m.status === 'Active';
      else if (activeMedicineFilter === 'Completed') matchFilter = m.status === 'Expired' || (m.endDate && new Date(m.endDate) < new Date(new Date().toISOString().slice(0,10)));
      else if (activeMedicineFilter === 'Expired') matchFilter = m.status === 'Expired';
      else if (activeMedicineFilter === 'As Needed') matchFilter = m.frequency === 'As Needed';
      return matchSearch && matchFilter;
    });
    if (!list.length) { emptyMsg.classList.remove('hidden'); return; }
    emptyMsg.classList.add('hidden');
    list.forEach(item => {
      const tr = document.createElement('tr'); tr.className='hover:bg-surface transition-colors';
      tr.innerHTML=`<td class="py-3 px-5 font-semibold text-on-surface">${escapeHtml(item.name)}</td><td class="py-3 px-5 text-on-surface-variant">${escapeHtml(item.dosage)}</td><td class="py-3 px-5 text-on-surface-variant font-medium">${escapeHtml(item.frequency||'Once Daily')}</td><td class="py-3 px-5 text-on-surface-variant">${escapeHtml(item.instructions||'—')}</td><td class="py-3 px-5 text-xs text-outline">${escapeHtml(item.startDate||'—')} to ${escapeHtml(item.endDate||'—')}</td><td class="py-3 px-5"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${item.status==='Expired'?'bg-slate-100 text-slate-700':'bg-primary-fixed text-on-primary-fixed'}">${escapeHtml(item.status||'Active')}</span></td><td class="py-3 px-5 text-right"><div class="inline-flex items-center gap-1">${item.frequency==='As Needed'&&item.status==='Active'?`<button onclick="logAsNeededMedicine(${item.id})" class="px-2.5 py-1 rounded-lg bg-primary-container text-on-primary text-xs font-medium hover:bg-primary">Log Now</button>`:''}<button onclick="openMedicineDetails(${item.id})" class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container" title="Details"><span class="material-symbols-outlined text-[18px]">info</span></button><button onclick="openEditMedicineForm(${item.id})" class="p-1 rounded text-outline hover:text-primary hover:bg-surface-container" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button><button onclick="promptDeleteMedicine(${item.id}, '${escapeHtml(item.name)}')" class="p-1 rounded text-outline hover:text-error hover:bg-red-50" title="Delete"><span class="material-symbols-outlined text-[18px]">delete</span></button></div></td>`;
      tbody.appendChild(tr);
    });
  }

  async function openMedicineDetails(id) {
    try {
      const m = await apiRequest(`/api/medicine/${id}`);
      let modal=document.getElementById('modal-medicine-details');
      if(!modal){modal=document.createElement('div');modal.id='modal-medicine-details';modal.className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50';document.body.appendChild(modal);}
      modal.innerHTML=`<div class="bg-surface-container-lowest rounded-2xl max-w-lg w-full border border-outline-variant p-6 shadow-xl"><div class="flex justify-between items-start"><div><p class="text-xs text-primary font-semibold uppercase tracking-wide">Medicine details</p><h3 class="text-xl font-bold text-on-surface mt-1">${escapeHtml(m.medicine_name)}</h3><p class="text-sm text-on-surface-variant">${escapeHtml(m.dosage)} • ${escapeHtml(m.frequency)}</p></div><button class="p-2 text-outline hover:text-on-surface" onclick="document.getElementById('modal-medicine-details').remove()"><span class="material-symbols-outlined">close</span></button></div><div class="grid grid-cols-2 gap-3 mt-5 text-sm"><div class="bg-surface-container-low rounded-lg p-3"><p class="text-xs text-outline">Schedule</p><p class="font-semibold mt-1">${escapeHtml(m.schedules?.join(', ')||'As needed')}</p></div><div class="bg-surface-container-low rounded-lg p-3"><p class="text-xs text-outline">Adherence</p><p class="font-semibold mt-1 text-primary">${m.adherence}%</p></div><div class="bg-surface-container-low rounded-lg p-3"><p class="text-xs text-outline">Date range</p><p class="font-semibold mt-1">${escapeHtml(m.startDate)}${m.endDate?' → '+escapeHtml(m.endDate):' → Ongoing'}</p></div><div class="bg-surface-container-low rounded-lg p-3"><p class="text-xs text-outline">Taken / Skipped / Missed</p><p class="font-semibold mt-1">${m.taken} / ${m.skipped} / ${m.missed}</p></div></div><div class="mt-4 p-3 rounded-lg bg-surface-container-low"><p class="text-xs text-outline">Instructions</p><p class="text-sm text-on-surface-variant mt-1">${escapeHtml(m.instructions||'No special instructions.')}</p></div></div>`;
    } catch(e){showToast(e.message,'error');}
  }

  async function logAsNeededMedicine(id) {
    try {
      const result = await apiRequest(`/take-medicine/${id}`, { method: 'POST', body: { medicine_id: id } });
      await refreshBackendState();
      renderMedicinesCatalog();
      showToast(result.message || 'As-needed dose logged.', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  function promptDeleteMedicine(id, name) {
    medicinePendingDeleteId = id;
    document.getElementById('modal-delete-text').textContent = `Are you sure you want to delete ${name}? All associated scheduled reminders will be removed.`;
    document.getElementById('modal-confirm-delete-btn').onclick = confirmDeleteMedicine;
    document.getElementById('modal-delete').classList.remove('hidden');
  }

  function closeDeleteModal() {
    document.getElementById('modal-delete').classList.add('hidden');
    medicinePendingDeleteId = null;
  }

    async function confirmDeleteMedicine() {
    if (!medicinePendingDeleteId) return;
    try {
      const result = await apiRequest(`/delete-medicine/${medicinePendingDeleteId}`, { method: 'POST' });
      closeDeleteModal(); await refreshBackendState(); renderMedicinesCatalog(); showToast(result.message, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  }


  // ================= ADD / EDIT MEDICINE FORM =================
  function openAddMedicineForm() {
    document.getElementById('form-title').textContent = "Add New Medicine";
    document.getElementById('medicine-id-field').value = '';
    document.getElementById('input-med-name').value = '';
    document.getElementById('input-med-dosage').value = '';
    document.getElementById('input-med-frequency').value = 'Once Daily';
    document.getElementById('input-med-instructions').value = '';
    const today = new Date(); const end = new Date(today); end.setDate(end.getDate()+30);
    document.getElementById('input-med-start').value = today.toISOString().slice(0,10);
    document.getElementById('input-med-end').value = end.toISOString().slice(0,10);
    handleFrequencyChange(["09:00 AM"]);

    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-add-edit-medicine').classList.remove('hidden');
  }

  function openEditMedicineForm(id) {
    const med = appState.medicines.find(m => m.id === id);
    if (!med) return;

    document.getElementById('form-title').textContent = "Edit Medicine Schedule";
    document.getElementById('medicine-id-field').value = med.id;
    document.getElementById('input-med-name').value = med.name;
    document.getElementById('input-med-dosage').value = med.dosage;
    document.getElementById('input-med-frequency').value = med.frequency || 'Once Daily';
    document.getElementById('input-med-instructions').value = med.instructions || '';
    document.getElementById('input-med-start').value = med.startDate || new Date().toISOString().slice(0,10);
    document.getElementById('input-med-end').value = med.endDate || '';

    handleFrequencyChange(med.times || [med.time || "09:00 AM"]);

    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-add-edit-medicine').classList.remove('hidden');
  }

  function handleFrequencyChange(presetTimes = null) {
    const freq = document.getElementById('input-med-frequency').value;
    const wrapper = document.getElementById('times-inputs-wrapper');
    const hint = document.getElementById('as-needed-hint');
    wrapper.innerHTML = '';

    if (freq === 'As Needed') {
      hint.classList.remove('hidden');
      return;
    } else {
      hint.classList.add('hidden');
    }

    let count = 1;
    let defaults = ["09:00 AM"];
    if (freq === 'Twice Daily') {
      count = 2;
      defaults = ["09:00 AM", "08:00 PM"];
    } else if (freq === 'Three Times Daily') {
      count = 3;
      defaults = ["09:00 AM", "02:00 PM", "08:00 PM"];
    }

    const timesToUse = presetTimes && presetTimes.length >= count ? presetTimes : defaults;

    for (let i = 0; i < count; i++) {
      const timeVal = timesToUse[i] || defaults[i] || "09:00 AM";
      const div = document.createElement('div');
      div.className = "flex items-center gap-2 bg-surface-container-lowest px-3 py-1.5 rounded-lg border border-outline-variant";
      div.innerHTML = `
        <span class="text-xs font-semibold text-outline">Dose ${i+1}:</span>
        <input type="text" class="med-time-input w-24 text-xs font-medium outline-none bg-transparent" value="${escapeHtml(timeVal)}" placeholder="09:00 AM">
      `;
      wrapper.appendChild(div);
    }
  }

    async function handleSaveMedicine(e) {
    e.preventDefault();
    const idVal = document.getElementById('medicine-id-field').value;
    const startDate = document.getElementById('input-med-start').value;
    const endDate = document.getElementById('input-med-end').value;
    if (endDate && new Date(startDate) > new Date(endDate)) { document.getElementById('err-dates').classList.remove('hidden'); return; }
    document.getElementById('err-dates').classList.add('hidden');
    const payload = {
      medicine_name: document.getElementById('input-med-name').value.trim(),
      dosage: document.getElementById('input-med-dosage').value.trim(),
      frequency: document.getElementById('input-med-frequency').value,
      instructions: document.getElementById('input-med-instructions').value.trim(),
      start_date: startDate, end_date: endDate,
      scheduled_times: Array.from(document.querySelectorAll('.med-time-input')).map(x => x.value.trim()).filter(Boolean)
    };
    try {
      const result = await apiRequest(idVal ? `/edit-medicine/${idVal}` : '/add-medicine', { method: 'POST', body: payload });
      await refreshBackendState(); navigateTo('medicines'); showToast(result.message, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  }


  // ================= MEDICATION HISTORY VIEW =================
  function ensureHistoryEnhancements() {
    const filterRow=document.getElementById('history-filter-search')?.closest('.grid');
    if(filterRow && !document.getElementById('history-filter-date')){
      const wrap=document.createElement('div'); wrap.innerHTML='<label class="block text-xs font-semibold text-outline mb-1">Filter by Date</label><input type="date" id="history-filter-date" class="w-full px-3 py-1.5 text-xs rounded-lg border border-outline-variant focus:border-primary outline-none" onchange="renderHistoryTable()">';
      filterRow.insertBefore(wrap.firstElementChild, filterRow.children[1]);
      const calendar=document.createElement('div'); calendar.id='medication-calendar-panel'; calendar.className='mt-5 border border-outline-variant rounded-xl p-4 bg-surface-container-low'; calendar.innerHTML='<div class="flex items-center justify-between gap-3"><div><p class="text-sm font-semibold text-on-surface">Medication calendar</p><p class="text-xs text-outline">Select a date to review doses.</p></div><input type="date" id="calendar-date" class="px-3 py-1.5 text-xs rounded-lg border border-outline-variant" onchange="loadCalendarDate()"></div><div id="calendar-results" class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"><span class="text-xs text-outline">Select a date.</span></div>';
      const table=filterRow.parentElement.querySelector('.mt-6'); table?.parentElement.insertBefore(calendar,table);
    }
  }

  function renderHistoryTable() {
    ensureHistoryEnhancements();
    const tbody=document.getElementById('history-tbody'), emptyMsg=document.getElementById('history-empty-msg');
    const searchFilter=(document.getElementById('history-filter-search')?.value||'').toLowerCase(); const medFilter=document.getElementById('history-filter-med')?.value||'All'; const statusFilter=document.getElementById('history-filter-status')?.value||'All'; const dateFilter=document.getElementById('history-filter-date')?.value||'';
    populateHistoryMedDropdown(); tbody.innerHTML='';
    const list=appState.history.filter(h=>{
      const matchSearch=h.medicine.toLowerCase().includes(searchFilter)||h.notes.toLowerCase().includes(searchFilter)||h.date.toLowerCase().includes(searchFilter);
      const matchMed=medFilter==='All'||h.medicine===medFilter; const matchStatus=statusFilter==='All'||h.status===statusFilter; const matchDate=!dateFilter||h.dateIso===dateFilter; return matchSearch&&matchMed&&matchStatus&&matchDate;
    });
    if(!list.length){emptyMsg.classList.remove('hidden');return;} emptyMsg.classList.add('hidden');
    list.forEach(row=>{let cls=row.status==='Taken'?'bg-[#dcfce7] text-[#16a34a] border-[#bbf7d0]':row.status==='Skipped'?'bg-error-container text-[#b91c1c] border-red-200':row.status==='Missed'?'bg-slate-100 text-slate-700 border-slate-200':'bg-[#fef3c7] text-[#d97706] border-[#fde68a]';let icon=row.status==='Taken'?'check':row.status==='Skipped'?'close':'schedule';const tr=document.createElement('tr');tr.className='hover:bg-surface transition-colors';tr.innerHTML=`<td class="py-3 px-5 font-medium text-on-surface whitespace-nowrap">${escapeHtml(row.date)}</td><td class="py-3 px-5 font-semibold text-on-surface">${escapeHtml(row.medicine)}</td><td class="py-3 px-5 text-on-surface-variant">${escapeHtml(row.dosage)}</td><td class="py-3 px-5 text-on-surface-variant">${escapeHtml(row.scheduledTime)}</td><td class="py-3 px-5"><span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}"><span class="material-symbols-outlined text-[13px]">${icon}</span>${escapeHtml(row.status)}</span></td><td class="py-3 px-5 text-on-surface">${escapeHtml(row.takenAt||'—')}</td><td class="py-3 px-5 text-xs text-outline max-w-xs truncate">${escapeHtml(row.notes||'—')}</td>`;tbody.appendChild(tr);});
  }

  async function loadCalendarDate(){
    const d=document.getElementById('calendar-date')?.value; if(!d)return; const box=document.getElementById('calendar-results');
    try{const data=await apiRequest(`/api/calendar?date=${encodeURIComponent(d)}`);box.innerHTML=data.items.length?data.items.map(x=>`<div class="rounded-lg border border-outline-variant bg-surface-container-lowest p-3"><div class="flex justify-between"><p class="text-xs font-semibold text-on-surface">${escapeHtml(x.medicine)}</p><span class="text-[11px] text-outline">${escapeHtml(x.time)}</span></div><p class="text-[11px] text-outline mt-1">${escapeHtml(x.dosage)}</p><span class="inline-block mt-2 text-[11px] font-semibold ${x.status==='Taken'?'text-green-700':x.status==='Missed'?'text-red-700':x.status==='Skipped'?'text-amber-700':'text-primary'}">${escapeHtml(x.status)}</span></div>`).join(''):'<span class="text-xs text-outline">No medication logs for this date.</span>';}catch(e){box.innerHTML='<span class="text-xs text-error">Unable to load calendar.</span>';}
  }

  function populateHistoryMedDropdown() {
    const select = document.getElementById('history-filter-med');
    if (!select) return;
    const currentVal = select.value;
    const uniqueMeds = Array.from(new Set(appState.history.map(h => h.medicine)));
    
    select.innerHTML = '<option value="All">All Medicines</option>';
    uniqueMeds.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });
    if (uniqueMeds.includes(currentVal)) {
      select.value = currentVal;
    }
  }

  function resetHistoryFilters() {
    if (document.getElementById('history-filter-search')) document.getElementById('history-filter-search').value = '';
    if (document.getElementById('history-filter-med')) document.getElementById('history-filter-med').value = 'All';
    if (document.getElementById('history-filter-status')) document.getElementById('history-filter-status').value = 'All';
    if (document.getElementById('history-filter-date')) document.getElementById('history-filter-date').value = '';
    renderHistoryTable();
    showToast('Filters reset to show all records.', 'info');
  }

    async function exportHistoryCSV() {
    window.location.href = '/export/csv';
    showToast("CSV history log exported successfully.", "success");
  }


  function showPDFUnavailableTooltip() {
    showToast("PDF export will be available in a future version.", "info");
  }

  // ================= REPORTS VIEW & ANALYTICS =================
    async function renderReportsView() {
    try {
      const report = await apiRequest('/api/reports');
      document.getElementById('report-adherence-pct').textContent = `${report.adherence_percentage}%`;
      document.getElementById('report-doses-taken').textContent = report.taken;
      document.getElementById('report-doses-skipped').textContent = report.skipped;
      document.getElementById('report-doses-missed').textContent = report.missed;
      const barContainer = document.getElementById('weekly-chart-container'); barContainer.innerHTML = '';
      (report.weekly || []).forEach(d => {
        const col=document.createElement('div'); col.className="flex flex-col items-center gap-2 flex-1";
        col.innerHTML=`<span class="text-[11px] font-semibold text-primary">${d.pct}%</span><div class="w-7 sm:w-10 bg-surface-container rounded-t-lg relative flex items-end overflow-hidden h-36"><div class="w-full bg-primary-container rounded-t-lg transition-all duration-500" style="height:${d.pct}%;"></div></div><span class="text-xs font-medium text-outline">${escapeHtml(d.label)}</span>`;
        barContainer.appendChild(col);
      });
      const total=report.total||0, pctTaken=total?Math.round(report.taken/total*100):0, pctSkipped=total?Math.round(report.skipped/total*100):0, pctMissed=total?Math.max(0,100-pctTaken-pctSkipped):0;
      document.getElementById('donut-pct-taken').textContent=`${pctTaken}%`; document.getElementById('donut-pct-skipped').textContent=`${pctSkipped}%`; document.getElementById('donut-pct-missed').textContent=`${pctMissed}%`;
      const c=2*Math.PI*40, st=pctTaken/100*c, ss=pctSkipped/100*c;
      document.getElementById('donut-svg-wrapper').innerHTML=`<svg class="w-36 h-36 transform -rotate-90" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="transparent" stroke="#e2e8f0" stroke-width="12"></circle><circle cx="50" cy="50" r="40" fill="transparent" stroke="#16a34a" stroke-width="12" stroke-dasharray="${st} ${c}"></circle><circle cx="50" cy="50" r="40" fill="transparent" stroke="#ba1a1a" stroke-width="12" stroke-dasharray="${ss} ${c}" stroke-dashoffset="-${st}"></circle></svg><div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"><span class="text-lg font-bold text-on-surface">${report.adherence_percentage}%</span><span class="text-[10px] text-outline">Adherence</span></div>`;
    } catch(e) { showToast(e.message,'error'); }
  }


  // ================= SETTINGS VIEW =================
  function renderSettingsView() {
    document.getElementById('settings-name').value = appState.user.name;
    document.getElementById('settings-email').value = appState.user.email;

    const s = appState.settings;
    document.getElementById('toggle-notif-reminders').checked = !!s.medicineReminders;
    document.getElementById('toggle-notif-browser').checked = !!s.browserNotifications;
    document.getElementById('toggle-notif-sound').checked = !!s.reminderSound;
    document.getElementById('toggle-notif-summary').checked = !!s.dailySummary;
  }

    async function handleSaveSettingsProfile(e) {
    e.preventDefault();
    try {
      const result=await apiRequest('/settings/profile',{method:'POST',body:{name:document.getElementById('settings-name').value.trim(),email:document.getElementById('settings-email').value.trim()}});
      await refreshBackendState(); renderSettingsView(); showToast(result.message,'success');
    } catch(e){showToast(e.message,'error');}
  }
  async function handleSaveNotificationToggles() {
    if (document.getElementById('toggle-notif-browser')?.checked) requestBrowserNotifications();
    const settings={medicineReminders:document.getElementById('toggle-notif-reminders').checked,browserNotifications:document.getElementById('toggle-notif-browser').checked,reminderSound:document.getElementById('toggle-notif-sound').checked,dailySummary:document.getElementById('toggle-notif-summary').checked};
    try{await apiRequest('/api/settings/notifications',{method:'POST',body:settings}); appState.settings=settings; showToast('Notification preferences saved.','info');}catch(e){showToast(e.message,'error');}
  }




  function renderNotificationMenu() {
    const list = document.getElementById('notif-list');
    const dot = document.getElementById('notif-dot');
    list.innerHTML = '';

    const unread = appState.notifications.filter(n => !n.read).length;
    if (unread > 0) {
      dot.classList.remove('hidden');
    } else {
      dot.classList.add('hidden');
    }

    if (appState.notifications.length === 0) {
      list.innerHTML = `<p class="p-4 text-xs text-center text-outline">You’re all caught up.</p>`;
      return;
    }

    appState.notifications.forEach(n => {
      const item = document.createElement('div');
      item.className = `p-3 flex items-start gap-2.5 transition-colors ${n.read ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`;
      item.innerHTML = `
        <span class="material-symbols-outlined text-[18px] text-primary mt-0.5">notifications_active</span>
        <div class="flex-1">
          <p class="text-xs text-on-surface font-medium leading-snug">${escapeHtml(n.text)}</p>
          <span class="text-[10px] text-outline mt-0.5 block">${escapeHtml(n.time)}</span>
        </div>
      `;
      list.appendChild(item);
    });
    const historyBtn=document.createElement('button'); historyBtn.className='w-full px-3 py-2.5 text-xs font-semibold text-primary hover:bg-surface-container-low border-t border-outline-variant'; historyBtn.textContent='View notification history'; historyBtn.onclick=openNotificationHistory; list.appendChild(historyBtn);
  }

  async function openNotificationHistory(){
    try{const rows=await apiRequest('/api/notifications/history');let modal=document.getElementById('modal-notification-history');if(!modal){modal=document.createElement('div');modal.id='modal-notification-history';modal.className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50';document.body.appendChild(modal);}modal.innerHTML=`<div class="bg-surface-container-lowest rounded-2xl max-w-xl w-full border border-outline-variant p-6 shadow-xl max-h-[80vh] overflow-hidden"><div class="flex items-center justify-between"><div><p class="text-xs text-primary font-semibold uppercase tracking-wide">Notifications</p><h3 class="text-xl font-bold text-on-surface">Notification history</h3></div><button class="p-2 text-outline hover:text-on-surface" onclick="document.getElementById('modal-notification-history').remove()"><span class="material-symbols-outlined">close</span></button></div><div class="mt-4 max-h-[55vh] overflow-y-auto space-y-2">${rows.length?rows.map(r=>`<div class="p-3 rounded-lg border border-outline-variant ${r.read?'bg-surface-container-lowest':'bg-surface-container-low'}"><div class="flex justify-between gap-3"><p class="text-xs font-semibold text-on-surface">${escapeHtml(r.message)}</p><span class="text-[10px] text-outline whitespace-nowrap">${escapeHtml(r.time)}</span></div><p class="text-[10px] text-outline mt-1">${escapeHtml(r.type)}</p></div>`).join(''):'<p class="text-xs text-outline text-center py-8">No notification history yet.</p>'}</div></div>`;}catch(e){showToast(e.message,'error');}
  }

  function toggleNotificationDropdown() {
    const dd = document.getElementById('notif-dropdown');
    document.getElementById('profile-dropdown').classList.add('hidden');
    dd.classList.toggle('hidden');
    if (!dd.classList.contains('hidden')) {
      renderNotificationMenu();
    }
  }

  async function markAllNotificationsRead() {
    try { await apiRequest('/api/notifications/read',{method:'POST',body:{all:true}}); appState.notifications.forEach(n=>n.read=true); renderNotificationMenu(); showToast('All notifications marked as read.','info'); } catch(e){showToast(e.message,'error');}
  }

  function toggleProfileDropdown() {
    const dd = document.getElementById('profile-dropdown');
    document.getElementById('notif-dropdown').classList.add('hidden');
    dd.classList.toggle('hidden');
  }

  // Medicine Reminder Modal Controls + automatic reminder engine
  let activeModalMedId = null;
  let activeModalScheduleId = null;

  function openReminderForDose(dose, automatic=false) {
    activeReminderDose=dose; activeModalMedId=dose.medicine_id; activeModalScheduleId=dose.schedule_id;
    document.getElementById('modal-reminder-name').textContent=dose.medicine_name;
    document.getElementById('modal-reminder-dosage').textContent=dose.dosage;
    document.getElementById('modal-reminder-instructions').textContent='Scheduled for '+(dose.scheduled_time||'now')+'. Follow your prescribed instructions.';
    document.getElementById('modal-reminder').classList.remove('hidden');
    if(automatic){
      if(appState.settings.browserNotifications && 'Notification' in window && Notification.permission==='granted') new Notification('MediMate medicine reminder',{body:`${dose.medicine_name} • ${dose.dosage}`});
      if(appState.settings.reminderSound) playReminderChime();
    }
  }

  function openReminderModal() {
    const dose=(appState.todaySchedules||[]).find(m=>m.status==='Pending');
    if(dose) openReminderForDose({medicine_id:dose.medicineId,schedule_id:dose.scheduleId,medicine_name:dose.name,dosage:dose.dosage,scheduled_time:dose.time},false);
    else showToast('There are no pending scheduled doses today.','info');
  }
  function closeReminderModal(){document.getElementById('modal-reminder').classList.add('hidden');}
  async function handleSnoozeReminder(){
    if(!activeModalMedId||!activeModalScheduleId)return;
    const minutes=Number(document.getElementById('remind-later-minutes')?.value||15);
    try{const r=await apiRequest('/api/remind-later',{method:'POST',body:{medicine_id:activeModalMedId,schedule_id:activeModalScheduleId,minutes}});closeReminderModal();showToast(r.message,'info');shownReminderKeys.delete(`${activeModalMedId}-${activeModalScheduleId}-${new Date().toISOString().slice(0,10)}`);}catch(e){showToast(e.message,'error');}
  }
  async function handleReminderConfirmTake(){if(!activeModalMedId)return;closeReminderModal();await markMedicineTaken(activeModalMedId,activeModalScheduleId);}
  async function handleReminderSkip(){if(!activeModalMedId)return;closeReminderModal();await skipMedicine(activeModalMedId,activeModalScheduleId);}
  function playReminderChime(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=880;gain.gain.setValueAtTime(.001,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.03);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.7);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.75);}catch(_){} }
  async function requestBrowserNotifications(){if(!('Notification' in window)){showToast('This browser does not support notifications.','warning');return;}const p=await Notification.requestPermission();if(p==='granted')showToast('Browser notifications enabled.','success');else showToast('Notification permission was not granted.','warning');}
  async function refreshPersistentNotifications(){try{appState.notifications=await apiRequest('/api/notifications');renderNotificationMenu();}catch(_){} }
  async function checkDueReminders(){
    if(!appState.auth.isLoggedIn || !appState.settings.medicineReminders)return;
    try{
      const doses=await apiRequest('/api/upcoming'); const now=Date.now();
      for(const d of doses){const target=new Date(d.target).getTime();const key=`${d.medicine_id}-${d.schedule_id}-${new Date().toISOString().slice(0,10)}`;if(now>=target&&!shownReminderKeys.has(key)){shownReminderKeys.add(key);openReminderForDose(d,true);break;}}
      await refreshPersistentNotifications();
    }catch(_){ }
  }
  function startReminderEngine(){if(reminderPollTimer)clearInterval(reminderPollTimer);checkDueReminders();reminderPollTimer=setInterval(checkDueReminders,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDueReminders();});}

  // ================= AUTH FLOW =================
  function showAuthScreen(mode = 'login') {
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('auth-container').classList.remove('hidden');
    switchAuthMode(mode);
  }

  function showAppScreen() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    navigateTo('dashboard');
  }

  function switchAuthMode(mode) {
    const formLogin = document.getElementById('form-login');
    const formReg = document.getElementById('form-register');
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');

    if (mode === 'login') {
      formLogin.classList.remove('hidden');
      formReg.classList.add('hidden');
      title.textContent = "Welcome to MediMate";
      subtitle.textContent = "Sign in to manage your medication regimen";
    } else {
      formLogin.classList.add('hidden');
      formReg.classList.remove('hidden');
      title.textContent = "Create MediMate Account";
      subtitle.textContent = "Register student identity for treatment routine tracker";
    }
  }

  function togglePasswordVisibility(fieldId, iconId) {
    const field = document.getElementById(fieldId);
    const icon = document.getElementById(iconId);
    if (field.type === 'password') {
      field.type = 'text';
      icon.textContent = 'visibility_off';
    } else {
      field.type = 'password';
      icon.textContent = 'visibility';
    }
  }

    async function handleLoginSubmit(e) {
    e.preventDefault();
    const btn=document.getElementById('login-submit-btn'), original=btn.innerHTML; btn.disabled=true;
    try{
      const result=await apiRequest('/login',{method:'POST',body:{email:document.getElementById('login-email').value.trim(),password:document.getElementById('login-password').value}});
      await loadState(); btn.innerHTML=original; btn.disabled=false; showAppScreen(); showToast(result.message,'success');
    }catch(e){btn.innerHTML=original;btn.disabled=false;showToast(e.message,'error');}
  }
  async function handleRegisterSubmit(e) {
    e.preventDefault();
    const name=document.getElementById('reg-name').value.trim(),email=document.getElementById('reg-email').value.trim(),pw=document.getElementById('reg-password').value,pwConfirm=document.getElementById('reg-password-confirm').value;
    const mismatch=document.getElementById('reg-pw-mismatch'); if(pw!==pwConfirm){mismatch.classList.remove('hidden');return;} mismatch.classList.add('hidden');
    try{const result=await apiRequest('/register',{method:'POST',body:{name,email,password:pw,confirm_password:pwConfirm}});await loadState();updateUserHeaderDisplays();showAppScreen();showToast(result.message,'success');}catch(e){showToast(e.message,'error');}
  }

  async function handleLogout(){try{await apiRequest('/logout',{headers:{'Accept':'application/json'}});}catch(_){} appState.auth.isLoggedIn=false;showAuthScreen('login');showToast('Logged out securely.','info');}



  function openChangePasswordModal() {
    document.getElementById('modal-change-password').classList.remove('hidden');
  }
  function closeChangePasswordModal() {
    document.getElementById('modal-change-password').classList.add('hidden');
  }
  async function submitChangePassword() {
    const current_password=document.getElementById('current-password').value;
    const new_password=document.getElementById('new-password').value;
    const confirm_password=document.getElementById('confirm-password').value;
    try {
      const result=await apiRequest('/settings/password',{method:'POST',body:{current_password,new_password,confirm_password}});
      closeChangePasswordModal();
      document.getElementById('current-password').value='';
      document.getElementById('new-password').value='';
      document.getElementById('confirm-password').value='';
      showToast(result.message,'success');
    } catch(e) { showToast(e.message,'error'); }
  }

  // ================= TOAST NOTIFICATION ENGINE =================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let iconName = 'info';
    let iconColor = 'text-primary';
    let borderColor = 'border-primary/20';

    if (type === 'success') {
      iconName = 'check_circle';
      iconColor = 'text-[#16a34a]';
      borderColor = 'border-[#16a34a]/30';
    } else if (type === 'error') {
      iconName = 'error';
      iconColor = 'text-error';
      borderColor = 'border-error/30';
    } else if (type === 'warning') {
      iconName = 'warning';
      iconColor = 'text-[#d97706]';
      borderColor = 'border-amber-200';
    }

    toast.className = `pointer-events-auto bg-surface-container-lowest border ${borderColor} rounded-xl p-3.5 shadow-lg flex items-center justify-between gap-3 text-sm transition-all duration-300 transform translate-y-2 opacity-0`;
    toast.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="material-symbols-outlined text-[20px] ${iconColor}">${iconName}</span>
        <span class="text-on-surface text-xs font-medium">${escapeHtml(message)}</span>
      </div>
      <button class="text-outline hover:text-on-surface p-0.5" onclick="this.parentElement.remove()">
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    `;

    container.appendChild(toast);

    // Animate in
    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    // Auto dismiss after 3s
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // Utility to escape HTML preventing injection
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

  function updateUserHeaderDisplays() {
    const name = appState.user.name || 'MediMate User';
    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'MM';
    document.getElementById('header-greeting').textContent = `Good morning, ${name.split(' ')[0]}`;
    document.getElementById('user-display-name').textContent = name;
    document.getElementById('user-avatar-initials').textContent = initials;
    document.getElementById('menu-user-name').textContent = name;
    document.getElementById('menu-user-email').textContent = appState.user.email || '';
    const headerDate = document.getElementById('header-date');
    if (headerDate) headerDate.textContent = new Date().toLocaleDateString(undefined, {weekday:'short', day:'2-digit', month:'short', year:'numeric'});
  }

  function refreshAllViews() {
    updateUserHeaderDisplays();
    renderNotificationMenu();
    navigateTo(currentView);
  }

  // Global Click Listener for Dropdowns
  document.addEventListener('click', (e) => {
    const notifBtn = document.getElementById('notif-btn');
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifBtn && notifDropdown && !notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
      notifDropdown.classList.add('hidden');
    }

    const profileDropdown = document.getElementById('profile-dropdown');
    if (profileDropdown && !profileDropdown.contains(e.target) && !e.target.closest('button[onclick="toggleProfileDropdown()"]')) {
      profileDropdown.classList.add('hidden');
    }
  });

  // Initialization
  window.addEventListener('DOMContentLoaded', async () => {
    const loggedIn = await loadState();
    if (!loggedIn || !appState.auth.isLoggedIn) showAuthScreen(window.MEDIMATE_AUTH_MODE || 'login');
    else { currentView = window.MEDIMATE_INITIAL_VIEW || 'dashboard'; refreshAllViews(); startNextDoseCountdown(); startReminderEngine(); }
  });
