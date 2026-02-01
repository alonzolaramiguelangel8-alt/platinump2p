const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// --- CONFIGURACIÓN GLOBAL ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. ARQUITECTURA DE BASE DE DATOS AMPLIADA ---
const initDB = async () => {
    try {
        // Tablas base (Users, Ordenes, Chats)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance_usdt DECIMAL(18,8) DEFAULT 0,
                is_admin BOOLEAN DEFAULT false,
                kyc_status TEXT DEFAULT 'verificado',
                reputacion INTEGER DEFAULT 100,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL(18,8) NOT NULL,
                monto_bs DECIMAL(18,2) NOT NULL,
                tasa_cambio DECIMAL(18,2),
                estatus TEXT DEFAULT 'ABIERTA', -- ABIERTA, PROCESANDO, DISPUTA, FINALIZADA, CANCELADA
                tipo TEXT DEFAULT 'VENTA',
                metodo_pago TEXT,
                comprobante_url TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_cierre TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER REFERENCES ordenes(id) ON DELETE CASCADE,
                remitente_id INTEGER REFERENCES users(id),
                mensaje TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Nueva Tabla de Auditoría/Transacciones
            CREATE TABLE IF NOT EXISTS transacciones (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                orden_id INTEGER REFERENCES ordenes(id),
                tipo TEXT, -- INGRESO, EGRESO, BLOQUEO, LIBERACION
                monto DECIMAL(18,8),
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("💎 PLATINUM ENGINE: Motor Total Cargado.");
    } catch (err) {
        console.error("❌ CRITICAL DB ERROR:", err.message);
    }
};
initDB();

// --- 2. RUTAS DE ADMINISTRACIÓN ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query(`
            UPDATE users 
            SET balance_usdt = balance_usdt + 10000, is_admin = true, reputacion = 1000
            WHERE email = $1 OR username = $1 RETURNING *`, [miEmail]);
        if (result.rowCount > 0) {
            res.send("<h1 style='color:cyan; background:black; padding:50px;'>💎 SISTEMA RECARGADO: 10,000 USDT ACTIVOS</h1>");
        } else {
            res.status(404).send("Usuario no registrado.");
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 3. AUTENTICACIÓN ---

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const newUser = await pool.query(
            'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
            [username, email, password]
        );
        res.json({ success: true, user: newUser.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: "Usuario o Email ya existe." }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2', [username, password]);
        if (result.rows.length > 0) res.json({ success: true, user: result.rows[0] });
        else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 4. MOTOR P2P AVANZADO ---

// Tomar una orden (Iniciar proceso de compra)
app.post('/api/tomar-orden', async (req, res) => {
    const { orden_id, comprador_id } = req.body;
    try {
        const result = await pool.query(
            "UPDATE ordenes SET comprador_id = $1, estatus = 'PROCESANDO' WHERE id = $2 AND estatus = 'ABIERTA' RETURNING *",
            [comprador_id, orden_id]
        );
        if(result.rowCount > 0) {
            io.to("orden_" + orden_id).emit('status_update', { status: 'PROCESANDO' });
            res.json({ success: true, orden: result.rows[0] });
        } else {
            res.status(400).json({ error: "Orden no disponible." });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reportar Pago (El comprador notifica que ya envió el dinero Fiat)
app.post('/api/reportar-pago', async (req, res) => {
    const { orden_id } = req.body;
    try {
        await pool.query("UPDATE ordenes SET estatus = 'PAGADO' WHERE id = $1", [orden_id]);
        io.to("orden_" + orden_id).emit('status_update', { status: 'PAGADO' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Iniciar Disputa
app.post('/api/disputa', async (req, res) => {
    const { orden_id, motivo } = req.body;
    try {
        await pool.query("UPDATE ordenes SET estatus = 'DISPUTA' WHERE id = $1", [orden_id]);
        io.to("orden_" + orden_id).emit('status_update', { status: 'DISPUTA', motivo });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 5. LÓGICA DE ESCROW Y CIERRE ---

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, compradorId, monto } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 1. Abonar al comprador
        await client.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        // 2. Marcar orden como finalizada
        await client.query("UPDATE ordenes SET estatus = 'FINALIZADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1", [ordenId]);
        // 3. Registrar transacción
        await client.query('INSERT INTO transacciones (user_id, orden_id, tipo, monto) VALUES ($1, $2, $3, $4)', [compradorId, ordenId, 'LIBERACION', monto]);
        
        await client.query('COMMIT');
        io.to("orden_" + ordenId).emit('finalizado', { status: 'SUCCESS' });
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally { client.release(); }
});

// --- 6. SOCKETS ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (ordenId) => socket.join("orden_" + ordenId));
    socket.on('msg_p2p', async (data) => {
        try {
            await pool.query('INSERT INTO chats (orden_id, remitente_id, mensaje) VALUES ($1, $2, $3)', 
                [data.ordenId, data.user_id, data.message]);
            io.to("orden_" + data.ordenId).emit('update_chat', data);
        } catch (e) { console.error(e); }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PLATINUM ENGINE TOTAL LIVE ON PORT: ${PORT}`);
});
