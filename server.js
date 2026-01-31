const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const Hyperswarm = require('hyperswarm'); // Reincorporamos P2P
const crypto = require('crypto');
const b4a = require('b4a');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// MIDDLEWARES
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CONEXIÓN DB (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. INICIALIZACIÓN DE TABLAS ---
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
        console.log("✅ PLATINUM DB: Tablas listas.");
    } catch (err) { console.error("❌ Error DB:", err.message); }
};
initDB();

// --- 2. LÓGICA P2P (HYPERSWARM) ---
const swarm = new Hyperswarm();
const topic = crypto.createHash('sha256').update('platinum-p2p-network').digest();
swarm.join(topic);
swarm.on('connection', (conn) => {
    console.log('🌐 Nueva conexión P2P detectada');
    conn.on('data', data => io.emit('p2p_data', data.toString()));
});

// --- 3. RUTAS DE ACCESO ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', 
            [username, email, password]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Error en registro" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false, message: "No coincide" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1", [miEmail]);
        res.send("<h1>✅ ADMIN ACTIVADO</h1><a href='/'>Volver</a>");
    } catch (err) { res.status(500).send(err.message); }
});

// --- 4. RUTAS MERCADO ---

app.get('/api/mercado', async (req, res) => {
    const r = await pool.query("SELECT o.*, u.username FROM ordenes o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA'");
    res.json(r.rows);
});

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    try {
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        await pool.query('INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs) VALUES ($1, $2, $3)', [seller_id, amount, price]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. SOCKETS ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => socket.join("orden_" + id));
    socket.on('msg_p2p', (data) => io.to("orden_" + data.ordenId).emit('update_chat', data));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 PLATINUM P2P LIVE EN PUERTO ${PORT}`));
