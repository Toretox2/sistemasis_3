/**
 * Sincroniza empleados de Google Sheets con Supabase REST.
 * Pega este archivo en Extensiones > Apps Script de tu Google Sheet.
 */

const SUPABASE_URL = 'https://olwqpstvsyzuzpdziwyd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sd3Fwc3R2c3l6dXpwZHppd3lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3Nzg1MzUsImV4cCI6MjEwMzM1NDUzNX0.5Z2d3HMHvp0iSUKwxNtkjHF4xCwBAYMIlqoYkmjpdsM';
const EMPLOYEES_TABLE = 'employees';
const HEADER_ROW = 1;
const LAST_SYNC_ROW_PROPERTY = 'AURATECH_LAST_SYNC_ROW';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AuraTech Sync')
    .addItem('Subir a Supabase', 'syncActiveRow')
    .addItem('Subir filas nuevas', 'syncNewRows')
    .addItem('Reiniciar control de filas', 'resetSyncPosition')
    .addToUi();
}

function syncActiveRow() {
  try {
    validateConfiguration_();

    const sheet = SpreadsheetApp.getActiveSheet();
    const rowNumber = sheet.getActiveRange().getRow();

    if (rowNumber <= HEADER_ROW) {
      throw new Error('Selecciona una fila de empleado, no la fila de encabezados.');
    }

    const employee = readEmployeeFromRow_(sheet, rowNumber);
    sendEmployeeToSupabase_(employee);
    markSyncPosition_(rowNumber);

    SpreadsheetApp.getUi().alert(
      'Sincronización completada',
      `El empleado "${employee.nombre}" fue enviado correctamente a Supabase.`,
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
  } catch (error) {
    showError_(error);
  }
}

function syncNewRows() {
  try {
    validateConfiguration_();

    const sheet = SpreadsheetApp.getActiveSheet();
    const lastRow = sheet.getLastRow();
    const firstRow = Math.max(getLastSyncRow_() + 1, HEADER_ROW + 1);

    if (firstRow > lastRow) {
      SpreadsheetApp.getUi().alert('AuraTech Sync', 'No hay filas nuevas para subir.', SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }

    let uploaded = 0;
    for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
      if (isRowEmpty_(sheet, rowNumber)) {
        continue;
      }

      const employee = readEmployeeFromRow_(sheet, rowNumber);
      sendEmployeeToSupabase_(employee);
      uploaded += 1;
      markSyncPosition_(rowNumber);
    }

    SpreadsheetApp.getUi().alert(
      'Sincronización completada',
      `${uploaded} empleado(s) fueron enviados correctamente a Supabase.`,
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
  } catch (error) {
    showError_(error);
  }
}

function resetSyncPosition() {
  PropertiesService.getDocumentProperties().deleteProperty(LAST_SYNC_ROW_PROPERTY);
  SpreadsheetApp.getUi().alert('AuraTech Sync', 'El control de filas fue reiniciado.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function readEmployeeFromRow_(sheet, rowNumber) {
  const lastColumn = Math.max(sheet.getLastColumn(), 4);
  const headers = sheet.getRange(HEADER_ROW, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getDisplayValues()[0];

  const headerIndexes = buildHeaderIndexes_(headers);
  const getValue = (names, fallbackIndex) => {
    const index = names.map((name) => headerIndexes[normalizeHeader_(name)]).find((value) => value !== undefined);
    return index === undefined ? String(values[fallbackIndex] || '').trim() : String(values[index] || '').trim();
  };

  const nombre = getValue(['nombre', 'name'], 0);
  const cargo = getValue(['cargo', 'puesto', 'departamento'], 1);
  const qrCodeHash = getValue(['qr_code_hash', 'qr code hash', 'qr hash'], 3) ||
    getValue(['qr_token', 'qr token', 'token'], 4);
  const salarioBase = getValue(['salario_base', 'salario base', 'sueldo'], 2);

  if (!nombre || !cargo || !qrCodeHash) {
    throw new Error(`La fila ${rowNumber} debe tener nombre, cargo y QR token/hash.`);
  }

  return {
    nombre,
    cargo,
    qr_code_hash: qrCodeHash,
    salario_base: parseSalary_(salarioBase),
  };
}

function sendEmployeeToSupabase_(employee) {
  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${EMPLOYEES_TABLE}?on_conflict=qr_code_hash`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    payload: JSON.stringify(employee),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Supabase respondió ${statusCode}: ${response.getContentText()}`);
  }
}

function buildHeaderIndexes_(headers) {
  return headers.reduce((indexes, header, index) => {
    const normalized = normalizeHeader_(header);
    if (normalized) {
      indexes[normalized] = index;
    }
    return indexes;
  }, {});
}

function normalizeHeader_(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseSalary_(value) {
  const normalized = String(value || '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const salary = Number(normalized);

  if (!Number.isFinite(salary) || salary < 0) {
    throw new Error(`Salario base inválido: "${value}".`);
  }

  return salary;
}

function isRowEmpty_(sheet, rowNumber) {
  return sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).isBlank();
}

function getLastSyncRow_() {
  return Number(PropertiesService.getDocumentProperties().getProperty(LAST_SYNC_ROW_PROPERTY) || HEADER_ROW);
}

function markSyncPosition_(rowNumber) {
  PropertiesService.getDocumentProperties().setProperty(LAST_SYNC_ROW_PROPERTY, String(rowNumber));
}

function validateConfiguration_() {
  if (SUPABASE_URL.indexOf('PEGA_AQUI') !== -1 || SUPABASE_ANON_KEY.indexOf('PEGA_AQUI') !== -1) {
    throw new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY al inicio del script.');
  }

  if (!/^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL)) {
    throw new Error('SUPABASE_URL no parece una URL válida de Supabase.');
  }
}

function showError_(error) {
  console.error(error && error.stack ? error.stack : error);
  SpreadsheetApp.getUi().alert(
    'Error de sincronización',
    error && error.message ? error.message : String(error),
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}
