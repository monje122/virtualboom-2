/* =========================
   Bingo Virtual - JS (con precio editable y Bs)
   ========================= */

let selectedCartons = [];
let occupiedCartons = new Set();
let inscriptions = [];
let total = 0;

// ---- Config dinámica ----
let PRICE = 5;                 // fallback si no hay config en BD
let SALES_OPEN = true;         // por si luego quieres cerrar ventas
const CURRENCY = 'Bs';

// flags anti doble envío
let isSaving = false;
let alreadyOpenedWA = false;

// --- Supabase ---
const SUPABASE_URL = 'https://avycdfdbprllrqgzwkwe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2eWNkZmRicHJsbHJxZ3p3a3dlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NzAwMjEsImV4cCI6MjA3NTM0NjAyMX0.ydsK-epIo7wQBT3H44u2eJVqJFVhUtNOTRQQ8nQTCg4';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- Helpers de fecha ---------- */
function todayISO(){ return new Date().toISOString().slice(0,10); } // YYYY-MM-DD
function prettyFromISO(iso){
  const [y,m,d] = iso.split('-').map(Number);
  const date = new Date(y, m-1, d);
  return `${d} ${date.toLocaleString('default',{month:'long'})}`;
}

/* ---------- Config desde BD (key/value) ---------- */
async function loadConfig() {
  const { data, error } = await supabase
    .from('config')
    .select('key,value')
    .in('key', ['precio_ticket','ventas_abiertas']);
  if (!error && Array.isArray(data)) {
    const map = Object.fromEntries(data.map(r => [r.key, r.value]));
    PRICE = Number(map['precio_ticket'] ?? PRICE);
    SALES_OPEN = (map['ventas_abiertas'] ?? SALES_OPEN) === true;
    applySalesStateToUI();
  }
  // recalcular total por si cambió el precio
  total = selectedCartons.length * PRICE;
  renderTotals();
}

/* ---------- Cargar día ---------- */
function setCurrentDay(){
  const sel = document.getElementById("day-select");
  if (!sel) return;
  sel.innerHTML = '';
  const iso = todayISO();
  const opt = document.createElement("option");
  opt.value = iso;                         // para BD
  opt.textContent = prettyFromISO(iso);    // para el usuario
  sel.appendChild(opt);
}

/* ---------- Traer ocupados para el día seleccionado (RPC) ---------- */
async function fetchOccupiedCartons(){
  const sel = document.getElementById("day-select");
  const isoDay = sel?.value ?? todayISO();
  const { data, error } = await supabase.rpc('get_occupied_cartons_by_day', { p_day: isoDay });
  if (error){
    console.error("Error al obtener cartones ocupados:", error.message);
    occupiedCartons = new Set();
  } else {
    occupiedCartons = new Set(data || []);
  }
  generateCartons();
}

/* ---------- Boot ---------- */
window.onload = function (){
  setCurrentDay();
  loadConfig();               // <--- lee precio/estado
  fetchOccupiedCartons();
  supabase
    .channel('inscripciones-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inscripciones' }, () => fetchOccupiedCartons())
    .subscribe();
};

/* ---------- Navegación ---------- */
function showInscription(){
  hideAll();
  document.getElementById("inscription-window")?.classList.remove("hidden");
}
function hideAll(){ document.querySelectorAll("body > div").forEach(d => d.classList.add("hidden")); }

/* =========================================================
   MODAL de cartones
   ========================================================= */
function openCartonsModal(){
  if (!SALES_OPEN){
  alert('Las ventas están cerradas temporalmente.');
  return;
}

  setCurrentDay();
  fetchOccupiedCartons();
  document.body.classList.add('modal-open');
  document.getElementById('cartons-modal')?.classList.add('open');
  updateNextState();
}
function closeCartonsModal(){
  document.body.classList.remove('modal-open');
  document.getElementById('cartons-modal')?.classList.remove('open');
}
document.addEventListener('keydown', e=>{
  if (e.key==='Escape' && document.getElementById('cartons-modal')?.classList.contains('open')) closeCartonsModal();
});

