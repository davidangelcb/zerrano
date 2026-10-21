
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const directorio = path.resolve(__dirname, '../data/raw');
const directorioSalida = path.resolve(__dirname, '../data/processed');
const directorioEstado = path.resolve(__dirname, '../data/state');

const archivoEstado = path.join(
    directorioEstado,
    'movimientos_enviados.json'
);

const archivoPendientes = path.join(
    directorioSalida,
    `eventos_nuevos_kardex_${new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date())}.json`
);

fs.mkdirSync(directorioSalida, { recursive: true });
fs.mkdirSync(directorioEstado, { recursive: true });

const fechaHoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(new Date());

const nombreArchivo = `kardex_${fechaHoy}.xlsx`;
const rutaArchivo = path.join(directorio, nombreArchivo);

if (!fs.existsSync(rutaArchivo)) {
    throw new Error(`No se encontró el archivo: ${rutaArchivo}`);
}

console.log('Procesando:', nombreArchivo);

const libro = XLSX.readFile(rutaArchivo);
const hoja = libro.Sheets[libro.SheetNames[0]];
const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

function texto(valor) {
    return String(valor ?? '').trim();
}

function numero(valor) {
    if (typeof valor === 'number') {
        return Number.isFinite(valor) ? valor : 0;
    }

    const limpio = texto(valor).replace(/\s/g, '').replace(',', '.');
    const resultado = Number(limpio);
    return Number.isFinite(resultado) ? resultado : 0;
}

function esSubtotal(fila) {
    const sinMotivo = !texto(fila['MOTIVO']);
    const sinIdentidad =
        !texto(fila['CATEGORIA']) &&
        !texto(fila['TIPO ITEM']) &&
        !texto(fila['ID']) &&
        !texto(fila['INSUMO / PRODUCTO']) &&
        !texto(fila['ALMACEN']) &&
        !texto(fila['COD. INTERNO']);

    const unidad = texto(fila['UNIDAD MEDIDA']).toUpperCase();

    return sinMotivo && sinIdentidad && unidad === 'TOTAL';
}

