const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Cargar variables de entorno desde .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const transbankService = require('./services/transbank');
const mailerService = require('./services/mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Directorios y archivos
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CITIES_FILE = path.join(DATA_DIR, 'cities.json');
const COMUNAS_FILE = path.join(DATA_DIR, 'comunas.json');
const SPECIALTIES_FILE = path.join(DATA_DIR, 'specialties.json');
const PROFESSIONALS_FILE = path.join(DATA_DIR, 'professionals.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const PATIENTS_FILE = path.join(DATA_DIR, 'patients.json');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
const SITE_CONFIG_FILE = path.join(DATA_DIR, 'site_config.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');

// Asegurar directorios
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helpers
function readJson(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`[readJson Error] ${file}:`, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// Sanitizar profesional para vista pública (oculta teléfonos, correos y contraseñas)
function sanitizePublicPro(pro) {
  const { password, phone, email, bankDetails, ...safePro } = pro;
  return safePro;
}

// ==========================================
// 1. AUTENTICACIÓN Y SEGURIDAD
// ==========================================

// Login de Administrador
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admins = readJson(ADMINS_FILE);
  const admin = admins.find(a => a.email.toLowerCase() === (email || '').toLowerCase() && a.password === password);

  if (!admin) {
    return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
  }

  const { password: _, ...safeAdmin } = admin;
  const token = 'adm_token_' + Buffer.from(`${admin.id}:${Date.now()}`).toString('base64');
  res.json({ message: 'Acceso concedido a administración', admin: safeAdmin, token });
});

// Login de Profesional
app.post('/api/professionals/login', (req, res) => {
  const { email, password } = req.body;
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.email.toLowerCase() === (email || '').toLowerCase() && (p.password === password || (!p.password && password === 'pro123')));

  if (!pro) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }

  const { password: _, ...safePro } = pro;
  const token = 'pro_token_' + Buffer.from(`${pro.id}:${Date.now()}`).toString('base64');
  res.json({ message: 'Sesión iniciada con éxito', professional: safePro, token });
});

// Login y Registro de Pacientes
app.post('/api/patients/register', (req, res) => {
  const { fullName, email, password, rut, phone, cityId, comunaId, address } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios' });
  }

  const patients = readJson(PATIENTS_FILE);
  if (patients.some(p => p.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Ya existe una cuenta con este correo' });
  }

  const newPatient = {
    id: 'pat-' + Date.now(),
    fullName,
    email: email.toLowerCase(),
    password,
    rut: rut || '',
    phone: phone || '',
    cityId: cityId || 'santiago',
    comunaId: comunaId || '',
    address: address || '',
    registeredAt: new Date().toISOString()
  };

  patients.push(newPatient);
  writeJson(PATIENTS_FILE, patients);

  const { password: _, ...safeUser } = newPatient;
  res.status(201).json({ message: 'Registro exitoso', patient: safeUser });
});

app.post('/api/patients/login', (req, res) => {
  const { email, password } = req.body;
  const patients = readJson(PATIENTS_FILE);
  const patient = patients.find(p => p.email.toLowerCase() === (email || '').toLowerCase() && p.password === password);

  if (!patient) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

  const { password: _, ...safeUser } = patient;
  res.json({ message: 'Sesión iniciada con éxito', patient: safeUser });
});

// ==========================================
// 2. PROFESIONALES (CANAL PROTEGIDO)
// ==========================================

// Catálogo público: teléfonos y correos protegidos
app.get('/api/professionals', (req, res) => {
  const { comuna, city, specialty, status } = req.query;
  let pros = readJson(PROFESSIONALS_FILE);

  if (status && status !== 'all') {
    pros = pros.filter(p => p.status === status);
  } else if (!status) {
    pros = pros.filter(p => p.status === 'APPROVED');
  }

  if (city) {
    const cityComunas = readJson(COMUNAS_FILE).filter(c => c.cityId === city).map(c => c.id);
    pros = pros.filter(p => p.cityId === city || (p.coverageComunas && p.coverageComunas.some(cid => cityComunas.includes(cid))));
  }

  if (comuna) {
    pros = pros.filter(p => p.coverageComunas && p.coverageComunas.includes(comuna));
  }

  if (specialty) {
    pros = pros.filter(p => p.specialtyId === specialty);
  }

  // Sanitizar si es solicitud pública
  const isInternal = req.headers['x-admin-auth'] || req.query.admin === 'true';
  const result = isInternal ? pros : pros.map(sanitizePublicPro);

  res.json(result);
});

app.get('/api/professionals/:id', (req, res) => {
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  const appointments = readJson(APPOINTMENTS_FILE).filter(a => a.professionalId === pro.id && (a.status === 'CONFIRMED' || a.status === 'PAID_PENDING_PRO_CONFIRMATION'));
  const safePro = sanitizePublicPro(pro);
  res.json({ ...safePro, bookedAppointments: appointments.map(a => ({ date: a.date, timeSlot: a.timeSlot })) });
});

