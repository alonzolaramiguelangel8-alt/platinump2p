const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. BASE DE DATOS PROFESIONAL (MERCADO Y USUARIOS) ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password TEXT,
                balance_usdt DECIMAL DEFAULT 0,
                balance_congelado DECIMAL DEFAULT 0,
                rol TEXT DEFAULT 'usuario',
                kyc_status TEXT DEFAULT 'no_iniciado',
                reputacion INTEGER DEFAULT 100,
                is_admin BOOLEAN DEFAULT false,
                verificado BOOLEAN DEFAULT false,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER,
                comprador_id INTEGER,
                monto_usdt DECIMAL,
                monto_bs DECIMAL,
                tasa_cambio DECIMAL,
                comision_usdt DECIMAL,
                tipo TEXT, -- 'COMPRA' o 'VENTA'
                estatus TEXT DEFAULT 'ABIERTA', -- 'ABIERTA', 'PROCESO', 'FINALIZADA', 'DISPUTA'
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER,
                enviado_por TEXT,
                texto TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ SISTEMA PLATINUM: Mercado y Escrow sincronizados.");
    } catch (err) { console.error("❌ Error DB:", err.message); }
};
initDB();

// --- 2. RUTA DE ACTIVACIÓN (ADMIN & SALDO) ---
app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query(
            "UPDATE users SET balance_usdt = 10000, is_admin = true, rol = 'admin', verificado = true WHERE email = $1 OR username = $1 RETURNING *",
            [miEmail]
        );
        if (result.rowCount > 0) {
            res.send(`<h1 style='color:green'>✅ ¡PODER TOTAL ACTIVADO!</h1><p>Usuario ${miEmail} tiene 10,000 USDT y es Admin.</p><a href='/'>Ir al Mercado</a>`);
        } else {
            res.send("<h1>⚠️ No se encontró el usuario.</h1><p>Regístrate primero en la web.</p>");
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 3. FUNCIONES DEL MERCADO P2P ---
// Obtener todos los anuncios activos
app.get('/api/mercado', async (req, res) => {
    try {
        const anuncios = await pool.query("SELECT o.*, u.username, u.reputacion FROM orders o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA' ORDER BY o.fecha DESC");
        res.json(anuncios.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear anuncio de venta (congelando saldo)
app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price, tipo } = req.body;
    const comision = amount * 0.01;
    try {
        await pool.query('BEGIN');
        const user = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (user.rows[0].balance_usdt < amount) throw new Error("Saldo insuficiente");

        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1, balance_congelado = balance_congelado + $1 WHERE id = $2', [amount, seller_id]);
        const nueva = await pool.query('INSERT INTO orders (vendedor_id, monto_usdt, monto_bs, comision_usdt, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id', [seller_id, amount, price, comision, tipo]);
        await pool.query('COMMIT');
        io.emit('nuevo_anuncio');
        res.json({ success: true, ordenId: nueva.rows[0].id });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    }
});

// --- 4. CHAT Y FINALIZACIÓN ---
app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, vendedorId, compradorId, monto } = req.body;
    const neto = monto - (monto * 0.01);
    try {
        await pool.query('BEGIN');
        await pool.query('UPDATE users SET balance_congelado = balance_congelado - $1 WHERE id = $2', [monto, vendedorId]);
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [neto, compradorId]);
        await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        await pool.query('COMMIT');
        io.to(`orden_${ordenId}`).emit('finalizado', { ordenId });
        res.json({ ok: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ ok: false });
    }
});

io.on('connection', (socket) => {
    socket.on('unirse_p2p', async (id) => {
        socket.join(`orden_${id}`);
        const msgs = await pool.query('SELECT * FROM messages WHERE orden_id = $1 ORDER BY fecha ASC', [id]);
        socket.emit('historial_chat', msgs.rows);
    });
    socket.on('msg_p2p', async (data) => {
        await pool.query('INSERT INTO messages (orden_id, enviado_por, texto) VALUES ($1, $2, $3)', [data.ordenId, data.user, data.msg]);
        io.to(`orden_${data.ordenId}`).emit('update_chat', data);
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 PLATINUM P2P PRO ACTIVO EN PUERTO ${PORT}`));
