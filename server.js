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

// --- BASE DE DATOS ACTUALIZADA ---
async function initDB() {
    try {
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
                status TEXT DEFAULT 'ESPERANDO_PAGO' -- ESPERANDO_PAGO, PAGADO, COMPLETADA, CANCELADA
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                order_id UUID REFERENCES orders(order_id),
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Base de Datos Interactiva Lista");
    } catch (err) { console.error("Error DB:", err); }
}
initDB();

// --- INTERFAZ DINÁMICA ---
const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platinum P2P - Interactiva</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; --green: #2ebd85; --red: #f6465d; }
        body { background: var(--bg); color: white; font-family: 'Inter', sans-serif; margin: 0; }
        .nav { background: var(--card); padding: 15px 5%; display: flex; justify-content: space-between; border-bottom: 1px solid #333; }
        .container { padding: 20px 5%; }
        input, select { background: #2b3139; border: 1px solid #444; color: white; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; color: white; }
        .btn-gold { background: var(--gold); color: black; }
        .btn-red { background: var(--red); }
        .btn-green { background: var(--green); }
        
        .filters { display: flex; gap: 10px; margin-bottom: 20px; background: var(--card); padding: 15px; border-radius: 10px; }
        .ad-card { background: var(--card); padding: 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--gold); margin-bottom: 10px; }
        
        .chat-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); display: none; flex-direction: column; }
        .chat-header { padding: 20px; background: var(--card); display: flex; justify-content: space-between; }
        #msgs { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        .msg { padding: 10px 15px; border-radius: 10px; max-width: 70%; background: #2b3139; }
        .msg.me { align-self: flex-end; background: #037dff; }
        .controls { padding: 20px; background: var(--card); border-top: 1px solid #333; display: flex; gap: 10px; }
    </style>
</head>
<body>
    <div id="authView">
        <div style="width:300px; margin:100px auto; background:var(--card); padding:30px; border-radius:15px; text-align:center;">
            <h2 style="color:var(--gold)">PLATINUM P2P</h2>
            <input type="text" id="user" style="width:100%" placeholder="Usuario">
            <input type="email" id="email" style="width:100%" placeholder="Correo">
            <input type="password" id="pass" style="width:100%" placeholder="Contraseña">
            <button class="btn btn-gold" style="width:100%; margin-top:10px" onclick="auth('register')">Registrarse</button>
            <button class="btn" style="width:100%; margin-top:10px; border:1px solid var(--gold); background:none; color:var(--gold)" onclick="auth('login')">Entrar</button>
        </div>
    </div>

    <div id="p2pView" style="display:none;">
        <nav class="nav">
            <h3 style="color:var(--gold); margin:0;">PLATINUM VENEZUELA</h3>
            <div>
                <span id="labelUser" style="margin-right:15px"></span>
                <button class="btn btn-red" onclick="logout()">Salir</button>
            </div>
        </nav>

        <div class="container">
            <div class="filters">
                <select id="filterBank" onchange="renderAds()">
                    <option value="TODOS">Todos los bancos</option>
                    <option value="Banesco">Banesco</option>
                    <option value="Mercantil">Mercantil</option>
                    <option value="Pago Móvil">Pago Móvil</option>
                </select>
                <input type="number" id="filterAmount" placeholder="Monto en VES" oninput="renderAds()">
            </div>

            <div id="adsList"></div>
        </div>
    </div>

    <div id="chatModal" class="chat-modal">
        <div class="chat-header">
            <div>
                <b id="ordStatus" style="color:var(--gold)">ESTADO: ESPERANDO PAGO</b><br>
                <small id="ordIdInfo"></small>
            </div>
            <button class="btn btn-red" onclick="closeOrder()">Cerrar Vista</button>
        </div>
        <div id="msgs"></div>
        <div class="controls">
            <input type="text" id="chatInput" style="flex:1" placeholder="Escribe un mensaje...">
            <button class="btn btn-gold" onclick="sendMsg()">Enviar</button>
        </div>
        <div class="controls" style="background:#121212">
            <button id="btnPay" class="btn btn-green" onclick="updateStatus('PAGADO')">Notificar Pago</button>
            <button id="btnCancel" class="btn btn-red" onclick="updateStatus('CANCELADA')">Cancelar Orden</button>
            <button id="btnRelease" class="btn btn-gold" style="display:none" onclick="updateStatus('COMPLETADA')">Liberar Cripto</button>
        </div>
    </div>

    <script>
        let me = null;
        let activeOrd = null;
        let chatLoop = null;

        const ads = [
            { id: 1, user: "Admin_Banesco", price: 54.20, bank: "Banesco", min: 500 },
            { id: 2, user: "Mercantil_Express", price: 54.50, bank: "Mercantil", min: 1000 },
            { id: 3, user: "PagoMovil_Fast", price: 53.90, bank: "Pago Móvil", min: 100 }
        ];

        async function auth(type) {
            const res = await fetch('/api/auth/' + type, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: user.value, email: email.value, password: pass.value })
            });
            const data = await res.json();
            if(res.ok) {
                if(type === 'login') {
                    me = data.user;
                    authView.style.display = 'none';
                    p2pView.style.display = 'block';
                    labelUser.innerText = "Usuario: " + me.username;
                    renderAds();
                } else alert("Registrado con éxito");
            } else alert(data.error);
        }

        function logout() { location.reload(); }

        function renderAds() {
            const bank = filterBank.value;
            const amount = filterAmount.value;
            adsList.innerHTML = ads
                .filter(a => (bank === 'TODOS' || a.bank === bank))
                .map(a => \`
                <div class="ad-card">
                    <div>
                        <b>\${a.user}</b><br>
                        <small>Banco: \${a.bank}</small>
                    </div>
                    <div style="font-size:20px; font-weight:bold; color:var(--gold)">\${a.price} VES</div>
                    <button class="btn btn-green" onclick="startOrder('\${a.bank}', \${a.price})">Comprar</button>
                </div>
            \`).join('');
        }

        async function startOrder(bank, price) {
            const res = await fetch('/api/p2p/order', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ buyer_id: me.id, seller_id: 1, amount: 100, price, bank })
            });
            const data = await res.json();
            activeOrd = data.order_id;
            openOrderView();
        }

        function openOrderView() {
            chatModal.style.display = 'flex';
            ordIdInfo.innerText = "Orden: " + activeOrd;
            chatLoop = setInterval(syncChat, 2000);
        }

        function closeOrder() {
            chatModal.style.display = 'none';
            clearInterval(chatLoop);
        }

        async function sendMsg() {
            if(!chatInput.value) return;
            await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, sender_id: me.id, text: chatInput.value })
            });
            chatInput.value = '';
            syncChat();
        }

        async function syncChat() {
            const res = await fetch('/api/chat/' + activeOrd);
            const data = await res.json();
            msgs.innerHTML = data.msgs.map(m => \`
                <div class="msg \${m.sender_id === me.id ? 'me' : ''}">\${m.text}</div>
            \`).join('');
            ordStatus.innerText = "ESTADO: " + data.status;
            
            // Lógica de botones por rol
            if(data.status === 'PAGADO') {
                btnPay.style.display = 'none';
                btnRelease.style.display = 'block'; // En un P2P real esto solo lo ve el vendedor
            }
        }

        async function updateStatus(newStatus) {
            await fetch('/api/p2p/status', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, status: newStatus })
            });
            if(newStatus === 'CANCELADA' || newStatus === 'COMPLETADA') closeOrder();
        }
    </script>
</body>
</html>
`;

// --- RUTAS DEL SERVIDOR ---

app.get('/', (req, res) => res.send(mainHTML));

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3)", [username.toLowerCase(), email.toLowerCase(), hash]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Usuario/Email ya existe" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const r = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        const v = await bcrypt.compare(password, r.rows[0].password_hash);
        if(v) res.json({ success: true, user: r.rows[0] });
        else res.status(400).json({ error: "Clave incorrecta" });
    } catch (e) { res.status(400).json({ error: "No existe" }); }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Platinum P2P Interactiva Ready`));