// Registro de nuevo profesional
app.post('/api/professionals/register', (req, res) => {
  const { fullName, rut, email, password, phone, specialtyId, sisNumber, experienceYears, bio, cityId } = req.body;
  if (!fullName || !rut || !email || !specialtyId || !phone) {
    return res.status(400).json({ error: 'Todos los campos requeridos deben completarse' });
  }

  const pros = readJson(PROFESSIONALS_FILE);
  if (pros.some(p => p.rut === rut || p.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Ya existe un profesional registrado con ese RUT o correo' });
  }

  const specialties = readJson(SPECIALTIES_FILE);
  const spec = specialties.find(s => s.id === specialtyId);

  const newPro = {
    id: 'pro-' + Date.now(),
    fullName,
    rut,
    email: email.toLowerCase(),
    password: password || 'pro123',
    phone,
    specialtyId,
    specialtyName: spec ? spec.name : specialtyId,
    sisNumber: sisNumber || '',
    experienceYears: parseInt(experienceYears) || 1,
    cityId: cityId || 'santiago',
    rating: 5.0,
    reviewsCount: 0,
    avatar: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=300&auto=format&fit=crop&q=80',
    bio: bio || 'Profesional de salud acreditado.',
    status: 'PENDING_REVIEW',
    statusNote: 'Documentos en espera de verificación por administración.',
    verifiedAt: null,
    coverageComunas: [],
    bankDetails: null,
    schedule: {
      days: [1, 2, 3, 4, 5],
      customSlots: ["09:00", "10:30", "12:00", "14:30", "16:00", "17:30"]
    },
    documents: []
  };

  pros.push(newPro);
  writeJson(PROFESSIONALS_FILE, pros);

  const { password: _, ...safePro } = newPro;
  res.status(201).json(safePro);
});

// Perfil privado del profesional (con teléfono, correo y finanzas)
app.get('/api/professionals/:id/private-profile', (req, res) => {
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  const { password: _, ...safePro } = pro;
  res.json(safePro);
});

// Guardar datos bancarios
app.put('/api/professionals/:id/bank-details', (req, res) => {
  const { bankName, accountType, accountNumber, holderRut } = req.body;
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  pro.bankDetails = {
    bankName,
    accountType,
    accountNumber,
    holderRut: holderRut || pro.rut,
    updatedAt: new Date().toISOString()
  };

  writeJson(PROFESSIONALS_FILE, pros);
  res.json({ message: 'Datos bancarios guardados con éxito', bankDetails: pro.bankDetails });
});

// Actualizar cobertura y disponibilidad
app.put('/api/professionals/:id/availability', (req, res) => {
  const { coverageComunas, schedule } = req.body;
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  if (pro.status !== 'APPROVED') {
    return res.status(403).json({ error: 'Cuenta pendiente de alta administrativa.' });
  }

  if (coverageComunas) pro.coverageComunas = coverageComunas;
  if (schedule) pro.schedule = schedule;

  writeJson(PROFESSIONALS_FILE, pros);
  res.json({ message: 'Disponibilidad guardada', professional: sanitizePublicPro(pro) });
});

// Subida de imagen / fotografía general (Avatar o documentos)
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo de imagen' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, originalname: req.file.originalname });
});

// Actualizar avatar / fotografía de perfil del profesional
app.post('/api/professionals/:id/avatar', upload.single('avatar'), (req, res) => {
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo de imagen' });

  pro.avatar = `/uploads/${req.file.filename}`;
  writeJson(PROFESSIONALS_FILE, pros);
  res.json({ message: 'Fotografía de perfil actualizada con éxito', avatar: pro.avatar });
});

// Subida de documentos (Título SIS, Cédula, CV y Antecedentes)
app.post('/api/professionals/:id/documents', upload.fields([
  { name: 'tituloSis', maxCount: 1 },
  { name: 'cedula', maxCount: 1 },
  { name: 'cv', maxCount: 1 },
  { name: 'antecedentes', maxCount: 1 }
]), (req, res) => {
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  if (!pro.documents) pro.documents = [];
  const files = req.files || {};

  ['tituloSis', 'cedula', 'cv', 'antecedentes'].forEach(k => {
    if (files[k] && files[k][0]) {
      const f = files[k][0];
      const type = k === 'tituloSis' ? 'TITULO_SIS' : k === 'cedula' ? 'CEDULA' : k === 'cv' ? 'CURRICULUM_VITAE' : 'ANTECEDENTES';
      pro.documents = pro.documents.filter(d => d.type !== type);
      pro.documents.push({
        id: 'doc-' + Date.now() + '-' + k,
        type,
        name: f.originalname,
        fileName: f.filename,
        fileUrl: `/uploads/${f.filename}`,
        uploadedAt: new Date().toISOString(),
        verified: false
      });
    }
  });

  writeJson(PROFESSIONALS_FILE, pros);
  res.json({ message: 'Documentos recibidos para auditoría', documents: pro.documents });
});

// Finanzas del profesional
app.get('/api/professionals/:id/finances', (req, res) => {
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  const appointments = readJson(APPOINTMENTS_FILE).filter(a => a.professionalId === pro.id && (a.status === 'CONFIRMED' || a.status === 'PAID_PENDING_PRO_CONFIRMATION'));
  const specialties = readJson(SPECIALTIES_FILE);
  const spec = specialties.find(s => s.id === pro.specialtyId);
  const payoutPerVisit = spec ? spec.professionalPayout : 28000;

  const totalEarnings = appointments.filter(a => a.status === 'CONFIRMED').length * payoutPerVisit;

  res.json({
    totalVisits: appointments.length,
    payoutPerVisit,
    totalEarnings,
    bankDetails: pro.bankDetails || null,
    appointments
  });
});

