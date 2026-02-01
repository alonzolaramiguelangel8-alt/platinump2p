const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- BASE DE DATOS AVANZADA ---
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password_hash TEXT,
            kyc_level INTEGER DEFAULT 0, -- 0: No verificado, 1: Cédula, 2: Completo
            reputation_pos INTEGER DEFAULT 0,
            reputation_neg INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS wallets (
            user_id INTEGER REFERENCES users(id),
            balance_usdt DECIMAL(18,2) DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS ads (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            type TEXT, -- COMPRA / VENTA
            bank TEXT, -- Banesco, Mercantil, Pago Movil, BCV
            price DECIMAL(18,2),
            min_limit DECIMAL(18,2),
            max_limit DECIMAL(18,2)
        );
        CREATE TABLE IF NOT EXISTS orders (
            order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            buyer_id INTEGER REFERENCES users(id),
            seller_id INTEGER REFERENCES users(id),
            ad_id INTEGER REFERENCES ads(id),
            amount_usdt DECIMAL(18,2),
            status TEXT DEFAULT 'ESPERANDO_PAGO' -- PAGADO, DISPUTA, LIBERADO, CANCELADO
        );
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            order_id UUID REFERENCES orders(order_id),
            sender_id INTEGER REFERENCES users(id),
            text TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}
initDB();

// --- FRONTEND PROFESIONAL (DASHBOARD P2P) ---
const dashboardHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platinum P2P - Exchange</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; --green: #2ebd85; --red: #f6465d; }
        body { background: var(--bg); color: white; font-family: 'Inter', sans-serif; margin: 0; }
        .nav { background: var(--card); padding: 15px 5%; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; }
        .container { padding: 20px 5%; }
        .tabs { display: flex; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid #333; }
        .tab { padding: 10px 20px; cursor: pointer; font-weight: bold; }
        .tab.active { color: var(--gold); border-bottom: 2px solid var(--gold); }
        
        .filters { display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; padding-bottom: 10px; }
        .filter-btn { background: #2b3139; border: none; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
        
        .ad-card { background: var(--card); border-radius: 12px; padding: 20px; margin-bottom: 15px; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; align-items: center; transition: 0.3s; }
        .ad-card:hover { background: #2b3139; }
        .price { font-size: 22px; font-weight: bold; color: var(--gold); }
        .btn-buy { background: var(--green); border: none; padding: 10px; border-radius: 4px; color: white; font-weight: bold; cursor: pointer; }
        
        /* CHAT MODAL */
        .modal { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.8); display:none; justify-content:center; align-items:center; }
        .chat-window { background: var(--card); width: 90%; max-width: 500px; height: 80vh; border-radius: 15px; display: flex; flex-direction: column; }
        .chat-header { padding: 15px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }
        .messages { flex: 1; overflow-y: auto; padding: 15px; }
        .chat-input { padding: 15px; display: flex; gap: 10px; border-top: 1px solid #333; }
        .msg-bubble { background: #2b3139; padding: 8px 12px; border-radius: 10px; margin-bottom: 8px; max-width: 80%; }
        .msg-me { background: #037dff; align-self: flex-end; margin-left: auto; }
    </style>
</head>
<body>
    <div class="nav">
        <h2 style="color:var(--gold); margin:0;">PLATINUM P2P</h2>
        <div id="user-info">Cargando...</div>
    </div>

    <div class="container">
        <div class="tabs">
            <div class="tab active" onclick="setTab('COMPRA')">Compra</div>
            <div class="tab" onclick="setTab('VENTA')">Venta</div>
        </div>

        <div class="filters">
            <button class="filter-btn" onclick="filterBank('TODOS')">Todos los pagos</button>
            <button class="filter-btn" onclick="filterBank('Banesco')">Banesco</button>
            <button class="filter-btn" onclick="filterBank('Pago Movil')">Pago Móvil</button>
            <button class="filter-btn" onclick="filterBank('Mercantil')">Mercantil</button>
        </div>

        <div id="market-list">
            <div class="ad-card">
                <div>
                    <b>Admin_Escrow</b> <small>1500 órdenes | 100%</small><br>
                    <small>Límites: 500 - 5,000 VES</small>
                </div>
                <div class="price">54.30 VES</div>
                <div style="color:var(--gold)">Banesco</div>
                <button class="btn-buy" onclick="openTrade('UUID-EJEMPLO')">Comprar USDT</button>
            </div>
        </div>
    </div>

    <div id="tradeModal" class="modal">
        <div class="chat-window">
            <div class="chat-header">
                <span>Orden: #<b id="order-id-display"></b></span>
                <button onclick="closeModal()" style="background:none; border:none; color:white; font-size:20px; cursor:pointer;">&times;</button>
            </div>
            <div class="messages" id="chat-msgs"></div>
            <div class="chat-input">
                <input type="text" id="msg-input" placeholder="Escribe un mensaje..." style="flex:1; background:#000; color:white; border:none; padding:10px; border-radius:5px;">
                <button onclick="sendMessage()" class="btn-buy" style="width:auto; padding:0 15px;">Enviar</button>
            </div>
            <div style="padding:10px; display:flex; gap:5px;">
                <button onclick="updateStatus('PAGADO')" style="background:var(--gold); flex:1; border:none; padding:10px; border-radius:5px; font-weight:bold;">MARCAR PAGADO</button>
                <button onclick="updateStatus('DISPUTA')" style="background:var(--red); flex:1; border:none; padding:10px; border-radius:5px; font-weight:bold;">APELAR</button>
            </div>
        </div>
    </div>

    <script>
        const user = JSON.parse(localStorage.getItem('user'));
        if(!user) window.location.href = '/';
        document.getElementById('user-info').innerText = user.username + " | KYC Lvl 2";

        async function openTrade(adId) {
            document.getElementById('tradeModal').style.display = 'flex';
            document.getElementById('order-id-display').innerText = "PRO-9921";
            // Aquí llamarías a la API para crear la orden real
        }

        function closeModal() { document.getElementById('tradeModal').style.display = 'none'; }
        
        function setTab(type) {
            alert("Cambiando a modo: " + type);
            // Lógica para filtrar anuncios por tipo en la API
        }
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), dashboardHTML);

// --- RUTAS API (EXPRESS) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const result = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username", [username.toLowerCase(), email.toLowerCase(), hashed]);
        await pool.query("INSERT INTO wallets (user_id) VALUES ($1)", [result.rows[0].id]);
        res.json({ success: true, user: result.rows[0] });
    } catch (e) { res.status(400).json({ error: "Datos duplicados" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if(valid) res.json({ success: true, user: result.rows[0] });
        else res.status(400).json({ error: "Clave errada" });
    } catch (e) { res.status(400).json({ error: "Usuario inexistente" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Platinum P2P Professional Ready"));
