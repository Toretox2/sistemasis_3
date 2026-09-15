const dashboardState = {
  allRows: [],
  filteredRows: [],
  payrollHistory: [],
  employees: [],
  selectedHistoryId: null,
  historyPeriodId: null,
  currentPage: 1,
  pageSize: 5,
  currency: 'GTQ',
};

function calculateWorkedHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;

  const startDate = parseTimeToDate(startTime);
  const endDate = parseTimeToDate(endTime);

  if (!startDate || !endDate) return 0;

  return Math.max((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60), 0);
}

function parseTimeToDate(value) {
  if (!value) return null;

  const normalized = value.includes(':') ? value : `${value}:00`;
  const [hours, minutes, seconds = '0'] = normalized.split(':').map(Number);
  const parsed = new Date(2000, 0, 1, hours, minutes, seconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculateExtraHours(hoursWorked) {
  return Math.max(hoursWorked - 8, 0);
}

function getDateRange(daysBack = 30) {
  const dates = [];
  const today = new Date();

  for (let i = daysBack; i >= 0; i -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - i);
    dates.push(toISODate(current));
  }

  return dates;
}

function toISODate(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().split('T')[0];
}

document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    console.error('Supabase no está inicializado.');
    window.location.href = './admin-login.html';
    return;
  }

  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (!session) {
      window.location.href = './admin-login.html';
      return;
    }
  } catch (error) {
    console.error('No hay sesión activa:', error);
    window.location.href = './admin-login.html';
    return;
  }

  let visibilityLogoutInProgress = false;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'hidden' || visibilityLogoutInProgress) {
      return;
    }

    visibilityLogoutInProgress = true;
    await cerrarSesion();
    showLockScreen();
    visibilityLogoutInProgress = false;
  });

  const exportButton = document.getElementById('exportPayrollBtn');

  if (exportButton) {
    exportButton.addEventListener('click', async () => {
      try {
        const rows = await fetchAttendanceWithEmployees();
        const exportRows = buildPayrollExport(rows);

        if (!exportRows.length) {
          alert('No hay datos para exportar.');
          return;
        }

        const worksheet = XLSX.utils.json_to_sheet(exportRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Planilla');
        XLSX.writeFile(workbook, 'auratech-planilla.xlsx');
      } catch (error) {
        console.error('Error al exportar la planilla:', error);
        alert('No se pudo exportar la planilla. Intenta nuevamente.');
      }
    });
  }

  bindFilters();
  bindNavigation();
  bindCurrencySelector();
  bindEmployeeModal();
  bindPayrollHistoryControls();
  bindWorkScheduleForm();
  bindShiftManagement();
  bindReturnToScanner();
  bindLogoutButton();
  bindLockScreen();
  await loadDashboardData();
  await loadPayrollHistory();
  await loadWorkScheduleSettings();
  await loadShifts();
  renderPerformanceSummary();
});

function bindNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });
}

