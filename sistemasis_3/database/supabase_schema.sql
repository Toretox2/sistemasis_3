-- SQL para Supabase: AuraTech Industries
-- Tablas para control de asistencia

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    cargo TEXT NOT NULL,
    qr_code_hash TEXT NOT NULL UNIQUE,
    salario_base NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