/* ---------- Cartones ---------- */
function generateCartons(){
  const container = document.getElementById("cartons-container");
  if (!container) return;
  container.innerHTML = "";
  for (let i=1; i<=4000; i++){
    const div = document.createElement("div");
    div.className = "carton";
    div.textContent = i;
    if (occupiedCartons.has(i)){
      div.classList.add("occupied");
    } else {
      div.onclick = () => toggleCarton(i, div);
    }
    container.appendChild(div);
  }
  updateNextState();
}

function toggleCarton(num, el){
  const idx = selectedCartons.indexOf(num);
  if (idx >= 0){
    selectedCartons.splice(idx, 1);
    el.classList.remove("selected");
  } else {
    selectedCartons.push(num);
    el.classList.add("selected");
  }
  total = selectedCartons.length * PRICE;   // <= usa precio actual
  updateNextState();
  renderTotals();
}

/* Habilita “Siguiente” solo si hay selección */
function updateNextState(){
  const btn = document.getElementById('btn-next');
  if (btn) btn.disabled = selectedCartons.length === 0;
}

/* Continuar a pago */
function goToPayment(){
  if (selectedCartons.length === 0){
    alert('Debes seleccionar al menos un cartón.');
    return;
  }
  closeCartonsModal();
  hideAll();
  document.getElementById('payment-window')?.classList.remove('hidden');
  renderTotals();
}

/* ============== Validación Inscripción (nombre/teléfono) ============== */
const nextBtn = document.getElementById('btn-insc-next');
['name', 'phone'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    if (id === 'phone') el.value = el.value.replace(/[^\d+\-\s()]/g, '');
    validateInscriptionFields();
  });
});

function validateInscriptionFields(){
  const name  = (document.getElementById('name')?.value || '').trim();
  const phone = (document.getElementById('phone')?.value || '').replace(/\D/g, '');
  const okName  = name.length >= 2;
  const okPhone = phone.length >= 10; // cambia a 11 si lo prefieres

  toggleInvalid('name',  !okName);
  toggleInvalid('phone', !okPhone);

  const valid = okName && okPhone;
  if (nextBtn) nextBtn.disabled = !valid;
  return valid;
}
function toggleInvalid(id, invalid){
  const el = document.getElementById(id);
  if (el) el.classList.toggle('invalid', invalid);
}

/* Ir a cartones (validado) */
function goToCartons(){
  if (!SALES_OPEN){
  alert('Las ventas están cerradas temporalmente.');
  return;
}

  if (!validateInscriptionFields()){
    alert('Por favor completa Nombre y Teléfono para continuar.');
    return;
  }
  if (document.getElementById('cartons-modal')){
    openCartonsModal();
  } else {
    hideAll();
    document.getElementById('cartons-window')?.classList.remove('hidden');
    generateCartons();
  }
}

/* ============== Admin ============== */
async function showProofs(){
  const proofsContainer = document.getElementById("proofs-container");
  if (!proofsContainer) return;
  proofsContainer.innerHTML = "<h3>Comprobantes:</h3>";
  const { data, error } = await supabase.from('inscripciones').select('*').order('id', { ascending: false });
  if (error){
    console.error("Error al obtener inscripciones:", error.message);
    proofsContainer.innerHTML += "<p>Error cargando comprobantes.</p>";
    return;
  }
  data.forEach((inscription, index) => {
    const cartones = Array.isArray(inscription.cartons) ? inscription.cartons : [];
    const cantidad = cartones.length;
    const listaFormateada = formatCartons(cartones);
    const fecha = inscription.event_day || inscription.day || '';
    const div = document.createElement("div");
    div.className = "proof-card";
    div.innerHTML = `
      <p class="proof-title">
        <strong>${index + 1}. ${inscription.name}</strong> — ${inscription.phone}
        ${fecha ? `<span class="meta">• ${fecha}</span>` : ''}
      </p>
      <p class="meta"><strong>Cartones (${cantidad}):</strong> ${listaFormateada || '<em>Sin cartones</em>'}</p>
      <p class="meta"><strong>Total:</strong> ${CURRENCY} ${(inscription.total ?? 0).toFixed(2)}</p>
      ${inscription.proof_url ? `<img src="${inscription.proof_url}" alt="Comprobante" onclick="viewImage('${inscription.proof_url}')" />` : ''}
    `;
    proofsContainer.appendChild(div);
  });
}

