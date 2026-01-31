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

// --- 1. CONSTRUCTOR DE DB PROFESIONAL (100% COMPLETO) ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance_usdt DECIMAL DEFAULT 0,
                balance_congelado DECIMAL DEFAULT 0,
                rol TEXT DEFAULT 'usuario',
                is_admin BOOLEAN DEFAULT false,
                kyc_status TEXT DEFAULT 'verificado',
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM DB: Tabla de usuarios reiniciada y limpia.");
    } catch (err) {
        console.error("❌ Error inicializando DB:", err.message);
    }
};
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER,
                comprador_id INTEGER,
                monto_usdt DECIMAL,
                monto_bs DECIMAL,
                comision_usdt DECIMAL,
                tipo TEXT,
                estatus TEXT DEFAULT 'ABIERTA',
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER,
                enviado_por TEXT,
                texto TEXT,
                archivo_url TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM ENGINE: Sistema de Mercado y Seguridad cargado.");
    } catch (err) { console.error("❌ Error inicializando sistema:", err.message); }
};
initDB();

// --- 2. RUTA MAESTRA DE ADMINISTRACIÓN ---
app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const query = `
            UPDATE users 
            SET balance_usdt = 10000, 
                is_admin = true, 
                rol = 'admin', 
                verificado = true, 
                kyc_status = 'verificado' 
            WHERE email = $1 OR username = $1 
            RETURNING *`;
        const result = await pool.query(query, [miEmail]);
        if (result.rowCount > 0) {
            res.send("<div style='text-align:center;padding:50px;font-family:sans-serif;'><h1>✅ ACCESO NIVEL DIOS ACTIVADO</h1><p>El usuario " + miEmail + " ahora tiene 10,000 USDT y es el Administrador de la plataforma.</p><a href='/'>ENTRAR AL MERCADO</a></div>");
        } else {
            res.send("<h1>⚠️ Error: El usuario no existe en la base de datos. Regístrate primero.</h1>");
        }
    } catch (err) { res.status(500).send("Error de sistema: " + err.message); }
});

// --- 3. RUTAS DE USUARIO Y REGISTRO ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)', 
            [username, email, password]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Error detalle:", err);
        res.status(500).json({ error: "Error en el servidor o usuario duplicado" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false, message: "Credenciales inválidas" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. LÓGICA DE MERCADO P2P Y ESCROW ---
app.get('/api/mercado', async (req, res) => {
    try {
        const result = await pool.query("SELECT o.*, u.username, u.reputacion FROM orders o JOIN users u ON o.vendedor_id = u.id WHERE o.estatus = 'ABIERTA'");
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price, tipo } = req.body;
    const comision = amount * 0.01;
    try {
        await pool.query('BEGIN');
        const user = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (user.rows[0].balance_usdt < amount) throw new Error("Saldo insuficiente en balance principal");
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1, balance_congelado = balance_congelado + $1 WHERE id = $2', [amount, seller_id]);
        const nueva = await pool.query('INSERT INTO orders (vendedor_id, monto_usdt, monto_bs, comision_usdt, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id', [seller_id, amount, price, comision, tipo]);
        await pool.query('COMMIT');
        io.emit('nuevo_anuncio');
        res.json({ success: true, id: nueva.rows[0].id });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    }
});

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, vendedorId, compradorId, monto } = req.body;
    const neto = monto - (monto * 0.01);
    try {
        await pool.query('BEGIN');
        await pool.query('UPDATE users SET balance_congelado = balance_congelado - $1 WHERE id = $2', [monto, vendedorId]);
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [neto, compradorId]);
        await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        await pool.query('COMMIT');
        io.to("orden_" + ordenId).emit('finalizado', { ordenId });
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: "Fallo en la liberación." });
    }
});

// --- 5. SOCKETS Y CHAT MULTIMEDIA ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', async (id) => {
        socket.join("orden_" + id);
        const msgs = await pool.query('SELECT * FROM messages WHERE orden_id = $1 ORDER BY fecha ASC', [id]);
        socket.emit('historial_chat', msgs.rows);
    });
    socket.on('msg_p2p', async (data) => {
        await pool.query('INSERT INTO messages (orden_id, enviado_por, texto) VALUES ($1, $2, $3)', [data.ordenId, data.user, data.msg]);
        io.to("orden_" + data.ordenId).emit('update_chat', data);
        io.to("orden_" + data.ordenId).emit('notificar_visual', { de: data.user });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR PROFESIONAL LIVE EN PUERTO ${PORT}`));