function fechaEvento(fecha, hora) {
    const partes = texto(fecha).split('-');
    const horaTexto = texto(hora);

    if (partes.length !== 3 || !horaTexto) {
        return null;
    }

    const [dia, mes, anio] = partes;

    // La hora local del reporte corresponde a Perú (UTC-05:00).
    return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T${horaTexto}-05:00`;
}

function clasificarUso(motivo) {
    const valor = texto(motivo).toUpperCase();

    if (valor.includes('POR MERMA')) return 'Merma';
    if (valor.includes('POR VENTA')) return 'Venta';
    if (valor.includes('POR MOVIMIENTO')) return 'Movimiento';
    if (valor.includes('CORTES')) return 'Cortesía';
    if (valor.includes('MALA PRODUCCION') ||
        valor.includes('MALA PRODUCCIÓN')) return 'Mala Producción';

    return 'Otros';
}

const subtotales = filas.filter(esSubtotal);
const movimientos = filas.filter(fila => !esSubtotal(fila));

const eventos = movimientos.map((fila, indice) => {
    const entrada = numero(fila['ENTRADA']);
    const salida = numero(fila['SALIDA']);
    const motivo = texto(fila['MOTIVO']);
    const tipoMovimiento =
        entrada > 0 && salida > 0 ? 'mixto' :
        entrada > 0 ? 'ingreso' :
        salida > 0 ? 'egreso' : 'sin_cantidad';

    const fechaHora = fechaEvento(fila['FECHA'], fila['HORA']);
    const codigoInterno = texto(fila['COD. INTERNO']);
    const almacen = texto(fila['ALMACEN']);
    const documento =
        texto(fila['OBSERVACION']).match(/Nº:\s*(\d+)/i)?.[1] || '';

    const claveMovimiento = JSON.stringify([
        codigoInterno,
        fechaHora,
        motivo.toUpperCase(),
        almacen.toUpperCase(),
        entrada,
        salida,
        documento
    ]);
    return {
        event_type: 'inventory_movement',
        event_time: fechaHora,
        movement_key: claveMovimiento,
        source_file: nombreArchivo,
        source_row: indice + 2,

        item_id: texto(fila['COD. INTERNO']) || null,
        item_name: texto(fila['INSUMO / PRODUCTO']) || null,
        category: texto(fila['CATEGORIA']) || null,
        item_type: texto(fila['TIPO ITEM']) || null,
        warehouse: texto(fila['ALMACEN']) || null,

        reason: motivo || null,
        usage_type: clasificarUso(motivo),
        movement_type: tipoMovimiento,

        quantity_in: entrada,
        quantity_out: salida,
        unit: texto(fila['UNIDAD MEDIDA']) || null,

        movement_cost: numero(fila['COSTO MOVIMIENTO']),
        operation_cost: numero(fila['COSTO OPERACION']),
        unit_cost: numero(fila['COSTO UNITARIO']),
        average_cost: numero(fila['COSTO PROMEDIO']),

        stock: numero(fila['STOCK']),
        stock_value: numero(fila['STOCK VALORIZADO']),

        document_reference: texto(fila['OBSERVACION']).match(/Nº:\s*(\d+)/i)?.[1] || null,
        sale_code: null,
        sale_product_id: texto(fila['ID PRODUCTO VENTA']) || null,
        base_recipe_id: null,
        store: texto(fila['TIENDA']) || null
    };
});

function sumar(lista, selector) {
    return lista.reduce((total, elemento) => total + selector(elemento), 0);
}

function redondear(valor) {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function agrupar(campo) {
    const grupos = {};

    for (const evento of eventos) {
        const valor = evento[campo] || '(VACÍO)';
        grupos[valor] = (grupos[valor] || 0) + 1;
    }

    return Object.entries(grupos)
        .sort((a, b) => b[1] - a[1])
        .map(([valor, cantidad]) => ({ valor, cantidad }));
}

const salidasOperativas = eventos.filter(evento =>
    evento.movement_type === 'egreso' &&
    evento.usage_type !== 'Movimiento'
);

const mermas = eventos.filter(evento =>
    evento.usage_type === 'Merma' &&
    evento.movement_type === 'egreso'
);

const resumen = {
    archivo: nombreArchivo,
    fechaProcesamiento: new Date().toISOString(),

    control: {
        filasOriginales: filas.length,
        filasSubtotalExcluidas: subtotales.length,
        eventosGenerados: eventos.length
    },

    cantidades: {
        totalEntradas: redondear(sumar(eventos, e => e.quantity_in)),
        totalSalidas: redondear(sumar(eventos, e => e.quantity_out)),
        cantidadMerma: redondear(sumar(mermas, e => e.quantity_out))
    },

    costos: {
        // Se excluyen traslados internos del cálculo de consumo operativo.
        costoMovimientoSalidasOperativas: redondear(
            sumar(salidasOperativas, e => e.movement_cost)
        ),
        costoOperacionSalidasOperativas: redondear(
            sumar(salidasOperativas, e => e.operation_cost)
        ),
        costoTotalOperativoProvisional: redondear(
            sumar(salidasOperativas, e => e.movement_cost + e.operation_cost)
        ),
        costoMovimientoMerma: redondear(
            sumar(mermas, e => e.movement_cost)
        ),
        costoOperacionMerma: redondear(
            sumar(mermas, e => e.operation_cost)
        ),
        costoTotalMermaProvisional: redondear(
            sumar(mermas, e => e.movement_cost + e.operation_cost)
        )
    },

    porMotivo: agrupar('reason'),
    porCategoria: agrupar('category'),
    porTipoItem: agrupar('item_type'),
    porAlmacen: agrupar('warehouse'),

    eventos
};

const salida = path.join(
    directorioSalida,
    `eventos_${path.basename(nombreArchivo, '.xlsx')}.json`
);

fs.writeFileSync(salida, JSON.stringify(resumen, null, 2), 'utf8');

// Leer las claves de los movimientos enviados correctamente.
// Si el archivo todavía no existe, se considera que no hay envíos previos.
let estado = { enviados: [] };

if (fs.existsSync(archivoEstado)) {
    estado = JSON.parse(
        fs.readFileSync(archivoEstado, 'utf8')
    );
}

const clavesEnviadas = new Set(estado.enviados || []);

// Seleccionar únicamente los movimientos que no figuran como enviados.
const eventosNuevos = eventos.filter(evento =>
    !clavesEnviadas.has(evento.movement_key)
);

// Guardar los movimientos pendientes en un archivo independiente.
const pendientes = {
    archivo: nombreArchivo,
    fechaProcesamiento: new Date().toISOString(),

    control: {
        eventosTotales: eventos.length,
        movimientosYaEnviados: eventos.length - eventosNuevos.length,
        movimientosPendientes: eventosNuevos.length
    },

    eventos: eventosNuevos
};

fs.writeFileSync(
    archivoPendientes,
    JSON.stringify(pendientes, null, 2),
    'utf8'
);

console.log('\nCONTROL DE ENVÍOS');
console.table(pendientes.control);

console.log('Movimientos pendientes guardados en:', archivoPendientes);

console.log('\nCONTROL DEL PROCESAMIENTO');
console.table(resumen.control);

console.log('\nCANTIDADES');
console.table(resumen.cantidades);

console.log('\nCOSTOS PROVISIONALES');
console.table(resumen.costos);

console.log('\nMOVIMIENTOS POR MOTIVO');
console.table(resumen.porMotivo);

console.log('\nJSON guardado en:', salida);
