import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney } from "../utils";

export const STOCK_THRESHOLD = 10;
export const EXPIRY_DAYS = 14;

// Devuelve { lowStock: [...], expiring: [...] } a partir de productos + batches.
export function classifyAlerts(products, batches) {
  const stockMap = {};
  const batchesByProduct = {};
  for (const b of batches || []) {
    if (b.is_deleted) continue;
    stockMap[b.product_uuid] = (stockMap[b.product_uuid] || 0) + Number(b.quantity || 0);
    if (!batchesByProduct[b.product_uuid]) batchesByProduct[b.product_uuid] = [];
    batchesByProduct[b.product_uuid].push(b);
  }

  const now = new Date();
  const limit = new Date();
  limit.setDate(limit.getDate() + EXPIRY_DAYS);

  const lowStock = [];
  const expiring = [];

  for (const p of products || []) {
    const stock = stockMap[p.uuid] || 0;
    if (stock <= STOCK_THRESHOLD) {
      lowStock.push({ ...p, stock });
    }
    const productBatches = batchesByProduct[p.uuid] || [];
    let earliest = null;
    for (const b of productBatches) {
      if (!b.expiry_date) continue;
      if (Number(b.quantity) <= 0) continue;
      const d = new Date(b.expiry_date);
      if (isNaN(d.getTime())) continue;
      if (d <= limit && (!earliest || d < earliest)) earliest = d;
    }
    if (earliest) {
      const days = Math.ceil((earliest - now) / (1000 * 60 * 60 * 24));
      expiring.push({ ...p, expiry: earliest, days });
    }
  }

  lowStock.sort((a, b) => a.stock - b.stock);
  expiring.sort((a, b) => a.days - b.days);
  return { lowStock, expiring };
}

export function useAlerts() {
  const [data, setData] = useState({ lowStock: [], expiring: [], loading: true });

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const [prodsRes, batchesRes] = await Promise.all([
          supabase.from("products").select("*").eq("is_deleted", 0),
          supabase.from("product_batches").select("*").eq("product_source", "products").eq("is_deleted", 0),
        ]);
        if (cancel) return;
        const cls = classifyAlerts(prodsRes.data || [], batchesRes.data || []);
        setData({ ...cls, loading: false });
      } catch (e) {
        if (cancel) return;
        // Si falla por red u otra cosa, no bloqueamos la UI: dejamos contadores en 0.
        setData({ lowStock: [], expiring: [], loading: false });
      }
    }
    load();
    const id = setInterval(load, 60000); // refresca cada minuto
    return () => { cancel = true; clearInterval(id); };
  }, []);

  return data;
}

export default function Alerts() {
  const { lowStock, expiring, loading } = useAlerts();
  const [tab, setTab] = useState("expiring");

  const list = tab === "expiring" ? expiring : lowStock;

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <TabButton active={tab === "expiring"} onClick={() => setTab("expiring")}
          icon="schedule" label="Por vencer" count={expiring.length} color="var(--color-danger)" />
        <TabButton active={tab === "lowStock"} onClick={() => setTab("lowStock")}
          icon="inventory_2" label="Stock bajo" count={lowStock.length} color="var(--color-warn)" />
      </div>

      {list.length === 0 ? (
        <div className="text-center text-muted py-12">
          <span className="material-symbols-outlined text-4xl text-success">check_circle</span>
          <p className="mt-2 text-sm">Nada que avisar acá</p>
        </div>
      ) : tab === "expiring" ? (
        <ExpiringList items={list} />
      ) : (
        <LowStockList items={list} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count, color }) {
  return (
    <button onClick={onClick}
      className={`p-3 rounded-2xl border-2 flex items-center gap-2 ${
        active ? "bg-surface border-brand" : "bg-surface border-line"
      }`}>
      <span className="material-symbols-outlined" style={{ color }}>{icon}</span>
      <div className="text-left">
        <p className="text-xs text-muted">{label}</p>
        <p className="font-bold text-lg" style={{ color }}>{count}</p>
      </div>
    </button>
  );
}

function ExpiringList({ items }) {
  return items.map((p) => {
    const negativo = p.days < 0;
    const tone = negativo ? "var(--color-danger)" : p.days <= 3 ? "var(--color-danger)" : p.days <= 7 ? "var(--color-warn)" : "var(--color-brand)";
    return (
      <div key={p.uuid} className="bg-surface rounded-2xl p-4 border border-line">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-fg truncate">{p.name}</p>
            <p className="text-xs text-muted">{p.category || "Sin categoría"}</p>
            <p className="text-xs text-muted mt-1">
              Vence: {p.expiry.toLocaleDateString("es-AR")}
            </p>
          </div>
          <span className="font-bold text-sm whitespace-nowrap" style={{ color: tone }}>
            {negativo ? `Vencido hace ${-p.days} d` : p.days === 0 ? "Hoy" : `En ${p.days} d`}
          </span>
        </div>
      </div>
    );
  });
}

function LowStockList({ items }) {
  return items.map((p) => {
    const tone = p.stock === 0 ? "var(--color-danger)" : p.stock <= 5 ? "var(--color-warn)" : "var(--color-brand)";
    return (
      <div key={p.uuid} className="bg-surface rounded-2xl p-4 border border-line">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-fg truncate">{p.name}</p>
            <p className="text-xs text-muted">{p.category || "Sin categoría"}</p>
            <p className="text-xs text-muted mt-1">
              Venta {formatMoney(p.unit_price)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-bold text-2xl" style={{ color: tone }}>{p.stock}</p>
            <p className="text-[10px] text-muted uppercase">unidades</p>
          </div>
        </div>
      </div>
    );
  });
}
