const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// 1. CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 2. RUTA PRINCIPAL (CARGA EL HTML)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. SISTEMA DE LOGIN
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.json({ success: false, message: "Usuario o clave incorrecta" });
        }
    } catch (err) {
        console.error("Error en login:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 4. MERCADO Y ÓRDENES (COMPLETO)
app.get('/ordenes', async (req, res) => {
    try {
        const { user_id, historico } = req.query;
        let query = "SELECT * FROM orders WHERE estatus = 'ABIERTA'";
        if (historico === 'true') {
            query = `SELECT * FROM orders WHERE (vendedor_id = $1 OR comprador_id = $1) AND estatus = 'FINALIZADA' ORDER BY id DESC LIMIT 10`;
            const r = await pool.query(query, [user_id]);
            return res.json(r.rows);
        }
        const r = await pool.query(query);
        res.json(r.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. LIBERACIÓN DE FONDOS (LÓGICA P2P)
app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, vendedorId, compradorId, monto } = req.body;
    try {
        await pool.query('BEGIN');
        // Descontar al vendedor
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [monto, vendedorId]);
        // Sumar al comprador
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        // Finalizar orden
        await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        
        await pool.query('COMMIT');
        
        // Notificar por sockets que la orden terminó
        io.emit('finalizado', { ordenId });
        res.json({ ok: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error en liberación:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// 6. SOCKETS CON NOTIFICACIÓN VISUAL (EL "ALUMBRE")
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => {
        socket.join("orden_" + id);
    });

    socket.on('msg_p2p', (data) => {
        // Enviar mensaje al chat
        io.to("orden_" + data.ordenId).emit('update_chat', data);
        // Enviar señal de notificación visual (para que alumbre)
        io.to("orden_" + data.ordenId).emit('notificar_mensaje', { de: data.user });
    });
});

// 7. PUERTO DINÁMICO PARA RENDER
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PLATINUM V3 - FULL AUTO en puerto ${PORT}`);
});
