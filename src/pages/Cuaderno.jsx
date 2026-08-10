// Cuaderno (mobile): log de productos cargados en la última semana.
// Lee de Supabase (la nube). No registra nada nuevo — filtra por las fechas
// que ya existen en products.created_at, weighted_products.created_at y
// product_batches.entry_date. Pasados 7 días deja de mostrarse aquí.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum } from "../utils";
import { Loader } from "./Products";
import Proveedores from "./Proveedores";

function toDate(s) {
  if (!s) return new Date(0);
  return new Date(String(s).replace(" ", "T"));
}

function dayLabel(d) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (d >= startToday) return "Hoy";
  if (d >= startYesterday) return "Ayer";
  const diffDays = Math.floor((startToday - d) / (1000 * 60 * 60 * 24));
  if (diffDays >= 2 && diffDays <= 6) {
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    return `${dias[d.getDay()]} ${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}`;
  }
  return d.toLocaleDateString("es-AR");
}

function timeOf(d) {
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function Cuaderno() {
  const [products, setProducts] = useState([]);
  const [weighted, setWeighted] = useState([]);
  const [batches, setBatches] = useState([]);
  // Nombres de productos padre de los fardos (productos viejos que aún tienen movimientos)
  const [parentNames, setParentNames] = useState({}); // { uuid: { name, source } }
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("movimientos"); // "movimientos" | "proveedores"

  async function load() {
    setLoading(true);
    // Solo traemos lo de los últimos 7 días (ventana semanal)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    const sinceISO = cutoff.toISOString().slice(0, 19).replace("T", " ");

    const [p, w, b] = await Promise.all([
      supabase.from("products").select("*").eq("is_deleted", 0).gte("created_at", sinceISO),
      supabase.from("weighted_products").select("*").eq("is_deleted", 0).gte("created_at", sinceISO),
      supabase.from("product_batches").select("*").eq("is_deleted", 0).gte("entry_date", sinceISO),
    ]);
    const prodList = p.data || [];
    const wpList = w.data || [];
    const batchList = b.data || [];
    setProducts(prodList);
    setWeighted(wpList);
    setBatches(batchList);

    // Resolver nombres de productos padre que NO estén en la lista de "nuevos"
    // (porque pueden ser productos viejos a los que les estás sumando un fardo hoy).
    // No confiamos en product_source: buscamos el uuid en ambas tablas y usamos
    // el que aparezca. Así resolvemos batches con source vacío o mal seteado.
    const knownUuids = new Set([...prodList.map((x) => x.uuid), ...wpList.map((x) => x.uuid)]);
    const missing = [
      ...new Set(
        batchList
          .map((bt) => bt.product_uuid)
          .filter((u) => u && !knownUuids.has(u))
      ),
    ];

    const names = {};
    if (missing.length) {
      const [rc, rw] = await Promise.all([
        supabase.from("products").select("uuid, name").in("uuid", missing),
        supabase.from("weighted_products").select("uuid, name").in("uuid", missing),
      ]);
      // Common primero; si también aparece en weighted, weighted lo sobreescribe
      // solo cuando common no lo trajo.
      for (const r of rc.data || []) names[r.uuid] = { name: r.name, source: "products" };
      for (const r of rw.data || []) {
        if (!names[r.uuid]) names[r.uuid] = { name: r.name, source: "weighted_products" };
      }
    }
    setParentNames(names);

    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const events = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    const items = [];

    // Productos comunes nuevos
    for (const p of products) {
      const d = toDate(p.created_at);
      if (d < cutoff) continue;
      items.push({
        id: `prod-${p.uuid}`,
        when: d,
        type: "product_new",
        title: p.name,
        subtitle: p.category || "Sin categoría",
        detail: `${formatMoney(p.cost_price)} → ${formatMoney(p.unit_price)}`,
        unit: `${p.quantity || 0} u`,
        icon: "inventory_2",
        color: "var(--color-brand)",
      });
    }

    // Productos por peso nuevos
    for (const w of weighted) {
      const d = toDate(w.created_at);
      if (d < cutoff) continue;
      items.push({
        id: `wp-${w.uuid}`,
        when: d,
        type: "weighted_new",
        title: w.name,
        subtitle: w.category || "Sin categoría",
        detail: `${formatMoney(w.cost_price_kg)}/kg → ${formatMoney(w.price_kg)}/kg`,
        unit: `${formatNum(w.stock || 0)} kg`,
        icon: "scale",
        color: "var(--color-success)",
      });
    }

    // Fardos sumados — saltamos la tanda inicial (ya aparece como producto nuevo)
    for (const b of batches) {
      const d = toDate(b.entry_date || b.created_at);
      if (d < cutoff) continue;

      // Buscar el padre en ambas listas de "nuevos" sin confiar en product_source
      const parentCommon = products.find((x) => x.uuid === b.product_uuid);
      const parentWeighted = weighted.find((x) => x.uuid === b.product_uuid);
      const parent = parentCommon || parentWeighted;

      // Fuente resuelta: la que encontramos, si no la del batch, si no el fallback
      const resolvedSource =
        (parentWeighted && "weighted_products") ||
        (parentCommon && "products") ||
        parentNames[b.product_uuid]?.source ||
        b.product_source;
      const isWeighted = resolvedSource === "weighted_products";

      // No mostrar si el padre se creó casi al mismo tiempo (es la tanda inicial)
      if (parent) {
        const parentDate = toDate(parent.created_at);
        if (Math.abs(d - parentDate) < 5000) continue;
      }

      // Nombre: primero el padre "nuevo" (últimos 7 días), si no el resuelto por UUID
      const resolvedName = parent?.name || parentNames[b.product_uuid]?.name || "Producto";

      items.push({
        id: `batch-${b.uuid}`,
        when: d,
        type: "batch",
        title: resolvedName,
        subtitle: isWeighted ? "Fardo (por peso)" : "Fardo (común)",
        detail: b.expiry_date ? `Vence ${b.expiry_date}` : "Sin vencimiento",
        unit: `+${isWeighted ? formatNum(b.quantity) + " kg" : b.quantity + " u"}`,
        icon: isWeighted ? "scale" : "inventory_2",
        color: "var(--color-warn)",
      });
    }

    items.sort((a, b) => b.when - a.when);
    return items;
  }, [products, weighted, batches, parentNames]);

  // Agrupar por Hoy / Ayer
  const groups = useMemo(() => {
    const m = new Map();
    for (const ev of events) {
      const k = dayLabel(ev.when);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(ev);
    }
    return [...m.entries()];
  }, [events]);

  const totalNuevos = events.filter((e) => e.type !== "batch").length;
  const totalFardos = events.filter((e) => e.type === "batch").length;

  return (
    <div className="space-y-3">
      {/* Intro */}
      <div className="bg-surface rounded-2xl p-4 border border-line">
        <p className="text-sm text-muted">
          Lo que cargaste en <b className="text-fg">los últimos 7 días</b>. Después de una semana deja de mostrarse acá (el producto sigue en el inventario).
        </p>
      </div>

      {/* Tabs: Movimientos (timeline de hoy/ayer) vs Proveedores (deuda) */}
      <div className="flex gap-2 bg-surface rounded-2xl p-1.5 border border-line">
        <button
          onClick={() => setTab("movimientos")}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === "movimientos" ? "bg-brand-solid text-white" : "text-muted"
          }`}
        >
          📋 Movimientos
        </button>
        <button
          onClick={() => setTab("proveedores")}
          className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === "proveedores" ? "bg-brand-solid text-white" : "text-muted"
          }`}
        >
          🚚 Proveedores
        </button>
      </div>

      {tab === "proveedores" ? (
        <Proveedores />
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface rounded-2xl p-4 border border-line">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-brand text-[18px]">inventory_2</span>
                <span className="text-xs text-muted">Productos nuevos</span>
              </div>
              <p className="text-2xl font-extrabold text-brand">{totalNuevos}</p>
            </div>
            <div className="bg-surface rounded-2xl p-4 border border-line">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-warn text-[18px]">inbox</span>
                <span className="text-xs text-muted">Fardos sumados</span>
              </div>
              <p className="text-2xl font-extrabold text-warn">{totalFardos}</p>
            </div>
          </div>

          {/* Acción */}
          <button
            onClick={load}
            className="w-full py-2 bg-surface border border-line rounded-xl text-sm text-brand font-semibold flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Actualizar
          </button>

          {loading ? <Loader /> : events.length === 0 ? (
            <div className="bg-surface rounded-2xl p-10 border border-line text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-brand/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-brand">menu_book</span>
              </div>
              <p className="font-semibold text-fg">No cargaste nada en los últimos 2 días</p>
              <p className="text-sm text-subtle mt-1">Cuando agregues productos o sumes fardos, van a aparecer acá.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([day, items]) => (
                <div key={day}>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-base font-bold text-fg">{day}</h3>
                    <span className="text-xs text-subtle">{items.length} {items.length === 1 ? "mov." : "movs."}</span>
                    <div className="flex-1 h-px bg-line" />
                  </div>
                  <div className="space-y-2">
                    {items.map((ev) => (
                      <div key={ev.id} className="bg-surface border border-line rounded-2xl p-3 flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `color-mix(in srgb, ${ev.color} 12%, transparent)` }}
                        >
                          <span className="material-symbols-outlined text-[20px]" style={{ color: ev.color }}>
                            {ev.icon}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-fg text-sm truncate">{ev.title}</p>
                            <span className="text-[9px] text-subtle shrink-0">{timeOf(ev.when)}</span>
                          </div>
                          <p className="text-xs text-muted truncate">
                            {ev.type === "batch" ? ev.subtitle : ev.subtitle}
                          </p>
                          <p className="text-[11px] text-subtle truncate">{ev.detail}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-base font-extrabold" style={{ color: ev.color }}>{ev.unit}</p>
                          <p className="text-[9px] text-subtle uppercase font-semibold">
                            {ev.type === "batch" ? "Fardo" : "Nuevo"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
