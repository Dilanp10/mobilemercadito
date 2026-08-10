// Tema claro/oscuro. Por defecto sigue al sistema; si el usuario toca el
// botón, esa elección se guarda y pasa a mandar sobre el sistema.
// El primer pintado lo resuelve el script inline de index.html — cualquier
// cambio acá hay que reflejarlo también allá.
import { useEffect, useState } from "react";

const KEY = "sb-theme";
const HEADER_COLOR = { light: "#0040a1", dark: "#16357a" };

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// "light" | "dark" según lo guardado, o lo que diga el sistema si no hay nada.
export function currentTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage puede fallar en modo privado; caemos al sistema
  }
  return systemPrefersDark() ? "dark" : "light";
}

function apply(theme) {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? HEADER_COLOR.dark : HEADER_COLOR.light);
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => { apply(theme); }, [theme]);

  // Si el usuario nunca eligió a mano, seguimos los cambios del sistema
  // (por ejemplo el modo oscuro automático al anochecer).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => {
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch { /* ignorado */ }
      if (saved !== "dark" && saved !== "light") setTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* ignorado */ }
    setTheme(next);
  }

  return { theme, toggle, isDark: theme === "dark" };
}