async function fetchClientCount() {
  const { count, error } = await supabase
    .from('inscripciones')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error("Error obteniendo el conteo de clientes:", error.message);
    return;
  }
  const el = document.getElementById("clients-count");
  if (el) el.textContent = count;
}

/* ===== Config Admin: abrir y guardar (precio/ventas) ===== */
async function openConfigInAdmin() {
  await loadConfig(); // precarga valores actuales
  const priceEl = document.getElementById('cfg-price');
  const openEl  = document.getElementById('cfg-open');
  if (priceEl) priceEl.value = PRICE.toString();
  if (openEl)  openEl.checked = SALES_OPEN;
}
async function saveConfig() {
  const price = parseFloat(document.getElementById('cfg-price').value);
  const open  = document.getElementById('cfg-open').checked;

  if (Number.isNaN(price) || price < 0) {
    alert('Precio inválido');
    return;
  }
  const { error } = await supabase
    .from('config')
    .upsert([
      { key: 'precio_ticket',   value: price },
      { key: 'ventas_abiertas', value: open }
    ], { onConflict: 'key' });

  if (error) { alert('No se pudo guardar: ' + error.message); return; }

  PRICE = price;
  SALES_OPEN = open;
  total = selectedCartons.length * PRICE;
  renderTotals();
  alert('Configuración actualizada.');
}

/* ============== Guardar inscripción (RPC anti-duplicados) ============== */
async function saveInscription(){
  if (!validateInscriptionFields()){
    alert('Completa Nombre y Teléfono antes de guardar.');
    return;
  }
  if (isSaving) return; // anti doble click
  isSaving = true;

  const btn = document.getElementById('whatsapp-btn');
  if (btn){ btn.disabled = true; btn.dataset.text = btn.innerText; btn.innerText = 'Enviando...'; }

  try{
    const name = document.getElementById("name").value;
    const phone = document.getElementById("phone").value;
    const ref   = document.getElementById("referrer") ? document.getElementById("referrer").value : '';

    const proofFile = document.getElementById("proof").files[0];
    if (!proofFile) throw new Error("Debes subir un comprobante.");

    const isoDay = document.getElementById("day-select").value;

    // 1) Subir imagen
    const fileName = `${Date.now()}_${proofFile.name}`;
    const { error: uploadError } = await supabase.storage.from('comprobantes').upload(fileName, proofFile);
    if (uploadError) throw uploadError;

    // 2) URL pública
    const { data: publicUrlData } = supabase.storage.from('comprobantes').getPublicUrl(fileName);
    const proofURL = publicUrlData.publicUrl;

    // 3) Reservar + crear inscripción
    const { error: reserveErr } = await supabase.rpc('reserve_and_create_inscription', {
      p_name: name,
      p_phone: phone,
      p_referrer: ref,
      p_total: total,
      p_proof_url: proofURL,
      p_cartons: selectedCartons,
      p_event_day: isoDay
    });
    if (reserveErr){
      if (reserveErr.code === '23505' || /ocupados/i.test(reserveErr.message)){
        alert("Ups, alguien tomó uno de esos cartones al mismo tiempo 😬. Elige otros.");
        await fetchOccupiedCartons();
      } else {
        throw reserveErr;
      }
      return;
    }

    alert("Inscripción guardada exitosamente.");
    occupiedCartons = new Set([...occupiedCartons, ...selectedCartons]);
    inscriptions.push({ name, phone, ref, cartons: [...selectedCartons], total, proofURL, event_day: isoDay });

    sendToWhatsApp();
    goHome();

  } catch(err){
    console.error("Error en el guardado:", err);
    alert(err.message || "Ocurrió un error. Vuelve a intentar.");
    const b = document.getElementById('whatsapp-btn');
    if (b){ b.disabled = false; b.innerText = b.dataset.text || 'Enviar por WhatsApp'; }
    isSaving = false;
    alreadyOpenedWA = false;
  }
}