function switchView(viewName) {
  const views = document.querySelectorAll('.view-panel');
  const navItems = document.querySelectorAll('.nav-item');
  const pageTitle = document.getElementById('pageTitle');

  const titles = {
    summary: 'Resumen General',
    employees: 'Empleados',
    payroll: 'Pagos',
    schedules: 'Horarios',
    reports: 'Reportes',
  };

  views.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${viewName}`);
  });

  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  if (pageTitle) {
    pageTitle.textContent = titles[viewName] || 'Resumen General';
  }
}

async function loadDashboardData() {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    return;
  }

  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!session) {
      showLockScreen();
      return;
    }

    const [rows, employees] = await Promise.all([
      fetchAttendanceWithEmployees(),
      fetchEmployees(),
    ]);
    dashboardState.allRows = rows;
    dashboardState.employees = employees;
    dashboardState.filteredRows = rows;
    dashboardState.currentPage = 1;

    populateFilterOptions(rows);
    renderDashboard();
  } catch (error) {
    if (isAuthenticationError(error)) {
      showLockScreen();
      return;
    }

    console.error('Error al cargar datos del dashboard:', error);
    showEmptyTable('Error al cargar los registros.');
  }
}

function isAuthenticationError(error) {
  return error?.status === 401
    || error?.status === 403
    || error?.code === '401'
    || error?.code === '403'
    || error?.code === 'PGRST301';
}

async function loadPayrollHistory() {
  const supabase = window.AuraTechSupabase;
  const historyList = document.getElementById('payrollHistoryList');

  if (!supabase || !historyList) {
    return;
  }

  try {
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('*')
      .order('fecha_fin', { ascending: false });

    if (error) {
      throw error;
    }

    dashboardState.payrollHistory = data || [];
    renderPayrollHistoryList(dashboardState.payrollHistory);
  } catch (error) {
    console.error('Error al cargar el historial de pagos:', error);
    dashboardState.payrollHistory = [];
    renderPayrollHistoryList([]);
  }
}

function renderPayrollHistoryList(historyRows) {
  const historyList = document.getElementById('payrollHistoryList');

  if (!historyList) {
    return;
  }

  if (!historyRows.length) {
    historyList.innerHTML = '<div class="history-card"><p style="margin:0; color: var(--color-muted);">No hay cierres guardados todavía.</p></div>';
    return;
  }

  historyList.innerHTML = historyRows
    .slice()
    .sort((a, b) => new Date(b.fecha_fin) - new Date(a.fecha_fin))
    .map((period) => `
      <article class="history-card">
        <div class="history-card-header">
          <div>
            <h4 class="history-title">${period.nombre_periodo}</h4>
            <div class="history-range">${formatShortDate(period.fecha_inicio)} - ${formatShortDate(period.fecha_fin)}</div>
          </div>
          <span class="history-total">${formatCurrency(period.total_pagado || 0)}</span>
        </div>
        <div class="history-meta">
          <span>${period.periodo_tipo === 'quincenal' ? 'Quincenal' : 'Mensual'}</span>
          <span>${formatDate(period.fecha_fin)}</span>
        </div>
        <div class="history-actions">
          <button class="history-detail-btn" type="button" data-period-id="${period.id}">Ver Detalle</button>
        </div>
      </article>
    `)
    .join('');

  historyList.querySelectorAll('.history-detail-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const periodId = button.dataset.periodId;
      openPayrollHistoryDetail(periodId);
    });
  });
}

function getPayrollPeriodRange(periodType = 'quincenal', referenceDate = new Date()) {
  const currentDate = new Date(referenceDate);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  if (periodType === 'mensual') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);

    return {
      fecha_inicio: toISODate(start),
      fecha_fin: toISODate(end),
    };
  }

  const day = currentDate.getDate();
  const start = new Date(year, month, day <= 15 ? 1 : 16);
  const end = new Date(year, month, day <= 15 ? 15 : new Date(year, month + 1, 0).getDate());

  return {
    fecha_inicio: toISODate(start),
    fecha_fin: toISODate(end),
  };
}

function buildPayrollHistoryLabel(record) {
  const startDate = new Date(record.fecha_inicio + 'T00:00:00');
  const monthLabel = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(startDate);

  if (record.periodo_tipo === 'quincenal') {
    const descriptor = new Date(record.fecha_inicio + 'T00:00:00').getDate() <= 15 ? '1ra' : '2da';
    return `${descriptor} Quincena ${monthLabel}`;
  }

  return `Mes ${monthLabel}`;
}

function formatShortDate(dateString) {
  if (!dateString) return '—';

  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
  });
}

function openPayrollHistoryDetail(periodId) {
  const modal = document.getElementById('historyDetailModal');
  const tableBody = document.getElementById('historyDetailTableBody');
  const summary = document.getElementById('historyDetailSummary');

  if (!modal || !tableBody || !summary) {
    return;
  }

  const period = dashboardState.payrollHistory.find((item) => item.id === periodId);

  if (!period) {
    return;
  }

  const snapshot = Array.isArray(period.snapshot) ? period.snapshot : [];
  summary.textContent = `${period.nombre_periodo} • ${formatShortDate(period.fecha_inicio)} - ${formatShortDate(period.fecha_fin)}`;

  tableBody.innerHTML = snapshot.length
    ? snapshot.map((entry) => `
      <tr>
        <td>${entry.employee_name || 'Empleado no encontrado'}</td>
        <td>${entry.department || 'Sin departamento'}</td>
        <td>${formatCurrency(entry.pago_por_hora || 0)}</td>
        <td>${Number((entry.horas_trabajadas || 0).toFixed(1))}h</td>
        <td>${entry.asistencias || 0}</td>
        <td>${entry.faltas || 0}</td>
        <td>${formatCurrency(entry.pago_por_horas || 0)}</td>
        <td>${Number((entry.horas_extra || 0).toFixed(1))}h</td>
        <td>${Number((entry.horas_faltantes || 0).toFixed(1))}h</td>
        <td>${formatCurrency(entry.total_pagado || 0)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="10" style="text-align:center; color: var(--color-muted); padding: 2rem;">Sin detalle disponible para este período.</td></tr>';

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function bindFilters() {
  const dateFilter = document.getElementById('dateFilter');
  const employeeFilter = document.getElementById('employeeFilter');
  const departmentFilter = document.getElementById('departmentFilter');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');

  if (!dateFilter || !employeeFilter || !departmentFilter) {
    return;
  }

  const updateRows = async () => {
    const dateValue = dateFilter.value;
    const startValue = startDate?.value || '';
    const endValue = endDate?.value || '';

    if (dateValue === 'custom' && startValue && endValue) {
      try {
        const rows = await fetchAttendanceWithEmployees({
          startDate: startValue,
          endDate: endValue,
        });

        dashboardState.allRows = rows;
        dashboardState.filteredRows = rows;
        dashboardState.currentPage = 1;
        renderDashboard();
        return;
      } catch (error) {
        console.error('Error al recargar registros por rango personalizado:', error);
        showToast('No se pudieron cargar los registros del rango seleccionado.');
        return;
      }
    }

    dashboardState.currentPage = 1;
    const filtered = applyFilters();
    dashboardState.filteredRows = filtered;
    renderDashboard();
  };

  [dateFilter, employeeFilter, departmentFilter].forEach((element) => {
    element.addEventListener('change', updateRows);
  });

  [startDate, endDate].forEach((element) => {
    if (element) {
      element.addEventListener('change', updateRows);
    }
  });
}

function bindCurrencySelector() {
  const currencySelector = document.getElementById('currencySelector');

  if (!currencySelector) {
    return;
  }

  currencySelector.value = dashboardState.currency;
  currencySelector.addEventListener('change', (event) => {
    dashboardState.currency = event.target.value;
    renderDashboard();
  });
}

function bindPayrollHistoryControls() {
  const closePayrollButton = document.getElementById('closePayrollPeriodBtn');
  const modal = document.getElementById('closePayrollPeriodModal');
  const cancelButton = document.getElementById('cancelClosePayrollPeriod');
  const closeButton = document.getElementById('closeClosePayrollPeriod');
  const confirmButton = document.getElementById('confirmClosePayrollPeriod');
  const typeSelector = document.getElementById('closePayrollType');
  const startDate = document.getElementById('closePayrollStartDate');
  const endDate = document.getElementById('closePayrollEndDate');
  const historyModal = document.getElementById('historyDetailModal');
  const closeHistoryButton = document.getElementById('closeHistoryDetail');

  if (!closePayrollButton || !modal || !cancelButton || !closeButton || !confirmButton) {
    return;
  }

  const syncPeriodFields = () => {
    const range = getPayrollPeriodRange(typeSelector.value, new Date());
    startDate.value = range.fecha_inicio;
    endDate.value = range.fecha_fin;
  };

  const openModal = () => {
    syncPeriodFields();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  };

  closePayrollButton.addEventListener('click', openModal);
  cancelButton.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  typeSelector.addEventListener('change', () => {
    syncPeriodFields();
  });

  if (historyModal && closeHistoryButton) {
    closeHistoryButton.addEventListener('click', () => {
      historyModal.classList.remove('is-open');
      historyModal.setAttribute('aria-hidden', 'true');
    });

    historyModal.addEventListener('click', (event) => {
      if (event.target === historyModal) {
        historyModal.classList.remove('is-open');
        historyModal.setAttribute('aria-hidden', 'true');
      }
    });
  }

  confirmButton.addEventListener('click', async () => {
    const selectedType = typeSelector.value;
    const selectedStart = startDate.value;
    const selectedEnd = endDate.value;

    if (!selectedStart || !selectedEnd || selectedStart > selectedEnd) {
      showToast('Selecciona un rango de fechas válido.');
      return;
    }

    try {
      await closePayrollPeriod(selectedType, selectedStart, selectedEnd);
      closeModal();
      showToast('Periodo cerrado y guardado en el historial.');
    } catch (error) {
      console.error('Error al cerrar el periodo:', error);
      showToast('No se pudo cerrar el periodo. Intenta nuevamente.');
    }
  });
}

function bindEmployeeModal() {
  const modal = document.getElementById('employeeEditModal');
  const saveButton = document.getElementById('saveEmployeeEdit');
  const cancelButton = document.getElementById('cancelEmployeeEdit');
  const closeButton = document.getElementById('closeEmployeeEdit');

  if (!modal || !saveButton || !cancelButton || !closeButton) {
    return;
  }

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  };

  const openModal = (employeeId) => {
    const allRows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;
    const employee = dashboardState.employees.find((item) => item.id === employeeId)
      || allRows.find((item) => (item.employee_id || item.employees?.id) === employeeId)?.employees
      || {};
    const shiftSelect = document.getElementById('employeeEditShiftId');

    document.getElementById('employeeEditId').value = employeeId;
    document.getElementById('employeeEditDailyPay').value = employee.salario_base ?? 0;
    document.getElementById('employeeEditWorkdayHours').value = employee.horas_jornada || 8;

    if (shiftSelect) {
      shiftSelect.value = employee.shift_id || '';
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  };

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  closeButton.addEventListener('click', closeModal);
  cancelButton.addEventListener('click', closeModal);

  saveButton.addEventListener('click', async () => {
    const supabase = window.AuraTechSupabase;
    const employeeId = document.getElementById('employeeEditId').value;
    const salaryInput = document.getElementById('employeeEditDailyPay');
    const salarioBase = parseFloat(salaryInput?.value?.trim() || '');
    const horasJornada = Number(document.getElementById('employeeEditWorkdayHours').value || 8);
    const shiftId = document.getElementById('employeeEditShiftId')?.value || null;

    if (!supabase || !employeeId || !Number.isFinite(salarioBase) || salarioBase < 0) {
      showToast('Ingresa un salario base válido.');
      return;
    }

    try {
      const { error } = await supabase
        .from('employees')
        .update({
          salario_base: salarioBase,
          horas_jornada: horasJornada,
          shift_id: shiftId,
        })
        .eq('id', employeeId);

      if (error) {
        throw error;
      }

      closeModal();
      showToast('Datos actualizados correctamente');
      await loadDashboardData();
    } catch (error) {
      console.error('Error al guardar los cambios del empleado:', error);
      showToast('No se pudieron guardar los cambios. Intenta nuevamente.');
    }
  });

  bindNewEmployeeModal();
  bindEmployeeQrModal();

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.edit-employee-btn');

    if (!button || button.dataset.employeeAction) {
      return;
    }

    const employeeId = button.dataset.employeeId;

    if (employeeId) {
      openModal(employeeId);
    }
  });
}

function bindNewEmployeeModal() {
  const modal = document.getElementById('newEmployeeModal');
  const form = document.getElementById('newEmployeeForm');
  const openButton = document.getElementById('newEmployeeBtn');
  const cancelButton = document.getElementById('cancelNewEmployee');
  const closeButton = document.getElementById('closeNewEmployee');

  if (!modal || !form || !openButton || !cancelButton || !closeButton) return;

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    form.reset();
    document.getElementById('newEmployeeHours').value = '8';
  };

  openButton.addEventListener('click', () => {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('newEmployeeName').focus();
  });
  cancelButton.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const supabase = window.AuraTechSupabase;
    const name = document.getElementById('newEmployeeName').value.trim();
    const department = document.getElementById('newEmployeeDepartment').value.trim();
    const salary = parseFloat(document.getElementById('newEmployeeSalary').value.trim());
    const hours = parseFloat(document.getElementById('newEmployeeHours').value.trim());

    if (!supabase || !name || !department || !Number.isFinite(salary) || salary < 0 || !Number.isFinite(hours) || hours <= 0) {
      showToast('Completa los datos del empleado correctamente.');
      return;
    }

    try {
      const qrCodeHash = await generateUniqueQrCodeHash(supabase);
      const { error } = await supabase.from('employees').insert({
        nombre: name,
        cargo: department,
        salario_base: salary,
        horas_jornada: hours,
        qr_code_hash: qrCodeHash,
      });

      if (error) throw error;

      closeModal();
      showToast('Empleado creado correctamente.');
      await loadDashboardData();
    } catch (error) {
      console.error('Error al crear el empleado:', error);
      showToast('No se pudo crear el empleado. Intenta nuevamente.');
    }
  });
}

async function generateUniqueQrCodeHash(supabase) {
  const { data, error } = await supabase
    .from('employees')
    .select('qr_code_hash');

  if (error) throw error;

  const usedCodes = new Set((data || []).map((employee) => employee.qr_code_hash).filter(Boolean));
  let code = '';

  do {
    code = String(Math.floor(100000000 + Math.random() * 900000000));
  } while (usedCodes.has(code));

  return code;
}

