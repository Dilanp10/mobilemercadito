import { useState } from "react";
import { supabase, configMissing } from "../supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();

    // Si faltan las variables de entorno, avisamos claro (no es problema de la clave)
    if (configMissing) {
      setError("⚙️ La app no está conectada a la base. Faltan las variables de entorno en Vercel (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY). Cargalas y volvé a desplegar.");
      return;
    }

    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      if (/email not confirmed/i.test(error.message)) setError("El email no está confirmado.");
      else if (/invalid/i.test(error.message)) setError("Email o contraseña incorrectos.");
      else setError("No se pudo entrar: " + error.message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-brand-solid to-brand-deep">
      <div className="w-full max-w-sm bg-surface rounded-3xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-brand-solid flex items-center justify-center mb-3">
            <span className="text-white text-2xl font-extrabold">SB</span>
          </div>
          <h1 className="text-2xl font-extrabold text-fg">SuperBeto</h1>
          <p className="text-sm text-muted">Control del negocio</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Email</label>
            <input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:border-brand text-base"
              placeholder="tucorreo@gmail.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:border-brand text-base"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="text-sm text-danger font-medium">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-solid text-white rounded-xl font-bold text-base hover:bg-brand-press disabled:bg-subtle transition-all"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
      <p className="text-white/60 text-xs mt-6">Acceso solo para el dueño del negocio</p>
    </div>
  );
}