/* ---------- Utilidades ---------- */
function viewImage(url){
  const win = window.open();
  win.document.write(`<img src="${url}" style="width:100%">`);
}
function renderTotals(){
  const totalEl = document.getElementById("total");
  if (totalEl) totalEl.textContent = `${CURRENCY} ${total.toFixed(2)}`;
  const finalEl = document.getElementById("final-amount");
  if (finalEl) finalEl.textContent = `${CURRENCY} ${total.toFixed(2)}`;
}
function goHome(){
  hideAll();
  document.getElementById("main-container")?.classList.remove("hidden");
  document.getElementById("form")?.reset();
  selectedCartons = [];
  total = 0;
  renderTotals();
  const btn = document.getElementById('whatsapp-btn');
  if (btn){ btn.disabled = false; btn.innerText = btn.dataset.text || 'Enviar por WhatsApp'; }
  isSaving = false;
  alreadyOpenedWA = false;
}

/* ---------- Auth Admin ---------- */
async function showAdmin(){
  hideAll();
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session) showAdminPanel();
  else document.getElementById("admin-window")?.classList.remove("hidden");
}
function showAdminPanel(){
  hideAll();
  document.getElementById("admin-panel-window")?.classList.remove("hidden");
  const soldEl = document.getElementById("sold-count");
  if (soldEl) soldEl.textContent = 0;
  fetchClientCount();
  showProofs();
  openConfigInAdmin();    // <--- precarga precio/estado en el panel
}
async function loginAdmin(){
  const email = document.getElementById("admin-email").value;
  const password = document.getElementById("admin-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){ alert("Acceso denegado: " + error.message); return; }
  alert("Bienvenido, Admin");
  showAdminPanel();
}
async function logout(){
  await supabase.auth.signOut();
  alert("Sesión cerrada");
  hideAll();
  document.getElementById("admin-window")?.classList.remove("hidden");
}

/* ---------- WhatsApp (Bs) ---------- */
function sendToWhatsApp(){
  if (alreadyOpenedWA) return;
  alreadyOpenedWA = true;

  const name = document.getElementById("name").value;
  const phone = document.getElementById("phone").value;
  const ref = document.getElementById("referrer") ? document.getElementById("referrer").value : '';

  const sel = document.getElementById("day-select");
  const iso = sel.value;
  const nice = sel.options[sel.selectedIndex].textContent || prettyFromISO(iso);

  const msg = `*Nueva inscripción de Bingo*\n
*Nombre:* ${name}
*Teléfono:* ${phone}
*Día:* ${nice}
*Cartones:* ${selectedCartons.join(', ')}
*Total:* ${CURRENCY} ${total.toFixed(2)}`;

  const encoded = encodeURIComponent(msg);
  window.open(`https://wa.me/584162226494?text=${encoded}`, "_blank", "noopener");
}

/* ---------- Formatear cartones: 5, 7-9, 12 ---------- */
function formatCartons(arr){
  const a = (arr || []).filter(n => Number.isInteger(n)).sort((x,y)=>x-y);
  const res = [];
  for (let i=0; i<a.length; i++){
    let start=a[i], end=start;
    while (i+1<a.length && a[i+1]===end+1){ end=a[++i]; }
    res.push(start===end ? `${start}` : `${start}-${end}`);
  }
  return res.join(', ');
}

/* ---------- Helpers Storage + Reset ---------- */
function storagePathFromPublicUrl(url){
  const m = /\/object\/public\/([^/]+)\/(.+)$/.exec(url || '');
  return m ? m[2] : null;
}
async function deleteProofsFromDBRows(){
  const { data, error } = await supabase.from('inscripciones').select('proof_url');
  if (error) throw error;
  const paths = (data || []).map(r => storagePathFromPublicUrl(r.proof_url)).filter(Boolean);
  if (!paths.length) return 0;
  const { error: delErr } = await supabase.storage.from('comprobantes').remove(paths);
  if (delErr) throw delErr;
  return paths.length;
}
async function deleteAllFromBucketRoot(bucket = 'comprobantes', deletePlaceholder = false){
  let page = 0, size = 100;
  while (true) {
    const { data: files, error } = await supabase.storage
      .from(bucket)
      .list('', { limit: size, offset: page*size, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    if (!files?.length) break;
    const names = files.map(f => f.name).filter(n => deletePlaceholder ? true : n !== '.emptyFolderPlaceholder');
    if (names.length){
      const { error: delErr } = await supabase.storage.from(bucket).remove(names);
      if (delErr) throw delErr;
    }
    if (files.length < size) break;
    page++;
  }
}
async function resetData(){
  if (!confirm("⚠️ Esto borrará TODO: inscripciones + boletas + comprobantes. ¿Continuar?")) return;
  if (!confirm("Última confirmación: acción irreversible. ¿Borrar definitivamente?")) return;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) { alert("Debes iniciar sesión como administrador."); return; }

  const btns = Array.from(document.querySelectorAll('button'));
  btns.forEach(b => b.disabled = true);

  try {
    await deleteProofsFromDBRows();
    await deleteAllFromBucketRoot('comprobantes', true);
    try { await supabase.from('boletas').delete().neq('id', 0); } catch(_) {}
    const { error: delInsErr } = await supabase.from('inscripciones').delete().neq('id', 0);
    if (delInsErr) throw delInsErr;

    occupiedCartons = new Set();
    selectedCartons = [];
    inscriptions = [];
    total = 0;

    const soldEl = document.getElementById("sold-count");
    if (soldEl) soldEl.textContent = 0;
    const clientsEl = document.getElementById("clients-count");
    if (clientsEl) clientsEl.textContent = 0;
    const proofs = document.getElementById("proofs-container");
    if (proofs) proofs.innerHTML = "<h3>Comprobantes:</h3><p>(Vacío)</p>";

    await fetchOccupiedCartons();
    alert("✅ Todo fue reiniciado correctamente.");
  } catch (err) {
    console.error(err);
    alert("❌ Error al reiniciar: " + (err?.message || err));
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

// Hace visibles las funciones para los onclick del HTML
Object.assign(window, {
  showInscription,
  showAdmin,
  showAdminPanel,
  loginAdmin,
  logout,
  goToCartons,
  openCartonsModal,
  closeCartonsModal,
  generateCartons,
  toggleCarton,
  goToPayment,
  saveInscription,
  resetData,
  openConfigInAdmin,
  saveConfig,
  openSales,
closeSales,
setSales,
});

// Estado en memoria (ya lo tienes):
// let SALES_OPEN = true;

// Refresca etiquetas/UI según estado
function applySalesStateToUI(){
  // badge
  const badge = document.getElementById('sales-badge');
  if (badge){
    if (SALES_OPEN){
      badge.textContent = 'Ventas abiertas';
      badge.classList.remove('closed'); badge.classList.add('open');
    } else {
      badge.textContent = 'Ventas cerradas';
      badge.classList.remove('open');   badge.classList.add('closed');
    }
  }

  // deshabilitar el botón "Siguiente" de inscripción si está cerrada
  const nextBtn = document.getElementById('btn-insc-next');
  if (nextBtn){
    const valid = validateInscriptionFields ? validateInscriptionFields() : true;
    nextBtn.disabled = !SALES_OPEN || !valid;
  }

  // overlay del modal (si lo agregaste)
  const overlay = document.getElementById('sales-closed-overlay');
  if (overlay){
    overlay.style.display = SALES_OPEN ? 'none' : 'flex';
  }
}

// Cambia ventas en BD + estado local
async function setSales(isOpen){
  const { error } = await supabase
    .from('config')
    .upsert([{ key: 'ventas_abiertas', value: isOpen }], { onConflict: 'key' });
  if (error){ alert('No se pudo actualizar el estado de ventas: ' + error.message); return; }

  SALES_OPEN = !!isOpen;
  applySalesStateToUI();
  alert(SALES_OPEN ? '✅ Ventas abiertas' : '⛔ Ventas cerradas');
}

// botones
function openSales(){ setSales(true); }
function closeSales(){ setSales(false); }
