import { supabase } from "./supabase";

// Formato de moneda/numeros argentino: 27.540,00
const AR = (d) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
export const formatNum = (v, d = 2) => Number(v || 0).toLocaleString("es-AR", AR(d));
export const formatMoney = (v) => `$${formatNum(v)}`;

// Trae TODAS las filas de una consulta paginando de a 1000: Supabase corta
// silenciosamente ahí sin range(), y varias tablas (fardos, ventas) ya lo superan.
// buildPage(from, to) debe devolver la misma consulta con .range(from, to) aplicado.
export async function fetchAllRows(buildPage) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildPage(from, from + PAGE - 1);
    if (error || !data) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

// Suma de fardos por producto (product_uuid -> total), paginada.
export async function fetchAllBatchQuantities(productSource) {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("product_batches")
      .select("product_uuid, quantity")
      .eq("product_source", productSource)
      .eq("is_deleted", 0)
      .range(from, to)
  );
  const map = {};
  for (const b of rows) map[b.product_uuid] = (map[b.product_uuid] || 0) + Number(b.quantity || 0);
  return map;
}

// Marca de tiempo en hora local de Argentina (UTC-3) con el MISMO formato que
// usa la compu ('YYYY-MM-DD HH:MM:SS'), para que el sync compare bien.
export function nowLocalAR() {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// uuid v4 (para altas nuevas desde el celu)
export function newUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// El mes comercial arranca el 20 (misma regla que la compu del local):
// del 20 al 19 del mes siguiente. Devuelve el 20 que abre el ciclo actual;
// offset = -1 es el ciclo anterior, +1 el siguiente.
export const MONTH_START_DAY = 20;
export function startOfBusinessMonth(now, offset = 0) {
  const m = now.getDate() >= MONTH_START_DAY ? now.getMonth() : now.getMonth() - 1;
  return new Date(now.getFullYear(), m + offset, MONTH_START_DAY);
}

// Texto del rango del ciclo: "Del 20 ago a hoy" / "Del 20 jul al 19 ago"
export function businessMonthLabel(now, previous = false) {
  const fmt = (d) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  if (!previous) return `Del ${fmt(startOfBusinessMonth(now))} a hoy`;
  const fin = new Date(startOfBusinessMonth(now));
  fin.setDate(fin.getDate() - 1);
  return `Del ${fmt(startOfBusinessMonth(now, -1))} al ${fmt(fin)}`;
}

// Estampa para escrituras que van a sincronizarse hacia la compu
export const stampUpdate = () => ({ updated_at: nowLocalAR() });
export const stampNew = () => ({
  uuid: newUuid(),
  is_deleted: 0,
  created_at: nowLocalAR(),
  updated_at: nowLocalAR(),
});