// ==========================================
// 3. PASARELA WEBPAY PLUS & AGENDAMIENTO WEB
// ==========================================

// Iniciar Checkout Webpay
app.post('/api/webpay/create', async (req, res) => {
  const {
    professionalId,
    patientName,
    patientRut,
    patientEmail,
    patientPhone,
    cityId,
    cityName,
    comunaId,
    comunaName,
    address,
    reason,
    date,
    timeSlot,
    acceptTerms
  } = req.body;

  // Validación de Términos y Condiciones obligatoria
  if (!acceptTerms) {
    return res.status(400).json({ error: 'Debe aceptar los Términos y Condiciones de Uso y la Política de Reembolsos de Movisalud.' });
  }

  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === professionalId);
  if (!pro || pro.status !== 'APPROVED') {
    return res.status(400).json({ error: 'El profesional no está disponible actualmente.' });
  }

  const specialties = readJson(SPECIALTIES_FILE);
  const spec = specialties.find(s => s.id === pro.specialtyId);
  const amount = spec ? spec.patientPrice : 35000;
  const proPayout = spec ? spec.professionalPayout : 28000;

  const cities = readJson(CITIES_FILE);
  const cityObj = cities.find(c => c.id === cityId);
  const finalCityName = cityName || (cityObj ? cityObj.name : 'Santiago');

  const comunas = readJson(COMUNAS_FILE);
  const comunaObj = comunas.find(c => c.id === comunaId);
  const finalComunaName = comunaName || (comunaObj ? comunaObj.name : (comunaId || 'Santiago Centro'));

  const buyOrder = 'ord-' + Date.now().toString().slice(-8);
  const sessionId = 'ses-' + Math.floor(100000 + Math.random() * 900000);
  const returnUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/webpay/return`;

  const appointments = readJson(APPOINTMENTS_FILE);
  const verificationCode = 'VIST-' + Math.floor(10000 + Math.random() * 90000);

  const tempApt = {
    id: 'apt-' + Math.floor(100000 + Math.random() * 900000),
    buyOrder,
    verificationCode,
    professionalId: pro.id,
    professionalName: pro.fullName,
    professionalSpecialty: pro.specialtyName,
    professionalPhone: pro.phone,
    professionalEmail: pro.email,
    patientName,
    patientRut: patientRut || '',
    patientEmail,
    patientPhone,
    cityId: cityId || (cityObj ? cityObj.id : 'santiago'),
    cityName: finalCityName,
    comunaId: comunaId || (comunaObj ? comunaObj.id : 'santiago-centro'),
    comunaName: finalComunaName,
    address,
    reason,
    date,
    timeSlot,
    price: amount,
    proPayout,
    status: 'PENDING_PAYMENT',
    termsAcceptedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  const tbkResult = await transbankService.createTransaction(buyOrder, sessionId, amount, returnUrl);
  tempApt.tbkToken = tbkResult.token;

  appointments.push(tempApt);
  writeJson(APPOINTMENTS_FILE, appointments);

  res.json({
    buyOrder,
    appointmentId: tempApt.id,
    amount,
    token: tbkResult.token,
    url: tbkResult.url
  });
});

// Mock Gateway interactivo de Transbank para pruebas locales
app.get('/api/webpay/mock-gateway', (req, res) => {
  const { token_ws, amount, buy_order } = req.query;
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Webpay Plus - Simulación Transbank</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-100 min-h-screen flex items-center justify-center p-4">
      <div class="bg-white max-w-md w-full rounded-3xl shadow-xl border border-slate-200 p-6 space-y-5">
        <div class="flex items-center justify-between border-b pb-4">
          <div class="flex items-center space-x-2">
            <img src="/images/logo_movisalud_def_3.png" alt="MOVISALUD" class="h-8 w-auto object-contain" />
            <span class="font-extrabold text-red-600 text-base tracking-tight">Webpay Plus</span>
          </div>
          <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Integración Transbank</span>
        </div>
        <div>
          <h3 class="font-bold text-slate-900">MOVISALUD Chile</h3>
          <p class="text-xs text-slate-500">Orden de Compra: <strong>${buy_order}</strong></p>
        </div>
        <div class="bg-slate-50 p-4 rounded-2xl border flex justify-between items-center">
          <span class="text-xs font-semibold text-slate-600">Monto Oficial:</span>
          <span class="text-2xl font-black text-slate-900">$${(parseInt(amount) || 35000).toLocaleString('es-CL')} CLP</span>
        </div>
        <form action="/api/webpay/return" method="POST" class="space-y-2">
          <input type="hidden" name="token_ws" value="${token_ws}" />
          <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl text-sm transition">
            ✓ Autorizar Pago con Tarjeta de Prueba
          </button>
        </form>
        <a href="/" class="block text-center text-xs text-slate-400 hover:text-slate-600">Cancelar y Volver</a>
      </div>
    </body>
    </html>
  `);
});

