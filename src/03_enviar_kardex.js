
const fs = require('fs');
const path = require('path');

function fechaLocal() {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const obtener = tipo =>
        partes.find(parte => parte.type === tipo).value;

    return `${obtener('year')}-${obtener('month')}-${obtener('day')}`;
}

const fechaHoy = fechaLocal();

const directorioProcesado = path.join(
    __dirname, '..', 'data', 'processed'
);

const directorioEstado = path.join(
    __dirname, '..', 'data', 'state'
);

const archivoEntrada = path.join(
    directorioProcesado,
    `eventos_nuevos_kardex_${fechaHoy}.json`
);

const archivoEstado = path.join(
    directorioEstado,
    'movimientos_enviados.json'
);

const URL_COLECTOR = 'http://localhost:8095/v1/inventory/events';
const TAMANO_LOTE = 100;

function guardarEstado(estado) {
    fs.mkdirSync(directorioEstado, { recursive: true });

    const temporal = `${archivoEstado}.tmp`;

    fs.writeFileSync(
        temporal,
        JSON.stringify(estado, null, 2),
        'utf8'
    );

    fs.renameSync(temporal, archivoEstado);
}

async function main() {
    if (!fs.existsSync(archivoEntrada)) {
        throw new Error(`No existe el archivo: ${archivoEntrada}`);
    }

    const contenido = JSON.parse(
        fs.readFileSync(archivoEntrada, 'utf8')
    );

    const eventos = contenido.eventos;

    if (!Array.isArray(eventos)) {
        throw new Error('El archivo no contiene una lista válida de eventos.');
    }

    // Si no hay eventos nuevos, no hay nada que enviar.
    if (eventos.length === 0) {
        console.log('No hay movimientos pendientes de envío.');
        return;
    }

    // Cada movimiento debe tener una clave estable.
    for (const [indice, evento] of eventos.entries()) {
        if (!evento.movement_key) {
            throw new Error(
                `El evento de la posición ${indice} no tiene movement_key.`
            );
        }
    }

    let estado = { enviados: [] };

    if (fs.existsSync(archivoEstado)) {
        estado = JSON.parse(
            fs.readFileSync(archivoEstado, 'utf8')
        );
    }

    if (!Array.isArray(estado.enviados)) {
        throw new Error(
            'El archivo de estado no contiene una lista válida de enviados.'
        );
    }

    const clavesEnviadas = new Set(estado.enviados);

    // Protección adicional: no enviar claves ya registradas como enviadas.
    const pendientes = eventos.filter(
        evento => !clavesEnviadas.has(evento.movement_key)
    );

    if (pendientes.length === 0) {
        console.log('Todos los movimientos ya figuran como enviados.');
        return;
    }

    console.log(`Archivo: ${contenido.archivo}`);
    console.log(`Pendientes por enviar: ${pendientes.length}`);

    let totalRecibidos = 0;
    let totalNuevos = 0;
    let totalDuplicados = 0;

    for (let i = 0; i < pendientes.length; i += TAMANO_LOTE) {
        const lote = pendientes.slice(i, i + TAMANO_LOTE);
        const numeroLote = Math.floor(i / TAMANO_LOTE) + 1;

        const respuesta = await fetch(URL_COLECTOR, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(lote)
        });

        const textoRespuesta = await respuesta.text();

        let resultado;

        try {
            resultado = JSON.parse(textoRespuesta);
        } catch {
            throw new Error(
                `El lote ${numeroLote} recibió una respuesta que no es JSON. ` +
                'No se marcará como enviado.'
            );
        }

        if (!respuesta.ok) {
            throw new Error(
                `Falló el lote ${numeroLote}: ${textoRespuesta}. ` +
                'No se marcará como enviado.'
            );
        }

        const recibidos = resultado.recibidos;
        const nuevos = resultado.nuevos;
        const duplicados = resultado.duplicadosOmitidos;

        // Exigir confirmación completa antes de registrar las claves.
        if (
            recibidos !== lote.length ||
            !Number.isInteger(nuevos) ||
            !Number.isInteger(duplicados) ||
            nuevos + duplicados !== lote.length
        ) {
            throw new Error(
                `El lote ${numeroLote} no tiene una confirmación completa. ` +
                `Esperados: ${lote.length}. Respuesta: ${textoRespuesta}. ` +
                'No se marcará este lote como enviado.'
            );
        }

        // Registrar las claves solo después de confirmar el lote.
        for (const evento of lote) {
            clavesEnviadas.add(evento.movement_key);
        }

        estado.enviados = [...clavesEnviadas];
        guardarEstado(estado);

        totalRecibidos += recibidos;
        totalNuevos += nuevos;
        totalDuplicados += duplicados;

        console.log(
            `Lote ${numeroLote}: ${recibidos} recibidos, ` +
            `${nuevos} nuevos, ${duplicados} duplicados omitidos. ` +
            'Estado guardado.'
        );
    }

    console.log('\nEnvío terminado.');
    console.log(`Total recibido por el simulador: ${totalRecibidos}`);
    console.log(`Eventos nuevos almacenados: ${totalNuevos}`);
    console.log(`Duplicados omitidos por el simulador: ${totalDuplicados}`);
    console.log(`Claves registradas en: ${archivoEstado}`);
}

main().catch(error => {
    console.error('\nError durante el envío:', error.message);
    process.exitCode = 1;
});
