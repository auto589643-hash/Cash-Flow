import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-cashflow-backend": "supabase-v5.0" }
});

const clean = (v: unknown, max = 500) => String(v ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max);
const activeStatuses = new Set(["Pending", "Approved", "Waitlist"]);
const allowedAges = new Set(["ต่ำกว่า 15", "15–18", "19–22", "23 ปีขึ้นไป"]);
const allowedMoneyStyles = new Set(["เก็บก่อน", "ใช้ตามเป้าหมาย", "มองหาโอกาส", "แล้วแต่สถานการณ์"]);
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const a = crypto.getRandomValues(new Uint8Array(32));
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
}

function normalizeThaiPhone(v: unknown) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("0066")) d = "0" + d.slice(4);
  else if (d.startsWith("66") && d.length >= 11) d = "0" + d.slice(2);
  return d.slice(0, 10);
}

function getClientIp(req: Request) {
  return clean(req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown", 100);
}

async function settingText(key: string, fallback = "") {
  const { data, error } = await db.from("cashflow_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  const v = data?.value;
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

async function activeRoundCode() {
  return clean(await settingText("active_round_code", "cashflow-01"), 60) || "cashflow-01";
}

async function resolveRound(code?: string) {
  const requested = clean(code, 60);
  if (requested) {
    const { data, error } = await db.from("cashflow_rounds").select("*").eq("round_code", requested).maybeSingle();
    if (error) throw error;
    return data;
  }
  const active = await activeRoundCode();
  const { data: configured, error: configuredError } = await db.from("cashflow_rounds").select("*").eq("round_code", active).maybeSingle();
  if (configuredError) throw configuredError;
  if (configured) return configured;
  const { data: open, error: openError } = await db.from("cashflow_rounds").select("*").eq("status", "Open").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (openError) throw openError;
  if (open) return open;
  const { data: anyRound, error: anyError } = await db.from("cashflow_rounds").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (anyError) throw anyError;
  return anyRound;
}

function mapRound(r: any, activeCode?: string) {
  if (!r) return r;
  const startTime = typeof r.start_time === "string" ? r.start_time.slice(0, 5) : r.start_time;
  const endTime = typeof r.end_time === "string" ? r.end_time.slice(0, 5) : r.end_time;
  return {
    ...r,
    start_time: startTime,
    end_time: endTime,
    round_id: r.id,
    is_public_active: activeCode ? r.round_code === activeCode : undefined
  };
}

function publicRegistration(r: any) {
  if (!r) return r;
  return {
    registration_id: r.id,
    status: r.status,
    reference_code: r.reference_code,
    submitted_at: r.submitted_at,
    checked_in_at: r.checked_in_at,
    submission_email_status: r.submission_email_status,
    approval_email_status: r.approval_email_status
  };
}

function deliveryStatus(v: unknown) {
  const s = String(v || "").toLowerCase();
  if (s === "sent") return "Sent";
  if (s === "queued" || s === "pending") return "Pending";
  if (s === "processing") return "Sending";
  if (s === "failed") return "Failed";
  if (s === "cancelled") return "Cancelled";
  return "NotQueued";
}

function mapAdminRegistration(r: any, all: any[]) {
  const duplicateCount = all.filter(x =>
    x.id !== r.id &&
    x.round_id === r.round_id &&
    (x.phone === r.phone || String(x.email || "").toLowerCase() === String(r.email || "").toLowerCase())
  ).length;
  const useApproval = r.status === "Approved" || !!r.approval_email_sent_at || ["queued", "sent", "failed"].includes(String(r.approval_email_status || "").toLowerCase());
  return {
    ...r,
    registration_id: r.id,
    duplicate_contact_count: duplicateCount,
    email_delivery: { status: deliveryStatus(useApproval ? r.approval_email_status : r.submission_email_status) }
  };
}

async function publicRound(code?: string) {
  const round = await resolveRound(code);
  if (!round) throw new Error("round_not_found");
  const { count, error } = await db.from("cashflow_registrations").select("id", { count: "exact", head: true }).eq("round_id", round.id).eq("status", "Approved");
  if (error) throw error;
  const approved = count || 0;
  const cap = Number(round.approval_capacity || 0);
  const full = round.status === "Open" && !!round.capacity_enabled && cap > 0 && approved >= cap;
  return {
    round: {
      ...mapRound(round, await activeRoundCode()),
      stored_status: round.status,
      status: full ? "Full" : round.status,
      approved_count: approved,
      remaining_seats: round.capacity_enabled && cap ? Math.max(0, cap - approved) : null,
      registration_mode: full ? "waitlist" : "standard"
    }
  };
}

async function registrationStatus(body: any) {
  const manageToken = clean(body.manageToken, 80);
  let reg: any = null;
  let round: any = null;

  if (manageToken) {
    if (!uuidRe.test(manageToken)) throw new Error("invalid_manage_token");
    const { data, error } = await db.from("cashflow_registrations").select("*").eq("manage_token", manageToken).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("invalid_manage_token");
    reg = data;
    const { data: rd, error: rdErr } = await db.from("cashflow_rounds").select("*").eq("id", reg.round_id).maybeSingle();
    if (rdErr) throw rdErr;
    round = rd;
    const requested = clean(body.roundCode, 60);
    if (requested && round?.round_code !== requested) throw new Error("registration_not_found");
  } else {
    const phone = normalizeThaiPhone(body.phone);
    const email = clean(body.email, 254).toLowerCase();
    if (!/^0[689]\d{8}$/.test(phone)) throw new Error("invalid_phone");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
    round = await resolveRound(clean(body.roundCode, 60));
    if (!round) throw new Error("round_not_found");
    const { data, error } = await db.from("cashflow_registrations")
      .select("*")
      .eq("round_id", round.id)
      .eq("phone", phone)
      .ilike("email", email)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    reg = data;
  }

  if (!reg) return { found: false };
  const canCancel = activeStatuses.has(reg.status) && !reg.checked_in_at;
  const canReapply = ["Rejected", "Cancelled"].includes(reg.status);
  return { found: true, registration: publicRegistration(reg), can_cancel: canCancel, can_reapply: canReapply };
}

async function register(body: any) {
  const d = body.data || {};
  const required = ["full_name", "nickname", "age_range", "phone", "email"];
  if (required.some(k => !clean(d[k], k === "email" ? 254 : 120))) throw new Error("missing_required_fields");

  const email = clean(d.email, 254).toLowerCase();
  const phone = normalizeThaiPhone(d.phone);
  const ageRange = clean(d.age_range, 40);
  const moneyStyle = clean(d.money_style, 80);

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_email");
  if (!/^0[689]\d{8}$/.test(phone)) throw new Error("invalid_phone");
  if (!allowedAges.has(ageRange)) throw new Error("invalid_age_range");
  if (moneyStyle && !allowedMoneyStyles.has(moneyStyle)) throw new Error("invalid_money_style");

  const round = await resolveRound(clean(body.roundCode, 60));
  if (!round) throw new Error("round_not_found");

  const clientRequestId = clean(body.clientRequestId, 120) || crypto.randomUUID();
  const { data, error } = await db.rpc("cashflow_register_v2", {
    p_round_code: round.round_code,
    p_client_request_id: clientRequestId,
    p_full_name: clean(d.full_name, 100),
    p_nickname: clean(d.nickname, 40),
    p_age_range: ageRange,
    p_phone: phone,
    p_email: email,
    p_money_style: moneyStyle,
    p_money_goal: clean(d.money_goal, 500)
  });
  if (error) throw error;
  const out = data || {};
  return { ...out, registration: publicRegistration(out.registration) };
}

async function sendManageLink(body: any) {
  const status = await registrationStatus(body);
  if (!status.found || !status.can_cancel) throw new Error("registration_not_found");

  const phone = normalizeThaiPhone(body.phone);
  const email = clean(body.email, 254).toLowerCase();
  const round = await resolveRound(clean(body.roundCode, 60));
  if (!round) throw new Error("round_not_found");

  const { data: reg, error } = await db.from("cashflow_registrations")
    .select("*")
    .eq("round_id", round.id)
    .eq("phone", phone)
    .ilike("email", email)
    .in("status", ["Pending", "Approved", "Waitlist"])
    .is("checked_in_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!reg) throw new Error("registration_not_found");

  const { data: queued, error: queuedErr } = await db.from("cashflow_email_outbox")
    .select("id")
    .eq("registration_id", reg.id)
    .eq("email_type", "manage_link")
    .in("status", ["pending", "processing"])
    .limit(1);
  if (queuedErr) throw queuedErr;

  if (!queued?.length) {
    const { error: insertErr } = await db.from("cashflow_email_outbox").insert({
      email_type: "manage_link",
      registration_id: reg.id,
      to_email: reg.email,
      status: "pending",
      provider: "gmail"
    });
    if (insertErr) throw insertErr;
  }

  await db.from("cashflow_audit_logs").insert({
    actor: "participant",
    action: "manage_link_requested",
    round_id: reg.round_id,
    registration_id: reg.id,
    detail: { backend: "supabase_v5" }
  });

  return { queued: true };
}

async function cancelRegistration(body: any) {
  const manageToken = clean(body.manageToken, 80);
  if (!uuidRe.test(manageToken)) throw new Error("invalid_manage_token");
  const { data, error } = await db.rpc("cashflow_cancel_registration_v2", {
    p_manage_token: manageToken,
    p_round_code: clean(body.roundCode, 60) || null
  });
  if (error) throw error;
  const reg = data?.registration;
  return { found: true, registration: publicRegistration(reg), can_cancel: false, can_reapply: true, email_queued: !!data?.email_queued };
}

async function requireAdmin(t?: string) {
  if (!t) throw new Error("unauthorized");
  const h = await sha256(t);
  const now = new Date().toISOString();
  const { data, error } = await db.from("cashflow_admin_sessions").select("id").eq("token_hash", h).is("revoked_at", null).gt("expires_at", now).maybeSingle();
  if (error || !data) throw new Error("unauthorized");
  await db.from("cashflow_admin_sessions").update({ last_used_at: now }).eq("id", data.id);
  return data;
}

async function adminLogin(password: string, req: Request) {
  const ipHash = await sha256("cashflow-admin:" + getClientIp(req));
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from("cashflow_admin_login_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("success", false).gte("attempted_at", since);
  if ((count || 0) >= 5) throw new Error("rate_limited");

  const { data: cred, error } = await db.from("cashflow_admin_credentials").select("password_salt,password_hash,enabled").eq("enabled", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error || !cred) throw new Error("admin_not_configured");

  const ok = await sha256(cred.password_salt + ":" + String(password || "")) === cred.password_hash;
  await db.from("cashflow_admin_login_attempts").insert({ ip_hash: ipHash, success: ok });
  if (!ok) throw new Error("unauthorized");

  const t = newToken();
  const th = await sha256(t);
  const rawMinutes = Number(await settingText("admin_session_minutes", "360"));
  const minutes = Math.min(720, Math.max(5, Number.isFinite(rawMinutes) ? rawMinutes : 360));
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();

  await db.from("cashflow_admin_sessions").delete().lt("expires_at", new Date(Date.now() - 7 * 86400_000).toISOString());
  await db.from("cashflow_admin_login_attempts").delete().lt("attempted_at", new Date(Date.now() - 2 * 86400_000).toISOString());
  const { error: sessionError } = await db.from("cashflow_admin_sessions").insert({
    token_hash: th,
    expires_at: expiresAt,
    last_used_at: new Date().toISOString(),
    metadata: { source: "cashflow_edge_v5" }
  });
  if (sessionError) throw sessionError;
  return { token: t, expires_at: expiresAt };
}

async function adminLogout(t?: string) {
  if (t) {
    const h = await sha256(t);
    await db.from("cashflow_admin_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", h);
  }
  return { logged_out: true };
}

async function listRoundsForAdmin() {
  const active = await activeRoundCode();
  const { data, error } = await db.from("cashflow_rounds").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(r => mapRound(r, active));
}

async function dashboard(roundCode?: string) {
  const round = await resolveRound(clean(roundCode, 60));
  if (!round) throw new Error("round_not_found");
  const { data, error } = await db.from("cashflow_registrations").select("*").eq("round_id", round.id).order("submitted_at", { ascending: false });
  if (error) throw error;
  const raw = data || [];
  const regs = raw.map(r => mapAdminRegistration(r, raw));
  const approved = raw.filter(r => r.status === "Approved").length;
  const cap = Number(round.approval_capacity || 0);
  const enabled = !!round.capacity_enabled;
  const stats = {
    total: raw.length,
    pending: raw.filter(r => r.status === "Pending").length,
    approved,
    waitlist: raw.filter(r => r.status === "Waitlist").length,
    rejected: raw.filter(r => r.status === "Rejected").length,
    cancelled: raw.filter(r => r.status === "Cancelled").length,
    checked_in: raw.filter(r => !!r.checked_in_at).length,
    capacity_enabled: enabled,
    approval_capacity: enabled ? cap : null,
    remaining_seats: enabled && cap ? Math.max(0, cap - approved) : null
  };
  return { round: mapRound(round, await activeRoundCode()), stats, registrations: regs };
}

async function adminBootstrap(roundCode?: string) {
  const [dash, rounds] = await Promise.all([dashboard(roundCode), listRoundsForAdmin()]);
  return { ...dash, rounds };
}

async function updateRegistrationStatus(body: any) {
  if (!uuidRe.test(clean(body.registrationId, 80))) throw new Error("registration_not_found");
  const { data, error } = await db.rpc("cashflow_apply_registration_status_v2", {
    p_registration_id: body.registrationId,
    p_status: clean(body.status, 30),
    p_note: clean(body.note, 300)
  });
  if (error) throw error;
  return { registration: mapAdminRegistration(data?.registration, [data?.registration].filter(Boolean)), email_queued: !!data?.email_queued };
}

async function setActiveRound(code: string) {
  const roundCode = clean(code, 60);
  const round = await resolveRound(roundCode);
  if (!round || round.round_code !== roundCode) throw new Error("round_not_found");
  const { error } = await db.from("cashflow_settings").upsert({
    key: "active_round_code",
    value: roundCode,
    description: "Public default round code for CA$HFLOW participant page",
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });
  if (error) throw error;
  await db.from("cashflow_audit_logs").insert({
    actor: "admin",
    action: "set_public_round",
    round_id: round.id,
    detail: { round_code: roundCode, backend: "supabase_v5" }
  });
  return { round: mapRound(round, roundCode), active_round_code: roundCode };
}

async function saveRound(input: any) {
  const r = input || {};
  const code = clean(r.round_code, 60);
  const title = clean(r.title, 120);
  if (!code || !title) throw new Error("missing_round_fields");

  const payload = {
    round_code: code,
    title,
    event_date: r.event_date || null,
    event_date_label: clean(r.event_date_label, 80) || null,
    start_time: r.start_time || null,
    end_time: r.end_time || null,
    location_name: clean(r.location_name, 160) || null,
    location_url: clean(r.location_url, 500) || null,
    status: ["Draft", "Open", "Closed", "Completed", "Cancelled"].includes(r.status) ? r.status : "Draft",
    capacity_enabled: !!r.capacity_enabled,
    approval_capacity: Math.max(1, Number(r.approval_capacity || 30)),
    public_seat_display: clean(r.public_seat_display, 80) || "จำนวนจำกัด",
    updated_at: new Date().toISOString()
  };

  const id = clean(r.round_id, 80);
  const query = id && uuidRe.test(id)
    ? db.from("cashflow_rounds").update(payload).eq("id", id).select("*").single()
    : db.from("cashflow_rounds").insert(payload).select("*").single();
  const { data, error } = await query;
  if (error) throw error;
  return { round: mapRound(data, await activeRoundCode()) };
}

async function checkinSearch(body: any) {
  const d = await dashboard(clean(body.roundCode, 60));
  const raw = clean(body.query, 150).toLowerCase();
  const digits = raw.replace(/\D/g, "");
  return {
    matches: d.registrations.filter((r: any) =>
      r.status === "Approved" &&
      (
        [r.full_name, r.nickname, r.phone, r.reference_code].some(v => String(v || "").toLowerCase().includes(raw)) ||
        (digits.length >= 4 && String(r.phone || "").replace(/\D/g, "").includes(digits))
      )
    ).slice(0, 10)
  };
}

async function checkIn(body: any) {
  const registrationId = clean(body.registrationId, 80);
  const qrToken = clean(body.qrToken, 80);
  const { data, error } = await db.rpc("cashflow_check_in_v2", {
    p_registration_id: registrationId && uuidRe.test(registrationId) ? registrationId : null,
    p_qr_token: qrToken && uuidRe.test(qrToken) ? qrToken : null,
    p_round_code: clean(body.roundCode, 60) || null
  });
  if (error) throw error;
  return {
    registration: mapAdminRegistration(data?.registration, [data?.registration].filter(Boolean)),
    already_checked_in: !!data?.already_checked_in
  };
}

function friendly(err: any) {
  const raw = String(err?.message || err || "request_failed");
  const m = raw.replace(/^PGRST\d+:\s*/, "").replace(/^.*?:\s*(?=[a-z_]+$)/, "");
  const messages: Record<string, string> = {
    unauthorized: "รหัสผู้ดูแลไม่ถูกต้องหรือ Session หมดอายุ",
    rate_limited: "ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอประมาณ 15 นาทีแล้วลองใหม่",
    admin_not_configured: "ยังไม่ได้ตั้งค่ารหัสผู้ดูแล",
    round_not_found: "ไม่พบรอบกิจกรรม",
    round_closed: "รอบนี้ปิดรับสมัครแล้ว",
    missing_required_fields: "กรอกข้อมูลที่จำเป็นไม่ครบ",
    invalid_email: "Email ไม่ถูกต้อง",
    invalid_phone: "เบอร์มือถือไทยต้องมี 10 หลัก และขึ้นต้น 06, 08 หรือ 09",
    invalid_age_range: "ช่วงอายุไม่ถูกต้อง",
    invalid_money_style: "ตัวเลือกสไตล์การเงินไม่ถูกต้อง",
    registration_not_found: "ไม่พบผู้สมัคร",
    contact_conflict: "เบอร์มือถือหรือ Email นี้มีใบสมัครที่ยังใช้งานอยู่ในรอบนี้แล้ว กรุณาเช็กสถานะใบสมัครเดิม",
    invalid_manage_token: "ลิงก์จัดการใบสมัครไม่ถูกต้อง",
    checked_in_locked: "ผู้สมัคร Check-in แล้ว จึงไม่สามารถเปลี่ยนสถานะหรือยกเลิกได้",
    capacity_full: "จำนวนที่อนุมัติเต็มแล้ว",
    invalid_status: "สถานะไม่ถูกต้อง",
    not_approved: "ผู้สมัครยังไม่ได้รับการอนุมัติ",
    missing_round_fields: "กรอก Round code และชื่อรอบ"
  };
  return messages[m] || messages[raw] || raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  const u = new URL(req.url);
  try {
    if (req.method === "GET") {
      const action = u.searchParams.get("action") || "health";
      if (action === "health") return json({ ok: true, backend: "supabase", version: "5.0", feature_parity: true, mail_pipeline: "supabase->gmail" });
      if (action === "publicRound") return json({ ok: true, ...(await publicRound(u.searchParams.get("roundCode") || undefined)) });
      return json({ ok: false, error: "unknown_action" }, 404);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const body = await req.json();
    const action = body.action;
    let out: any;

    if (action === "register") out = await register(body);
    else if (action === "registrationStatus") out = await registrationStatus(body);
    else if (action === "cancelRegistration") out = await cancelRegistration(body);
    else if (action === "sendManageLink") out = await sendManageLink(body);
    else if (action === "adminLogin") out = await adminLogin(body.password, req);
    else if (action === "adminLogout") out = await adminLogout(body.token);
    else {
      await requireAdmin(body.token);
      if (action === "adminBootstrap") out = await adminBootstrap(body.roundCode);
      else if (action === "adminDashboard") out = await dashboard(body.roundCode);
      else if (action === "listRounds") out = { rounds: await listRoundsForAdmin() };
      else if (action === "setActiveRound") out = await setActiveRound(body.roundCode);
      else if (action === "updateRegistrationStatus") out = await updateRegistrationStatus(body);
      else if (action === "saveRound") out = await saveRound(body.round);
      else if (action === "checkinSearch") out = await checkinSearch(body);
      else if (action === "checkIn") out = await checkIn(body);
      else throw new Error("unknown_action");
    }

    return json({ ok: true, ...out });
  } catch (e) {
    const raw = String((e as any)?.message || e);
    const status = raw.includes("unauthorized") ? 401 : raw.includes("rate_limited") ? 429 : 400;
    return json({ ok: false, error: raw, message: friendly(e) }, status);
  }
});