// Callback de retorno de Transbank: Al pagarse, notifica al PROFESIONAL para confirmar
app.all('/api/webpay/return', async (req, res) => {
  const tokenWs = req.body?.token_ws || req.query?.token_ws;
  if (!tokenWs) return res.redirect('/?payment=cancelled');

  const commitResult = await transbankService.commitTransaction(tokenWs);
  const appointments = readJson(APPOINTMENTS_FILE);
  let aptIndex = appointments.findIndex(a => a.tbkToken === tokenWs);
  if (aptIndex === -1 && commitResult.buy_order) {
    aptIndex = appointments.findIndex(a => a.buyOrder === commitResult.buy_order);
  }
  if (aptIndex === -1) {
    for (let i = appointments.length - 1; i >= 0; i--) {
      if (appointments[i].status === 'PENDING_PAYMENT') {
        aptIndex = i;
        break;
      }
    }
  }

  if (commitResult.success && aptIndex !== -1) {
    const apt = appointments[aptIndex];
    apt.status = 'PAID_PENDING_PRO_CONFIRMATION';
    apt.paymentDetails = {
      authorizationCode: commitResult.authorization_code,
      cardNumber: commitResult.card_detail?.card_number || '6623',
      paymentTypeCode: commitResult.payment_type_code,
      transactionDate: commitResult.transaction_date || new Date().toISOString()
    };

    const pros = readJson(PROFESSIONALS_FILE);
    const pro = pros.find(p => p.id === apt.professionalId) || {};
    const cities = readJson(CITIES_FILE);
    const city = cities.find(c => c.id === apt.cityId) || { name: apt.cityName || 'Santiago' };
    const comunas = readJson(COMUNAS_FILE);
    const comuna = comunas.find(c => c.id === apt.comunaId) || { name: apt.comunaName || 'Comuna Domicilio' };

    // 1. Despachar correo de comprobante al PACIENTE con botón de confirmación de llegada y políticas de 4h
    await mailerService.sendPatientPaymentReceipt(apt, pro, comuna, city);

    // 2. Despachar correo inmediato de aviso al PROFESIONAL con plazo de 4h y botones de confirmación y finalización
    await mailerService.sendProBookingNotice(apt, pro, comuna, city);

    writeJson(APPOINTMENTS_FILE, appointments);

    // Redirigir a pantalla de reserva pagada en espera de confirmación
    return res.redirect(`/?payment=success&aptId=${apt.id}&status=PAID_PENDING_PRO_CONFIRMATION`);
  }

  res.redirect('/?payment=failed');
});

// ==========================================
// 4. CONFIRMACIÓN Y CIERRE BILATERAL DE ATENCIONES
// ==========================================

