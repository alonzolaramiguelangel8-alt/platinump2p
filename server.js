const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 1. RUTA RAÍZ (CARGA EL HTML)
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("ERROR DE PERMISOS:", err.message);
            res.status(500).send("Error de servidor al leer index.html");
        }
    });
});

// 2. HISTORIAL Y MERCADO P2P (COMPLETO)
app.get('/ordenes', async (req, res) => {
    try {
        const { user_id, historico } = req.query;
        let query;
        let params = [];

        if (historico === 'true') {
            // Carga las órdenes terminadas o donde el usuario participó
            query = `SELECT * FROM orders 
                     WHERE (vendedor_id = $1 OR comprador_id = $1) 
                     AND estatus = 'FINALIZADA' 
                     ORDER BY id DESC LIMIT 10`;
            params = [user_id];
        } else {
            // Carga solo las órdenes disponibles para comprar/vender
            query = "SELECT * FROM orders WHERE estatus = 'ABIERTA' ORDER BY id DESC";
        }

        const r = await pool.query(query, params);
        res.json(r.rows);
    } catch (err) {
        console.error("Error en mercado:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. LIBERACIÓN DE FONDOS (TRANSACCIÓN)
app.post('/liberar-fondos', async (req, res) => {
    try {
        const { ordenId, vendedorId, compradorId, monto } = req.body;
        await pool.query('BEGIN');
        
        // Descontar al vendedor
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [monto, vendedorId]);
        // Sumar al comprador
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        // Finalizar orden
        await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        
        await pool.query('COMMIT');
        
        io.emit('finalizado', { ordenId });
        res.json({ ok: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error en liberación:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// 4. SOCKETS (CHAT Y NOTIFICACIONES)
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => {
        socket.join("orden_" + id);
    });

    socket.on('msg_p2p', (data) => {
        // Reenvía el mensaje a la sala de la orden específica
        io.to("orden_" + data.ordenId).emit('update_chat', data);
    });
});

// 5. PUERTO DINÁMICO PARA RENDER
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PLATINUM V3 - FULL AUTO en puerto ${PORT}`);
});
