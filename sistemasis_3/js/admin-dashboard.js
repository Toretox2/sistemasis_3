const dashboardState = {
  allRows: [],
  filteredRows: [],
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
  await loadDashboardData();
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
    payroll: 'Horas Extra / Pagos',
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
  try {
    const rows = await fetchAttendanceWithEmployees();
    dashboardState.allRows = rows;
    dashboardState.filteredRows = rows;
    dashboardState.currentPage = 1;

    populateFilterOptions(rows);
    renderDashboard();
  } catch (error) {
    console.error('Error al cargar datos del dashboard:', error);
    showEmptyTable('Error al cargar los registros.');
  }
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

  const updateRows = () => {
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
    const row = allRows.find((item) => (item.employee_id || item.employees?.id) === employeeId) || allRows[0];
    const employee = row?.employees || {};

    document.getElementById('employeeEditId').value = employeeId;
    document.getElementById('employeeEditDailyPay').value = employee.pago_por_dia ?? employee.salario_base ?? 0;
    document.getElementById('employeeEditWorkdayHours').value = employee.horas_jornada || 8;

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
    const dailyPay = Number(document.getElementById('employeeEditDailyPay').value || 0);
    const workdayHours = Number(document.getElementById('employeeEditWorkdayHours').value || 8);

    if (!supabase || !employeeId) {
      return;
    }

    try {
      const { error } = await supabase
        .from('employees')
        .update({
          pago_por_dia: dailyPay,
          horas_jornada: workdayHours,
        })
        .eq('id', employeeId);

      if (error) {
        throw error;
      }

      closeModal();
      await loadDashboardData();
    } catch (error) {
      console.error('Error al guardar los cambios del empleado:', error);
      alert('No se pudieron guardar los cambios. Intenta nuevamente.');
    }
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.edit-employee-btn');

    if (!button) {
      return;
    }

    const employeeId = button.dataset.employeeId;

    if (employeeId) {
      openModal(employeeId);
    }
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
      const empleado = row.employees || {};
      const horasTrabajadas = Number(row.horas_trabajadas || 0);
      const horasJornada = Number(empleado.horas_jornada || 8);
      let regularHours = horasTrabajadas > horasJornada ? horasJornada : horasTrabajadas;
      let overtimeHours = horasTrabajadas > horasJornada ? horasTrabajadas - horasJornada : 0;
      const totalHours = Number(row.horas_trabajadas || 0);
      const breakdown = buildPaymentBreakdown(row.employees, totalHours, status);
      const absences = status === 'falta' ? 1 : 0;
      const payEstimate = formatCurrency(breakdown.totalPay);

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

  const rows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;
  const employeeMap = new Map();

  rows.forEach((row) => {
    const employeeId = row.employee_id || row.employees?.id || row.employees?.nombre;
    const employeeName = row.employees?.nombre || 'Empleado no encontrado';
    const department = row.employees?.cargo || 'Sin departamento';

    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        employeeId,
        name: employeeName,
        department,
        hours: 0,
        attendance: 0,
        absences: 0,
        hoursExtra: 0,
        missingHours: 0,
        totalPay: 0,
        hourlyRate: 0,
        payForHours: 0,
      });
    }

    const employee = employeeMap.get(employeeId);
    const breakdown = buildPaymentBreakdown(row.employees, Number(row.horas_trabajadas || 0), row.estado);

    employee.hours += Number(row.horas_trabajadas || 0);
    employee.hoursExtra += breakdown.overtimeHours;
    employee.missingHours += breakdown.missingHours;
    employee.totalPay += breakdown.totalPay;
    employee.payForHours += breakdown.regularPay + breakdown.overtimePay;
    employee.hourlyRate = breakdown.hourlyRate || employee.hourlyRate || 0;

    if (row.estado === 'falta') {
      employee.absences += 1;
    } else {
      employee.attendance += 1;
    }

    employee.department = employee.department || department;
  });

  const employeeList = [...employeeMap.values()].sort((a, b) => b.hours - a.hours);

  if (!employeeList.length) {
    tableBody.innerHTML = '<tr><td colspan="11" style="text-align:center; color: var(--color-muted); padding: 2rem;">Sin empleados registrados.</td></tr>';
    return;
  }

  tableBody.innerHTML = employeeList.map((employee) => `
    <tr>
      <td>${employee.name}</td>
      <td>${employee.department}</td>
      <td>${Number(employee.hours.toFixed(1))}h</td>
      <td>${employee.attendance}</td>
      <td>${employee.absences}</td>
      <td>${formatCurrency(employee.hourlyRate)}</td>
      <td>${formatCurrency(employee.payForHours)}</td>
      <td>${Number(employee.hoursExtra.toFixed(1))}h</td>
      <td>${Number(employee.missingHours.toFixed(1))}h</td>
      <td>${formatCurrency(employee.totalPay)}</td>
      <td><button class="edit-employee-btn" data-employee-id="${employee.employeeId}" type="button">Editar</button></td>
    </tr>
  `).join('');
}