function bindEmployeeQrModal() {
  const modal = document.getElementById('employeeQrModal');
  const closeButton = document.getElementById('closeEmployeeQr');
  const downloadButton = document.getElementById('downloadEmployeeQr');

  if (!modal || !closeButton || !downloadButton) return;

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  };

  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-employee-action]');
    if (!button) return;

    const employee = dashboardState.employees.find((item) => item.id === button.dataset.employeeId);
    if (button.dataset.employeeAction === 'delete') {
      if (!employee) {
        showToast('No se encontró el empleado seleccionado.');
        return;
      }

      const confirmed = window.confirm(`¿Deseas eliminar a ${employee.nombre}? También se eliminarán sus registros de asistencia.`);
      if (!confirmed) return;

      try {
        const supabase = window.AuraTechSupabase;
        const { error } = await supabase
          .from('employees')
          .delete()
          .eq('id', employee.id);

        if (error) throw error;

        showToast('Empleado eliminado correctamente.');
        await loadDashboardData();
      } catch (error) {
        console.error('Error al eliminar el empleado:', error);
        showToast('No se pudo eliminar el empleado. Intenta nuevamente.');
      }
      return;
    }

    const qrCodeHash = employee?.qr_code_hash;
    if (!employee || !qrCodeHash) {
      showToast('No se encontró el empleado seleccionado.');
      return;
    }

    if (button.dataset.employeeAction === 'view-qr') {
      openQrModal(employee);
      return;
    }

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCodeHash)}`;
    const safeName = employee.nombre.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'Empleado';
    await downloadQrImage(qrUrl, `QR_${safeName}.png`);
  });

  function openQrModal(employee) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(employee.qr_code_hash)}`;
    const safeName = employee.nombre.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'Empleado';

    document.getElementById('employeeQrTitle').textContent = `QR de ${employee.nombre}`;
    document.getElementById('employeeQrContent').innerHTML = `
      <img src="${qrUrl}" alt="Código QR de ${escapeHtml(employee.nombre)}" width="250" height="250" />
      <p>Código: <strong>${escapeHtml(employee.qr_code_hash)}</strong></p>
    `;
    downloadButton.dataset.qrUrl = qrUrl;
    downloadButton.dataset.fileName = `QR_${safeName}.png`;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  downloadButton.addEventListener('click', async () => {
    if (downloadButton.dataset.qrUrl) {
      await downloadQrImage(downloadButton.dataset.qrUrl, downloadButton.dataset.fileName);
    }
  });
}

async function downloadQrImage(url, fileName) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo descargar el QR.');
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    console.warn('Descarga directa no disponible, se abrirá el QR:', error);
    window.open(url, '_blank', 'noopener');
  }
}

async function loadWorkScheduleSettings() {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    return;
  }

  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .eq('setting_key', 'work_schedule')
    .maybeSingle();

  if (error) {
    console.error('Error al cargar configuración de horarios:', error);
    return;
  }

  const entryTimeInput = document.getElementById('scheduleEntryTime');
  const exitTimeInput = document.getElementById('scheduleExitTime');
  const toleranceInput = document.getElementById('scheduleToleranceMinutes');

  if (entryTimeInput && data?.hora_entrada_oficial) {
    entryTimeInput.value = data.hora_entrada_oficial;
  }

  if (exitTimeInput && data?.hora_salida_oficial) {
    exitTimeInput.value = data.hora_salida_oficial;
  }

  if (toleranceInput && data?.margen_tolerancia_minutos !== undefined && data?.margen_tolerancia_minutos !== null) {
    toleranceInput.value = data.margen_tolerancia_minutos;
  }

  await renderGeneralScheduleEmployeeSelection();
}

async function renderGeneralScheduleEmployeeSelection() {
  const employeeList = document.getElementById('generalScheduleEmployeeList');
  const selectAllCheckbox = document.getElementById('selectAllGeneralScheduleEmployees');

  if (!employeeList || !selectAllCheckbox) {
    return;
  }

  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    employeeList.innerHTML = '<p style="margin:0; color: var(--color-muted);">No se pudo cargar la lista de empleados.</p>';
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }

  try {
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, nombre, cargo, tipo_horario')
      .order('nombre', { ascending: true });

    if (employeesError) {
      throw employeesError;
    }

    employeeList.innerHTML = (employees || []).map((employee) => `
      <label class="general-schedule-employee-item">
        <input type="checkbox" class="employee-checkbox" name="generalScheduleEmployee" value="${employee.id}" ${employee.tipo_horario === 'general' ? 'checked' : ''} />
        <span>
          <strong>${employee.nombre}</strong><br />
          <small style="color: var(--color-muted);">${employee.cargo || 'Sin departamento'}</small>
        </span>
      </label>
    `).join('');

    const checkboxes = Array.from(
      employeeList.querySelectorAll('input.employee-checkbox')
    );

    if (!checkboxes.length) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }

    const allChecked = checkboxes.every((checkbox) => checkbox.checked);
    const someChecked = checkboxes.some((checkbox) => checkbox.checked);

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  } catch (error) {
    console.error('Error al renderizar empleados para horario general:', error);
    employeeList.innerHTML = '<p style="margin:0; color: var(--color-muted);">No se pudo cargar la asignación de empleados.</p>';
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  }
}

async function loadShifts() {
  const supabase = window.AuraTechSupabase;
  const shiftList = document.getElementById('workShiftList');

  if (!supabase || !shiftList) {
    return;
  }

  try {
    const { data, error } = await supabase
      .from('work_shifts')
      .select('*')
      .order('entry_time', { ascending: true });

    if (error) {
      throw error;
    }

    dashboardState.shifts = data || [];
    renderShiftCards(dashboardState.shifts);
    populateShiftSelectorOptions(dashboardState.shifts);
  } catch (error) {
    console.error('Error al cargar los turnos:', error);
    dashboardState.shifts = [];
    renderShiftCards([]);
    populateShiftSelectorOptions([]);
  }
}

function renderShiftCards(shifts) {
  const shiftList = document.getElementById('workShiftList');

  if (!shiftList) {
    return;
  }

  if (!shifts.length) {
    shiftList.innerHTML = '<div class="shift-card"><p style="margin:0; color: var(--color-muted);">No hay turnos creados aún.</p></div>';
    return;
  }

  shiftList.innerHTML = shifts.map((shift) => `
    <article class="shift-card">
      <div class="shift-card-header">
        <div>
          <h4>${shift.name}</h4>
        </div>
        <span class="shift-badge">Activo</span>
      </div>

      <div class="shift-meta">
        <span>Entrada ${shift.entry_time}</span>
        <span>Salida ${shift.exit_time}</span>
        <span>Tolerancia ${shift.tolerance_minutes} min</span>
      </div>

      <div class="shift-action-row">
        <button class="shift-action-btn" type="button" data-shift-action="edit" data-shift-id="${shift.id}">Editar</button>
        <button class="shift-action-btn danger" type="button" data-shift-action="delete" data-shift-id="${shift.id}">Eliminar</button>
      </div>
    </article>
  `).join('');

  shiftList.querySelectorAll('[data-shift-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const shiftId = button.dataset.shiftId;
      const action = button.dataset.shiftAction;

      if (action === 'delete') {
        await deleteShift(shiftId);
        return;
      }

      openShiftModal(shiftId);
    });
  });
}

function bindWorkScheduleForm() {
  const form = document.getElementById('workScheduleForm');
  const resetButton = document.getElementById('resetWorkScheduleBtn');
  const selectAllCheckbox = document.getElementById('selectAllGeneralScheduleEmployees');
  const employeeList = document.getElementById('generalScheduleEmployeeList');

  if (!form) {
    return;
  }

  const updateSelectAllState = () => {
    if (!employeeList || !selectAllCheckbox) {
      return;
    }

    const checkboxes = Array.from(
      employeeList.querySelectorAll('input.employee-checkbox')
    );

    if (!checkboxes.length) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }

    const allChecked = checkboxes.every((checkbox) => checkbox.checked);
    const someChecked = checkboxes.some((checkbox) => checkbox.checked);

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  };

  const setDefaultValues = () => {
    const entryTimeInput = document.getElementById('scheduleEntryTime');
    const exitTimeInput = document.getElementById('scheduleExitTime');
    const toleranceInput = document.getElementById('scheduleToleranceMinutes');

    if (entryTimeInput) entryTimeInput.value = '08:00';
    if (exitTimeInput) exitTimeInput.value = '17:00';
    if (toleranceInput) toleranceInput.value = '10';
  };

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      if (!employeeList) {
        return;
      }

      const checkboxes = employeeList.querySelectorAll('input.employee-checkbox');
      checkboxes.forEach((checkbox) => {
        checkbox.checked = selectAllCheckbox.checked;
      });
      updateSelectAllState();
    });
  }

  if (employeeList) {
    employeeList.addEventListener('change', (event) => {
      if (event.target.matches('input.employee-checkbox')) {
        updateSelectAllState();
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const supabase = window.AuraTechSupabase;

    if (!supabase) {
      showToast('La conexión con Supabase no está disponible.');
      return;
    }

    const payload = {
      setting_key: 'work_schedule',
      hora_entrada_oficial: document.getElementById('scheduleEntryTime')?.value || '08:00',
      hora_salida_oficial: document.getElementById('scheduleExitTime')?.value || '17:00',
      margen_tolerancia_minutos: Number(document.getElementById('scheduleToleranceMinutes')?.value || 10),
      updated_at: new Date().toISOString(),
    };

    const selectedIds = employeeList
      ? Array.from(
          employeeList.querySelectorAll('input.employee-checkbox:checked')
        )
          .map((checkbox) => String(checkbox.value || checkbox.dataset.id || '').trim())
          .filter((id) => id.length > 0)
      : [];

    const checkboxesFound = employeeList
      ? employeeList.querySelectorAll('input.employee-checkbox').length
      : 0;

    console.log('Checkboxes encontrados:', checkboxesFound);
    console.log('IDs seleccionados:', selectedIds);

    try {
      const { data, error } = await supabase
        .from('company_settings')
        .upsert(payload, { onConflict: 'setting_key' })
        .select('*');

      if (error) {
        throw error;
      }

      if (!selectedIds.length) {
        console.log('No hay empleados seleccionados. Validación fallida.');
        showToast('Debe seleccionar al menos un empleado para guardar la configuración general de horarios.');
        return;
      }

      const { data: allEmployees, error: allEmployeesError } = await supabase
        .from('employees')
        .select('id');

      if (allEmployeesError) {
        throw allEmployeesError;
      }

      const allEmployeeIds = (allEmployees || [])
        .map((employee) => String(employee.id || '').trim())
        .filter((id) => id.length > 0);

      if (allEmployeeIds.length) {
        const { error: resetError } = await supabase
          .from('employees')
          .update({ tipo_horario: 'personalizado' })
          .in('id', allEmployeeIds);

        if (resetError) {
          throw resetError;
        }
      }

      const { error: assignError } = await supabase
        .from('employees')
        .update({ tipo_horario: 'general' })
        .in('id', selectedIds);

      if (assignError) {
        throw assignError;
      }

      if (data && data.length) {
        showToast('Configuración de horarios guardada correctamente.');
      }

      await renderGeneralScheduleEmployeeSelection();
    } catch (error) {
      console.error('Error al guardar configuración de horarios:', error);
      showToast('No se pudo guardar la configuración.');
    }
  });

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      setDefaultValues();
      showToast('Valores restablecidos.');
    });
  }
}