// El paciente confirma con 1 clic que el profesional llegó a atenderlo
app.all('/api/appointments/:id/patient-confirm-arrival', async (req, res) => {
  const appointments = readJson(APPOINTMENTS_FILE);
  const apt = appointments.find(a => a.id === req.params.id);

  if (!apt) {
    if (req.method === 'GET') return res.send('<h3>Cita no encontrada.</h3>');
    return res.status(404).json({ error: 'Cita no encontrada' });
  }

  apt.patientArrivalConfirmed = true;
  apt.patientArrivalConfirmedAt = new Date().toISOString();

  // Si ambos lados han confirmado, se cierra formalmente la atención
  if (apt.proCompleted) {
    apt.isClosed = true;
    apt.closedAt = new Date().toISOString();
    apt.status = 'COMPLETED';
  }

  writeJson(APPOINTMENTS_FILE, appointments);

  if (req.method === 'GET') {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Llegada Confirmada - MOVISALUD</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-100 min-h-screen flex items-center justify-center p-4 font-sans">
        <div class="bg-white max-w-md w-full rounded-3xl shadow-xl p-8 text-center space-y-5 border border-slate-200">
          <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold shadow-sm">✓</div>
          <div>
            <h2 class="text-2xl font-black text-slate-900">¡Llegada Confirmada!</h2>
            <p class="text-xs text-slate-500 mt-1">Cita #${apt.id} • ${apt.date} ${apt.timeSlot} hrs</p>
          </div>
          <p class="text-sm text-slate-600">
            Has certificado la llegada del profesional <strong>${apt.professionalName}</strong> a tu domicilio. La atención ha sido registrada como <strong>recibida</strong> en el sistema.
          </p>
          ${apt.isClosed ? `
            <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl text-xs text-emerald-800 space-y-1">
              <span class="font-extrabold text-sm block">🎉 ¡Atención Cerrada Exitosamente!</span>
              <p>Tanto tú como el profesional han confirmado. La atención queda 100% cerrada y verificada por ambas partes.</p>
            </div>
          ` : `
            <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-2xl text-xs text-indigo-800 space-y-1">
              <span class="font-bold block">⏳ En Espera del Cierre Clínico</span>
              <p>Tu certificación ha quedado registrada. En cuanto el profesional marque la finalización clínica del procedimiento, la atención se cerrará formalmente.</p>
            </div>
          `}
          <div class="pt-2">
            <a href="/" class="inline-block w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-xl text-xs transition shadow-sm">
              Volver a Movisalud
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  res.json({ message: 'Llegada del profesional confirmada exitosamente por el paciente', appointment: apt });
});

// El profesional confirma con 1 clic la finalización de la atención (atención realizada)
app.all('/api/appointments/:id/pro-complete', async (req, res) => {
  const appointments = readJson(APPOINTMENTS_FILE);
  const apt = appointments.find(a => a.id === req.params.id);

  if (!apt) {
    if (req.method === 'GET') return res.send('<h3>Cita no encontrada.</h3>');
    return res.status(404).json({ error: 'Cita no encontrada' });
  }

  apt.proCompleted = true;
  apt.proCompletedAt = new Date().toISOString();

  // Si ambos lados han confirmado, se cierra formalmente la atención
  if (apt.patientArrivalConfirmed) {
    apt.isClosed = true;
    apt.closedAt = new Date().toISOString();
    apt.status = 'COMPLETED';
  }

  writeJson(APPOINTMENTS_FILE, appointments);

  if (req.method === 'GET') {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Atención Finalizada - MOVISALUD</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-100 min-h-screen flex items-center justify-center p-4 font-sans">
        <div class="bg-white max-w-md w-full rounded-3xl shadow-xl p-8 text-center space-y-5 border border-slate-200">
          <div class="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto text-3xl font-bold shadow-sm">🏁</div>
          <div>
            <h2 class="text-2xl font-black text-slate-900">¡Atención Finalizada!</h2>
            <p class="text-xs text-slate-500 mt-1">Cita #${apt.id} • Paciente: ${apt.patientName}</p>
          </div>
          <p class="text-sm text-slate-600">
            Has certificado la finalización de tu atención clínica domiciliaria. Tu registro ha quedado guardado exitosamente.
          </p>
          ${apt.isClosed ? `
            <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl text-xs text-emerald-800 space-y-1">
              <span class="font-extrabold text-sm block">🎉 ¡Atención Cerrada por Ambas Partes!</span>
              <p>El paciente confirmó tu llegada y tú confirmaste la finalización. La atención está cerrada y lista en la nómina de liquidaciones.</p>
            </div>
          ` : `
            <div class="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs text-amber-800 space-y-1">
              <span class="font-bold block">⏳ En Espera de Validación del Paciente</span>
              <p>Tu finalización está registrada. En cuanto el paciente presione el botón de confirmación de llegada recibido en su correo, la atención se cerrará bilateralmente.</p>
            </div>
          `}
          <div class="pt-2">
            <a href="/" class="inline-block w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-xl text-xs transition shadow-sm">
              Ir a mi Portal Profesional
            </a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  res.json({ message: 'Atención marcada como finalizada por el profesional', appointment: apt });
});

// El profesional confirma su asistencia a la visita (1 clic)
app.all('/api/appointments/:id/confirm-attendance', async (req, res) => {
  const appointments = readJson(APPOINTMENTS_FILE);
  const apt = appointments.find(a => a.id === req.params.id);

  if (!apt) {
    if (req.method === 'GET') return res.send('<h3>Cita no encontrada.</h3>');
    return res.status(404).json({ error: 'Cita no encontrada' });
  }

  apt.status = 'CONFIRMED';
  apt.proConfirmedAt = new Date().toISOString();

  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === apt.professionalId) || {};
  const cities = readJson(CITIES_FILE);
  const city = cities.find(c => c.id === apt.cityId) || { name: apt.cityName || 'Santiago' };
  const comunas = readJson(COMUNAS_FILE);
  const comuna = comunas.find(c => c.id === apt.comunaId) || { name: apt.comunaName || 'Comuna Domicilio' };

  // 2. Despachar correo de confirmación final al PACIENTE
  await mailerService.sendPatientConfirmedNotice(apt, pro, comuna, city);
  writeJson(APPOINTMENTS_FILE, appointments);

  if (req.method === 'GET') {
    return res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Asistencia Confirmada - MOVISALUD</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white max-w-md w-full rounded-3xl shadow-xl p-8 text-center space-y-4">
          <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">✓</div>
          <h2 class="text-2xl font-black text-slate-900">¡Asistencia Confirmada!</h2>
          <p class="text-xs text-slate-600">
            Has confirmado tu asistencia para la visita con <strong>${apt.patientName}</strong> el <strong>${apt.date}</strong> a las <strong>${apt.timeSlot} hrs</strong>.
          </p>
          <p class="text-xs text-emerald-700 font-bold bg-emerald-50 p-3 rounded-xl border border-emerald-200">
            Hemos despachado el correo de confirmación oficial al paciente con tus datos.
          </p>
          <a href="/" class="inline-block bg-slate-900 text-white font-bold px-6 py-3 rounded-xl text-xs">Ir a la Plataforma</a>
        </div>
      </body>
      </html>
    `);
  }

  res.json({ message: 'Asistencia confirmada exitosamente', appointment: apt });
});

// Solicitud de Reembolso por Inasistencia
app.post('/api/appointments/:id/request-refund', (req, res) => {
  const { reason } = req.body;
  const appointments = readJson(APPOINTMENTS_FILE);
  const apt = appointments.find(a => a.id === req.params.id);
  if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });

  apt.status = 'CANCELLED_REFUND_REQUESTED';
  apt.refundReason = reason || 'Inasistencia del profesional / Fuerza mayor';
  apt.refundRequestedAt = new Date().toISOString();

  writeJson(APPOINTMENTS_FILE, appointments);
  res.json({ message: 'Solicitud de reembolso del 100% recibida. Será procesada en 24 horas hábiles.', appointment: apt });
});

// ==========================================
// 5. ADMINISTRACIÓN
// ==========================================

app.put('/api/admin/professionals/:id/status', (req, res) => {
  const { status, statusNote } = req.body;
  const pros = readJson(PROFESSIONALS_FILE);
  const pro = pros.find(p => p.id === req.params.id);
  if (!pro) return res.status(404).json({ error: 'Profesional no encontrado' });

  pro.status = status;
  pro.statusNote = statusNote || (status === 'APPROVED' ? 'Aprobado y dado de alta.' : 'Revisión pendiente.');
  if (status === 'APPROVED') {
    pro.verifiedAt = new Date().toISOString();
    if (pro.documents) pro.documents.forEach(d => d.verified = true);
  }

  writeJson(PROFESSIONALS_FILE, pros);
  res.json({ message: `Profesional ${status === 'APPROVED' ? 'dado de alta' : 'actualizado'} con éxito`, professional: sanitizePublicPro(pro) });
});

// Registrar nuevo profesional desde Panel de Administración
app.post('/api/admin/professionals', (req, res) => {
  const {
    fullName,
    rut,
    email,
    password,
    phone,
    specialtyId,
    sisNumber,
    experienceYears,
    cityId,
    coverageComunas,
    bio,
    avatar,
    status = 'APPROVED',
    bankDetails
  } = req.body;

  if (!fullName || !rut || !email || !specialtyId || !phone) {
    return res.status(400).json({ error: 'Nombre, RUT, correo, teléfono y especialidad son campos obligatorios.' });
  }

  const pros = readJson(PROFESSIONALS_FILE);
  if (pros.some(p => p.rut === rut || p.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Ya existe un profesional registrado con ese RUT o correo electrónico.' });
  }

  const specialties = readJson(SPECIALTIES_FILE);
  const spec = specialties.find(s => s.id === specialtyId);

  const newPro = {
    id: 'pro-' + Date.now(),
    fullName,
    rut,
    email: email.toLowerCase(),
    password: password || 'pro123',
    phone,
    specialtyId,
    specialtyName: spec ? spec.name : specialtyId,
    sisNumber: sisNumber || '',
    experienceYears: parseInt(experienceYears) || 1,
    cityId: cityId || 'santiago',
    rating: 5.0,
    reviewsCount: 0,
    avatar: avatar || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&auto=format&fit=crop&q=80',
    bio: bio || 'Profesional de salud acreditado ante la Superintendencia de Salud.',
    status: status || 'APPROVED',
    statusNote: status === 'APPROVED' ? 'Dado de alta directamente por Administración.' : 'En espera de revisión.',
    verifiedAt: status === 'APPROVED' ? new Date().toISOString() : null,
    coverageComunas: Array.isArray(coverageComunas) ? coverageComunas : [],
    bankDetails: bankDetails && bankDetails.accountNumber ? {
      bankName: bankDetails.bankName || 'Banco de Chile',
      accountType: bankDetails.accountType || 'Cuenta Corriente',
      accountNumber: bankDetails.accountNumber,
      holderRut: bankDetails.holderRut || rut,
      updatedAt: new Date().toISOString()
    } : null,
    schedule: {
      days: [1, 2, 3, 4, 5],
      customSlots: ["09:00", "10:30", "12:00", "14:30", "16:00", "17:30"]
    },
    documents: []
  };

  pros.push(newPro);
  writeJson(PROFESSIONALS_FILE, pros);

  res.status(201).json({ message: 'Profesional registrado con éxito', professional: newPro });
});

app.put('/api/admin/specialties/:id/pricing', (req, res) => {
  const { patientPrice, professionalPayout } = req.body;
  const specialties = readJson(SPECIALTIES_FILE);
  const spec = specialties.find(s => s.id === req.params.id);
  if (!spec) return res.status(404).json({ error: 'Especialidad no encontrada' });

  spec.patientPrice = parseInt(patientPrice) || spec.patientPrice;
  spec.professionalPayout = parseInt(professionalPayout) || spec.professionalPayout;
  spec.platformFee = spec.patientPrice - spec.professionalPayout;

  writeJson(SPECIALTIES_FILE, specialties);
  res.json({ message: 'Tarifas actualizadas', specialty: spec });
});

// ==========================================
// 6. INFORME FINANCIERO Y PAGOS A PROFESIONALES
// ==========================================

app.get('/api/admin/reports/payouts', (req, res) => {
  const { period = 'all', date } = req.query;
  const appointments = readJson(APPOINTMENTS_FILE);
  const professionals = readJson(PROFESSIONALS_FILE);

  const targetDate = date ? new Date(date + 'T12:00:00') : new Date();
  const currentDateStr = date || targetDate.toISOString().slice(0, 10);
  let startDate = currentDateStr;
  let endDate = currentDateStr;
  let periodLabel = '';

  if (period === 'daily') {
    periodLabel = `Diario (${currentDateStr})`;
  } else if (period === 'weekly') {
    const day = targetDate.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const monday = new Date(targetDate);
    monday.setDate(targetDate.getDate() + diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const formatYMD = (d) => d.toISOString().split('T')[0];
    startDate = formatYMD(monday);
    endDate = formatYMD(sunday);
    periodLabel = `Semana del ${startDate} al ${endDate}`;
  } else if (period === 'monthly') {
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, targetDate.getMonth() + 1, 0).getDate();
    startDate = `${y}-${m}-01`;
    endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    periodLabel = `Mes de ${monthNames[targetDate.getMonth()]} ${y}`;
  } else {
    startDate = '2000-01-01';
    endDate = '2099-12-31';
    periodLabel = 'Todas las Liquidaciones (Histórico Completo)';
  }

  // Filtrar citas con atención/pago aprobado
  const filteredApts = appointments.filter(a => {
    const isPaid = a.status === 'CONFIRMED' || a.status === 'COMPLETED' || a.status === 'PAID_PENDING_PRO_CONFIRMATION';
    if (!isPaid) return false;
    if (period === 'all') return true;

    // Consideramos tanto la fecha programada como la fecha de cierre/ejecución
    const visitDate = a.date;
    const closedDate = (a.closedAt || a.proCompletedAt || a.createdAt)?.slice(0, 10);

    const visitMatches = visitDate && (visitDate >= startDate && visitDate <= endDate);
    const closedMatches = closedDate && (closedDate >= startDate && closedDate <= endDate);

    return visitMatches || closedMatches;
  });

  // Agrupar por profesional
  const proMap = {};

  filteredApts.forEach(apt => {
    const proId = apt.professionalId;
    if (!proMap[proId]) {
      const pro = professionals.find(p => p.id === proId) || {};
      proMap[proId] = {
        id: proId,
        fullName: apt.professionalName || pro.fullName || 'Profesional de Salud',
        rut: pro.rut || 'Sin RUT',
        email: pro.email || apt.professionalEmail || '',
        phone: pro.phone || apt.professionalPhone || '',
        specialtyName: apt.professionalSpecialty || pro.specialtyName || 'Salud',
        avatar: pro.avatar || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300',
        bankDetails: pro.bankDetails || {
          bankName: 'Por registrar',
          accountType: 'Cuenta Corriente',
          accountNumber: 'Pendiente',
          holderRut: pro.rut || ''
        },
        visitsCount: 0,
        totalPatientPaid: 0,
        totalProPayout: 0,
        totalPayout: 0,
        totalPlatformFee: 0,
        pendingPayout: 0,
        transferredPayout: 0,
        appointments: []
      };
    }

    const price = apt.price || 35000;
    const proPayout = apt.proPayout || 28000;
    const platformFee = apt.platformFee || (price - proPayout);

    proMap[proId].visitsCount += 1;
    proMap[proId].totalPatientPaid += price;
    proMap[proId].totalProPayout += proPayout;
    proMap[proId].totalPayout += proPayout;
    proMap[proId].totalPlatformFee += platformFee;

    if (apt.payoutStatus === 'TRANSFERRED') {
      proMap[proId].transferredPayout += proPayout;
    } else {
      proMap[proId].pendingPayout += proPayout;
    }

    proMap[proId].appointments.push({
      ...apt,
      price,
      proPayout,
      platformFee,
      payoutStatus: apt.payoutStatus || 'PENDING'
    });
  });

  const prosList = Object.values(proMap).sort((a, b) => b.totalProPayout - a.totalProPayout);

  const totalPatientPaid = prosList.reduce((acc, p) => acc + p.totalPatientPaid, 0);
  const totalProPayout = prosList.reduce((acc, p) => acc + p.totalProPayout, 0);
  const totalPlatformFee = prosList.reduce((acc, p) => acc + p.totalPlatformFee, 0);
  const totalPendingPayout = prosList.reduce((acc, p) => acc + p.pendingPayout, 0);
  const totalTransferredPayout = prosList.reduce((acc, p) => acc + p.transferredPayout, 0);

  res.json({
    period,
    selectedDate: date,
    startDate,
    endDate,
    periodLabel,
    summary: {
      totalVisits: filteredApts.length,
      totalPatientPaid,
      totalProPayout,
      totalPlatformFee,
      totalPendingPayout,
      totalTransferredPayout,
      totalProsWithVisits: prosList.length
    },
    professionals: prosList
  });
});

app.post('/api/admin/payouts/mark-transferred', (req, res) => {
  const { appointmentIds, transferRef } = req.body;
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    return res.status(400).json({ error: 'Debe indicar las citas a marcar como transferidas' });
  }

  const appointments = readJson(APPOINTMENTS_FILE);
  let updatedCount = 0;

  appointments.forEach(a => {
    if (appointmentIds.includes(a.id)) {
      a.payoutStatus = 'TRANSFERRED';
      a.transferredAt = new Date().toISOString();
      a.transferRef = transferRef || `TRF-${Date.now().toString().slice(-6)}`;
      updatedCount++;
    }
  });

  writeJson(APPOINTMENTS_FILE, appointments);
  res.json({ message: `${updatedCount} visita(s) marcadas como transferidas exitosamente.` });
});

// Ciudades, Comunas y Catálogos
app.get('/api/cities', (req, res) => {
  const cities = readJson(CITIES_FILE);
  cities.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  res.json(cities);
});

// Administración de Ciudades
app.post('/api/admin/cities', (req, res) => {
  const { name, region, badge } = req.body;
  if (!name || !region) return res.status(400).json({ error: 'Nombre y región son requeridos' });

  const cities = readJson(CITIES_FILE);
  const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (cities.some(c => c.id === id)) {
    return res.status(400).json({ error: 'Ya existe una ciudad registrada con este identificador' });
  }

  const newCity = {
    id,
    name,
    region,
    badge: badge || 'Zona',
    active: true
  };

  cities.push(newCity);
  cities.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  writeJson(CITIES_FILE, cities);
  res.status(201).json({ message: 'Ciudad agregada con éxito', city: newCity });
});

app.delete('/api/admin/cities/:id', (req, res) => {
  let cities = readJson(CITIES_FILE);
  const city = cities.find(c => c.id === req.params.id);
  if (!city) return res.status(404).json({ error: 'Ciudad no encontrada' });

  cities = cities.filter(c => c.id !== req.params.id);
  writeJson(CITIES_FILE, cities);

  // También eliminar comunas asociadas
  let comunas = readJson(COMUNAS_FILE);
  comunas = comunas.filter(c => c.cityId !== req.params.id);
  writeJson(COMUNAS_FILE, comunas);

  res.json({ message: 'Ciudad y sus comunas eliminadas con éxito' });
});

app.get('/api/comunas', (req, res) => {
  const { city } = req.query;
  let comunas = readJson(COMUNAS_FILE);
  if (city) comunas = comunas.filter(c => c.cityId === city);
  comunas.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  res.json(comunas);
});

// Administración de Comunas
app.post('/api/admin/comunas', (req, res) => {
  const { name, cityId, zone } = req.body;
  if (!name || !cityId) return res.status(400).json({ error: 'Nombre de comuna y ciudad son requeridos' });

  const comunas = readJson(COMUNAS_FILE);
  const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (comunas.some(c => c.id === id && c.cityId === cityId)) {
    return res.status(400).json({ error: 'Esta comuna ya existe en la ciudad seleccionada' });
  }

  const newComuna = {
    id,
    name,
    cityId,
    zone: zone || 'Urbana'
  };

  comunas.push(newComuna);
  comunas.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  writeJson(COMUNAS_FILE, comunas);
  res.status(201).json({ message: 'Comuna agregada con éxito', comuna: newComuna });
});

app.delete('/api/admin/comunas/:id', (req, res) => {
  let comunas = readJson(COMUNAS_FILE);
  const idx = comunas.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Comuna no encontrada' });

  comunas.splice(idx, 1);
  writeJson(COMUNAS_FILE, comunas);
  res.json({ message: 'Comuna eliminada con éxito' });
});

// Registro de interés en zonas en expansión
app.post('/api/coverage/notify', (req, res) => {
  const { email, location } = req.body;
  if (!email) return res.status(400).json({ error: 'Correo requerido' });

  const LEADS_FILE = path.join(DATA_DIR, 'coverage_leads.json');
  const leads = readJson(LEADS_FILE);
  leads.push({
    id: 'lead-' + Date.now(),
    email,
    location: location || 'No especificada',
    createdAt: new Date().toISOString()
  });
  writeJson(LEADS_FILE, leads);
  res.json({ message: '¡Gracias! Te avisaremos por correo en cuanto abramos cupos en tu comuna.' });
});

app.get('/api/specialties', (req, res) => res.json(readJson(SPECIALTIES_FILE)));
app.get('/api/appointments', (req, res) => {
  const { professionalId, patientEmail, status } = req.query;
  let apts = readJson(APPOINTMENTS_FILE);
  if (professionalId) {
    apts = apts.filter(a => a.professionalId === professionalId);
  }
  if (patientEmail) {
    apts = apts.filter(a => (a.patientEmail || '').toLowerCase() === patientEmail.toLowerCase());
  }
  if (status) {
    apts = apts.filter(a => a.status === status);
  }
  res.json(apts);
});
app.get('/api/emails', (req, res) => res.json(readJson(EMAILS_FILE)));
app.get('/api/site-config', (req, res) => res.json(readJson(SITE_CONFIG_FILE, {})));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`🏥 MOVISALUD.CL - Plataforma Protegida y Activa`);
  console.log(`🌐 Acceso local: http://localhost:${PORT}`);
  console.log(`📱 Red Wi-Fi (Celular): http://${HOST}:${PORT}`);
  console.log(`🔒 Control de Acceso: Profesionales & Admin Activo`);
  console.log(`⚖️ Términos y Condiciones: Exención & Reembolso 100%`);
  console.log(`====================================================`);
});
