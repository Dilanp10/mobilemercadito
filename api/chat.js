// Función serverless de Vercel: /api/chat
// Recibe { message, history, supabase_token } y devuelve la respuesta del asistente.
// Usa Gemini con "function calling" para consultar Supabase.
// Modo actual: SOLO CONSULTA (no modifica datos).

import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const MODEL = "gemini-2.5-flash";

const SYSTEM_INSTRUCTION = `Sos "Beto", el asistente del negocio SuperBeto (una despensa/almacén argentino).
El dueño te habla en español (rioplatense) para consultar información del negocio.

Reglas:
- Sé breve y directo. Nada de introducciones largas.
- Usá los formatos argentinos: precios con $ y coma decimal (ej: $1.250,50), kg con coma.
- Si te preguntan algo que no podés responder con las herramientas, decilo con naturalidad.
- Si preguntan por una persona por nombre, buscá en las cuentas (podés buscar aunque el nombre esté incompleto).
- Cuando muestres listas, priorizá lo más importante (top 5, no más).
- Si algo no aparece en los datos (ej: producto sin ventas hoy), decilo claro y no inventes números.
- Por ahora NO podés modificar nada (precios, stock, cuentas). Si te piden un cambio, explicá que por ahora solo consultás.`;

// Cliente de Supabase. Preferimos service_role (bypass de RLS, acceso total) si
// está configurado; si no, caemos al JWT del usuario (respeta RLS).
function makeSupabase(token) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

function cutoffIso(offsetHours) {
  // Marca de tiempo Argentina (UTC-3) en formato 'YYYY-MM-DD HH:MM:SS'
  const d = new Date(Date.now() - offsetHours * 3600e3 - 3 * 3600e3);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function startOfTodayIso() {
  const d = new Date(Date.now() - 3 * 3600e3);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function startOfPeriodIso(period) {
  const now = new Date(Date.now() - 3 * 3600e3);
  if (period === "hoy") return startOfTodayIso();
  if (period === "ayer") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return y.toISOString().slice(0, 10) + " 00:00:00";
  }
  if (period === "semana") {
    const c = new Date(now);
    c.setDate(c.getDate() - 6);
    return c.toISOString().slice(0, 10) + " 00:00:00";
  }
  if (period === "mes") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) + " 00:00:00";
  }
  if (period === "mes_anterior") {
    return new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10) + " 00:00:00";
  }
  return "1970-01-01 00:00:00";
}
function endOfPeriodIso(period) {
  const now = new Date(Date.now() - 3 * 3600e3);
  if (period === "ayer") return startOfTodayIso();
  if (period === "mes_anterior") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) + " 00:00:00";
  }
  return null; // sin límite superior
}