function bindShiftManagement() {
  const createButton = document.getElementById('createShiftBtn');
  const modal = document.getElementById('shiftModal');
  const closeButton = document.getElementById('closeShiftModal');
  const cancelButton = document.getElementById('cancelShiftModal');
  const form = document.getElementById('shiftForm');
  const shiftEmployeeList = document.getElementById('shiftEmployeeList');
  const selectAllCheckbox = document.getElementById('selectAllShiftEmployees');

  if (!createButton || !modal || !closeButton || !cancelButton || !form || !shiftEmployeeList || !selectAllCheckbox) {
    return;
  }

  const syncSelectAllShiftCheckboxState = () => {
    const checkboxes = Array.from(
      shiftEmployeeList.querySelectorAll('input[type="checkbox"][name="shiftEmployee"]')
    );

    if (!checkboxes.length) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }

    const allChecked = checkboxes.every((checkbox) => checkbox.checked);
    const someChecked = checkboxes.some((checkbox) => checkbox.checked);

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  };

  const closeModal = () => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    form.reset();
    document.getElementById('shiftId').value = '';
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    shiftEmployeeList.innerHTML = '';
  };

  createButton.addEventListener('click', () => {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('shiftModalTitle').textContent = 'Crear horario';
    renderShiftEmployeeSelection();
  });

  closeButton.addEventListener('click', closeModal);
  cancelButton.addEventListener('click', closeModal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  selectAllCheckbox.addEventListener('change', () => {
    const checkboxes = shiftEmployeeList.querySelectorAll('input[type="checkbox"][name="shiftEmployee"]');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = selectAllCheckbox.checked;
    });
    syncSelectAllShiftCheckboxState();
  });

  shiftEmployeeList.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"][name="shiftEmployee"]')) {
      syncSelectAllShiftCheckboxState();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const supabase = window.AuraTechSupabase;

    if (!supabase) {
      showToast('La conexión con Supabase no está disponible.');
      return;
    }

    const shiftId = document.getElementById('shiftId').value;
    const payload = {
      name: document.getElementById('shiftName').value.trim(),
      entry_time: document.getElementById('shiftEntryTime').value,
      exit_time: document.getElementById('shiftExitTime').value,
      tolerance_minutes: Number(document.getElementById('shiftToleranceMinutes').value || 0),
    };

    if (!payload.name || !payload.entry_time || !payload.exit_time) {
      showToast('Completa todos los campos del horario.');
      return;
    }

    try {
      let result;

      if (shiftId) {
        result = await supabase
          .from('work_shifts')
          .update(payload)
          .eq('id', shiftId)
          .select('*');
      } else {
        result = await supabase
          .from('work_shifts')
          .insert(payload)
          .select('*');
      }

      if (result.error) {
        throw result.error;
      }

      const createdOrUpdatedShift = result.data?.[0] || result.data;
      const selectedEmployeeIds = Array.from(
        shiftEmployeeList.querySelectorAll('input[type="checkbox"][name="shiftEmployee"]:checked')
      ).map((checkbox) => checkbox.value);

      if (createdOrUpdatedShift) {
        await syncEmployeesToShift(createdOrUpdatedShift.id, selectedEmployeeIds);
      }

      await loadShifts();
      closeModal();
      showToast(shiftId ? 'Horario actualizado correctamente.' : 'Horario creado correctamente.');
    } catch (error) {
      console.error('Error al guardar el horario:', error);
      showToast('No se pudo guardar el horario.');
    }
  });

  renderShiftEmployeeSelection();
}

async function deleteShift(shiftId) {
  const supabase = window.AuraTechSupabase;

  if (!supabase || !shiftId) {
    return;
  }

  const confirmed = window.confirm('¿Deseas eliminar este horario?');

  if (!confirmed) {
    return;
  }

  try {
    const { error } = await supabase
      .from('work_shifts')
      .delete()
      .eq('id', shiftId);

    if (error) {
      throw error;
    }

    await loadShifts();
    showToast('Horario eliminado correctamente.');
  } catch (error) {
    console.error('Error al eliminar horario:', error);
    showToast('No se pudo eliminar el horario.');
  }
}

async function openShiftModal(shiftId) {
  const supabase = window.AuraTechSupabase;
  const modal = document.getElementById('shiftModal');

  if (!supabase || !modal) {
    return;
  }

  try {
    const { data, error } = await supabase
      .from('work_shifts')
      .select('*')
      .eq('id', shiftId)
      .single();

    if (error) {
      throw error;
    }

    document.getElementById('shiftModalTitle').textContent = 'Editar horario';
    document.getElementById('shiftId').value = data.id;
    document.getElementById('shiftName').value = data.name || '';
    document.getElementById('shiftEntryTime').value = data.entry_time || '08:00';
    document.getElementById('shiftExitTime').value = data.exit_time || '17:00';
    document.getElementById('shiftToleranceMinutes').value = data.tolerance_minutes || 0;

    renderShiftEmployeeSelection(data.id);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  } catch (error) {
    console.error('Error al cargar horario:', error);
    showToast('No se pudo cargar el horario.');
  }
}

async function renderShiftEmployeeSelection(shiftId = null) {
  const shiftEmployeeList = document.getElementById('shiftEmployeeList');
  const selectAllCheckbox = document.getElementById('selectAllShiftEmployees');

  if (!shiftEmployeeList || !selectAllCheckbox) {
    return;
  }

  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    shiftEmployeeList.innerHTML = '<p style="margin:0; color: var(--color-muted);">No se pudo cargar la lista de empleados.</p>';
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }

  try {
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, nombre, cargo')
      .order('nombre', { ascending: true });

    if (employeesError) {
      throw employeesError;
    }

    let assignedIds = [];

    if (shiftId) {
      const { data: assignedData, error: assignedError } = await supabase
        .from('employees')
        .select('id')
        .eq('shift_id', shiftId);

      if (assignedError) {
        throw assignedError;
      }

      assignedIds = assignedData.map((employee) => employee.id);
    }

    shiftEmployeeList.innerHTML = (employees || []).map((employee) => `
      <label class="shift-assignment-item">
        <input type="checkbox" name="shiftEmployee" value="${employee.id}" ${assignedIds.includes(employee.id) ? 'checked' : ''} />
        <span>
          <strong>${employee.nombre}</strong><br />
          <small style="color: var(--color-muted);">${employee.cargo || 'Sin departamento'}</small>
        </span>
      </label>
    `).join('');

    const checkboxes = Array.from(
      shiftEmployeeList.querySelectorAll('input[type="checkbox"][name="shiftEmployee"]')
    );

    if (!checkboxes.length) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      return;
    }

    const allChecked = checkboxes.every((checkbox) => checkbox.checked);
    const someChecked = checkboxes.some((checkbox) => checkbox.checked);

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  } catch (error) {
    console.error('Error al renderizar asignación:', error);
    shiftEmployeeList.innerHTML = '<p style="margin:0; color: var(--color-muted);">No se pudo cargar la asignación de empleados.</p>';
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  }
}

