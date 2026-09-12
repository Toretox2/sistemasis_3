-- SQL para Supabase: AuraTech Industries
-- Tablas para control de asistencia

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    cargo TEXT NOT NULL,
    qr_code_hash TEXT NOT NULL UNIQUE,
    salario_base NUMERIC(12,2) NOT NULL DEFAULT 0,
    pago_por_dia NUMERIC(12,2) NOT NULL DEFAULT 0,
    horas_jornada NUMERIC(5,2) NOT NULL DEFAULT 8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS pago_por_dia NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS horas_jornada NUMERIC(5,2) NOT NULL DEFAULT 8;

CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_entrada TIME,
    hora_salida TIME,
    horas_trabajadas NUMERIC(5,2) DEFAULT 0,
    horas_extra NUMERIC(5,2) DEFAULT 0,
    estado TEXT NOT NULL CHECK (estado IN ('presente', 'falta', 'retardo')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_logs_employee_id_fecha_key'
          AND conrelid = 'public.attendance_logs'::regclass
    ) THEN
        ALTER TABLE public.attendance_logs
            ADD CONSTRAINT attendance_logs_employee_id_fecha_key UNIQUE (employee_id, fecha);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_id
    ON public.attendance_logs(employee_id);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_fecha
    ON public.attendance_logs(fecha);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read employees for QR validation" ON public.employees;
CREATE POLICY "Public can read employees for QR validation"
    ON public.employees
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can read attendance logs" ON public.attendance_logs;
CREATE POLICY "Public can read attendance logs"
    ON public.attendance_logs
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can register attendance" ON public.attendance_logs;
CREATE POLICY "Public can register attendance"
    ON public.attendance_logs
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can complete attendance" ON public.attendance_logs;
CREATE POLICY "Public can complete attendance"
    ON public.attendance_logs
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.payroll_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_periodo TEXT NOT NULL,
    periodo_tipo TEXT NOT NULL CHECK (periodo_tipo IN ('quincenal', 'mensual')),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    total_pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
    snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (periodo_tipo, fecha_inicio, fecha_fin)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_fecha
    ON public.payroll_periods(fecha_fin DESC);

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read payroll periods" ON public.payroll_periods;
CREATE POLICY "Public can read payroll periods"
    ON public.payroll_periods
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can insert payroll periods" ON public.payroll_periods;
CREATE POLICY "Public can insert payroll periods"
    ON public.payroll_periods
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update payroll periods" ON public.payroll_periods;
CREATE POLICY "Public can update payroll periods"
    ON public.payroll_periods
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.company_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key TEXT NOT NULL UNIQUE,
    hora_entrada_oficial TIME NOT NULL DEFAULT '08:00',
    hora_salida_oficial TIME NOT NULL DEFAULT '17:00',
    margen_tolerancia_minutos INTEGER NOT NULL DEFAULT 10,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read company settings" ON public.company_settings;
CREATE POLICY "Public can read company settings"
    ON public.company_settings
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can insert company settings" ON public.company_settings;
CREATE POLICY "Public can insert company settings"
    ON public.company_settings
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update company settings" ON public.company_settings;
CREATE POLICY "Public can update company settings"
    ON public.company_settings
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.work_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    entry_time TIME NOT NULL,
    exit_time TIME NOT NULL,
    tolerance_minutes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read work shifts" ON public.work_shifts;
CREATE POLICY "Public can read work shifts"
    ON public.work_shifts
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can insert work shifts" ON public.work_shifts;
CREATE POLICY "Public can insert work shifts"
    ON public.work_shifts
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update work shifts" ON public.work_shifts;
CREATE POLICY "Public can update work shifts"
    ON public.work_shifts
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can delete work shifts" ON public.work_shifts;
CREATE POLICY "Public can delete work shifts"
    ON public.work_shifts
    FOR DELETE
    TO anon, authenticated
    USING (true);

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tipo_horario TEXT NOT NULL DEFAULT 'personalizado';

CREATE INDEX IF NOT EXISTS idx_employees_shift_id
    ON public.employees(shift_id);

CREATE INDEX IF NOT EXISTS idx_employees_tipo_horario
    ON public.employees(tipo_horario);

CREATE TABLE IF NOT EXISTS public.payroll_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_id UUID REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    periodo_tipo TEXT NOT NULL CHECK (periodo_tipo IN ('quincenal', 'mensual')),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    pago_por_hora NUMERIC(12,2) NOT NULL DEFAULT 0,
    pago_por_horas NUMERIC(12,2) NOT NULL DEFAULT 0,
    horas_trabajadas NUMERIC(7,2) NOT NULL DEFAULT 0,
    horas_extra NUMERIC(7,2) NOT NULL DEFAULT 0,
    horas_faltantes NUMERIC(7,2) NOT NULL DEFAULT 0,
    asistencias INTEGER NOT NULL DEFAULT 0,
    faltas INTEGER NOT NULL DEFAULT 0,
    total_pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_history_period_id
    ON public.payroll_history(period_id);

CREATE INDEX IF NOT EXISTS idx_payroll_history_employee_id
    ON public.payroll_history(employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_history_periodo
    ON public.payroll_history(periodo_tipo, fecha_inicio, fecha_fin);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payroll_history_period_employee
    ON public.payroll_history(period_id, employee_id);

ALTER TABLE public.payroll_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read payroll history" ON public.payroll_history;
CREATE POLICY "Public can read payroll history"
    ON public.payroll_history
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can insert payroll history" ON public.payroll_history;
CREATE POLICY "Public can insert payroll history"
    ON public.payroll_history
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update payroll history" ON public.payroll_history;
CREATE POLICY "Public can update payroll history"
    ON public.payroll_history
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
