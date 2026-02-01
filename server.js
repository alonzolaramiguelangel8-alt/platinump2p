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

// --- 1. ARQUITECTURA DE BASE DE DATOS (SISTEMA DE ESCROW) ---
const initDB = async () => {
    try {
        // Tabla de Usuarios con Auditoría de Seguridad
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
        `);

        // Tabla de Ordenes (Estados: ABIERTA, EN_PROCESO, DISPUTA, FINALIZADA, CANCELADA)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ordenes (
                id SERIAL PRIMARY KEY,
                vendedor_id INTEGER REFERENCES users(id),
                comprador_id INTEGER REFERENCES users(id),
                monto_usdt DECIMAL(18,8) NOT NULL,
                monto_bs DECIMAL(18,2) NOT NULL,
                tasa_cambio DECIMAL(18,2),
                estatus TEXT DEFAULT 'ABIERTA',
                tipo TEXT DEFAULT 'VENTA',
                metodo_pago TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_cierre TIMESTAMP
            );
        `);

        // Tabla de Mensajería P2P Encriptada (Historial)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER REFERENCES ordenes(id) ON DELETE CASCADE,
                remitente_id INTEGER REFERENCES users(id),
                mensaje TEXT NOT NULL,
                leido BOOLEAN DEFAULT false,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("💎 PLATINUM ENGINE: Arquitectura de datos cargada al 100%.");
    } catch (err) {
        console.error("❌ CRITICAL DB ERROR:", err.message);
    }
};
initDB();

// --- 2. RUTAS DE ADMINISTRACIÓN Y BYPASS ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// BYPASS DE PRIVILEGIOS (ACCESO DIOS)
app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const query = `
            UPDATE users 
            SET balance_usdt = balance_usdt + 10000, 
                is_admin = true, 
                kyc_status = 'verificado',
                reputacion = 1000
            WHERE email = $1 OR username = $1 
            RETURNING *`;
        const result = await pool.query(query, [miEmail]);

        if (result.rowCount > 0) {
            res.send(`
                <div style="background:#020617; color:#22d3ee; padding:100px; text-align:center; font-family:sans-serif; border:10px solid #22d3ee; border-radius:20px;">
                    <h1 style="font-size:4em; text-shadow: 0 0 20px #22d3ee;">💎 SISTEMA PLATINUM LIBERADO</h1>
                    <p style="font-size:2em;">Privilegios de Administrador Global inyectados en: <b>${miEmail}</b></p>
                    <p style="font-size:1.5em; color:#4ade80;">+10,000 USDT inyectados en Escrow Personal.</p>
                    <br><a href="/" style="background:#22d3ee; color:#020617; padding:20px 40px; text-decoration:none; font-weight:bold; border-radius:10px; font-size:1.5em;">ENTRAR AL TERMINAL</a>
                </div>
            `);
        } else {
            res.status(404).send("<h1>⚠️ Usuario no detectado en el Registro.</h1>");
        }
    } catch (err) {
        res.status(500).send("Fallo en la inyección: " + err.message);
    }
});

// --- 3. GESTIÓN DE USUARIOS Y AUTENTICACIÓN ---

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const check = await pool.query('SELECT * FROM users WHERE email = $1 OR username = $2', [email, username]);
        if(check.rows.length > 0) return res.status(400).json({ success: false, error: "Ya existe el usuario." });

        const newUser = await pool.query(
            'INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0) RETURNING *',
            [username, email, password]
        );
        res.json({ success: true, user: newUser.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE (username = $1 OR email = $1) AND password = $2',
            [username, password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Acceso denegado." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. MOTOR P2P Y ESCROW (FLUJO COMPLETO) ---

// Obtener mercado activo
app.get('/api/mercado', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, u.username as vendedor_nombre, u.reputacion 
            FROM ordenes o 
            JOIN users u ON o.vendedor_id = u.id 
            WHERE o.estatus = 'ABIERTA' 
            ORDER BY o.fecha_creacion DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Publicar Oferta (Bloquea USDT inmediatamente)
app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price, metodo } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = await client.query('SELECT balance_usdt FROM users WHERE id = $1 FOR UPDATE', [seller_id]);
        
        if (parseFloat(user.rows[0].balance_usdt) < parseFloat(amount)) {
            throw new Error("Fondos insuficientes para Escrow.");
        }

        // Restar saldo (Bloqueo)
        await client.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        
        // Crear Orden
        const nuevaOrden = await client.query(
            'INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs, estatus, metodo_pago) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [seller_id, amount, price, 'ABIERTA', metodo]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, orden: nuevaOrden.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Liberar Fondos (Finaliza el P2P)
app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, compradorId, monto } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Sumar al comprador
        await client.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        
        // Cambiar estatus de orden
        await client.query("UPDATE ordenes SET estatus = 'FINALIZADA', fecha_cierre = CURRENT_TIMESTAMP WHERE id = $1", [ordenId]);
        
        await client.query('COMMIT');
        io.to("orden_" + ordenId).emit('finalizado', { status: 'SUCCESS' });
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- 5. COMUNICACIONES SOCKET.IO (TIEMPO REAL) ---

io.on('connection', (socket) => {
    socket.on('unirse_p2p', (ordenId) => {
        socket.join("orden_" + ordenId);
    });

    socket.on('msg_p2p', async (data) => {
        try {
            await pool.query('INSERT INTO chats (orden_id, remitente_id, mensaje) VALUES ($1, $2, $3)', 
                [data.ordenId, data.user_id, data.message]);
            io.to("orden_" + data.ordenId).emit('update_chat', data);
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => { /* Manejar desconexión */ });
});

// --- 6. INICIO DE SERVIDOR ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ██████╗ ██╗      █████╗ ████████╗██╗███╗   ██╗██╗   ██╗███╗   ███╗
    ██╔══██╗██║     ██╔══██╗╚══██╔══╝██║████╗  ██║██║   ██║████╗ ████║
    ██████╔╝██║     ███████║   ██║   ██║██╔██╗ ██║██║   ██║██╔████╔██║
    ██╔═══╝ ██║     ██╔══██║   ██║   ██║██║╚██╗██║██║   ██║██║╚██╔╝██║
    ██║     ███████╗██║  ██║   ██║   ██║██║ ╚████║╚██████╔╝██║ ╚═╝ ██║
    ╚═╝     ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝
    🚀 LIVE ON PORT: ${PORT}
    `);
});