async function syncEmployeesToShift(shiftId, selectedEmployeeIds) {
  const supabase = window.AuraTechSupabase;

  if (!supabase || !shiftId) {
    return;
  }

  try {
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, shift_id');

    if (employeesError) {
      throw employeesError;
    }

    const selectedSet = new Set(selectedEmployeeIds || []);

    for (const employee of employees || []) {
      const shouldAssign = selectedSet.has(employee.id);
      if (shouldAssign && employee.shift_id !== shiftId) {
        const { error } = await supabase
          .from('employees')
          .update({ shift_id: shiftId })
          .eq('id', employee.id);

        if (error) {
          throw error;
        }
      }

      if (!shouldAssign && employee.shift_id === shiftId) {
        const { error } = await supabase
          .from('employees')
          .update({ shift_id: null })
          .eq('id', employee.id);

        if (error) {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Error al sincronizar empleados con horario:', error);
    throw error;
  }
}

function populateShiftSelectorOptions(shifts) {
  const employeeEditShiftIdSelect = document.getElementById('employeeEditShiftId');

  if (!employeeEditShiftIdSelect) {
    return;
  }

  employeeEditShiftIdSelect.innerHTML = '<option value="">Sin turno asignado</option>' +
    (shifts || []).map((shift) => `<option value="${shift.id}">${shift.name}</option>`).join('');
}

async function cerrarSesion(redirectUrl = '') {
  const supabase = window.AuraTechSupabase;

  try {
    if (supabase?.auth) {
      await supabase.auth.signOut();
    }
  } catch (error) {
    console.warn('No se pudo cerrar sesión en Supabase:', error);
  } finally {
    sessionStorage.clear();
    localStorage.removeItem('supabase.auth.token');

    if (redirectUrl) {
      window.location.href = redirectUrl;
    }
  }
}

function showLockScreen() {
  const lockScreen = document.getElementById('lock-screen');

  if (!lockScreen) {
    return;
  }

  lockScreen.classList.add('is-visible');
  lockScreen.setAttribute('aria-hidden', 'false');
  document.getElementById('lockScreenEmail')?.focus();
}

function hideLockScreen() {
  const lockScreen = document.getElementById('lock-screen');

  if (!lockScreen) {
    return;
  }

  lockScreen.classList.remove('is-visible');
  lockScreen.setAttribute('aria-hidden', 'true');
}

function bindLockScreen() {
  const form = document.getElementById('lockScreenForm');
  const emailInput = document.getElementById('lockScreenEmail');
  const passwordInput = document.getElementById('lockScreenPassword');
  const errorMessage = document.getElementById('lockScreenError');

  if (!form || !emailInput || !passwordInput || !errorMessage) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.textContent = '';

    const supabase = window.AuraTechSupabase;
    const submitButton = form.querySelector('button[type="submit"]');

    if (!supabase) {
      errorMessage.textContent = 'La conexión con Supabase no está disponible.';
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });

    if (submitButton) {
      submitButton.disabled = false;
    }

    if (error) {
      errorMessage.textContent = 'Correo o contraseña incorrectos.';
      passwordInput.value = '';
      passwordInput.focus();
      return;
    }

    passwordInput.value = '';
    hideLockScreen();
    await loadDashboardData();
  });
}

function bindLogoutButton() {
  const logoutButton = document.getElementById('logoutBtn');

  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener('click', async () => {
    await cerrarSesion();
    window.location.href = './admin-login.html';
  });
}

function bindReturnToScanner() {
  const returnButton = document.getElementById('returnToScannerBtn');

  if (!returnButton) {
    return;
  }

  returnButton.addEventListener('click', async () => {
    await cerrarSesion();
    window.location.href = './index.html';
  });
}

function applyFilters() {
  const dateFilter = document.getElementById('dateFilter');
  const employeeFilter = document.getElementById('employeeFilter');
  const departmentFilter = document.getElementById('departmentFilter');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');

  if (!dateFilter || !employeeFilter || !departmentFilter) {
    return dashboardState.allRows;
  }

  const dateValue = dateFilter.value;
  const employeeValue = employeeFilter.value;
  const departmentValue = departmentFilter.value;
  const startValue = startDate?.value || '';
  const endValue = endDate?.value || '';

  return dashboardState.allRows.filter((row) => {
    const employeeName = row.employees?.nombre || 'Empleado no encontrado';
    const departmentName = row.employees?.cargo || 'Sin departamento';
    const currentDate = row.fecha;

    let matchesDate = true;

    if (dateValue === 'today') {
      matchesDate = currentDate === getTodayDate();
    } else if (dateValue === 'week') {
      matchesDate = isCurrentWeek(currentDate);
    } else if (dateValue === 'month') {
      matchesDate = isCurrentMonth(currentDate);
    } else if (dateValue === 'custom') {
      matchesDate = isDateBetween(currentDate, startValue, endValue);
    }

    const matchesEmployee = employeeValue === 'all' || employeeName === employeeValue;
    const matchesDepartment = departmentValue === 'all' || departmentName === departmentValue;

    return matchesDate && matchesEmployee && matchesDepartment;
  });
}

function populateFilterOptions(rows) {
  const employeeFilter = document.getElementById('employeeFilter');
  const departmentFilter = document.getElementById('departmentFilter');

  const employeeNames = [...new Set(rows.map((row) => row.employees?.nombre).filter(Boolean))];
  const departments = [...new Set(rows.map((row) => row.employees?.cargo).filter(Boolean))];

  if (employeeFilter) {
    employeeFilter.innerHTML = '<option value="all">Empleado</option>' +
      employeeNames.map((name) => `<option value="${name}">${name}</option>`).join('');
  }

  if (departmentFilter) {
    departmentFilter.innerHTML = '<option value="all">Departamento</option>' +
      departments.map((department) => `<option value="${department}">${department}</option>`).join('');
  }
}

function buildWeeklyAttendanceSeries(rows = dashboardState.filteredRows) {
  const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
  const values = Array(5).fill(0);

  if (!rows.length) {
    return { labels, values };
  }

  const today = new Date();
  const currentDay = today.getDay();

  rows.forEach((row) => {
    if (!row.fecha) return;

    const rowDate = new Date(`${row.fecha}T00:00:00`);
    const diff = Math.round((today - rowDate) / 86400000);
    const index = currentDay === 0 ? 6 : currentDay - 1;
    const dayOffset = index - diff;

    if (dayOffset >= 0 && dayOffset < 5) {
      const status = row.estado || 'presente';
      if (status !== 'falta') {
        values[dayOffset] += 1;
      }
    }
  });

  return { labels, values };
}

function buildEmployeePerformanceSeries(rows = dashboardState.filteredRows) {
  const employeeMap = new Map();

  rows.forEach((row) => {
    const name = row.employees?.nombre || 'Sin nombre';
    if (!employeeMap.has(name)) {
      employeeMap.set(name, 0);
    }
    employeeMap.set(name, employeeMap.get(name) + Number(row.horas_trabajadas || 0));
  });

  const entries = [...employeeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    labels: entries.map(([name]) => name),
    values: entries.map(([, value]) => Number(value.toFixed(1))),
  };
}

function buildDepartmentPerformanceSeries(rows = dashboardState.filteredRows) {
  const departmentMap = new Map();

  rows.forEach((row) => {
    const department = row.employees?.cargo || 'Sin departamento';
    if (!departmentMap.has(department)) {
      departmentMap.set(department, 0);
    }
    departmentMap.set(department, departmentMap.get(department) + Number(row.horas_trabajadas || 0));
  });

  const entries = [...departmentMap.entries()].sort((a, b) => b[1] - a[1]);
  return {
    labels: entries.map(([name]) => name),
    values: entries.map(([, value]) => Number(value.toFixed(1))),
  };
}

