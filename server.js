const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e7 // Soporte para envío de imágenes en chat
});

// --- CONFIGURACIÓN DE SEGURIDAD Y MIDDLEWARES ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. BASE DE DATOS: ARQUITECTURA DE GRADO BANCARIO ---
const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Usuarios con Metadatos de Seguridad
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance_usdt DECIMAL(20,8) DEFAULT 0,
                is_admin BOOLEAN DEFAULT false,
                kyc_status TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, EN_REVISION, APROBADO, RECHAZADO
                kyc_data JSONB DEFAULT '{}',
                reputacion INTEGER DEFAULT 100,
                ventas_completadas INTEGER DEFAULT 0,
                compras_completadas INTEGER DEFAULT 0,
                baneado BOOLEAN DEFAULT false,
                ultima_conexion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Mercado P2P con Trazabilidad Total
        await client.query(`
            CREATE TABLE IF NOT EXISTS ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                complainant_id INTEGER REFERENCES users(id), -- Para disputas
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL(20,8) NOT NULL,
                monto_bs DECIMAL(20,2) NOT NULL,
                precio_unidad DECIMAL(20,2),
                estatus TEXT DEFAULT 'ABIERTA', -- ABIERTA, RESERVADA, PAGADA, DISPUTA, FINALIZADA, CANCELADA
                metodo_pago TEXT NOT NULL,
                datos_pago JSONB DEFAULT '{}',
                comprobante_pago_url TEXT,
                vencimiento TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + interval '30 minutes')
            );
        `);

        // Sistema de Mensajería con Soporte de Archivos/Base64
        await client.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER REFERENCES ordenes(id) ON DELETE CASCADE,
                remitente_id INTEGER REFERENCES users(id),
                mensaje TEXT,
                archivo_adjunto TEXT, -- Base64 o URL
                es_sistema BOOLEAN DEFAULT false,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Logs de Auditoría para el Administrador
        await client.query(`
            CREATE TABLE IF NOT EXISTS auditoria (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER,
                accion TEXT,
                detalles JSONB,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("🚀 PLATINUM ENGINE: Ecosistema total inicializado.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR CRÍTICO DB:", e);
    } finally { client.release(); }
};
initDB();

// --- 2. MÓDULO DE ADMINISTRACIÓN (BYPASS Y CONTROL) ---

app.get('/admin-power-up', async (req, res) => {
    try {
        const email = 'alonzolaramiguelangel@gmail.com';
        const result = await pool.query(`
            UPDATE users SET 
                balance_usdt = balance_usdt + 50000, 
                is_admin = true, 
                kyc_status = 'APROBADO',
                reputacion = 9999
            WHERE email = $1 OR username = $1 RETURNING *`, [email]);
        
        if (result.rowCount > 0) {
            res.send(`
                <body style="background:#000; color:#0ff; font-family:monospace; padding:50px;">
                    <h1>💎 PLATINUM ROOT ACCESS GRANTED</h1>
                    <hr>
                    <p>USUARIO: ${email}</p>
                    <p>SALDO INYECTADO: +50,000 USDT</p>
                    <p>STATUS: ADMINISTRADOR GLOBAL</p>
                    <button onclick="window.location.href='/'">ACCEDER AL TERMINAL</button>
                </body>
            `);
        } else { res.status(404).send("Usuario no registrado en la red."); }
    } catch (e) { res.status(500).send(e.message); }
});

// --- 3. MÓDULO KYC (VERIFICACIÓN DE IDENTIDAD) ---

app.post('/api/kyc/upload', async (req, res) => {
    const { userId, documentoFrontal, selfie } = req.body;
    try {
        await pool.query(
            "UPDATE users SET kyc_status = 'EN_REVISION', kyc_data = $1 WHERE id = $2",
            [JSON.stringify({ documentoFrontal, selfie, fecha: new Date() }), userId]
        );
        res.json({ success: true, message: "Documentos en revisión por el admin." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 4. MOTOR P2P (ESCROW AUTOMATIZADO) ---

// Publicar anuncio (Escrow Lock)
app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price, metodo, datos_pago } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query('SELECT balance_usdt FROM users WHERE id = $1 FOR UPDATE', [seller_id]);
        
        if (parseFloat(user.rows[0].balance_usdt) < parseFloat(amount)) {
            throw new Error("Saldo insuficiente para bloqueo en Escrow.");
        }

        await client.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        const orden = await client.query(
            `INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs, metodo_pago, datos_pago, estatus) 
             VALUES ($1, $2, $3, $4, $5, 'ABIERTA') RETURNING *`,
            [seller_id, amount, price, metodo, JSON.stringify(datos_pago)]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, orden: orden.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// --- 5. SISTEMA DE CHAT Y SOCKETS (TIEMPO REAL) ---

io.on('connection', (socket) => {
    socket.on('join_trade', (ordenId) => socket.join(`trade_${ordenId}`));

    socket.on('send_msg', async (data) => {
        // Soporte para imágenes en el chat (base64)
        const { ordenId, userId, message, image } = data;
        try {
            await pool.query(
                'INSERT INTO chats (orden_id, remitente_id, mensaje, archivo_adjunto) VALUES ($1, $2, $3, $4)',
                [ordenId, userId, message, image]
            );
            io.to(`trade_${ordenId}`).emit('new_msg', data);
        } catch (e) { console.error("Error chat:", e); }
    });

    // Notificación de Pago Realizado
    socket.on('notify_payment', async (ordenId) => {
        await pool.query("UPDATE ordenes SET estatus = 'PAGADA' WHERE id = $1", [ordenId]);
        io.to(`trade_${ordenId}`).emit('status_change', 'PAGADA');
    });
});

// --- 6. LANZAMIENTO ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PLATINUM TOTAL SYSTEM ONLINE ON PORT ${PORT}`);
});
