# MOVISALUD - Plataforma de Intermediación de Atención de Salud a Domicilio

**MOVISALUD** es una solución web integral diseñada para coordinar visitas a domicilio de profesionales de la salud certificados en las comunas del Gran Santiago, Chile.

---

## Módulos de la Plataforma

### 1. Módulo de Pacientes
- **Filtro por Comuna**: Búsqueda focalizada entre las 34 comunas de Santiago (Las Condes, Providencia, Santiago Centro, Ñuñoa, Maipú, La Florida, etc.).
- **Filtro por Especialidad**: Selección entre Kinesiología, Fonoaudiología, Nutrición, TENS, Terapia Ocupacional, etc.
- **Perfiles Profesionales Verificados**: Información detallada con foto, calificación, años de experiencia, biografía, comunas de cobertura y número de registro en la Superintendencia de Salud (SIS).
- **Selector Horario en Tiempo Real**: Visualización de los días y bloques horarios configurados por el profesional, bloqueando automáticamente los horarios ya reservados.
- **Agendamiento y Notificación por Correo**: Ingreso de datos del paciente, dirección exacta y motivo de consulta. Se despacha inmediatamente un correo electrónico con el resumen, datos del profesional, teléfono de contacto y recomendaciones previas.

### 2. Módulo de Profesionales
- **Formulario de Enrolamiento**: Registro con RUT chileno, correo, teléfono, especialidad y N° de Registro SIS.
- **Carga de Documentación**: Subida de archivos (Certificado de Título / SIS, Cédula de Identidad ambos lados, Certificado de Antecedentes).
- **Estados de la Cuenta**:
  - `PENDIENTE DE REVISIÓN`: Mensaje informativo de validación en curso.
  - `DADO DE ALTA / APROBADO`: Desbloqueo total del panel operativo.
- **Configuración de Cobertura Territorial**: Selector interactivo de comunas de Santiago donde realiza visitas a domicilio.
- **Gestor de Disponibilidad**: Configuración de días de atención (Lunes a Domingo), horarios y tarifas por consulta.
- **Agenda de Pacientes**: Visualizador de citas reservadas con nombre del paciente, dirección, teléfono y detalles.

### 3. Panel de Administración y Mesa de Validación
- **Mesa de Validación**: Inspección de profesionales registrados y sus documentos adjuntos.
- **Alta de Profesionales**: Botón de un solo clic para "Dar de Alta" y habilitar al profesional para que atienda pacientes.
- **Gestión de Especialidades**: Capacidad para crear nuevas profesiones médicas/terapéuticas dinámicamente.
- **Buzón de Correos en Vivo**: Inspección y previsualización del HTML de los correos electrónicos despachados a los pacientes.

---

## Requisitos y Ejecución Local

### Ejecución Directa con Node.js
```bash
# Iniciar el servidor
node server.js
```
El servidor quedará disponible en:
👉 **`http://localhost:3000`**

---

## Estructura del Código

```
MOVISALUD/
├── data/
│   ├── comunas.json        # 34 comunas oficiales de Santiago y sus zonas
│   ├── specialties.json    # Catálogo extensible de especialidades de salud
│   ├── professionals.json  # Profesionales registrados, dados de alta y en revisión
│   ├── appointments.json   # Historial y reservas activas
│   └── emails.json         # Registro de correos electrónicos despachados
├── uploads/                # Archivos de acreditación y títulos subidos
├── public/
│   ├── index.html          # Vista única SPA con pestañas y modales
│   ├── css/styles.css      # Estilos personalizados y utilidades Tailwind
│   └── js/
│       ├── app.js          # Router, estado global y visor de correos
│       ├── patient-module.js # Búsqueda, agendamiento y envío de email
│       ├── pro-module.js   # Registro, documentos, comunas y horarios
│       └── admin-module.js # Mesa de validación y alta de profesionales
├── package.json
└── server.js               # Servidor Express y API RESTful
```
