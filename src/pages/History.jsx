import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum } from "../utils";
import { Loader } from "./Products";

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "efectivo", label: "Efectivo" },
  { key: "tarjeta", label: "Tarjeta" },
  { key: "transferencia", label: "Transfer." },
];

const PERIODS = [
  { key: "dia", label: "Hoy", icon: "today" },
  { key: "semana", label: "Semana", icon: "date_range" },
  { key: "mes", label: "Este mes", icon: "calendar_month" },
  { key: "mes_anterior", label: "Mes anterior", icon: "event_repeat" },
  { key: "todo", label: "Todo", icon: "all_inclusive" },
];

// Inicio del día (00:00) de una fecha
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Etiqueta corta para el botón de cada día (i = 0 es hoy)
function dayChipLabel(d, i) {
  if (i === 0) return "Hoy";
  if (i === 1) return "Ayer";
  return d.toLocaleDateString("es-AR", { weekday: "short" });
}

// Etiqueta larga para mostrar qué día se está viendo
function dayFullLabel(d) {
  const s = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function History() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos");
  const [period, setPeriod] = useState("dia");
  const [periodOpen, setPeriodOpen] = useState(false);
  // Día específico seleccionado cuando el período es "Hoy" (por defecto: hoy)
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));

  // Últimos 7 días (hoy + 6 anteriores) para el selector de día
  const dayOptions = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      return d;
    });
  }, []);

  useEffect(() => {
    (async () => {
      // Supabase limita a 1000 filas por consulta. Traemos TODAS las ventas
      // en tandas de 1000 (paginando) para no perder los días más viejos.
      const PAGE = 1000;
      const MAX_PAGES = 50; // tope de seguridad (~50k ventas)
      let all = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE;
        const { data, error } = await supabase
          .from("sales")
          .select("*")
          .eq("is_deleted", 0)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break; // última tanda
      }
      setSales(all);
      setLoading(false);
    })();
  }, []);

  const matchesPeriod = (createdAt) => {
    const now = new Date();
    const d = new Date(String(createdAt).replace(" ", "T"));
    if (period === "dia") {
      const desde = startOfDay(selectedDay);
      const hasta = new Date(desde);
      hasta.setDate(hasta.getDate() + 1);
      return d >= desde && d < hasta;
    }
    if (period === "semana") { const c = new Date(now); c.setDate(c.getDate() - 6); return d >= startOfDay(c); }
    if (period === "mes") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (period === "mes_anterior") {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear();
    }
    return true; // "todo"
  };

  // Agrupar por venta (sale_group_id), excluyendo cierres de cuenta
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      if (s.product_type === "account_close") continue;
      if (!matchesPeriod(s.created_at)) continue;
      const g = s.sale_group_id || s.uuid;
      if (!m.has(g)) {
        m.set(g, {
          id: g,
          fecha: s.created_at,
          total: Number(s.sale_total || 0),
          metodo: s.payment_method || "—",
          account: s.account_id,
          items: [],
        });
      }
      m.get(g).items.push(s);
    }
    let arr = [...m.values()];
    if (filter !== "todos") arr = arr.filter((g) => (g.metodo || "").toLowerCase() === filter);
    return arr;
  }, [sales, filter, period, selectedDay]);

  const totalPeriodo = groups.reduce((a, g) => a + g.total, 0);

  return (
    <div className="space-y-3">
      {/* Filtro de período (botón desplegable) */}
      <div className="relative">
        <button
          onClick={() => setPeriodOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-surface border border-line rounded-xl"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-brand">
              {PERIODS.find((p) => p.key === period)?.icon || "filter_list"}
            </span>
            <span className="text-sm font-semibold text-fg">
              {PERIODS.find((p) => p.key === period)?.label}
            </span>
          </span>
          <span className={`material-symbols-outlined text-muted transition-transform ${periodOpen ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>

        {periodOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setPeriodOpen(false)} />
            <div className="absolute left-0 right-0 mt-1 z-40 bg-surface border border-line rounded-xl shadow-lg overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    setPeriod(p.key);
                    setPeriodOpen(false);
                    // Al elegir "Hoy" arrancamos siempre mostrando el día de hoy
                    if (p.key === "dia") setSelectedDay(startOfDay(new Date()));
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left ${
                    period === p.key ? "bg-brand/5" : "active:bg-surface-soft"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ color: period === p.key ? "var(--color-brand)" : "var(--color-subtle)" }}>
                    {p.icon}
                  </span>
                  <span className={`text-sm flex-1 ${period === p.key ? "font-bold text-brand" : "text-fg"}`}>
                    {p.label}
                  </span>
                  {period === p.key && <span className="material-symbols-outlined text-[20px] text-brand">check</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Selector de día (solo cuando el período es "Hoy") */}
      {period === "dia" && (
        <div className="bg-surface rounded-xl p-3 border border-line">
          <p className="text-xs text-muted mb-2">Elegí el día que querés ver</p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {dayOptions.map((d, i) => {
              const activo = startOfDay(d).getTime() === startOfDay(selectedDay).getTime();
              return (
                <button key={d.toISOString()} onClick={() => setSelectedDay(d)}
                  className={`flex-shrink-0 min-w-[64px] rounded-xl py-2 px-2 flex flex-col items-center transition-all border ${
                    activo ? "bg-brand-solid text-white border-brand" : "bg-surface-soft text-muted border-line"}`}>
                  <span className="text-[11px] font-semibold capitalize leading-tight">{dayChipLabel(d, i)}</span>
                  <span className={`text-lg font-extrabold leading-tight ${activo ? "text-white" : "text-fg"}`}>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[13px] font-semibold text-brand mt-2">📅 {dayFullLabel(selectedDay)}</p>
        </div>
      )}

      {/* Filtros de método de pago */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
              filter === f.key ? "bg-brand-solid text-white" : "bg-surface text-muted border border-line"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Total */}
      <div className="bg-surface rounded-2xl p-4 border border-line flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Recaudado ({period === "dia" ? dayFullLabel(selectedDay) : PERIODS.find((p) => p.key === period)?.label})</p>
          <p className="text-2xl font-extrabold text-success">{formatMoney(totalPeriodo)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Ventas</p>
          <p className="text-2xl font-extrabold text-brand">{groups.length}</p>
        </div>
      </div>

      {loading ? <Loader /> : groups.length === 0 ? (
        <p className="text-center text-subtle py-10">Sin ventas registradas</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="bg-surface rounded-2xl p-4 border border-line">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-subtle">{(g.fecha || "").slice(0, 16)}</span>
              <span className="flex items-center gap-2">
                {g.account && <span className="text-[10px] bg-warn/10 text-warn px-2 py-0.5 rounded-full font-semibold">Cuenta</span>}
                <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-semibold capitalize">{g.metodo}</span>
              </span>
            </div>
            {g.items.map((it) => (
              <div key={it.uuid} className="flex justify-between text-sm py-0.5">
                <span className="text-fg">
                  {it.product_name}
                  <span className="text-subtle"> ×{formatNum(it.quantity, it.quantity % 1 === 0 ? 0 : 2)}</span>
                </span>
                <span className="text-muted">{formatMoney(it.total_price)}</span>
              </div>
            ))}
            <div className="flex justify-between mt-2 pt-2 border-t border-surface-mute">
              <span className="font-bold text-fg">Total</span>
              <span className="font-extrabold text-success">{formatMoney(g.total)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
