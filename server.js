/**
 * PLATINUM P2P VENEZUELA - COMPLETE ENGINE
 * ==========================================
 * Arquitectura: Monolito Modular
 * Moneda Base: USDT (Tether) vs VES (Bolívares)
 * Seguridad: JWT, Bcrypt, SQL Injection Protection, Rate Limiting
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer'); // Para subida de imágenes
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- 1. CONFIGURACIÓN DEL SERVIDOR ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e7 // 50MB para imágenes en chat
});

// Middleware de Seguridad y Configuración
app.use(helmet()); // Protege headers HTTP
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Servir imágenes

// Rate Limiting (Evitar ataques DDoS básicos)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// Configuración de Base de Datos
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Ajustar según proveedor (Render/Heroku/AWS)
});

// Configuración de Subida de Archivos (KYC y Chat)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Constantes de Venezuela
const BANCOS_VZLA = [
    "PAGO_MOVIL", "BANESCO", "MERCANTIL", "BBVA_PROVINCIAL", 
    "BANCO_DE_VENEZUELA", "BNC", "BANCAMIGA"
];

// --- 2. INICIALIZACIÓN DE BASE DE DATOS (ESQUEMA COMPLETO) ---
const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log("⚙️  Inicializando Esquema de Datos...");

        // 1. Usuarios
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT,
                phone TEXT,
                country_code TEXT DEFAULT 'VE',
                kyc_level INTEGER DEFAULT 0, -- 0: Nada, 1: Enviado, 2: Aprobado
                reputation_score DECIMAL(5,2) DEFAULT 100.00,
                trades_count INTEGER DEFAULT 0,
                completion_rate DECIMAL(5,2) DEFAULT 100.00,
                is_admin BOOLEAN DEFAULT FALSE,
                is_banned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Billetera (Separada del usuario para seguridad)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                balance_available DECIMAL(20,8) DEFAULT 0.00000000 CHECK (balance_available >= 0),
                balance_locked DECIMAL(20,8) DEFAULT 0.00000000 CHECK (balance_locked >= 0),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. KYC (Documentos)
        await client.query(`
            CREATE TABLE IF NOT EXISTS kyc_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                doc_type TEXT, -- CEDULA, PASAPORTE
                front_image TEXT,
                back_image TEXT,
                selfie_image TEXT,
                status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
                admin_note TEXT,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Métodos de Pago (Cuentas bancarias del usuario)
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                bank_name TEXT NOT NULL, -- Debe estar en BANCOS_VZLA
                account_number TEXT, -- 20 dígitos o Teléfono
                account_holder TEXT NOT NULL,
                cedula TEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE
            );
        `);

        // 5. Anuncios de Mercado (Ads)
        await client.query(`
            CREATE TABLE IF NOT EXISTS ads (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                type TEXT NOT NULL, -- 'BUY' (Quiero comprar USDT) o 'SELL' (Quiero vender USDT)
                crypto_currency TEXT DEFAULT 'USDT',
                fiat_currency TEXT DEFAULT 'VES',
                price_type TEXT DEFAULT 'FIXED', -- FIXED
                price DECIMAL(20,2) NOT NULL, -- Precio en Bolívares
                min_limit DECIMAL(20,2) NOT NULL, -- Mínimo en Bs
                max_limit DECIMAL(20,2) NOT NULL, -- Máximo en Bs
                total_amount DECIMAL(20,8) NOT NULL, -- Cantidad de USDT disponible
                payment_methods JSONB NOT NULL, -- Array de IDs de payment_methods aceptados
                terms TEXT,
                status TEXT DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, FINISHED
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 6. Órdenes P2P (El corazón del sistema)
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY, -- UUID generado manualmente para seguridad
                ad_id INTEGER REFERENCES ads(id),
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                crypto_amount DECIMAL(20,8) NOT NULL,
                fiat_amount DECIMAL(20,2) NOT NULL,
                exchange_rate DECIMAL(20,2) NOT NULL,
                status TEXT DEFAULT 'CREATED', 
                -- CREATED: Orden creada, fondos bloqueados.
                -- PAID: Comprador marcó pagado.
                -- COMPLETED: Vendedor liberó, fondos transferidos.
                -- CANCELLED: Orden cancelada, fondos devueltos.
                -- DISPUTE: En mediación.
                payment_method_snapshot JSONB, -- Datos bancarios congelados al momento de la orden
                chat_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                paid_at TIMESTAMP,
                completed_at TIMESTAMP
            );
        `);

        // 7. Chat de Órdenes
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                order_id TEXT REFERENCES orders(id),
                sender_id INTEGER REFERENCES users(id),
                message TEXT,
                image_url TEXT, -- URL de imagen adjunta
                is_system_message BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("✅ BASE DE DATOS INICIALIZADA CORRECTAMENTE");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR DB:", e);
    } finally {
        client.release();
    }
};
initDB();

// --- 3. MIDDLEWARES DE AUTENTICACIÓN Y AYUDA ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const checkKYC = async (req, res, next) => {
    const result = await pool.query("SELECT kyc_level FROM users WHERE id = $1", [req.user.id]);
    if (result.rows[0].kyc_level < 2) {
        return res.status(403).json({ error: "KYC Requerido para operar." });
    }
    next();
};

// Generador de ID de orden único (ej: 20231025-AX92)
const generateOrderId = () => {
    return `${new Date().getFullYear()}${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
};

// --- 4. RUTAS: USUARIOS Y AUTH ---

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const newUser = await client.query(
            `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
            [username, email, hashedPassword]
        );
        
        // Crear Wallet vacía
        await client.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [newUser.rows[0].id]);
        
        await client.query('COMMIT');
        res.json({ success: true, message: "Usuario registrado. Por favor inicia sesión." });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: "Usuario o email ya existe." });
    } finally { client.release(); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (user.rows.length === 0) return res.status(400).json({ error: "Credenciales inválidas" });

        const validPass = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!validPass) return res.status(400).json({ error: "Credenciales inválidas" });

        const token = jwt.sign({ id: user.rows[0].id, isAdmin: user.rows[0].is_admin }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.rows[0].id, username: user.rows[0].username, kyc: user.rows[0].kyc_level } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 5. MÓDULO KYC (Cédula y Selfie) ---

app.post('/api/kyc/submit', authenticateToken, upload.fields([{ name: 'front' }, { name: 'selfie' }]), async (req, res) => {
    // En producción, subirías esto a S3/Cloudinary y guardarías la URL
    const frontPath = req.files['front'][0].path;
    const selfiePath = req.files['selfie'][0].path;
    
    try {
        await pool.query(
            `INSERT INTO kyc_documents (user_id, doc_type, front_image, selfie_image, status) VALUES ($1, 'CEDULA', $2, $3, 'PENDING')`,
            [req.user.id, frontPath, selfiePath]
        );
        await pool.query("UPDATE users SET kyc_level = 1 WHERE id = $1", [req.user.id]);
        res.json({ success: true, message: "KYC enviado para revisión." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 6. MÓDULO DE MÉTODOS DE PAGO (Bancos Vzla) ---

app.post('/api/user/banks', authenticateToken, async (req, res) => {
    const { bank_name, account_number, cedula, account_holder } = req.body;
    
    if (!BANCOS_VZLA.includes(bank_name)) {
        return res.status(400).json({ error: "Banco no soportado en Venezuela." });
    }

    try {
        await pool.query(
            `INSERT INTO payment_methods (user_id, bank_name, account_number, cedula, account_holder) VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, bank_name, account_number, cedula, account_holder]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 7. MERCADO P2P (ANUNCIOS) ---

// Crear Anuncio (Solo si tienes saldo para vender)
app.post('/api/ads/create', authenticateToken, checkKYC, async (req, res) => {
    const { type, price, min_limit, max_limit, total_amount, payment_methods_ids } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Validación de saldo si es Venta
        if (type === 'SELL') {
            const wallet = await client.query("SELECT balance_available FROM wallets WHERE user_id = $1 FOR UPDATE", [req.user.id]);
            if (parseFloat(wallet.rows[0].balance_available) < parseFloat(total_amount)) {
                throw new Error("Saldo insuficiente para crear el anuncio.");
            }
            // Bloquear saldo del anuncio
            await client.query("UPDATE wallets SET balance_available = balance_available - $1, balance_locked = balance_locked + $1 WHERE user_id = $2", [total_amount, req.user.id]);
        }

        await client.query(
            `INSERT INTO ads (user_id, type, price, min_limit, max_limit, total_amount, payment_methods) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.user.id, type, price, min_limit, max_limit, total_amount, JSON.stringify(payment_methods_ids)]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Anuncio publicado." });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// Listar Anuncios (Filtros)
app.get('/api/ads', async (req, res) => {
    const { type, amount, bank } = req.query; // type: BUY/SELL
    // Lógica SQL compleja para filtrar JSONB de bancos
    let query = "SELECT ads.*, users.username, users.completion_rate FROM ads JOIN users ON ads.user_id = users.id WHERE ads.status = 'ACTIVE'";
    let params = [];
    
    if (type) {
        params.push(type);
        query += ` AND ads.type = $${params.length}`;
    }
    
    // Filtro por banco (Búsqueda dentro del JSONB de métodos de pago implicaría joins complejos, simplificado aquí)
    
    const result = await pool.query(query + " ORDER BY price ASC", params);
    res.json(result.rows);
});

// --- 8. MOTOR DE ÓRDENES Y ESCROW (CORE) ---

// Iniciar un Trade (Taker toma un anuncio)
app.post('/api/orders/create', authenticateToken, checkKYC, async (req, res) => {
    const { ad_id, fiat_amount } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Bloquear fila del anuncio
        const adRes = await client.query("SELECT * FROM ads WHERE id = $1 FOR UPDATE", [ad_id]);
        const ad = adRes.rows[0];
        
        if (ad.status !== 'ACTIVE') throw new Error("Anuncio no disponible");
        if (parseFloat(fiat_amount) < parseFloat(ad.min_limit) || parseFloat(fiat_amount) > parseFloat(ad.max_limit)) throw new Error("Monto fuera de límites");

        const cryptoAmount = parseFloat(fiat_amount) / parseFloat(ad.price);
        const orderId = generateOrderId();
        
        let buyerId, sellerId;

        // Lógica: Si el anuncio es VENTA (Seller Maker), yo soy el comprador (Buyer Taker)
        if (ad.type === 'SELL') {
            sellerId = ad.user_id;
            buyerId = req.user.id;
            
            // Verificar que el Maker (Vendedor) aún tenga saldo en el anuncio
            if (parseFloat(ad.total_amount) < cryptoAmount) throw new Error("Saldo insuficiente en el anuncio");
            
            // Descontar del anuncio (Ya está en 'locked' de la wallet del maker, solo actualizamos el anuncio)
            await client.query("UPDATE ads SET total_amount = total_amount - $1 WHERE id = $2", [cryptoAmount, ad.id]);

        } else {
            // Si el anuncio es COMPRA (Buyer Maker), yo soy el vendedor (Seller Taker)
            // Yo (Taker) debo bloquear mis fondos AHORA
            sellerId = req.user.id;
            buyerId = ad.user_id;

            const myWallet = await client.query("SELECT balance_available FROM wallets WHERE user_id = $1 FOR UPDATE", [req.user.id]);
            if (parseFloat(myWallet.rows[0].balance_available) < cryptoAmount) throw new Error("No tienes saldo para vender.");
            
            // Lock funds del Taker
            await client.query("UPDATE wallets SET balance_available = balance_available - $1, balance_locked = balance_locked + $1 WHERE user_id = $2", [cryptoAmount, req.user.id]);
            
            // Actualizar anuncio del Maker
            await client.query("UPDATE ads SET total_amount = total_amount - $1 WHERE id = $2", [cryptoAmount, ad.id]);
        }

        // Obtener datos bancarios del vendedor para mostrarlos al comprador
        const sellerMethods = await client.query("SELECT * FROM payment_methods WHERE user_id = $1", [sellerId]);

        // Crear la orden
        await client.query(
            `INSERT INTO orders (id, ad_id, buyer_id, seller_id, crypto_amount, fiat_amount, exchange_rate, payment_method_snapshot) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [orderId, ad.id, buyerId, sellerId, cryptoAmount, fiat_amount, ad.price, JSON.stringify(sellerMethods.rows)]
        );

        // Mensaje inicial del sistema en el chat
        await client.query("INSERT INTO chat_messages (order_id, message, is_system_message) VALUES ($1, 'Orden creada. El comprador tiene 15 minutos para pagar.', TRUE)", [orderId]);

        await client.query('COMMIT');
        res.json({ success: true, orderId });

    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// Acción 1: Marcar como Pagado (Comprador)
app.post('/api/orders/:id/pay', authenticateToken, async (req, res) => {
    const { id } = req.params;
    // Validar que el usuario sea el comprador de esa orden
    await pool.query("UPDATE orders SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = $1 AND buyer_id = $2 AND status = 'CREATED'", [id, req.user.id]);
    
    io.to(`order_${id}`).emit('order_update', { status: 'PAID', message: "El comprador ha marcado el pago." });
    res.json({ success: true });
});

// Acción 2: Liberar Fondos (Vendedor) - EL PASO CRÍTICO
app.post('/api/orders/:id/release', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Verificar orden y permisos
        const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 AND seller_id = $2 FOR UPDATE", [id, req.user.id]);
        const order = orderRes.rows[0];
        
        if (!order || order.status !== 'PAID') throw new Error("Orden no válida para liberación.");

        // MOVIMIENTO DE FONDOS (Ledger)
        const amount = order.crypto_amount;

        // 1. Descontar del Lock del Vendedor
        await client.query("UPDATE wallets SET balance_locked = balance_locked - $1 WHERE user_id = $2", [amount, order.seller_id]);
        
        // 2. Acreditar al Disponible del Comprador
        await client.query("UPDATE wallets SET balance_available = balance_available + $1 WHERE user_id = $2", [amount, order.buyer_id]);

        // 3. Finalizar Orden
        await client.query("UPDATE orders SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);

        // 4. Actualizar estadísticas de usuarios
        await client.query("UPDATE users SET trades_count = trades_count + 1 WHERE id IN ($1, $2)", [order.buyer_id, order.seller_id]);

        await client.query('COMMIT');
        
        io.to(`order_${id}`).emit('order_update', { status: 'COMPLETED', message: "USDT Liberados exitosamente." });
        res.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// Acción 3: Cancelar Orden (Comprador o Sistema por Timeout)
app.post('/api/orders/:id/cancel', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const orderRes = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
        const order = orderRes.rows[0];

        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') throw new Error("Orden ya finalizada");

        // Devolver fondos al Vendedor (de locked a available)
        // NOTA: Si el anuncio original sigue activo, podría volver al anuncio, pero para simplificar, se devuelve a la wallet del vendedor.
        await client.query("UPDATE wallets SET balance_locked = balance_locked - $1, balance_available = balance_available + $1 WHERE user_id = $2", [order.crypto_amount, order.seller_id]);
        
        await client.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [id]);
        
        await client.query('COMMIT');
        io.to(`order_${id}`).emit('order_update', { status: 'CANCELLED' });
        res.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

// --- 9. CHAT Y SUBIDA DE IMÁGENES ---

// Endpoint para subir imagen (Comprobante de pago)
app.post('/api/chat/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No hay archivo" });
    // Retornamos la URL relativa
    res.json({ url: `/uploads/${req.file.filename}` });
});

// Configuración de Socket.io
io.use((socket, next) => {
    // Autenticación de socket mediante JWT
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("No autorizado"));
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Token inválido"));
        socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    // Unirse a la sala de una orden específica
    socket.on('join_order', (orderId) => {
        // En producción verificar que el socket.user pertenece a la orden
        socket.join(`order_${orderId}`);
    });

    // Enviar mensaje
    socket.on('send_message', async (data) => {
        const { orderId, message, imageUrl } = data;
        
        // Guardar en DB
        const savedMsg = await pool.query(
            "INSERT INTO chat_messages (order_id, sender_id, message, image_url) VALUES ($1, $2, $3, $4) RETURNING *",
            [orderId, socket.user.id, message, imageUrl]
        );
        
        // Emitir a la sala
        io.to(`order_${orderId}`).emit('new_message', {
            id: savedMsg.rows[0].id,
            sender_id: socket.user.id,
            message,
            image_url: imageUrl,
            created_at: savedMsg.rows[0].created_at
        });
    });
});

// --- 10. PERFIL DE USUARIO ---
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const user = await pool.query("SELECT id, username, kyc_level, reputation_score, trades_count, completion_rate, created_at FROM users WHERE id = $1", [id]);
    if (user.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(user.rows[0]);
});

// --- ARRANQUE DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 PLATINUM P2P ENGINE (VENEZUELA) CORRIENDO EN PUERTO ${PORT}`);
    console.log(`🔒 Seguridad Activada: JWT + Helmet + RateLimit`);
    console.log(`📡 Sockets Listos`);
