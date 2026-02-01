const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const b4a = require('b4a');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// MIDDLEWARES
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CONEXIÓN A BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. MOTOR P2P (HYPERSWARM) ---
const swarm = new Hyperswarm();
const topic = crypto.createHash('sha256').update('platinum-p2p-elite-network').digest();

async function startP2P() {
    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();
    console.log('🌐 Red P2P Platinum Sincronizada');
}

swarm.on('connection', (conn, info) => {
    conn.on('data', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            io.emit('p2p_broadcast', msg);
        } catch (e) { /* Replicación silenciosa */ }
    });
});

// --- 2. BASE DE DATOS (ESTRUCTURA COMPLETA) ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance_usdt DECIMAL DEFAULT 0,
                is_admin BOOLEAN DEFAULT false,
                kyc_status TEXT DEFAULT 'verificado'
            );
            CREATE TABLE IF NOT EXISTS ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL NOT NULL,
                monto_bs DECIMAL NOT NULL,
                estatus TEXT DEFAULT 'ABIERTA',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM DB: Todo el sistema está listo.");
    } catch (err) { console.error("❌ Error DB:", err.message); }
};

// --- 3. RUTAS DE USUARIO Y LOGIN ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', [username, email, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: "Usuario o correo duplicado" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false, message: "Credenciales inválidas" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1 OR username = $1 RETURNING *", [miEmail]);
        if (result.rowCount > 0) {
            res.send("<h1>✅ NIVEL DIOS ACTIVADO</h1><a href='/'>VOLVER AL MERCADO</a>");
        } else {
            res.send("<h1>⚠️ Debes registrarte primero con: " + miEmail + "</h1>");
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 4. RUTAS DEL MERCADO (P2P ENGINE) ---

app.get('/api/mercado', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, u.username FROM ordenes o 
            JOIN users u ON o.vendedor_id = u.id 
            WHERE o.estatus = 'ABIERTA' ORDER BY o.id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    try {
        // Bloqueo de fondos (Escrow)
        const check = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (parseFloat(check.rows[0].balance_usdt) < parseFloat(amount)) return res.status(400).json({ error: "Saldo insuficiente" });

        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        await pool.query('INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs) VALUES ($1, $2, $3)', [seller_id, amount, price]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, compradorId, monto } = req.body;
    try {
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        await pool.query("UPDATE ordenes SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        io.to("orden_" + ordenId).emit('transaccion_completa');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. CHAT, NOTIFICACIONES Y SOCKETS ---

io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => socket.join("orden_" + id));
    
    socket.on('msg_p2p', (data) => {
        // El mensaje se envía a la sala y se emite notificación global
        io.to("orden_" + data.ordenId).emit('update_chat', {
            user: data.user,
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
        socket.broadcast.emit('notificacion_global', { from: data.user, type: 'MENSAJE' });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    initDB();
    startP2P();
    console.log(`🚀 PLATINUM SERVER LIVE ON PORT ${PORT}`);
});
