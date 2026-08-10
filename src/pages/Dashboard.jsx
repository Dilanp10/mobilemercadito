import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum } from "../utils";

const PERIODS = [
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "mes_anterior", label: "Mes ant." },
];

function toDate(str) {
  if (!str) return new Date(0);
  return new Date(str.replace(" ", "T"));
}

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

export default function Dashboard() {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [weighted, setWeighted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("hoy");
  // Día específico seleccionado cuando el período es "hoy" (por defecto: hoy)
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
      setLoading(true);
      try {
        // Ventas: Supabase limita a 1000 filas por consulta, así que paginamos
        // (en tandas de 1000, más recientes primero) para traerlas TODAS. Sin
        // esto, con +1000 ventas históricas se perdían días enteros.
        const PAGE = 1000;
        const MAX_PAGES = 50; // tope de seguridad (~50k ventas)
        let allSales = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const from = page * PAGE;
          const { data, error } = await supabase
            .from("sales")
            .select("*")
            .eq("is_deleted", 0)
            .order("created_at", { ascending: false })
            .range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          allSales = allSales.concat(data);
          if (data.length < PAGE) break; // última tanda
        }
        const [p, w] = await Promise.all([
          supabase.from("products").select("*").eq("is_deleted", 0),
          supabase.from("weighted_products").select("*").eq("is_deleted", 0),
        ]);
        setSales(allSales);
        setProducts(p.data || []);
        setWeighted(w.data || []);
      } catch {
        // si falla, dejamos listas vacías y no bloqueamos la UI
      }
      setLoading(false);
    })();
  }, []);

  // Ventas del período seleccionado (misma lógica que el desktop)
  const filteredSales = useMemo(() => {
    const now = new Date();
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return sales.filter((s) => {
      if (s.product_type === "account_close") return false;
      const d = toDate(s.created_at);
      if (period === "hoy") {
        const desde = startOf(selectedDay);
        const hasta = new Date(desde);
        hasta.setDate(hasta.getDate() + 1);
        return d >= desde && d < hasta;
      }
      if (period === "semana") {
        const c = new Date(now);
        c.setDate(c.getDate() - 6);
        return d >= startOf(c);
      }
      if (period === "mes") {
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }
      if (period === "mes_anterior") {
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return d.getMonth() === prev.getMonth() && d.getFullYear() === prev.getFullYear();
      }
      return true;
    });
  }, [sales, period, selectedDay]);

  // Costo de una lista de ventas (busca el producto por id y, si no, por nombre)
  function calcCosto(list) {
    let total = 0;
    for (const s of list) {
      if (s.product_type === "custom" || s.product_type === "account_close") continue;
      const qty = Number(s.quantity || 0);
      const byId = (arr) => (s.product_id != null ? arr.find((p) => String(p.id) === String(s.product_id)) : null);
      const byName = (arr) => (s.product_name ? arr.find((p) => p.name === s.product_name) : null);
      if (s.product_type === "peso") {
        const p = byId(weighted) || byName(weighted);
        total += qty * Number(p?.cost_price_kg || 0);
      } else {
        const p = byId(products) || byName(products);
        total += qty * Number(p?.cost_price || 0);
      }
    }
    return total;
  }

  // Calcula el set completo de KPIs para una lista de ventas
  function computeKpi(list) {
    const total = list.reduce((a, s) => a + Number(s.total_price || 0), 0);
    const ventas = new Set(list.map((s) => s.sale_group_id || s.uuid || s.id)).size;
    const unidades = list.reduce((a, s) => (s.product_type !== "peso" ? a + Number(s.quantity || 0) : a), 0);
    const kg = list.reduce((a, s) => (s.product_type === "peso" ? a + Number(s.quantity || 0) : a), 0);
    const costo = calcCosto(list);
    const ganancia = total - costo;
    const margen = total ? (ganancia / total) * 100 : 0;
    const ticket = ventas ? total / ventas : 0;
    return { total, ventas, unidades, kg, costo, ganancia, margen, ticket };
  }

  const caja = useMemo(() => computeKpi(filteredSales.filter((s) => !s.account_id)), [filteredSales, products, weighted]);
  const cuentas = useMemo(() => computeKpi(filteredSales.filter((s) => !!s.account_id)), [filteredSales, products, weighted]);
  const total = useMemo(() => computeKpi(filteredSales), [filteredSales, products, weighted]);

  const topProductos = useMemo(() => {
    const map = {};
    filteredSales.forEach((s) => {
      if (s.product_type === "custom" || s.product_type === "account_close") return;
      const type = s.product_type === "peso" ? "peso" : "unidad";
      const key = `${s.product_name}||${type}`;
      if (!map[key]) map[key] = { name: s.product_name || "—", type, qty: 0 };
      map[key].qty += Number(s.quantity || 0);
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [filteredSales]);

  const inventario = useMemo(() => {
    const stockUnidades = products.reduce((a, p) => a + Number(p.quantity || 0), 0);
    const stockKg = weighted.reduce((a, w) => a + Number(w.stock || 0), 0);
    const valor =
      products.reduce((a, p) => a + Number(p.cost_price || 0) * Number(p.quantity || 0), 0) +
      weighted.reduce((a, w) => a + Number(w.cost_price_kg || 0) * Number(w.stock || 0), 0);
    const valorVenta =
      products.reduce((a, p) => a + Number(p.unit_price || 0) * Number(p.quantity || 0), 0) +
      weighted.reduce((a, w) => a + Number(w.price_kg || 0) * Number(w.stock || 0), 0);
    const low = [
      ...products.filter((p) => Number(p.quantity) <= 5).map((p) => ({ name: p.name, qty: `${p.quantity} u` })),
      ...weighted.filter((w) => Number(w.stock) <= 5).map((w) => ({ name: w.name, qty: `${formatNum(w.stock)} kg` })),
    ];
    return { stockUnidades, stockKg, valor, valorVenta, low };
  }, [products, weighted]);

  if (loading) {
    return <div className="flex justify-center py-20 text-muted"><span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span></div>;
  }

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 border border-line">
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => {
              setPeriod(p.key);
              // Al volver a tocar "Hoy" arrancamos siempre mostrando el día de hoy
              if (p.key === "hoy") setSelectedDay(startOfDay(new Date()));
            }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${period === p.key ? "bg-brand-solid text-white" : "text-muted"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Selector de día (solo cuando el período es "Hoy") */}
      {period === "hoy" && (
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

      {/* Ganancia combinada destacada */}
      <div className="bg-gradient-to-br from-success to-success-deep rounded-2xl p-5 text-white">
        <p className="text-sm text-white/80">Ganancia total del período</p>
        <p className="text-4xl font-extrabold mt-1">{formatMoney(total.ganancia)}</p>
        <div className="flex items-center gap-3 mt-2 text-sm text-white/90">
          <span>Margen {formatNum(total.margen, 1)}%</span>
          <span>·</span>
          <span>Vendido {formatMoney(total.total)}</span>
        </div>
      </div>

      {/* BLOQUE: Ventas en caja */}
      <SectionHeader icon="point_of_sale" title="Ventas en caja" subtitle="Vendido directo desde caja" color="var(--color-brand)" />
      <KpiGrid k={caja} />

      {/* BLOQUE: Ventas en cuentas */}
      <SectionHeader icon="account_circle" title="Ventas en cuentas" subtitle="Fiado y cierres de clientes" color="var(--color-warn)" />
      <KpiGrid k={cuentas} />

      {/* BLOQUE: Totales combinados */}
      <SectionHeader icon="summarize" title="Totales combinados" subtitle="Caja + cuentas" color="var(--color-success)" />
      <KpiGrid k={total} />

      {/* Resumen del período */}
      <Section title="Resumen del período" icon="receipt_long">
        <Row label="Ventas (caja)" value={formatMoney(caja.total)} />
        <Row label="Ventas (cuentas)" value={formatMoney(cuentas.total)} />
        <Row label="Ventas totales" value={formatMoney(total.total)} green />
        <Row label="Costos" value={`- ${formatMoney(total.costo)}`} accent="var(--color-danger)" />
        <Row label="Ganancia neta" value={formatMoney(total.ganancia)} bold />
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted">
            <span>Margen combinado</span>
            <span>{formatNum(total.margen, 1)}%</span>
          </div>
          <div className="w-full bg-line h-2 rounded-full mt-1">
            <div className="bg-brand-solid h-2 rounded-full transition-all"
              style={{ width: `${Math.min(Math.max(total.margen, 0), 100)}%` }} />
          </div>
        </div>
      </Section>

      {/* Inventario */}
      <Section title="Inventario" icon="warehouse">
        <Row label="Stock en unidades" value={`${formatNum(inventario.stockUnidades, 0)} u`} />
        <Row label="Stock en kg" value={`${formatNum(inventario.stockKg)} kg`} />
        <Row label="Valor (al costo)" value={formatMoney(inventario.valor)} />
        <Row label="Valor (al precio de venta)" value={formatMoney(inventario.valorVenta)} green />
        <Row label="Ganancia potencial" value={formatMoney(inventario.valorVenta - inventario.valor)} accent="var(--color-brand)" />
        <Row label="Productos activos" value={products.length + weighted.length} />
      </Section>

      {/* Top productos */}
      <Section title="Más vendidos" icon="trending_up">
        {topProductos.length === 0 ? <Empty text="Sin ventas en este período" /> :
          topProductos.map((p, i) => (
            <div key={`${p.name}-${p.type}`} className="flex items-center gap-3 py-2 border-b border-surface-mute last:border-0">
              <span className="w-6 h-6 rounded-full bg-brand/10 text-brand text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <span className="flex-1 text-fg text-sm">
                {p.name}
                {p.type === "peso" && <span className="ml-1 text-xs text-muted">(por peso)</span>}
              </span>
              <span className="font-bold text-brand text-sm">
                {p.type === "peso" ? `${formatNum(p.qty)} kg` : `${Number(p.qty)} u`}
              </span>
            </div>
          ))}
      </Section>

      {/* Stock bajo */}
      <Section title="Stock bajo" icon="warning" accent="var(--color-danger)">
        {inventario.low.length === 0 ? <Empty text="Todo con stock suficiente 👍" /> :
          inventario.low.map((x) => (
            <div key={x.name} className="flex items-center justify-between py-2 border-b border-surface-mute last:border-0">
              <span className="text-fg text-sm">{x.name}</span>
              <span className="text-danger font-bold text-sm">{x.qty}</span>
            </div>
          ))}
      </Section>
    </div>
  );
}

// Grid de 8 KPIs para un bloque (caja / cuentas / total)
function KpiGrid({ k }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card title="Vendido" value={formatMoney(k.total)} icon="payments" color="var(--color-success)" />
      <Card title="Ganancia" value={formatMoney(k.ganancia)} icon="trending_up" color="var(--color-success)" highlight />
      <Card title="Ventas" value={k.ventas} icon="receipt_long" color="var(--color-brand)" />
      <Card title="Ticket prom." value={formatMoney(k.ticket)} icon="confirmation_number" color="var(--color-warn)" />
      <Card title="Unidades" value={formatNum(k.unidades, 0)} icon="inventory_2" color="var(--color-muted)" />
      <Card title="Kg vendidos" value={formatNum(k.kg)} icon="scale" color="var(--color-muted)" />
      <Card title="Costos" value={formatMoney(k.costo)} icon="trending_down" color="var(--color-danger)" />
      <Card title="Margen" value={`${formatNum(k.margen, 1)}%`} icon="percent" color="var(--color-brand)" />
    </div>
  );
}

function Card({ title, value, icon, color, highlight }) {
  return (
    <div className={`bg-surface rounded-2xl p-4 border ${highlight ? "border-success/40" : "border-line"}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
        <span className="text-xs text-muted">{title}</span>
      </div>
      <p className={`font-extrabold text-xl ${highlight ? "text-success" : "text-fg"}`}>{value}</p>
    </div>
  );
}
function SectionHeader({ icon, title, subtitle, color }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}>
        <span className="material-symbols-outlined" style={{ color, fontSize: 22 }}>{icon}</span>
      </div>
      <div>
        <h2 className="text-base font-bold text-fg leading-tight">{title}</h2>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
function Section({ title, icon, accent = "var(--color-brand)", children }) {
  return (
    <div className="bg-surface rounded-2xl p-4 border border-line">
      <h2 className="flex items-center gap-2 font-bold text-fg mb-2">
        <span className="material-symbols-outlined text-[20px]" style={{ color: accent }}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}
function Row({ label, value, green, accent, bold }) {
  const color = accent ? accent : green ? "var(--color-success)" : "var(--color-fg)";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-surface-mute last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`font-bold ${bold ? "text-base" : "text-sm"}`} style={{ color }}>{value}</span>
    </div>
  );
}
function Empty({ text }) {
  return <p className="text-sm text-subtle py-2">{text}</p>;
}