function renderCharts() {
  const attendanceCanvas = document.getElementById('attendanceChart');
  const employeeCanvas = document.getElementById('employeePerformanceChart');
  const departmentCanvas = document.getElementById('departmentChart');

  if (!attendanceCanvas || !employeeCanvas || !departmentCanvas || typeof Chart === 'undefined') {
    return;
  }

  const weeklyData = buildWeeklyAttendanceSeries(dashboardState.filteredRows);
  const employeeData = buildEmployeePerformanceSeries(dashboardState.filteredRows);
  const departmentData = buildDepartmentPerformanceSeries(dashboardState.filteredRows);

  if (window.attendanceChartInstance) {
    window.attendanceChartInstance.destroy();
  }

  if (window.employeeChartInstance) {
    window.employeeChartInstance.destroy();
  }

  if (window.departmentChartInstance) {
    window.departmentChartInstance.destroy();
  }

  window.attendanceChartInstance = new Chart(attendanceCanvas, {
    type: 'bar',
    data: {
      labels: weeklyData.labels,
      datasets: [{
        label: 'Asistencias',
        data: weeklyData.values,
        backgroundColor: ['#47A8BD', '#47A8BD', '#47A8BD', '#47A8BD', '#47A8BD'],
        borderRadius: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
        },
      },
    },
  });

  window.employeeChartInstance = new Chart(employeeCanvas, {
    type: 'doughnut',
    data: {
      labels: employeeData.labels,
      datasets: [{
        data: employeeData.values,
        backgroundColor: ['#0B132B', '#1C2541', '#47A8BD', '#8FD3E6', '#DDEFF3'],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
      },
    },
  });

  window.departmentChartInstance = new Chart(departmentCanvas, {
    type: 'polarArea',
    data: {
      labels: departmentData.labels,
      datasets: [{
        data: departmentData.values,
        backgroundColor: ['#0B132B', '#1C2541', '#47A8BD', '#8FD3E6', '#DDEFF3'],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
      },
      scales: {
        r: {
          beginAtZero: true,
        },
      },
    },
  });
}

function renderPerformanceSummary() {
  const list = document.getElementById('employeePerformanceList');
  const activeRows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;

  if (!list) {
    renderCharts();
    return;
  }

  const employeeMap = new Map();
  activeRows.forEach((row) => {
    const name = row.employees?.nombre || 'Sin nombre';
    if (!employeeMap.has(name)) {
      employeeMap.set(name, { name, hours: 0, present: 0 });
    }

    const current = employeeMap.get(name);
    current.hours += Number(row.horas_trabajadas || 0);
    if (row.estado === 'presente' || row.estado === 'retardo') current.present += 1;
    employeeMap.set(name, current);
  });

  const ranking = [...employeeMap.values()]
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 4);

  list.innerHTML = ranking
    .map((employee, index) => {
      const percent = Math.min(100, 50 + index * 15);
      return `
        <div>
          <div style="display:flex; justify-content:space-between; margin-bottom:0.3rem; font-size:0.8rem; color: var(--color-primary);">
            <span>${employee.name}</span>
            <strong>${employee.hours.toFixed(1)}h</strong>
          </div>
          <div style="height: 8px; background: rgba(11,19,43,0.08); border-radius: 999px; overflow:hidden;">
            <div style="width:${percent}%; height:100%; background: linear-gradient(90deg, #47A8BD, #0B132B); border-radius: inherit;"></div>
          </div>
        </div>
      `;
    })
    .join('');

  renderCharts();
}

function renderDashboard() {
  const tbody = document.getElementById('attendanceTableBody');
  const paginationSummary = document.getElementById('paginationSummary');
  const paginationControls = document.getElementById('paginationControls');

  if (!tbody) {
    return;
  }

  const total = dashboardState.filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / dashboardState.pageSize));
  if (dashboardState.currentPage > pageCount) {
    dashboardState.currentPage = pageCount;
  }

  const start = (dashboardState.currentPage - 1) * dashboardState.pageSize;
  const end = start + dashboardState.pageSize;
  const visibleRows = dashboardState.filteredRows.slice(start, end);

  if (!visibleRows.length) {
    showEmptyTable('No se encontraron registros para los filtros seleccionados.');
    if (paginationSummary) paginationSummary.textContent = 'Mostrando 0 registros';
    if (paginationControls) paginationControls.innerHTML = '';
    return;
  }

  tbody.innerHTML = visibleRows
    .map((row) => {
      const employeeName = row.employees?.nombre || 'Empleado no encontrado';
      const departmentName = row.employees?.cargo || 'Sin departamento';
      const status = row.estado || 'presente';
      const statusLabel =
        status === 'falta' ? 'Falta' : status === 'retardo' ? 'Retardo' : 'Presente';
      const statusClass =
        status === 'falta' ? 'absent' : status === 'retardo' ? 'late' : 'present';
      const employeeData = row.employees || {};
      const salarioBase = parseFloat(employeeData.salario_base) || 0;
      const horasJornada = parseFloat(employeeData.horas_jornada) || 8;
      const horasTrabajadas = parseFloat(row.horas_trabajadas) || 0;
      const dailyRate = salarioBase / 30;
      const hourlyRate = dailyRate / horasJornada;
      const regularHours = Math.min(horasTrabajadas, horasJornada);
      const extraHours = Math.max(0, horasTrabajadas - horasJornada);
      const pagoRegular = regularHours * hourlyRate;
      const pagoExtra = extraHours * (hourlyRate * 1.5);
      const pagoTotal = pagoRegular + pagoExtra;
      const absences = status === 'falta' ? 1 : 0;
      const payEstimate = formatCurrency(pagoTotal);

      return `
        <tr>
          <td>${employeeName}</td>
          <td>${departmentName}</td>
          <td>${formatDate(row.fecha)}</td>
          <td>${row.hora_entrada || '—'}</td>
          <td>${row.hora_salida || '—'}</td>
          <td>${Number(regularHours.toFixed(2))}</td>
          <td>${Number(extraHours.toFixed(2))}</td>
          <td>${absences}</td>
          <td>${payEstimate}</td>
          <td><span class="status ${statusClass}">${statusLabel}</span></td>
        </tr>
      `;
    })
    .join('');

  if (paginationSummary) {
    paginationSummary.textContent = `Mostrando ${Math.min(start + 1, total)}-${Math.min(end, total)} de ${total} registros`;
  }

  if (paginationControls) {
    const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
    paginationControls.innerHTML = `
      <button class="page-btn" type="button" data-page="prev" ${dashboardState.currentPage === 1 ? 'disabled' : ''}>‹</button>
      ${pageNumbers
        .map(
          (page) =>
            `<button class="page-btn ${page === dashboardState.currentPage ? 'active' : ''}" type="button" data-page="${page}">${page}</button>`,
        )
        .join('')}
      <button class="page-btn" type="button" data-page="next" ${dashboardState.currentPage === pageCount ? 'disabled' : ''}>›</button>
    `;

    paginationControls.querySelectorAll('.page-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.page;
        if (target === 'prev') {
          dashboardState.currentPage = Math.max(1, dashboardState.currentPage - 1);
        } else if (target === 'next') {
          dashboardState.currentPage = Math.min(pageCount, dashboardState.currentPage + 1);
        } else {
          dashboardState.currentPage = Number(target);
        }
        renderDashboard();
      });
    });
  }

  updateSummaryMetrics();
  renderPerformanceSummary();
  renderEmployeesView();
  renderPayrollView();
  renderReportsView();
}

