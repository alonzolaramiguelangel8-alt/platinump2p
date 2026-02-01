const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- BASE DE DATOS CON AUTO-REPARACIÓN ---
async function initDB() {
    try {
        // 1. Crear tablas base si no existen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                amount_usdt DECIMAL(18,2),
                price_ves DECIMAL(18,2),
                bank TEXT,
                status TEXT DEFAULT 'ESPERANDO_PAGO'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. AUTO-REPARACIÓN: Corregir columna si se llama orden_id
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='order_id') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='orden_id') THEN
                        ALTER TABLE messages RENAME COLUMN orden_id TO order_id;
                    ELSE
                        ALTER TABLE messages ADD COLUMN order_id UUID REFERENCES orders(order_id);
                    END IF;
                END IF;
            END $$;
        `);
        
        console.log("✅ Base de Datos Sincronizada y Reparada");
    } catch (err) { console.error("Error crítico en DB:", err.message); }
}
initDB();

// --- INTERFAZ PROFESIONAL (DASHBOARD + FILTROS + CHAT) ---
const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platinum P2P - VZLA</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; --green: #2ebd85; --red: #f6465d; }
        body { background: var(--bg); color: white; font-family: sans-serif; margin: 0; }
        .nav { background: var(--card); padding: 15px; display: flex; justify-content: space-between; border-bottom: 1px solid #333; }
        .container { padding: 20px; max-width: 800px; margin: auto; }
        .btn { padding: 10px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .btn-gold { background: var(--gold); }
        .btn-red { background: var(--red); color: white; }
        .card { background: var(--card); padding: 20px; border-radius: 10px; margin-top: 10px; border-left: 4px solid var(--gold); }
        .modal { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); display:none; flex-direction:column; }
        #msgs { flex:1; overflow-y:auto; padding:20px; background:#000; }
        .msg { background:#2b3139; padding:10px; border-radius:8px; margin-bottom:10px; width:fit-content; }
        .msg.me { margin-left:auto; background:#037dff; }
    </style>
</head>
<body>
    <div id="viewAuth">
        <div style="width:300px; margin:100px auto; background:var(--card); padding:30px; border-radius:10px; text-align:center;">
            <h2 style="color:var(--gold)">PLATINUM P2P</h2>
            <input type="email" id="email" placeholder="Correo" style="width:100%; margin-bottom:10px; padding:8px;">
            <input type="password" id="pass" placeholder="Contraseña" style="width:100%; margin-bottom:10px; padding:8px;">
            <button class="btn btn-gold" style="width:100%" onclick="login()">INGRESAR</button>
            <p onclick="alert('Usa el mismo botón de arriba para registrarte si no existes')" style="font-size:12px; cursor:pointer; color:gray">¿No tienes cuenta? Regístrate</p>
        </div>
    </div>

    <div id="viewP2P" style="display:none">
        <div class="nav">
            <b style="color:var(--gold)">PLATINUM P2P 🇻🇪</b>
            <button class="btn btn-red" onclick="location.reload()">Salir</button>
        </div>
        <div class="container">
            <h3>Filtros de Banco</h3>
            <select id="fBank" style="padding:10px; width:100%; background:#2b3139; color:white; border:none;">
                <option value="Banesco">Banesco</option>
                <option value="Pago Móvil">Pago Móvil</option>
                <option value="Mercantil">Mercantil</option>
            </select>
            <div class="card">
                <b>Vendedor: Admin_Pro</b><br>
                <span>Tasa: 55.10 VES</span><br>
                <button class="btn btn-gold" style="margin-top:10px" onclick="crearOrden()">COMPRAR USDT</button>
            </div>
        </div>
    </div>

    <div id="viewChat" class="modal">
        <div class="nav">
            <span id="ordStatus">ESTADO: ESPERANDO PAGO</span>
            <button class="btn btn-red" onclick="cerrarChat()">X</button>
        </div>
        <div id="msgs"></div>
        <div style="padding:15px; background:var(--card); display:flex; gap:10px;">
            <input type="text" id="txt" style="flex:1; padding:10px;" placeholder="Mensaje...">
            <button class="btn btn-gold" onclick="enviar()">Enviar</button>
        </div>
        <div style="padding:15px; display:flex; gap:10px; justify-content:center;">
            <button class="btn" style="background:var(--green); color:white" onclick="actualizarStatus('PAGADO')">NOTIFICAR PAGO</button>
            <button class="btn btn-red" onclick="actualizarStatus('CANCELADA')">CANCELAR</button>
        </div>
    </div>

    <script>
        let me = null, activeOrd = null, loop = null;

        async function login() {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email: email.value, password: pass.value })
            });
            const data = await res.json();
            if(res.ok) {
                me = data.user;
                viewAuth.style.display = 'none';
                viewP2P.style.display = 'block';
            } else { alert("Error de acceso"); }
        }

        async function crearOrden() {
            const res = await fetch('/api/p2p/order', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ buyer_id: me.id, seller_id: 1, amount: 100, price: 55.10, bank: fBank.value })
            });
            const data = await res.json();
            activeOrd = data.order_id;
            viewChat.style.display = 'flex';
            loop = setInterval(sync, 2000);
        }

        async function enviar() {
            await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, sender_id: me.id, text: txt.value })
            });
            txt.value = '';
        }

        async function sync() {
            const res = await fetch('/api/chat/' + activeOrd);
            const data = await res.json();
            msgs.innerHTML = data.msgs.map(m => \`<div class="msg \${m.sender_id==me.id?'me':''}">\${m.text}</div>\`).join('');
            ordStatus.innerText = "ESTADO: " + data.status;
        }

        async function actualizarStatus(s) {
            await fetch('/api/p2p/status', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, status: s })
            });
            if(s === 'CANCELADA') cerrarChat();
        }

        function cerrarChat() { viewChat.style.display='none'; clearInterval(loop); }
    </script>
</body>
</html>
`;

// --- RUTAS ---
app.get('/', (req, res) => res.send(mainHTML));

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        let r = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        
        if (r.rows.length === 0) {
            const hash = await bcrypt.hash(password, 10);
            r = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING *", [email.split('@')[0], email.toLowerCase(), hash]);
        }
        res.json({ success: true, user: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/p2p/order', async (req, res) => {
    const { buyer_id, seller_id, amount, price, bank } = req.body;
    const r = await pool.query("INSERT INTO orders (buyer_id, seller_id, amount_usdt, price_ves, bank) VALUES ($1,$2,$3,$4,$5) RETURNING order_id", [buyer_id, seller_id, amount, price, bank]);
    res.json({ order_id: r.rows[0].order_id });
});

app.get('/api/chat/:id', async (req, res) => {
    const m = await pool.query("SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC", [req.params.id]);
    const s = await pool.query("SELECT status FROM orders WHERE order_id = $1", [req.params.id]);
    res.json({ msgs: m.rows, status: s.rows[0].status });
});

app.post('/api/chat', async (req, res) => {
    const { order_id, sender_id, text } = req.body;
    await pool.query("INSERT INTO messages (order_id, sender_id, text) VALUES ($1,$2,$3)", [order_id, sender_id, text]);
    res.json({ success: true });
});

app.post('/api/p2p/status', async (req, res) => {
    const { order_id, status } = req.body;
    await pool.query("UPDATE orders SET status = $1 WHERE order_id = $2", [status, order_id]);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 Platinum P2P Professional Ready"));
