const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// CONFIGURACIÓN DE MIDDLEWARES
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// CONEXIÓN A BASE DE DATOS (POSTGRESQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- 1. BASE DE DATOS: ESTRUCTURA COMPLETA ---
const initDB = async () => {
    try {
        // Mantenemos los datos, solo creamos si no existen
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
                tipo TEXT DEFAULT 'VENTA',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                orden_id INTEGER REFERENCES ordenes(id),
                remitente_id INTEGER REFERENCES users(id),
                mensaje TEXT,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ PLATINUM DB: Estructura P2P Total lista.");
    } catch (err) {
        console.error("❌ Error inicializando DB:", err.message);
    }
};
initDB();

// --- 2. RUTAS DE SISTEMA Y ACCESO ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ACCESO DIOS (CORREGIDO Y SEGURO)
app.get('/admin-power-up', async (req, res) => {
    try {
        const miEmail = 'alonzolaramiguelangel@gmail.com';
        const query = `
            UPDATE users 
            SET balance_usdt = balance_usdt + 10000, is_admin = true, kyc_status = 'verificado' 
            WHERE email = $1 OR username = $1 
            RETURNING *`;
        const result = await pool.query(query, [miEmail]);

        if (result.rowCount > 0) {
            res.send(`
                <div style="background:#000; color:#0ff; padding:50px; text-align:center; font-family:sans-serif; border:5px solid #0ff;">
                    <h1 style="font-size:3em;">💎 PLATINUM ADMIN ACTIVADO</h1>
                    <p style="font-size:1.5em;">Usuario: ${miEmail} ha recibido 10,000 USDT y rango ADMIN.</p>
                    <a href="/" style="background:#0ff; color:#000; padding:15px 30px; text-decoration:none; font-weight:bold; border-radius:5px;">VOLVER AL DASHBOARD</a>
                </div>
            `);
        } else {
            res.send("<h1 style='text-align:center; color:red;'>⚠️ Usuario no encontrado. Regístrate primero en la Web.</h1>");
        }
    } catch (err) {
        res.status(500).send("Error en bypass: " + err.message);
    }
});

// --- 3. LÓGICA DE USUARIOS ---

app.post('/registro', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        await pool.query(
            'INSERT INTO users (username, email, password, balance_usdt) VALUES ($1, $2, $3, 0)',
            [username, email, password]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: "El usuario o email ya existe." });
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
            res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. MOTOR DEL MERCADO P2P (COMPLETO) ---

app.get('/api/mercado', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT o.*, u.username as vendedor_nombre 
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

app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    try {
        // Verificar saldo antes de publicar
        const user = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [seller_id]);
        if (parseFloat(user.rows[0].balance_usdt) < parseFloat(amount)) {
            return res.status(400).json({ error: "Saldo insuficiente en billetera" });
        }

        // Bloquear fondos en Escrow (descontar del saldo)
        await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [amount, seller_id]);
        
        // Crear orden
        const nuevaOrden = await pool.query(
            'INSERT INTO ordenes (vendedor_id, monto_usdt, monto_bs, estatus) VALUES ($1, $2, $3, $4) RETURNING *',
            [seller_id, amount, price, 'ABIERTA']
        );
        
        res.json({ success: true, orden: nuevaOrden.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, compradorId, monto } = req.body;
    try {
        // 1. Sumar al comprador
        await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
        // 2. Finalizar orden
        await pool.query("UPDATE ordenes SET estatus = 'FINALIZADA', comprador_id = $1 WHERE id = $2", [compradorId, ordenId]);
        
        io.to("orden_" + ordenId).emit('finalizado', { mensaje: "¡Fondos liberados con éxito!" });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. COMUNICACIONES EN TIEMPO REAL (SOCKET.IO) ---

io.on('connection', (socket) => {
    console.log('📡 Usuario conectado al nodo P2P');

    socket.on('unirse_p2p', (ordenId) => {
        socket.join("orden_" + ordenId);
        console.log(`💬 Usuario unido al chat de la orden: ${ordenId}`);
    });

    socket.on('msg_p2p', async (data) => {
        // Guardar en DB para historial
        await pool.query('INSERT INTO chats (orden_id, remitente_id, mensaje) VALUES ($1, $2, $3)', 
            [data.ordenId, data.user_id, data.message]);
        
        // Emitir a la sala de la orden
        io.to("orden_" + data.ordenId).emit('update_chat', data);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Usuario desconectado');
    });
});

// --- LANZAMIENTO ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 PLATINUM SERVER LIVE
    PORT: ${PORT}
    DB: CONNECTED
    P2P MODULE: ACTIVE
    `);
});
