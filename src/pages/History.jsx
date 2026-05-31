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

export default function History() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
      setSales(data || []);
      setLoading(false);
    })();
  }, []);

  // Agrupar por venta (sale_group_id), excluyendo cierres de cuenta
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      if (s.product_type === "account_close") continue;
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
  }, [sales, filter]);

  const totalPeriodo = groups.reduce((a, g) => a + g.total, 0);

  return (
    <div className="space-y-3">
      {/* Filtros de método de pago */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
              filter === f.key ? "bg-[#0040a1] text-white" : "bg-white text-[#64748b] border border-[#e2e8f0]"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Total */}
      <div className="bg-white rounded-2xl p-4 border border-[#e2e8f0] flex items-center justify-between">
        <div>
          <p className="text-xs text-[#64748b]">Recaudado (en la nube · 3 meses)</p>
          <p className="text-2xl font-extrabold text-[#10b981]">{formatMoney(totalPeriodo)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#64748b]">Ventas</p>
          <p className="text-2xl font-extrabold text-[#0040a1]">{groups.length}</p>
        </div>
      </div>

      {loading ? <Loader /> : groups.length === 0 ? (
        <p className="text-center text-[#94a3b8] py-10">Sin ventas registradas</p>
      ) : (
        groups.map((g) => (
          <div key={g.id} className="bg-white rounded-2xl p-4 border border-[#e2e8f0]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#94a3b8]">{(g.fecha || "").slice(0, 16)}</span>
              <span className="flex items-center gap-2">
                {g.account && <span className="text-[10px] bg-[#f59e0b]/10 text-[#f59e0b] px-2 py-0.5 rounded-full font-semibold">Cuenta</span>}
                <span className="text-[10px] bg-[#0040a1]/10 text-[#0040a1] px-2 py-0.5 rounded-full font-semibold capitalize">{g.metodo}</span>
              </span>
            </div>
            {g.items.map((it) => (
              <div key={it.uuid} className="flex justify-between text-sm py-0.5">
                <span className="text-[#1e293b]">
                  {it.product_name}
                  <span className="text-[#94a3b8]"> ×{formatNum(it.quantity, it.quantity % 1 === 0 ? 0 : 2)}</span>
                </span>
                <span className="text-[#64748b]">{formatMoney(it.total_price)}</span>
              </div>
            ))}
            <div className="flex justify-between mt-2 pt-2 border-t border-[#f1f5f9]">
              <span className="font-bold text-[#1e293b]">Total</span>
              <span className="font-extrabold text-[#10b981]">{formatMoney(g.total)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
