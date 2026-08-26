document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('adminLoginForm');
  const supabase = window.AuraTechSupabase;

  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;

    if (!email || !password) {
      alert('Completa correo y contraseña para continuar.');
      return;
    }

    if (!supabase) {
      alert('La conexión con Supabase no está disponible.');
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        window.location.href = './dashboard.html';
      }
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      alert('Credenciales inválidas o usuario no autorizado.');
    }
  });
});
