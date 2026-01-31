const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

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

// --- 1. INICIALIZACIÓN DE TABLAS ---
const initDB = async () => {
    try {
        await pool.query('DROP TABLE IF EXISTS ordenes CASCADE;');
        await pool.query('DROP TABLE IF EXISTS users CASCADE;');

        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance_usdt DECIMAL DEFAULT 0,
                is_admin BOOLEAN DEFAULT false,
                kyc_status TEXT DEFAULT 'verificado'
            );
        `);

        await pool.query(`
            CREATE TABLE ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL NOT NULL,
                monto_bs DECIMAL NOT NULL,
                estatus TEXT DEFAULT 'ABIERTA',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM DB: Todo listo.");
    } catch (err) {
        console.error("❌ Error DB:", err.message);
    }
};
initDB();

// --- 2. RUTAS DE ACCESO ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query(
            "UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1 OR username = $1 RETURNING *",
            [miEmail]
        );
        if (result.rowCount > 0) {
            res.send("<div style='text-align:center;padding:50px;'><h1>✅ ADMIN ACTIVADO</h1><a href='/'>VOLVER</a></div>");
        } else {
            res.send("<h1>⚠️ Regístrate primero en la app</h1>");
        }
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', 
            [username, email, password]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "Usuario duplicado o error de DB" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false, message: "No coincide" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. RUTAS MERCADO ---

app.get('/api/mercado', async (req, res) => {
    try {
        const result = await pool.query("SELECT o.*, u.username FROM ordenes o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA'");
        res.json(result.rows);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    try {
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        await pool.query('INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs) VALUES ($1, $2, $3)', [seller_id, amount, price]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. SOCKETS ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => socket.join("orden_" + id));
    socket.on('msg_p2p', (data) => io.to("orden_" + data.ordenId).emit('update_chat', data));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 LIVE ON PORT ${PORT}`));