function renderPayrollView() {
  const tableBody = document.getElementById('payrollTableBody');
  if (!tableBody) return;

  const rows = dashboardState.filteredRows.length ? dashboardState.filteredRows : dashboardState.allRows;
  const employeeMap = new Map();

  rows.forEach((row) => {
    const employeeName = row.employees?.nombre || 'Empleado no encontrado';
    const department = row.employees?.cargo || 'Sin departamento';

    if (!employeeMap.has(employeeName)) {
      employeeMap.set(employeeName, {
        name: employeeName,
        department,
        extraHours: 0,
        payEstimate: 0,
      });
    }

    const employee = employeeMap.get(employeeName);
    const totalHours = Number(row.horas_trabajadas || 0);
    const breakdown = buildPaymentBreakdown(row.employees, totalHours, row.estado);
    employee.extraHours += breakdown.overtimeHours;
    employee.payEstimate += breakdown.totalPay;
    employee.department = employee.department || department;
  });

  const payrollList = [...employeeMap.values()].sort((a, b) => b.payEstimate - a.payEstimate);

  if (!payrollList.length) {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--color-muted); padding: 2rem;">Sin registros de pago.</td></tr>';
    return;
  }

  tableBody.innerHTML = payrollList.map((employee) => `
    <tr>
      <td>${employee.name}</td>
      <td>${Number(employee.extraHours.toFixed(1))}h</td>
      <td>${formatCurrency(employee.payEstimate)}</td>
      <td>${employee.department}</td>
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

async function fetchAttendanceWithEmployees() {
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    throw new Error('Supabase no está inicializado.');
  }

  const { data, error } = await supabase
    .from('attendance_logs')
    .select(`
      id,
      employee_id,
      fecha,
      hora_entrada,
      hora_salida,
      horas_trabajadas,
      horas_extra,
      estado,
      employees:employee_id (
        id,
        nombre,
        cargo,
        salario_base,
        pago_por_dia,
        horas_jornada
      )
    `)
    .order('fecha', { ascending: false });

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
    .select('id, nombre, cargo');

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
  const dailyPay = Number(employee?.pago_por_dia ?? employee?.salario_base ?? 0);
  const workdayHours = Number(employee?.horas_jornada || 8);
  const hourlyRate = workdayHours > 0 ? dailyPay / workdayHours : 0;

  return {
    dailyPay,
    workdayHours,
    hourlyRate,
  };
}

function buildPaymentBreakdown(employee, totalHours = 0, status = 'presente') {
  const { dailyPay, workdayHours, hourlyRate } = getEmployeePayProfile(employee);
  const hoursWorked = Math.max(Number(totalHours || 0), 0);

  const regularHours = Math.min(hoursWorked, workdayHours);
  const overtimeHours = Math.max(hoursWorked - workdayHours, 0);
  const missingHours = status === 'falta'
    ? workdayHours
    : Math.max(workdayHours - hoursWorked, 0);

  const regularPay = regularHours * hourlyRate;
  const overtimePay = overtimeHours * hourlyRate * 1.5;
  const missingDeduction = status === 'falta' ? dailyPay : missingHours * hourlyRate;

  const totalPay = status === 'falta'
    ? 0
    : Math.max(regularPay + overtimePay - missingDeduction, 0);

  return {
    dailyPay,
    workdayHours,
    hourlyRate,
    regularHours,
    overtimeHours,
    missingHours,
    regularPay,
    overtimePay,
    missingDeduction,
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

function formatCurrency(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: dashboardState.currency,
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
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
