# Guía de Despliegue en Hosting y Configuración de Correos para MOVISALUD.CL

Esta guía detalla paso a paso cómo publicar la plataforma en un hosting comercial para que funcione bajo tu dominio **`https://www.movisalud.cl`**, con correos corporativos y pagos en línea.

---

## 1. Configuración de Dominio en NIC Chile

1. Ingresa a tu panel de [NIC Chile](https://www.nic.cl) y selecciona el dominio **`movisalud.cl`**.
2. En la sección **Servidores de Nombre (DNS)**, apunta a los nameservers que te entregue tu proveedor de hosting:
   - Ejemplo (si usas cPanel / Hostinger / DonWeb):
     - `ns1.tu-hosting.com`
     - `ns2.tu-hosting.com`
3. Guarda los cambios. La propagación toma entre 2 y 24 horas.

---

## 2. Creación de Correos Corporativos (`contacto@movisalud.cl`)

En el panel de tu hosting (cPanel o similar):
1. Dirígete a la sección **"Cuentas de Correo Electrónico"** (Email Accounts).
2. Haz clic en **"Crear"** y define la casilla:
   - Email: `contacto@movisalud.cl`
   - Contraseña: *(Define una contraseña segura)*
   - Espacio: Ilimitado o según tu plan.
3. En la sección **"Configurar cliente de correo"**, anota los parámetros SMTP:
   - **Servidor de salida (SMTP)**: `mail.movisalud.cl`
   - **Puerto SSL**: `465` (o TLS `587`)
   - **Usuario**: `contacto@movisalud.cl`
   - **Contraseña**: La que acabas de crear.

---

## 3. Subida y Puesta en Marcha de MOVISALUD (Node.js en cPanel)

La mayoría de los hostings modernos incluyen la herramienta **"Setup Node.js App"**:

1. En cPanel, abre **"Setup Node.js App"** y presiona **"Create Application"**.
2. Completa los campos:
   - **Node.js version**: Selecciona `20.x` o `22.x`.
   - **Application mode**: `Production`.
   - **Application root**: `movisalud` (o la carpeta donde subirás los archivos).
   - **Application URL**: Selecciona `movisalud.cl`.
   - **Application startup file**: `server.js`.
3. Sube los archivos del proyecto (puedes usar el Administrador de Archivos de cPanel o FTP):
   - Sube todo el contenido de la carpeta `MOVISALUD/` (excepto `node_modules`).
4. Haz clic en el botón **"Run NPM Install"** dentro de cPanel para instalar las dependencias automáticamente.
5. Edita el archivo `.env` en la raíz de tu hosting con tus datos de producción:
   ```ini
   PORT=3000
   NODE_ENV=production
   BASE_URL=https://www.movisalud.cl
   DOMAIN=movisalud.cl
   
   # Configuración de Correo Saliente (Requiere Autenticación de Usuario y Contraseña)
   SMTP_HOST=mail.movisalud.cl
   SMTP_PORT=465
   SMTP_USER=contacto@movisalud.cl
   SMTP_PASS=tu_contraseña_del_correo_en_cpanel
   SMTP_FROM="MOVISALUD Chile <contacto@movisalud.cl>"
   ```
   > 💡 **Nota cPanel:** Asegúrate de que `SMTP_USER` sea la cuenta de correo completa (ej: `contacto@movisalud.cl`) y que `SMTP_PASS` sea exactamente la contraseña que le asignaste al crear la cuenta en cPanel. Si tu explorador de archivos en cPanel oculta los archivos con punto como `.env`, también puedes configurar estos mismos valores en `data/site_config.json`.
   >
   > 🧪 **Herramienta de Prueba en Vivo:** Una vez iniciada la app, ingresa a la **Mesa de Validación** y en la tarjeta *Buzón de Despacho de Correos* haz clic en **"Diagnóstico SMTP"** para enviar un correo de prueba en vivo y verificar la autenticación en tiempo real.

6. Presiona **"Restart Application"** en cPanel. ¡Tu sitio ya estará en vivo y enviando correos reales!

---

## 4. Activación de Certificado SSL (HTTPS Gratuito)

1. En cPanel, busca **"Let's Encrypt SSL"** o **"SSL/TLS Status"**.
2. Selecciona `movisalud.cl` y `www.movisalud.cl` y presiona **"Run AutoSSL"** o **"Issue"**.
3. El candado verde quedará activo en todos los navegadores.

---

## 5. Paso a Producción de Webpay Plus (Transbank)

Cuando estés listo para cobrar dinero real:
1. Firma tu contrato con Transbank en [transbank.cl](https://www.transbank.cl) (o tu ejecutivo comercial).
2. Transbank te entregará tu **Código de Comercio de Producción** y la **Llave Secreta de Producción**.
3. En tu archivo `.env`, reemplaza los valores de prueba por los de producción:
   ```ini
   TBK_ENV=PRODUCTION
   TBK_COMMERCE_CODE=tu_codigo_de_produccion
   TBK_API_KEY=tu_llave_secreta_de_produccion
   ```
4. Reinicia la aplicación Node.js en cPanel y todos los cobros irán directo a tu cuenta bancaria de empresa.
