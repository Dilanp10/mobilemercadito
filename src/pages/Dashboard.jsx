import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum } from "../utils";

const PERIODS = [
  { key: "hoy", label: "Hoy" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
];

// 'YYYY-MM-DD HH:MM:SS' en hora AR para un offset de días atrás
function cutoff(daysAgo) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - daysAgo * 86400 * 1000);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}

export default function Dashboard() {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [weighted, setWeighted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("hoy");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [s, p, w] = await Promise.all([
        supabase.from("sales").select("*"),
        supabase.from("products").select("*").eq("is_deleted", 0),
        supabase.from("weighted_products").select("*").eq("is_deleted", 0),
      ]);
      setSales(s.data || []);
      setProducts(p.data || []);
      setWeighted(w.data || []);
      setLoading(false);
    })();
  }, []);

  const kpi = useMemo(() => {
    const from = period === "hoy" ? cutoff(0) : period === "semana" ? cutoff(6) : cutoff(29);
    const rows = sales.filter(
      (r) => (r.created_at || "") >= from && r.product_type !== "account_close"
    );

    // Total e ventas (dedupe por grupo)
    const groups = new Map();
    for (const r of rows) {
      const g = r.sale_group_id || `row-${r.uuid}`;
      if (!groups.has(g)) groups.set(g, Number(r.sale_total || 0));
    }
    const totalVendido = [...groups.values()].reduce((a, b) => a + b, 0);
    const ventas = groups.size;
    const ticket = ventas ? totalVendido / ventas : 0;

    // Top productos por cantidad
    const top = {};
    for (const r of rows) {
      if (r.product_type === "custom") continue;
      const k = r.product_name || "—";
      top[k] = (top[k] || 0) + Number(r.quantity || 0);
    }
    const topProductos = Object.entries(top)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return { totalVendido, ventas, ticket, topProductos };
  }, [sales, period]);

  const lowStock = useMemo(() => {
    const a = products.filter((p) => Number(p.quantity) < 5).map((p) => ({ name: p.name, qty: `${p.quantity} u` }));
    const b = weighted.filter((w) => Number(w.stock) < 5).map((w) => ({ name: w.name, qty: `${formatNum(w.stock)} kg` }));
    return [...a, ...b];
  }, [products, weighted]);

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-[#64748b]">
        <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex gap-2 bg-white rounded-xl p-1 border border-[#e2e8f0]">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              period === p.key ? "bg-[#0040a1] text-white" : "text-[#64748b]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 gap-3">
        <Card title="Total vendido" value={formatMoney(kpi.totalVendido)} icon="payments" color="#10b981" big />
        <Card title="Ventas" value={kpi.ventas} icon="receipt_long" color="#0040a1" />
        <Card title="Ticket promedio" value={formatMoney(kpi.ticket)} icon="confirmation_number" color="#f59e0b" />
        <Card title="Productos" value={products.length + weighted.length} icon="inventory_2" color="#64748b" />
      </div>

      {/* Top productos */}
      <Section title="Más vendidos" icon="trending_up">
        {kpi.topProductos.length === 0 ? (
          <Empty text="Sin ventas en este período" />
        ) : (
          kpi.topProductos.map(([name, qty], i) => (
            <div key={name} className="flex items-center gap-3 py-2 border-b border-[#f1f5f9] last:border-0">
              <span className="w-6 h-6 rounded-full bg-[#0040a1]/10 text-[#0040a1] text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <span className="flex-1 text-[#1e293b] text-sm">{name}</span>
              <span className="font-bold text-[#0040a1] text-sm">{formatNum(qty, qty % 1 === 0 ? 0 : 2)}</span>
            </div>
          ))
        )}
      </Section>

      {/* Alertas de stock */}
      <Section title="Stock bajo" icon="warning" accent="#ef4444">
        {lowStock.length === 0 ? (
          <Empty text="Todo con stock suficiente 👍" />
        ) : (
          lowStock.map((x) => (
            <div key={x.name} className="flex items-center justify-between py-2 border-b border-[#f1f5f9] last:border-0">
              <span className="text-[#1e293b] text-sm">{x.name}</span>
              <span className="text-[#ef4444] font-bold text-sm">{x.qty}</span>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

function Card({ title, value, icon, color, big }) {
  return (
    <div className={`bg-white rounded-2xl p-4 border border-[#e2e8f0] ${big ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-[18px]" style={{ color }}>{icon}</span>
        <span className="text-xs text-[#64748b]">{title}</span>
      </div>
      <p className={`font-extrabold text-[#1e293b] ${big ? "text-3xl" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function Section({ title, icon, accent = "#0040a1", children }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-[#e2e8f0]">
      <h2 className="flex items-center gap-2 font-bold text-[#1e293b] mb-2">
        <span className="material-symbols-outlined text-[20px]" style={{ color: accent }}>{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <p className="text-sm text-[#94a3b8] py-2">{text}</p>;
}
