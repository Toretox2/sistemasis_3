document.addEventListener('DOMContentLoaded', () => {
  const scannerStatus = document.getElementById('scannerStatus');
  const supabase = window.AuraTechSupabase;

  if (!supabase) {
    console.error('Supabase no está inicializado. Verifica js/config.js.');
    if (scannerStatus) {
      scannerStatus.textContent = 'Error de conexión';
    }
    return;
  }

  const localDateTime = () => new Date();

  const parseTimeToDate = (timeValue) => {
    if (!timeValue) return null;

    const normalized = timeValue.includes(':') ? timeValue : `${timeValue}:00`;
    const [hours, minutes, seconds = '0'] = normalized.split(':').map(Number);
    const parsed = new Date(2000, 0, 1, hours, minutes, seconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const calculateWorkedHours = (startTime, endTime) => {
    const startDate = parseTimeToDate(startTime);
    const endDate = parseTimeToDate(endTime);

    if (!startDate || !endDate) return 0;

    const differenceInHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    return Math.max(differenceInHours, 0);
  };

  const formatLocalDate = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
  };

  const formatLocalTime = (date) =>
    date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const determineShiftState = (startTime) => {
    const startDate = parseTimeToDate(startTime);
    const lateThreshold = new Date(2000, 0, 1, 8, 30, 0);

    if (!startDate) return 'presente';
    return startDate > lateThreshold ? 'retardo' : 'presente';
  };

  const setStatus = (message, tone = 'neutral') => {
    if (!scannerStatus) return;

    const statusBackgrounds = {
      success: 'rgba(34, 197, 94, 0.12)',
      warning: 'rgba(245, 158, 11, 0.12)',
      error: 'rgba(239, 68, 68, 0.12)',
      neutral: 'rgba(71, 168, 189, 0.12)',
    };
    const statusBorders = {
      success: 'rgba(34, 197, 94, 0.25)',
      warning: 'rgba(245, 158, 11, 0.25)',
      error: 'rgba(239, 68, 68, 0.25)',
      neutral: 'rgba(71, 168, 189, 0.25)',
    };

    scannerStatus.textContent = message;
    scannerStatus.style.background = statusBackgrounds[tone] || statusBackgrounds.neutral;
    scannerStatus.style.borderColor = statusBorders[tone] || statusBorders.neutral;
  };

  const showAttendanceAlert = async ({ employee, action, date, time }) => {
    const actionLabel = action === 'entry' ? 'Entrada registrada' : 'Salida registrada';

    await Swal.fire({
      title: actionLabel,
      html: `
        <div style="text-align: left;">
          <p><strong>Empleado:</strong> ${employee.nombre}</p>
          <p><strong>Cargo:</strong> ${employee.cargo}</p>
          <p><strong>Fecha:</strong> ${date}</p>
          <p><strong>Hora:</strong> ${time}</p>
        </div>
      `,
      icon: 'success',
      confirmButtonText: 'Aceptar',
      confirmButtonColor: '#47A8BD',
      background: '#ffffff',
      customClass: {
        popup: 'swal2-popup-custom',
        title: 'swal2-title-custom',
      },
      showClass: {
        popup: 'animate__animated animate__fadeInUp',
      },
      hideClass: {
        popup: 'animate__animated animate__fadeOutDown',
      },
      allowOutsideClick: false,
      timer: 2600,
      timerProgressBar: true,
    });
  };

  async function getEmployeeByQrCode(qrCode) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('qr_code_hash', qrCode)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async function getTodayAttendance(employeeId) {
    const today = formatLocalDate(localDateTime());

    const { data, error } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('fecha', today)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    return data && data.length > 0 ? data[0] : null;
  }

  async function registerScan(employee) {
    const now = localDateTime();
    const fecha = formatLocalDate(now);
    const horaActual = formatLocalTime(now);
    const currentLog = await getTodayAttendance(employee.id);

    if (!currentLog) {
      const { error } = await supabase.from('attendance_logs').insert([
        {
          employee_id: employee.id,
          fecha,
          hora_entrada: horaActual,
          hora_salida: null,
          horas_trabajadas: 0,
          horas_extra: 0,
          estado: determineShiftState(horaActual),
        },
      ]);

      if (error) throw error;

      await showAttendanceAlert({
        employee,
        action: 'entry',
        date: fecha,
        time: horaActual,
      });

      setStatus('Entrada registrada', 'success');
      return;
    }

    if (currentLog.hora_salida) {
      setStatus('Asistencia ya cerrada', 'warning');
      await Swal.fire({
        title: 'Asistencia ya registrada',
        text: 'Este empleado ya tiene entrada y salida registradas para hoy.',
        icon: 'info',
        confirmButtonColor: '#47A8BD',
        background: '#ffffff',
      });
      return;
    }

    const totalHoursWorked = calculateWorkedHours(currentLog.hora_entrada, horaActual);
    const extraHours = Math.max(totalHoursWorked - 8, 0);

    const { error } = await supabase
      .from('attendance_logs')
      .update({
        hora_salida: horaActual,
        horas_trabajadas: Number(totalHoursWorked).toFixed(2),
        horas_extra: Number(extraHours).toFixed(2),
        estado: determineShiftState(currentLog.hora_entrada),
      })
      .eq('id', currentLog.id);

    if (error) throw error;

    await showAttendanceAlert({
      employee,
      action: 'exit',
      date: fecha,
      time: horaActual,
    });

    setStatus('Salida registrada', 'success');
  }

  const scanner = new Html5QrcodeScanner(
    'qr-reader',
    {
      fps: 10,
      qrbox: { width: 260, height: 260 },
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
      aspectRatio: 1,
    },
    false,
  );

  scanner.render(
    async (decodedText) => {
      setStatus('Verificando código QR...', 'warning');
      scanner.pause(true);

      try {
        const employee = await getEmployeeByQrCode(decodedText.trim());

        if (!employee) {
          setStatus('Empleado no encontrado', 'error');
          await Swal.fire({
            title: 'Código no válido',
            text: 'No se encontró un empleado asociado a este QR.',
            icon: 'error',
            confirmButtonColor: '#47A8BD',
            background: '#ffffff',
          });
          scanner.resume();
          return;
        }

        await registerScan(employee);
        setTimeout(() => scanner.resume(), 1500);
      } catch (error) {
        console.error('Error al procesar el QR:', error);
        setStatus('Error en el registro', 'error');
        await Swal.fire({
          title: 'No se pudo registrar la asistencia',
          text: 'Revisa la conexión con Supabase o el QR escaneado.',
          icon: 'error',
          confirmButtonColor: '#47A8BD',
          background: '#ffffff',
        });
        scanner.resume();
      }
    },
    (errorMessage) => {
      if (errorMessage && typeof errorMessage === 'string' && errorMessage.includes('NotFoundException')) {
        return;
      }
    },
  );
});
