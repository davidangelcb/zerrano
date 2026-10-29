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
│   ├── 03_enviar_kardex.js
│   └── 04_carga_inicial_kardex.js
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
- Asigna un identificador alternativo a los movimientos cuyo `COD. INTERNO` está vacío.

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

**Importante:** no eliminar ni reiniciar este archivo durante la operación normal. Contiene el historial local de movimientos confirmados como enviados.

### 4. Carga histórica inicial (ejecución única)

Archivo: `src/04_carga_inicial_kardex.js`

Este proceso se utiliza para realizar la carga inicial del histórico del Kardex antes de comenzar con las ejecuciones recurrentes.

En la prueba inicial se configuró:

```env
KARDEX_DIAS=30
```

La descarga obtuvo los últimos 30 días calendario, finalizando el día anterior a la ejecución. El archivo generado fue:

`data/raw/kardex_2026-10-28.xlsx`

#### Objetivo

- Descargar el histórico disponible del periodo configurado.
- Procesar todos los movimientos del archivo.
- Identificar cuáles ya estaban registrados como enviados.
- Preparar los movimientos pendientes.
- Enviar los eventos históricos al colector de pruebas.

#### Ejecución

Ejecutar desde la raíz del proyecto:

```powershell
node src/04_carga_inicial_kardex.js
```

Una vez descargado el archivo histórico, el flujo de procesamiento y envío utilizado en la prueba fue:

```powershell
node src/02_procesar_kardex.js
node src/03_enviar_kardex.js
```

**Nota:** el proceso 4 realiza la descarga histórica. El procesamiento y el envío se ejecutan mediante los procesos 2 y 3, respectivamente, según el flujo probado. No se debe asumir que el proceso 4 ejecuta automáticamente todos los pasos.

#### Resultado de la carga histórica del 28/10/2026

| Indicador | Resultado |
|---|---:|
| Filas originales | 54,892 |
| Filas de subtotal excluidas | 764 |
| Eventos generados | 54,128 |
| Movimientos que ya figuraban como enviados | 1,469 |
| Movimientos pendientes de envío | 52,659 |
| Eventos almacenados al finalizar | 52,659 |
| Eventos nuevos en el último envío | 2,459 |
| Duplicados omitidos en el último envío | 0 |

Durante la carga se detectaron tres movimientos de `FIDEO CANUTO (PERSONAL)` sin `COD. INTERNO`. Se corrigió el procesamiento para asignarles un identificador alternativo y los tres fueron aceptados por el simulador.

#### Reglas para la carga inicial

- La carga histórica debe realizarse una sola vez por entorno de destino, salvo que se haya planificado una recarga controlada.
- No ejecutar repetidamente la carga inicial sin revisar primero el estado y el contenido del simulador.
- No borrar `data/state/movimientos_enviados.json` para intentar resolver errores de envío.
- No vaciar el simulador mientras se conserva el estado local de envíos, ni reiniciar el estado mientras se conservan los eventos del simulador, sin un procedimiento de recuperación coordinado.
- Si un lote falla, revisar el error y reanudar con el estado existente. No marcar como enviados los eventos de un lote que no fue confirmado.
- La deduplicación local utiliza `movement_key`. El comportamiento de deduplicación del colector definitivo debe validarse por separado.

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

## Ejecución manual recurrente

Para las ejecuciones normales, una vez terminada la carga histórica inicial, ejecutar los comandos desde la raíz del proyecto en este orden.

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

La respuesta esperada debe indicar que el servicio está operativo.

### Paso 4: enviar

```powershell
node src/03_enviar_kardex.js
```

Si no existen movimientos pendientes, el proceso termina con el mensaje:

`No hay movimientos pendientes de envío.`

Las ejecuciones recurrentes deben utilizar el mismo archivo de estado y el mecanismo de deduplicación existente. Antes de programarlas, es necesario probar cómo se comporta el proceso ante movimientos nuevos, cambios en el reporte y fallos parciales.

## Verificación del simulador

Para consultar el estado del servicio:

```powershell
Invoke-RestMethod http://localhost:8095/health
```

Para consultar el número de eventos almacenados, desde la terminal de Node.js o PowerShell:

```powershell
node -e "const d=require('C:/signoz-simulator/data/eventos.json'); console.log('Total almacenado:',Array.isArray(d)?d.length:'Revisar estructura del JSON')"
```

El resultado de referencia después de la carga histórica fue:

`Total almacenado: 52659`

Este número corresponde a la ejecución de prueba del 28/10/2026 y no debe considerarse un total permanente.

## Pruebas realizadas

### Prueba diaria del 20/10/2026

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

### Prueba de carga histórica del 28/10/2026

Se descargó y procesó un histórico de 30 días. Tras corregir tres movimientos sin código interno, se completó el envío de 52,659 eventos en total, de acuerdo con el estado y los resultados del simulador.

Estas pruebas validan el flujo en el entorno local utilizado. La integración definitiva y la deduplicación en el collector de producción deben probarse por separado.

## Estado del proyecto

### Implementado y probado

- Descarga del Excel del Kardex.
- Descarga histórica de 30 días mediante el proceso 4.
- Procesamiento y normalización de filas.
- Exclusión de subtotales.
- Generación de eventos JSON.
- Asignación de identificadores alternativos cuando falta `COD. INTERNO`.
- Envío HTTP por lotes de hasta 100 eventos.
- Registro local de movimientos enviados.
- Detección de cero movimientos pendientes al repetir el procesamiento.
- Carga histórica inicial completada en el simulador local.

### Pendiente de validación o implementación

- Verificar la deduplicación del simulador usando `movement_key`.
- Probar nuevas descargas con movimientos agregados y cambios en el orden de las filas.
- Validar que dos movimientos diferentes no generen la misma clave.
- Programar las ejecuciones automáticas durante el día.
- Integrar el collector definitivo.
- Completar la validación de las reglas de costos y clasificación de uso del stock.
- Definir un procedimiento de recuperación ante fallos y recargas históricas.

## Consideraciones importantes

- No eliminar `data/state/movimientos_enviados.json` durante la operación normal.
- No publicar archivos `.env` ni otros archivos con credenciales.
- El simulador local es un entorno de pruebas, no la integración definitiva con SigNoz.
- La carga histórica inicial ya se realizó en el entorno de pruebas. No debe repetirse sin una decisión explícita y una revisión previa del estado.
- Antes de programar ejecuciones automáticas, validar el comportamiento ante fallos de red y nuevas descargas del Kardex.
- Los costos calculados son provisionales hasta confirmar la interpretación de los campos del reporte y las reglas de negocio.