function renderEmployeesView() {
  const tableBody = document.getElementById('employeesTableBody');
  if (!tableBody) return;

  const rows = dashboardState.employees.length
    ? dashboardState.employees
    : dashboardState.allRows.map((row) => row.employees).filter(Boolean);
  const employeeMap = new Map();

  rows.forEach((row) => {
    const employeeData = row.employees || row;
    const employeeId = row.employee_id || employeeData.id || employeeData.nombre;
    const employeeName = employeeData.nombre || 'Empleado no encontrado';
    const department = employeeData.cargo || 'Sin departamento';

    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        employeeId,
        name: employeeName,
        department,
        salaryBase: parseFloat(employeeData.salario_base) || 0,
        jornada: parseFloat(employeeData.horas_jornada) || 8,
        qrCodeHash: employeeData.qr_code_hash || '',
      });
    }

    const employee = employeeMap.get(employeeId);
    employee.department = employee.department || department;
    employee.salaryBase = employee.salaryBase || parseFloat(employeeData.salario_base) || 0;
    employee.jornada = employee.jornada || parseFloat(employeeData.horas_jornada) || 8;
    employee.qrCodeHash = employee.qrCodeHash || employeeData.qr_code_hash || '';
  });

  const employeeList = [...employeeMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (!employeeList.length) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--color-muted); padding: 2rem;">Sin empleados registrados.</td></tr>';
    return;
  }

  tableBody.innerHTML = employeeList.map((employee) => `
    <tr>
      <td>${escapeHtml(employee.name)}</td>
      <td>${escapeHtml(employee.department)}</td>
      <td>${formatCurrency(employee.salaryBase)}</td>
      <td>${Number(employee.jornada.toFixed(1))}</td>
      <td>
        <div class="employee-actions">
          <button class="edit-employee-btn" data-employee-id="${employee.employeeId}" type="button">Editar</button>
          <button class="edit-employee-btn" data-employee-action="view-qr" data-employee-id="${employee.employeeId}" type="button">Ver QR</button>
          <button class="edit-employee-btn" data-employee-action="download-qr" data-employee-id="${employee.employeeId}" type="button">Descargar QR</button>
          <button class="edit-employee-btn" data-employee-action="delete" data-employee-id="${employee.employeeId}" type="button">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPayrollView() {
  const tableBody = document.getElementById('payrollTableBody');
  if (!tableBody) return;

  const rows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;
  const employeeMap = new Map();

  rows.forEach((row) => {
    const employeeData = row.employees || {};
    const employeeId = row.employee_id || employeeData.id || employeeData.nombre;
    const employeeName = employeeData.nombre || 'Empleado no encontrado';
    const department = employeeData.cargo || 'Sin departamento';

    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        name: employeeName,
        department,
        hoursWorked: 0,
        attendance: 0,
        absences: 0,
        hourlyRate: 0,
        payForHours: 0,
        hoursExtra: 0,
        missingHours: 0,
        totalPay: 0,
      });
    }

    const employee = employeeMap.get(employeeId);
    const hoursWorked = Number(row.horas_trabajadas || 0);
    const horasJornada = Number(employeeData.horas_jornada || 8);

    const breakdown = buildPaymentBreakdown(employeeData, hoursWorked, row.estado);
    employee.hoursWorked += hoursWorked;
    employee.attendance += row.estado === 'falta' ? 0 : 1;
    employee.absences += row.estado === 'falta' ? 1 : 0;
    employee.hourlyRate = breakdown.hourlyRate || employee.hourlyRate || 0;
    employee.payForHours += breakdown.payForHours;
    employee.hoursExtra += breakdown.overtimeHours;
    employee.missingHours += Number.isFinite(hoursWorked) ? Math.max(0, horasJornada - hoursWorked) : 0;
    employee.totalPay += breakdown.totalPay;
    employee.department = employee.department || department;
  });

  const payrollList = [...employeeMap.values()].sort((a, b) => b.totalPay - a.totalPay);

  if (!payrollList.length) {
    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--color-muted); padding: 2rem;">Sin registros de pago.</td></tr>';
    return;
  }

  tableBody.innerHTML = payrollList.map((employee) => `
    <tr>
      <td>${employee.name}</td>
      <td>${employee.department}</td>
      <td>${formatCurrency(employee.hourlyRate)}</td>
      <td>${Number(employee.hoursWorked.toFixed(1))}h</td>
      <td>${employee.attendance}</td>
      <td>${employee.absences}</td>
      <td>${formatCurrency(employee.payForHours)}</td>
      <td>${Number(employee.hoursExtra.toFixed(1))}h</td>
      <td>${Number(Math.max(0, employee.missingHours).toFixed(1))}h</td>
      <td>${formatCurrency(employee.totalPay)}</td>
    </tr>
  `).join('');
}

function renderReportsView() {
  const totalEmployeesEl = document.getElementById('reportTotalEmployees');
  const totalHoursEl = document.getElementById('reportTotalHours');
  const totalPayEl = document.getElementById('reportTotalPay');
  const summaryBody = document.getElementById('reportsSummaryBody');

  if (!totalEmployeesEl || !totalHoursEl || !totalPayEl || !summaryBody) return;

  const rows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;
  const uniqueEmployees = new Set(rows.map((row) => row.employees?.nombre || 'Empleado no encontrado')).size;
  const totalHours = rows.reduce((sum, row) => sum + Number(row.horas_trabajadas || 0), 0);
  const totalPay = rows.reduce((sum, row) => {
    const totalHoursValue = Number(row.horas_trabajadas || 0);
    return sum + buildPaymentBreakdown(row.employees, totalHoursValue, row.estado).totalPay;
  }, 0);

  const absentCount = rows.filter((row) => row.estado === 'falta').length;
  const lateCount = rows.filter((row) => row.estado === 'retardo').length;

  totalEmployeesEl.textContent = String(uniqueEmployees);
  totalHoursEl.textContent = `${Number(totalHours.toFixed(1))}h`;
  totalPayEl.textContent = `${formatCurrency(totalPay)}`;

  summaryBody.innerHTML = `
    <tr>
      <td>Faltas</td>
      <td>${absentCount}</td>
      <td>${absentCount > 0 ? 'Requiere seguimiento' : 'Dentro del promedio'}</td>
    </tr>
    <tr>
      <td>Tardanzas</td>
      <td>${lateCount}</td>
      <td>${lateCount > 0 ? 'Monitorear turnos' : 'Sin incidencias'}</td>
    </tr>
    <tr>
      <td>Pago estimado</td>
      <td>${formatCurrency(totalPay)}</td>
      <td>Resultado del período actual</td>
    </tr>
  `;
}

function showEmptyTable(message) {
  const tbody = document.getElementById('attendanceTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; color: var(--color-muted); padding: 2rem;">${message}</td>
      </tr>
    `;
  }
}

async function fetchAttendanceWithEmployees(filters = {}) {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    throw new Error('Supabase no está inicializado.');
  }

  const { startDate, endDate } = filters;

  let query = supabase
    .from('attendance_logs')
    .select(`
      *,
      employees:employee_id (
        id,
        nombre,
        cargo,
        salario_base,
        horas_jornada,
        shift_id
      )
    `)
    .order('fecha', { ascending: false });

  if (startDate && endDate) {
    query = query.gte('fecha', startDate).lte('fecha', endDate);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchEmployees() {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    throw new Error('Supabase no está inicializado.');
  }

  const { data, error } = await supabase
    .from('employees')
    .select('id, nombre, cargo, salario_base, horas_jornada, shift_id, tipo_horario, qr_code_hash');

  if (error) {
    throw error;
  }

  return data || [];
}

function calculateMissingDaysByEmployee(rows, employees) {
  const dateRange = getDateRange(30);
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const employeeAbsenceMap = new Map();

  employees.forEach((employee) => {
    employeeAbsenceMap.set(employee.id, 0);
  });

  dateRange.forEach((date) => {
    employees.forEach((employee) => {
      const hasRecord = rows.some((row) => row.employee_id === employee.id && row.fecha === date);
      if (!hasRecord) {
        const current = employeeAbsenceMap.get(employee.id) || 0;
        employeeAbsenceMap.set(employee.id, current + 1);
      }
    });
  });

  return employeeMap.size ? [...employeeMap.entries()].map(([employeeId, employee]) => ({
    employee_id: employeeId,
    employee_name: employee.nombre,
    absences: employeeAbsenceMap.get(employeeId) || 0,
  })) : [];
}

function updateSummaryMetrics() {
  const rows = dashboardState.filteredRows;
  const today = getTodayDate();
  const todayPresent = rows.filter((row) => row.fecha === today && row.estado === 'presente').length;
  const todayLate = rows.filter((row) => row.fecha === today && row.estado === 'retardo').length;
  const absentCount = rows.filter((row) => row.estado === 'falta').length;
  const extraTotal = rows.reduce((sum, row) => {
    const hoursWorked = Number(row.horas_trabajadas || 0);
    return sum + calculateExtraHours(hoursWorked);
  }, 0);

  updateMetric('Asistencias de hoy', todayPresent + todayLate);
  updateMetric('Faltas', absentCount);
  updateMetric('Horas extra totales', `${extraTotal.toFixed(1)}h`);
  renderOperationalRecommendations(rows);
}

function renderOperationalRecommendations(rows) {
  const lateCount = rows.filter((row) => row.estado === 'retardo').length;
  const absentCount = rows.filter((row) => row.estado === 'falta').length;
  const coveredCount = rows.filter((row) => row.estado && row.estado !== 'falta').length;
  const totalRecords = rows.length || 1;
  const overtimeTotal = rows.reduce((sum, row) => sum + calculateExtraHours(Number(row.horas_trabajadas || 0)), 0);
  const coverageRate = Math.round((coveredCount / totalRecords) * 100);

  const attendanceElement = document.getElementById('recommendationLate');
  const coverageElement = document.getElementById('recommendationCoverage');
  const payrollElement = document.getElementById('recommendationPayroll');

  if (attendanceElement) {
    attendanceElement.textContent = lateCount > 0
      ? `${lateCount} empleados registraron tardanzas este periodo. Revisa turnos con mayor riesgo de retraso.`
      : 'No se detectaron tardanzas relevantes. El cumplimiento del turno está estable.';
  }

  if (coverageElement) {
    coverageElement.textContent = coverageRate >= 90
      ? `Cobertura operativa del ${coverageRate}%. Mantener la planificación actual.`
      : `Cobertura operativa del ${coverageRate}%. Considera reforzar turnos con mayor ausencia.`;
  }

  if (payrollElement) {
    payrollElement.textContent = overtimeTotal > 0
      ? `Se registraron ${overtimeTotal.toFixed(1)}h extras. Revisa si la carga de trabajo requiere redistribución.`
      : 'No hay horas extra reportadas. La carga de trabajo se mantiene dentro del nivel esperado.';
  }

  const attendanceTrendChip = document.getElementById('attendanceTrendChip');
  const absenceTrendChip = document.getElementById('absenceTrendChip');
  const overtimeTrendChip = document.getElementById('overtimeTrendChip');

  if (attendanceTrendChip) {
    attendanceTrendChip.textContent = coverageRate >= 90 ? '+12%' : '+5%';
  }

  if (absenceTrendChip) {
    absenceTrendChip.textContent = absentCount > 0 ? 'Urgente' : 'Normal';
  }

  if (overtimeTrendChip) {
    overtimeTrendChip.textContent = overtimeTotal > 0 ? 'Revisión' : 'Estable';
  }
}

function getEmployeePayProfile(employee = {}) {
  const salarioBase = Number(employee?.salario_base ?? employee?.pago_por_dia ?? 0);
  const workdayHours = Number(employee?.horas_jornada || 8);
  const dailyPay = salarioBase > 0 ? salarioBase / 30 : 0;
  const hourlyRate = workdayHours > 0 ? dailyPay / workdayHours : 0;

  return {
    salarioBase,
    dailyPay,
    workdayHours,
    hourlyRate,
  };
}

