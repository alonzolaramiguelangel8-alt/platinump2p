const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. AUTO-INSTALADOR DE TABLAS PROFESIONAL ---
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                balance_usdt DECIMAL DEFAULT 0,
                balance_congelado DECIMAL DEFAULT 0,
                rol TEXT DEFAULT 'usuario',
                kyc_status TEXT DEFAULT 'no_iniciado',
                foto_cedula TEXT,
                video_rostro TEXT,
                reputacion INTEGER DEFAULT 100
            );
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
        console.log("✅ Base de Datos v18 Sincronizada y Tablas Creadas");
    } catch (err) { console.error("❌ Error inicializando DB:", err.message); }
};
initDB();

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- 2. REGISTRO Y LOGIN ---
app.post('/registro', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "El usuario ya existe" }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (r.rows.length > 0) res.json({ success: true, user: r.rows[0] });
        else res.status(401).json({ success: false, message: "Credenciales inválidas" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. LÓGICA P2P: ESCROW (CUSTODIA DE ACTIVOS) ---
app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price, tipo } = req.body;
    const comision = amount * 0.01; // 1% de comisión
    try {
        await pool.query('BEGIN');
        const user = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (user.rows[0].balance_usdt < amount) throw new Error("Saldo insuficiente en balance principal");

        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1, balance_congelado = balance_congelado + $1 WHERE id = $2', [amount, seller_id]);
        
        const nuevaOrden = await pool.query(
            'INSERT INTO orders (vendedor_id, monto_usdt, monto_bs, comision_usdt, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [seller_id, amount, price, comision, tipo]
        );
        
        await pool.query('COMMIT');
        io.emit('nuevo_anuncio');
        res.json({ success: true, ordenId: nuevaOrden.rows[0].id });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(400).json({ error: err.message });
    }
});

// --- 4. LIBERACIÓN DE FONDOS (FINALIZACIÓN) ---
app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, vendedorId, compradorId, monto } = req.body;
    const comision = monto * 0.01;
    const neto = monto - comision;
    try {
        await pool.query('BEGIN');
        await pool.query('UPDATE users SET balance_congelado = balance_congelado - $1 WHERE id = $2', [monto, vendedorId]);
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [neto, compradorId]);
        await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
        await pool.query('COMMIT');
        
        io.to("orden_" + ordenId).emit('finalizado', { ordenId });
        res.json({ ok: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ ok: false, error: err.message });
    }
});

// --- 5. SOCKETS CON CHAT PERSISTENTE Y NOTIFICACIÓN VISUAL ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', async (id) => {
        socket.join("orden_" + id);
        // Enviamos los mensajes guardados al usuario que entra
        const msgs = await pool.query('SELECT * FROM messages WHERE orden_id = $1 ORDER BY fecha ASC', [id]);
        socket.emit('historial_chat', msgs.rows);
    });

    socket.on('msg_p2p', async (data) => {
        // Guardar en Base de Datos
        await pool.query('INSERT INTO messages (orden_id, enviado_por, texto) VALUES ($1, $2, $3)', [data.ordenId, data.user, data.msg]);
        
        // Enviar a los demás en tiempo real
        io.to("orden_" + data.ordenId).emit('update_chat', data);
        
        // Señal para el efecto visual de "alumbrar"
        io.to("orden_" + data.ordenId).emit('notificar_mensaje', { de: data.user });
    });
});
app.get('/admin-power-up', async (req, res) => {
    try {
        // 1. Crear la tabla de usuarios por si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password TEXT,
                saldo_usdt DECIMAL DEFAULT 0,
                is_admin BOOLEAN DEFAULT false,
                verificado BOOLEAN DEFAULT false,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Intentar darte los poderes
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query(
            'UPDATE usuarios SET saldo_usdt = 10000, is_admin = true, verificado = true WHERE email = $1',
            [miEmail]
        );
        
        if (result.rowCount > 0) {
            res.send(`<h1>✅ ¡TABLA CREADA Y PODER ACTIVADO!</h1><p>El usuario ${miEmail} ya es Admin con 10,000 USDT.</p>`);
        } else {
            res.send(`<h1>📦 Tabla creada con éxito</h1><p>Pero el usuario ${miEmail} aún no existe. <b>Regístrate ahora en la web</b> y luego vuelve a este link.</p>`);
        }
    } catch (err) {
        res.status(500).send("Error crítico: " + err.message);
    }

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PLATINUM V3 - SISTEMA PROFESIONAL LIVE EN PUERTO ${PORT}`);
});
