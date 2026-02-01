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

// --- CONFIGURACIÓN ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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
    console.log('🌐 Red P2P Sincronizada');
}

swarm.on('connection', (conn, info) => {
    conn.on('data', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            io.emit('p2p_broadcast', msg);
        } catch (e) { }
    });
});

// --- 2. BASE DE DATOS ---
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
        console.log("✅ DB Lista");
    } catch (err) { console.error(err); }
};

// --- 3. RUTAS DE ACCESO ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', [username, email, password]);
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

app.get('/admin-power-up', async (req, res) => {
    const miEmail = 'alonzolaramiguelangel@gmail.com';
    const result = await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1 OR username = $1 RETURNING *", [miEmail]);
    if (result.rowCount > 0) {
        res.send("<h1>✅ NIVEL DIOS ACTIVADO</h1><a href='/'>VOLVER</a>");
    } else {
        res.send("<h1>⚠️ Regístrate primero con el correo: " + miEmail + "</h1>");
    }
});

// --- 4. MERCADO P2P & ESCROW ---
app.get('/api/mercado', async (req, res) => {
    const result = await pool.query("SELECT o.*, u.username FROM ordenes o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA'");
    res.json(result.rows);
});

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    const check = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
    if (parseFloat(check.rows[0].balance_usdt) < parseFloat(amount)) return res.status(400).json({ error: "Saldo insuficiente" });
    
    await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
    await pool.query('INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs) VALUES ($1, $2, $3)', [seller_id, amount, price]);
    res.json({ success: true });
});

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, compradorId, monto } = req.body;
    await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
    await pool.query("UPDATE ordenes SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
    io.to("orden_" + ordenId).emit('finalizado');
    res.json({ success: true });
});

// --- 5. CHAT & NOTIFICACIONES ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => socket.join("orden_" + id));
    socket.on('msg_p2p', (data) => {
        io.to("orden_" + data.ordenId).emit('update_chat', {
            user: data.user,
            text: data.text,
            time: new Date().toLocaleTimeString()
        });
        socket.broadcast.emit('notificacion_global', { from: data.user });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    initDB();
    startP2P();
    console.log(`🚀 PLATINUM LIVE`);
});