function buildPaymentBreakdown(employee, totalHours = 0, status = 'presente') {
  const { salarioBase, dailyPay, workdayHours, hourlyRate } = getEmployeePayProfile(employee);
  const hoursWorked = Math.max(Number(totalHours || 0), 0);

  const regularHours = Math.min(hoursWorked, workdayHours);
  const overtimeHours = Math.max(hoursWorked - workdayHours, 0);
  const missingHours = Math.max(0, workdayHours - hoursWorked);

  const regularPay = regularHours * hourlyRate;
  const overtimePay = overtimeHours * (hourlyRate * 1.5);
  const payForHours = regularPay + overtimePay;
  const totalPay = status === 'falta' ? 0 : payForHours;

  return {
    salarioBase,
    dailyPay,
    workdayHours,
    hourlyRate,
    regularHours,
    overtimeHours,
    missingHours,
    regularPay,
    overtimePay,
    payForHours,
    totalPay,
  };
}

function calculateEstimatedPay(employeeOrBaseSalary, regularHours, extraHours, status) {
  if (employeeOrBaseSalary && typeof employeeOrBaseSalary === 'object') {
    const totalHours = Number(regularHours || 0);
    const paymentStatus = typeof extraHours === 'string' ? extraHours : status || 'presente';
    return buildPaymentBreakdown(employeeOrBaseSalary, totalHours, paymentStatus).totalPay;
  }

  const salary = Number(employeeOrBaseSalary || 0);

  if (!salary || status === 'falta') {
    return 0;
  }

  const hourlyRate = salary / 160;
  const regularPay = regularHours * hourlyRate;
  const extraPay = extraHours * hourlyRate * 1.5;

  return regularPay + extraPay;
}

function formatCurrency(value, currencyCode = dashboardState.currency) {
  const localeByCurrency = {
    GTQ: 'es-GT',
    USD: 'en-US',
    EUR: 'es-ES',
  };

  const locale = localeByCurrency[currencyCode] || 'es-GT';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  const existing = document.querySelector('.auratech-toast');

  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'auratech-toast';
  toast.textContent = message;

  Object.assign(toast.style, {
    position: 'fixed',
    top: '1rem',
    right: '1rem',
    zIndex: '2000',
    padding: '0.9rem 1.1rem',
    borderRadius: '12px',
    background: '#47A8BD',
    color: '#ffffff',
    boxShadow: '0 12px 30px rgba(11, 19, 43, 0.18)',
    fontWeight: '600',
    opacity: '0',
    transform: 'translateY(-10px)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
  });

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';

    window.setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

async function closePayrollPeriod(periodType, startDate, endDate) {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    throw new Error('Supabase no está inicializado.');
  }

  const rows = dashboardState.allRows.filter((row) => {
    if (!row.fecha) {
      return false;
    }

    return row.fecha >= startDate && row.fecha <= endDate;
  });

  if (!rows.length) {
    throw new Error('No hay registros para cerrar en el rango seleccionado.');
  }

  const employeeMap = new Map();

  rows.forEach((row) => {
    const employeeData = row.employees || {};
    const employeeId = row.employee_id || employeeData.id || employeeData.nombre;

    if (!employeeId) {
      return;
    }

    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        employee_id: employeeId,
        employee_name: employeeData.nombre || 'Empleado no encontrado',
        department: employeeData.cargo || 'Sin departamento',
        hourlyRate: Number(employeeData.salario_base || 0) > 0
          ? Number(employeeData.salario_base || 0) / 30 / Number(employeeData.horas_jornada || 8)
          : 0,
        hoursWorked: 0,
        hoursExtra: 0,
        hoursMissing: 0,
        totalPay: 0,
        asistencias: 0,
        faltas: 0,
      });
    }

    const entry = employeeMap.get(employeeId);
    const breakdown = buildPaymentBreakdown(employeeData, Number(row.horas_trabajadas || 0), row.estado);
    const hoursWorked = Number(row.horas_trabajadas || 0);
    const workdayHours = Number(employeeData.horas_jornada || 8);

    entry.hoursWorked += hoursWorked;
    entry.hoursExtra += breakdown.overtimeHours;
    entry.hoursMissing += Math.max(0, workdayHours - hoursWorked);
    entry.totalPay += breakdown.totalPay;
    entry.asistencias += row.estado === 'falta' ? 0 : 1;
    entry.faltas += row.estado === 'falta' ? 1 : 0;
    entry.hourlyRate = breakdown.hourlyRate || entry.hourlyRate || 0;
  });

  const periodName = buildPayrollHistoryLabel({
    periodo_tipo: periodType,
    fecha_inicio: startDate,
    fecha_fin: endDate,
  });

  const snapshot = Array.from(employeeMap.values()).map((entry) => ({
    employee_id: entry.employee_id,
    employee_name: entry.employee_name,
    department: entry.department,
    pago_por_hora: Number(entry.hourlyRate.toFixed(2)),
    pago_por_horas: Number(entry.totalPay.toFixed(2)),
    horas_trabajadas: Number(entry.hoursWorked.toFixed(2)),
    horas_extra: Number(entry.hoursExtra.toFixed(2)),
    horas_faltantes: Number(entry.hoursMissing.toFixed(2)),
    asistencias: entry.asistencias,
    faltas: entry.faltas,
    total_pagado: Number(entry.totalPay.toFixed(2)),
  }));

  const totalPagado = snapshot.reduce((sum, item) => sum + Number(item.total_pagado || 0), 0);

  const { data: periodData, error: periodError } = await supabase
    .from('payroll_periods')
    .upsert({
      nombre_periodo: periodName,
      periodo_tipo: periodType,
      fecha_inicio: startDate,
      fecha_fin: endDate,
      total_pagado: Number(totalPagado.toFixed(2)),
      snapshot,
    }, {
      onConflict: 'periodo_tipo,fecha_inicio,fecha_fin',
    })
    .select('id')
    .single();

  if (periodError) {
    throw periodError;
  }

  const periodId = periodData?.id;

  if (!periodId) {
    throw new Error('No se pudo obtener el identificador del periodo cerrado.');
  }

  const historyPayload = snapshot.map((entry) => ({
    period_id: periodId,
    employee_id: entry.employee_id,
    periodo_tipo: periodType,
    fecha_inicio: startDate,
    fecha_fin: endDate,
    pago_por_hora: entry.pago_por_hora,
    pago_por_horas: entry.pago_por_horas,
    horas_trabajadas: entry.horas_trabajadas,
    horas_extra: entry.horas_extra,
    horas_faltantes: entry.horas_faltantes,
    asistencias: entry.asistencias,
    faltas: entry.faltas,
    total_pagado: entry.total_pagado,
  }));

  const { error: historyError } = await supabase
    .from('payroll_history')
    .upsert(historyPayload, {
      onConflict: 'period_id,employee_id',
    });

  if (historyError) {
    throw historyError;
  }

  await loadPayrollHistory();
}

function buildPayrollExport(rows) {
  return rows.map((row) => {
    const employeeName = row.employees?.nombre || 'Empleado no encontrado';
    const totalHours = Number(row.horas_trabajadas || 0);
    const breakdown = buildPaymentBreakdown(row.employees, totalHours, row.estado);
    const missingDays = row.estado === 'falta' ? 1 : 0;
    const estimatedPay = breakdown.totalPay;

    return {
      'Nombre del Empleado': employeeName,
      Fecha: row.fecha,
      'Hora Entrada': row.hora_entrada || '—',
      'Hora Salida': row.hora_salida || '—',
      'Horas Regulares': Number(breakdown.regularHours.toFixed(2)),
      'Horas Extra': Number(breakdown.overtimeHours.toFixed(2)),
      'Horas Faltantes': Number(breakdown.missingHours.toFixed(2)),
      Faltas: missingDays,
      'Pago Estimado': Number(estimatedPay.toFixed(2)),
    };
  });
}

function updateMetric(label, value) {
  const target = document.querySelector(`.metric-card[data-metric-label="${label}"] .metric-value`);

  if (target) {
    target.textContent = String(value);
  }
}

function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isCurrentWeek(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const now = new Date();
  const oneJan = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((now - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
  const start = new Date(now.getFullYear(), 0, 1);
  const currentWeek = Math.ceil((((now - start) / 86400000) + start.getDay() + 1) / 7);
  return Math.ceil((((date - start) / 86400000) + start.getDay() + 1) / 7) === currentWeek && date.getFullYear() === now.getFullYear();
}

function isCurrentMonth(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function isDateBetween(dateString, startDateString, endDateString) {
  if (!dateString || !startDateString || !endDateString) {
    return true;
  }

  const date = new Date(dateString + 'T00:00:00');
  const start = new Date(startDateString + 'T00:00:00');
  const end = new Date(endDateString + 'T00:00:00');

  return date >= start && date <= end;
}