// ═══════════════════════════════════════════════════════════════════════
//  DEFINICIÓN DE HERRAMIENTAS PARA GEMINI
// ═══════════════════════════════════════════════════════════════════════

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_recent_sales",
        description: "Devuelve las ventas de las últimas N horas. Útil para 'qué se vendió en la última hora', 'qué vendí hoy', etc.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            hours: { type: Type.NUMBER, description: "Cantidad de horas hacia atrás (1, 2, 24, etc.). Si el usuario dice 'hoy' usá 24, si dice 'última hora' usá 1." },
          },
          required: ["hours"],
        },
      },
      {
        name: "get_sales_summary",
        description: "Resumen de ventas: total vendido, cantidad de ventas, ganancia, ticket promedio. Para un período: hoy, ayer, semana, mes, mes_anterior.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING, description: "hoy | ayer | semana | mes | mes_anterior" },
          },
          required: ["period"],
        },
      },
      {
        name: "get_top_selling",
        description: "Productos más vendidos en un período. Devuelve top 5.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING, description: "hoy | semana | mes | mes_anterior | todo" },
          },
          required: ["period"],
        },
      },
      {
        name: "search_account",
        description: "Busca una cuenta (cliente que compra a fiado) por nombre parcial. Devuelve la lista de coincidencias con id.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: "Nombre o parte del nombre a buscar." },
          },
          required: ["query"],
        },
      },
      {
        name: "get_account_balance",
        description: "Cuánto debe una cuenta (saldo pendiente). Primero buscá con search_account para conseguir el account_id.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            account_id: { type: Type.STRING, description: "id de la cuenta (obtenido de search_account)" },
          },
          required: ["account_id"],
        },
      },
      {
        name: "get_account_sales",
        description: "Movimientos de una cuenta (últimas compras y cierres).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            account_id: { type: Type.STRING },
            limit: { type: Type.NUMBER, description: "Cantidad de últimos movimientos a devolver (default 10)" },
          },
          required: ["account_id"],
        },
      },
      {
        name: "search_product",
        description: "Busca un producto por nombre parcial. Devuelve nombre, precio de venta, costo, stock. Busca en productos comunes y por peso.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: "Nombre o parte del nombre del producto." },
          },
          required: ["query"],
        },
      },
      {
        name: "get_low_stock",
        description: "Productos con stock bajo (menos o igual a 10 unidades o kg).",
        parameters: { type: Type.OBJECT, properties: {} },
      },
      {
        name: "get_expiring_products",
        description: "Productos que vencen en los próximos N días.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            days: { type: Type.NUMBER, description: "Cantidad de días hacia adelante (default 14)" },
          },
        },
      },
      {
        name: "get_inventory_value",
        description: "Valor total del inventario al costo y al precio de venta.",
        parameters: { type: Type.OBJECT, properties: {} },
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════
//  EJECUCIÓN DE HERRAMIENTAS (consultas a Supabase)
// ═══════════════════════════════════════════════════════════════════════

async function runTool(name, args, supabase) {
  try {
    if (name === "get_recent_sales") {
      const since = cutoffIso(Number(args.hours || 1));
      const { data, error } = await supabase
        .from("sales")
        .select("product_name, quantity, total_price, product_type, payment_method, account_id, created_at")
        .gte("created_at", since)
        .neq("product_type", "account_close")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return { error: error.message };
      const total = (data || []).reduce((a, s) => a + Number(s.total_price || 0), 0);
      return { since, count: data?.length || 0, total, sales: data || [] };
    }

    if (name === "get_sales_summary") {
      const from = startOfPeriodIso(args.period);
      const to = endOfPeriodIso(args.period);
      let q = supabase
        .from("sales")
        .select("total_price, quantity, product_type, product_id, product_name, sale_group_id, uuid, account_id")
        .gte("created_at", from)
        .neq("product_type", "account_close");
      if (to) q = q.lt("created_at", to);
      const { data, error } = await q;
      if (error) return { error: error.message };
      const list = data || [];

      const [{ data: prods }, { data: wps }] = await Promise.all([
        supabase.from("products").select("id, uuid, name, cost_price"),
        supabase.from("weighted_products").select("id, uuid, name, cost_price_kg"),
      ]);

      const findCost = (s) => {
        if (s.product_type === "custom") return 0;
        const arr = s.product_type === "peso" ? (wps || []) : (prods || []);
        const byId = s.product_id != null ? arr.find((p) => String(p.id) === String(s.product_id)) : null;
        const byName = s.product_name ? arr.find((p) => p.name === s.product_name) : null;
        const p = byId || byName;
        return Number((s.product_type === "peso" ? p?.cost_price_kg : p?.cost_price) || 0);
      };

      const total = list.reduce((a, s) => a + Number(s.total_price || 0), 0);
      const costo = list.reduce((a, s) => a + Number(s.quantity || 0) * findCost(s), 0);
      const ganancia = total - costo;
      const ventas = new Set(list.map((s) => s.sale_group_id || s.uuid)).size;
      const ticket = ventas ? total / ventas : 0;
      const caja = list.filter((s) => !s.account_id).reduce((a, s) => a + Number(s.total_price || 0), 0);
      const cuentas = total - caja;
      const margen = total ? (ganancia / total) * 100 : 0;
      return { period: args.period, total, costo, ganancia, ventas, ticket, caja, cuentas, margen };
    }

    if (name === "get_top_selling") {
      const from = startOfPeriodIso(args.period);
      const to = endOfPeriodIso(args.period);
      let q = supabase
        .from("sales")
        .select("product_name, quantity, product_type")
        .gte("created_at", from)
        .neq("product_type", "account_close")
        .neq("product_type", "custom");
      if (to) q = q.lt("created_at", to);
      const { data, error } = await q;
      if (error) return { error: error.message };
      const map = {};
      for (const s of data || []) {
        const k = `${s.product_name}||${s.product_type === "peso" ? "kg" : "u"}`;
        if (!map[k]) map[k] = { name: s.product_name, unit: s.product_type === "peso" ? "kg" : "u", qty: 0 };
        map[k].qty += Number(s.quantity || 0);
      }
      const top = Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 5);
      return { period: args.period, top };
    }

    if (name === "search_account") {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, uuid, name, last_name, phone, gmail")
        .eq("is_deleted", 0)
        .or(`name.ilike.%${args.query}%,last_name.ilike.%${args.query}%`)
        .limit(10);
      if (error) return { error: error.message };
      return { accounts: data || [] };
    }

    if (name === "get_account_balance") {
      const { data: sales, error } = await supabase
        .from("sales")
        .select("total_price, product_type")
        .eq("account_id", String(args.account_id))
        .order("created_at", { ascending: false });
      if (error) return { error: error.message };
      const compras = (sales || [])
        .filter((s) => s.product_type !== "account_close")
        .reduce((a, s) => a + Number(s.total_price || 0), 0);
      const pagos = (sales || [])
        .filter((s) => s.product_type === "account_close")
        .reduce((a, s) => a + Number(s.total_price || 0), 0);
      return { compras, pagos, saldo: compras - pagos };
    }

    if (name === "get_account_sales") {
      const { data, error } = await supabase
        .from("sales")
        .select("created_at, product_name, quantity, total_price, product_type, payment_method")
        .eq("account_id", String(args.account_id))
        .order("created_at", { ascending: false })
        .limit(Number(args.limit || 10));
      if (error) return { error: error.message };
      return { sales: data || [] };
    }

    if (name === "search_product") {
      const [{ data: prods, error: e1 }, { data: wps, error: e2 }] = await Promise.all([
        supabase
          .from("products")
          .select("id, uuid, name, category, cost_price, unit_price, quantity, barcode")
          .eq("is_deleted", 0)
          .ilike("name", `%${args.query}%`)
          .limit(10),
        supabase
          .from("weighted_products")
          .select("id, uuid, name, category, cost_price_kg, price_kg, stock, barcode")
          .eq("is_deleted", 0)
          .ilike("name", `%${args.query}%`)
          .limit(10),
      ]);
      if (e1 || e2) return { error: e1?.message || e2?.message };
      return { productos: prods || [], por_peso: wps || [] };
    }

    if (name === "get_low_stock") {
      const [{ data: prods }, { data: wps }] = await Promise.all([
        supabase.from("products").select("name, quantity, unit_price").eq("is_deleted", 0).lte("quantity", 10),
        supabase.from("weighted_products").select("name, stock, price_kg").eq("is_deleted", 0).lte("stock", 10),
      ]);
      return {
        productos: (prods || []).map((p) => ({ name: p.name, stock: p.quantity, unidad: "u", precio: p.unit_price })),
        por_peso: (wps || []).map((p) => ({ name: p.name, stock: p.stock, unidad: "kg", precio: p.price_kg })),
      };
    }

    if (name === "get_expiring_products") {
      const days = Number(args.days || 14);
      const limit = new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("product_batches")
        .select("product_uuid, product_source, quantity, expiry_date")
        .eq("is_deleted", 0)
        .not("expiry_date", "is", null)
        .lte("expiry_date", limit)
        .order("expiry_date", { ascending: true });
      if (error) return { error: error.message };
      const list = data || [];
      const uuids = [...new Set(list.map((b) => b.product_uuid))];
      const [{ data: prods }, { data: wps }] = await Promise.all([
        supabase.from("products").select("uuid, name").in("uuid", uuids),
        supabase.from("weighted_products").select("uuid, name").in("uuid", uuids),
      ]);
      const nameOf = (uuid) => (prods?.find((p) => p.uuid === uuid) || wps?.find((p) => p.uuid === uuid))?.name || "—";
      const items = list.slice(0, 20).map((b) => ({
        producto: nameOf(b.product_uuid),
        cantidad: b.quantity,
        vence: b.expiry_date,
      }));
      return { items, total: list.length };
    }

    if (name === "get_inventory_value") {
      const [{ data: prods }, { data: wps }] = await Promise.all([
        supabase.from("products").select("cost_price, unit_price, quantity").eq("is_deleted", 0),
        supabase.from("weighted_products").select("cost_price_kg, price_kg, stock").eq("is_deleted", 0),
      ]);
      const costo =
        (prods || []).reduce((a, p) => a + Number(p.cost_price || 0) * Number(p.quantity || 0), 0) +
        (wps || []).reduce((a, w) => a + Number(w.cost_price_kg || 0) * Number(w.stock || 0), 0);
      const venta =
        (prods || []).reduce((a, p) => a + Number(p.unit_price || 0) * Number(p.quantity || 0), 0) +
        (wps || []).reduce((a, w) => a + Number(w.price_kg || 0) * Number(w.stock || 0), 0);
      return { valor_al_costo: costo, valor_al_precio_venta: venta, ganancia_potencial: venta - costo };
    }

    return { error: `Herramienta desconocida: ${name}` };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Falta GEMINI_API_KEY en las variables de entorno de Vercel." });
  }

  try {
    const { message, history = [], supabase_token } = req.body || {};
    if (!message?.trim()) {
      return res.status(400).json({ error: "Falta el mensaje." });
    }

    const supabase = makeSupabase(supabase_token);
    const ai = new GoogleGenAI({ apiKey });

    // Historial -> formato de contenidos de Gemini
    const contents = [];
    for (const m of history.slice(-10)) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    // Loop: llamar a Gemini, si pide tools ejecutarlas y volver a preguntar.
    let finalText = "";
    for (let step = 0; step < 6; step++) {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION, tools },
      });

      const cand = response?.candidates?.[0];
      const parts = cand?.content?.parts || [];
      const fnCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      if (fnCalls.length === 0) {
        finalText = response.text || parts.map((p) => p.text || "").join("").trim();
        break;
      }

      // Agregar el turno del modelo (con las llamadas a funciones) al historial
      contents.push({ role: "model", parts });

      // Ejecutar cada tool y armar el turno de respuesta
      const toolResponseParts = [];
      for (const call of fnCalls) {
        const result = await runTool(call.name, call.args || {}, supabase);
        toolResponseParts.push({
          functionResponse: { name: call.name, response: result },
        });
      }
      contents.push({ role: "user", parts: toolResponseParts });
    }

    if (!finalText) {
      finalText = "No pude generar una respuesta. Probá reformulando la pregunta.";
    }

    return res.status(200).json({ reply: finalText });
  } catch (e) {
    console.error("chat error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
