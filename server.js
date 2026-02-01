const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// CONFIGURACIÓN ESTÁTICOS
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- MOTOR P2P (HYPERSWARM) ---
const swarm = new Hyperswarm();
const topic = crypto.createHash('sha256').update('platinum-p2p-elite-network-v2').digest();

async function startP2P() {
    try {
        const discovery = swarm.join(topic, { client: true, server: true });
        swarm.on('error', (err) => console.log('P2P Network Status:', err.message));
        await discovery.flushed();
        console.log('🌐 Red P2P Sincronizada y Segura');
    } catch (e) { console.error('P2P Engine Error:', e.message); }
}

// --- INICIALIZACIÓN DE TABLAS AVANZADAS ---
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
                estatus TEXT DEFAULT 'ABIERTA', -- ABIERTA, PROCESO, DISPUTA, FINALIZADA
                comprobante_url TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS mensajes (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER REFERENCES ordenes(id),
                remitente_id INTEGER REFERENCES users(id),
                texto TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM DB: Motor de Datos Online.");
    } catch (err) { console.error("❌ DB Init Error:", err.message); }
};

// --- RUTAS DE SISTEMA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ACCESO DIOS (CORREGIDO)
app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1 OR username = $1 RETURNING *", [miEmail]);
        if(result.rowCount > 0) {
            res.send("<div style='background:#000;color:#0ff;padding:50px;text-align:center;font-family:mono;'><h1>💎 ACCESO ELITE ACTIVADO</h1><p>Saldo: 10,000 USDT inyectados.</p><a href='/' style='color:#fff;'>IR AL DASHBOARD</a></div>");
        } else {
            res.send("<h1>⚠️ Usuario no encontrado. Regístrate primero.</h1>");
        }
    } catch (err) { res.status(500).send("Error de inyección"); }
});

// --- GESTIÓN DE USUARIOS ---
app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', [username, email, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: "Datos duplicados" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- LÓGICA DE MERCADO P2P (ESCROW) ---
app.get('/api/mercado', async (req, res) => {
    const result = await pool.query(`
        SELECT o.*, u.username as vendedor_name 
        FROM ordenes o 
        JOIN users u ON o.vendedor_id = u.id 
        WHERE o.estatus = 'ABIERTA' ORDER BY o.id DESC
    `);
    res.json(result.rows);
});

app.post('/api/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    try {
        const check = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (parseFloat(check.rows[0].balance_usdt) < parseFloat(amount)) {
            return res.status(400).json({ error: "Saldo insuficiente para Escrow" });
        }
        // Bloqueo de fondos (Escrow)
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        await pool.query('INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs, estatus) VALUES ($1, $2, $3, $4)', [seller_id, amount, price, 'ABIERTA']);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tomar-orden', async (req, res) => {
    const { orden_id, comprador_id } = req.body;
    await pool.query("UPDATE ordenes SET comprador_id = $1, estatus = 'PROCESO' WHERE id = $2", [comprador_id, orden_id]);
    res.json({ success: true });
});

app.post('/api/liberar', async (req, res) => {
    const { orden_id } = req.body;
    try {
        const orden = await pool.query("SELECT * FROM ordenes WHERE id = $1", [orden_id]);
        const { comprador_id, monto_usdt } = orden.rows[0];
        // Transferencia final
        await pool.query("UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2", [monto_usdt, comprador_id]);
        await pool.query("UPDATE ordenes SET estatus = 'FINALIZADA' WHERE id = $1", [orden_id]);
        io.to(`orden_${orden_id}`).emit('orden_finalizada');
        res.json({ success: true });
    } catch (err) { res.status(500).send(err.message); }
});

// --- SOCKETS: CHAT Y NOTIFICACIONES REAL-TIME ---
io.on('connection', (socket) => {
    socket.on('join_chat', (ordenId) => {
        socket.join(`orden_${ordenId}`);
    });

    socket.on('send_msg', async (data) => {
        const { ordenId, userId, texto } = data;
        await pool.query("INSERT INTO mensajes (orden_id, remitente_id, texto) VALUES ($1, $2, $3)", [ordenId, userId, texto]);
        io.to(`orden_${ordenId}`).emit('new_msg', { userId, texto, time: new Date() });
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    initDB();
    startP2P();
    console.log(`🚀 PLATINUM ENGINE LIVE ON PORT ${PORT}`);
});
