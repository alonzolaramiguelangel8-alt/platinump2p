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
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- MOTOR P2P (HYPERSWARM) ---
const swarm = new Hyperswarm();
const topic = crypto.createHash('sha256').update('platinum-p2p-elite-network').digest();

async function startP2P() {
    const discovery = swarm.join(topic, { client: true, server: true });
    await discovery.flushed();
    console.log('🌐 Red P2P Platinum Sincronizada');
}

swarm.on('connection', (conn, info) => {
    const peerId = b4a.toString(info.publicKey, 'hex');
    conn.on('data', (data) => {
        try {
            const mensaje = JSON.parse(data.toString());
            io.emit('p2p_update', mensaje);
        } catch (e) { /* Silencioso */ }
    });
});

// --- INICIALIZACIÓN DE TABLAS ---
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
        console.log("✅ Tablas listas");
    } catch (err) { console.error("❌ Error DB:", err.message); }
};

// --- RUTAS ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mercado', async (req, res) => {
    const result = await pool.query("SELECT o.*, u.username FROM ordenes o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA' ORDER BY o.id DESC");
    res.json(result.rows);
});

app.get('/admin-power-up', async (req, res) => {
    const email = 'alonzolaramiguelangel@gmail.com';
    await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1", [email]);
    res.send("<h1>💎 ACCESO ELITE ACTIVADO</h1><a href='/'>VOLVER</a>");
});

// --- CHAT Y NOTIFICACIONES ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (ordenId) => socket.join(`orden_${ordenId}`));
    socket.on('msg_p2p', (data) => {
        io.to(`orden_${data.ordenId}`).emit('update_chat', {
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
    console.log(`🚀 PLATINUM LIVE`);
});;

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
