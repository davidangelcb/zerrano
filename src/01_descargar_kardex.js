
require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = process.env.ZERRANO_URL;
const USUARIO = process.env.ZERRANO_USER;
const PASSWORD = process.env.ZERRANO_PASSWORD;
const HEADLESS = process.env.HEADLESS === 'true';

const DIR_RAW = path.resolve('data/raw');

function fechaLocal() {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const obtener = (tipo) =>
    partes.find(parte => parte.type === tipo).value;

  const anio = obtener('year');
  const mes = obtener('month');
  const dia = obtener('day');

  return {
    iso: `${anio}-${mes}-${dia}`,
    visible: `${dia}/${mes}/${anio}`,
  };
}

async function iniciarSesion(page) {
  await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Si ya inició sesión, no vuelve a completar el formulario.
  if (page.url().includes('#!/login')) {
  /*  const campoUsuario = page.locator(
      'input[type="username"], input[name*="username" i], input[ng-model*="username" i], input[type="text"]'
    ).filter({ visible: true }).first();*/

    const campoPassword = page.locator('input[type="password"]').first();

   // await campoUsuario.waitFor({ state: 'visible', timeout: 15000 });
  //  await campoUsuario.fill(USUARIO);
    await page.fill('#username', USUARIO);

    await campoPassword.fill(PASSWORD);

    const botonLogin = page.getByRole('button', {
      name: /iniciar sesión|iniciar sesion|ingresar|entrar|login/i,
    }).first();

    await botonLogin.click();
    await page.waitForTimeout(3000);
  }

  console.log('Página después del inicio de sesión:', page.url());

  if (page.url().includes('#!/login')) {
    throw new Error(
      'El inicio de sesión no se completó. Hay que revisar los selectores del formulario.'
    );
  }
}

async function descargarKardex() {
  if (!URL_LOGIN || !USUARIO || !PASSWORD) {
    throw new Error('Faltan ZERRANO_URL, ZERRANO_USER o ZERRANO_PASSWORD en .env');
  }

  fs.mkdirSync(DIR_RAW, { recursive: true });

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.setDefaultTimeout(20000);

  try {
    await iniciarSesion(page);

    // Entrar directamente al módulo Kardex.
    await page.goto(
      'http://zerrano.restaurant.pe/restaurant/logistica.html#!/kardex/general',
      { waitUntil: 'domcontentloaded' }
    );

    await page.locator('#fechaDeKardex').waitFor({ state: 'visible' });

    const fecha = fechaLocal();
    const rango = `${fecha.visible} al ${fecha.visible}`;
    const campoFecha = page.locator('#fechaDeKardex');

    console.log('Rango diario solicitado:', rango);

    // Intentar aplicar el rango y disparar eventos del campo.
    await campoFecha.fill(rango);
    await campoFecha.dispatchEvent('change');
    await campoFecha.press('Tab');
    await page.waitForTimeout(1000);

    console.log('Rango que muestra la página:', await campoFecha.inputValue());

    // Abrir Descargar y seleccionar el Excel estándar.
    await page.locator('button[uib-dropdown-toggle]')
      .filter({ hasText: 'Descargar' })
      .click();

    const opcionExcel = page.locator('a.dropdown-item')
      .filter({ hasText: 'Descargar (.xlsx)' })
      .first();

    await opcionExcel.waitFor({ state: 'visible' });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      opcionExcel.click(),
    ]);

    const nombreArchivo = `kardex_${fecha.iso}.xlsx`;
    const destino = path.join(DIR_RAW, nombreArchivo);

    await download.saveAs(destino);

    const info = fs.statSync(destino);

    if (info.size === 0) {
      throw new Error('El archivo descargado está vacío.');
    }

    console.log('Descarga completada:', destino);
    console.log('Tamaño:', info.size, 'bytes');
  } catch (error) {
    const captura = path.resolve('logs', 'error_kardex.png');
    await page.screenshot({ path: captura, fullPage: true }).catch(() => {});
    console.error('Error al descargar el Kardex:', error.message);
    console.error('Captura de diagnóstico:', captura);
    throw error;
  } finally {
    await browser.close();
  }
}

descargarKardex().catch(() => {
  process.exitCode = 1;
});
