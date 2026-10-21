# Zerrano Automation

Automatización de descarga, procesamiento y envío de movimientos del Kardex del sistema Zerrano, desarrollada con Node.js.

Actualmente, los eventos se envían a un simulador local mediante una API REST. El objetivo es preparar los datos para su integración con un collector y su posterior análisis.

## Requisitos

- Windows.
- Node.js y npm.
- Acceso al sistema Zerrano.
- El proyecto `signoz-simulator` ejecutándose en local para las pruebas de envío.

## Estructura del proyecto

```text
zerrano-automation/
├── src/
│   ├── 01_descargar_kardex.js
│   ├── 02_procesar_kardex.js
│   └── 03_enviar_kardex.js
├── data/
│   ├── raw/
│   ├── processed/
│   └── state/
├── logs/
├── .env
├── .gitignore
└── README.md
```

## Procesos

### 1. Descargar el Kardex

Archivo: `src/01_descargar_kardex.js`

Inicia sesión en Zerrano y descarga el Excel del Kardex correspondiente al día actual.

Archivo generado:

`data/raw/kardex_YYYY-MM-DD.xlsx`

Si se vuelve a ejecutar durante el mismo día, se sobrescribe el archivo de esa fecha.

### 2. Procesar el Kardex

Archivo: `src/02_procesar_kardex.js`

Lee el Excel y genera eventos JSON.

Funciones principales:

- Excluye las filas de subtotal.
- Normaliza los datos de los movimientos.
- Genera una clave de identificación llamada `movement_key`.
- Calcula resúmenes de entradas, salidas, mermas y costos provisionales.
- Genera el archivo completo de eventos.
- Compara los eventos con el estado local para identificar movimientos pendientes.

Archivos generados:

- `data/processed/eventos_kardex_YYYY-MM-DD.json`
- `data/processed/eventos_nuevos_kardex_YYYY-MM-DD.json`

### 3. Enviar los eventos

Archivo: `src/03_enviar_kardex.js`

Envía los movimientos pendientes al simulador local mediante HTTP POST.

Endpoint de pruebas:

`http://localhost:8095/v1/inventory/events`

Los eventos se envían en lotes de hasta 100. Después de confirmar cada lote, el proceso registra las claves de los movimientos enviados.

Archivo de estado:

`data/state/movimientos_enviados.json`

Este archivo permite mantener el control entre ejecuciones y evitar volver a enviar movimientos que ya están registrados localmente.

## Instalación

Clonar el repositorio:

```powershell
git clone https://github.com/davidangelcb/zerrano.git
cd zerrano
```

Instalar las dependencias declaradas en el proyecto:

```powershell
npm install
```

Configurar las variables de entorno requeridas por el proyecto en un archivo `.env` local. No publicar credenciales, contraseñas ni tokens.

## Ejecución manual

Ejecutar los comandos desde la raíz del proyecto, en este orden.

### Paso 1: descargar

```powershell
node src/01_descargar_kardex.js
```

### Paso 2: procesar

```powershell
node src/02_procesar_kardex.js
```

### Paso 3: comprobar el simulador

```powershell
Invoke-RestMethod http://localhost:8095/health
```

### Paso 4: enviar

```powershell
node src/03_enviar_kardex.js
```

Si no existen movimientos pendientes, el proceso termina con el mensaje:

`No hay movimientos pendientes de envío.`

## Pruebas realizadas

Con el archivo `kardex_2026-10-20.xlsx`:

| Indicador | Resultado |
|---|---:|
| Filas originales | 1,716 |
| Filas de subtotal excluidas | 247 |
| Eventos generados | 1,469 |
| Eventos enviados al simulador | 1,469 |
| Eventos nuevos almacenados | 1,469 |
| Duplicados omitidos en el primer envío | 0 |
| Pendientes al repetir el procesamiento | 0 |

También se ejecutó nuevamente el proceso de envío y no se encontraron movimientos pendientes.

Estas pruebas validan el flujo básico y el control local en el escenario probado.

## Estado del proyecto

### Implementado y probado

- Descarga del Excel del Kardex.
- Procesamiento y normalización de filas.
- Exclusión de subtotales.
- Generación de eventos JSON.
- Envío HTTP por lotes.
- Registro local de movimientos enviados.
- Detección de cero movimientos pendientes al repetir el procesamiento.

### Pendiente de validación o implementación

- Verificar la deduplicación del simulador usando `movement_key`.
- Probar nuevas descargas con movimientos agregados y cambios en el orden de las filas.
- Validar que dos movimientos diferentes no generen la misma clave.
- Programar las ejecuciones automáticas durante el día.
- Integrar el collector definitivo.
- Completar la validación de las reglas de costos y clasificación de uso del stock.

## Consideraciones importantes

- No eliminar `data/state/movimientos_enviados.json` durante la operación normal.
- No publicar archivos `.env` ni otros archivos con credenciales.
- El simulador local es un entorno de pruebas, no la integración definitiva con SigNoz.
- Antes de programar ejecuciones automáticas, validar el comportamiento ante fallos de red y nuevas descargas del Kardex.
