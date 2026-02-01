const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- BASE DE DATOS ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password TEXT,
                balance_usdt DECIMAL DEFAULT 0,
                is_admin BOOLEAN DEFAULT false
            );
            CREATE TABLE IF NOT EXISTS ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL,
                monto_bs DECIMAL,
                estatus TEXT DEFAULT 'ABIERTA'
            );
        `);
        console.log("✅ DB Conectada");
    } catch (err) { console.log("❌ Error DB:", err.message); }
};
initDB();

// --- RUTAS ---

// 1. Cargar la App (Asegúrate que index.html esté en carpeta /public)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Registro
app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, email, password) VALUES ($1, $2, $3)', [username, email, password]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1 AND password=$2', [username, password]);
    if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
    else res.status(401).json({ success: false });
});

// 4. Mercado
app.get('/api/mercado', async (req, res) => {
    const r = await pool.query("SELECT o.*, u.username FROM ordenes o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA'");
    res.json(r.rows);
});

// 5. Admin (Modo Dios)
app.get('/admin-power-up', async (req, res) => {
    const email = 'alonzolaramiguelangel@gmail.com';
    await pool.query("UPDATE users SET balance_usdt = 10000, is_admin = true WHERE email = $1", [email]);
    res.send("<h1>Nivel DIOS Activado</h1><a href='/'>Ir a la App</a>");
});

// --- CHAT Y NOTIFICACIONES EN VIVO ---
io.on('connection', (socket) => {
    socket.on('join_chat', (ordenId) => {
        socket.join(`orden_${ordenId}`);
    });

    socket.on('send_msg', (data) => {
        // Esto envía el mensaje y la notificación al chat de la orden
        io.to(`orden_${data.ordenId}`).emit('new_msg', {
            user: data.user,
            msg: data.msg,
            time: new Date().toLocaleTimeString()
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
