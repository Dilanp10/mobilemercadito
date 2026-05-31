import { NavLink, useLocation } from "react-router-dom";
import { supabase } from "../supabase";

const TABS = [
  { to: "/dashboard", icon: "dashboard", label: "Inicio" },
  { to: "/productos", icon: "inventory_2", label: "Productos" },
  { to: "/peso", icon: "scale", label: "Por peso" },
  { to: "/cuentas", icon: "account_circle", label: "Cuentas" },
  { to: "/historial", icon: "receipt_long", label: "Historial" },
];

const TITLES = {
  "/dashboard": "Resumen",
  "/productos": "Productos",
  "/peso": "Productos por peso",
  "/cuentas": "Cuentas",
  "/historial": "Historial",
};

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || "SuperBeto";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0040a1] text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <span className="text-sm font-extrabold">SB</span>
          </div>
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-white/80 hover:text-white p-1"
          title="Salir"
        >
          <span className="material-symbols-outlined">logout</span>
        </button>
      </header>

      {/* Contenido */}
      <main className="flex-1 px-4 py-4 pb-24 max-w-2xl w-full mx-auto">{children}</main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-[#e2e8f0] flex justify-around"
           style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 ${
                isActive ? "text-[#0040a1]" : "text-[#94a3b8]"
              }`
            }
          >
            <span className="material-symbols-outlined text-[22px]">{t.icon}</span>
            <span className="text-[10px] font-medium">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
