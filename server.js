const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Librería para manejar archivos
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- ESTO CREA EL ARCHIVO SI RENDER NO LO VE ---
const loginHTMLContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Platinum P2P - Login</title>
    <style>
        body { background: #0b0e11; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: #1e2329; padding: 30px; border-radius: 10px; width: 300px; text-align: center; }
        input { width: 100%; padding: 10px; margin: 10px 0; border-radius: 5px; border: 1px solid #474d57; background: #2b2f36; color: white; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #f3ba2f; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; margin-top: 10px; }
    </style>
</head>
<body>
    <div class="box">
        <h2 style="color:#f3ba2f">Platinum P2P</h2>
        <input type="text" id="user" placeholder="Usuario">
        <input type="email" id="email" placeholder="Correo">
        <input type="password" id="pass" placeholder="Contraseña">
        <button onclick="auth('register')">REGISTRARSE</button>
        <button onclick="auth('login')" style="background:transparent; color:#f3ba2f; border:1px solid #f3ba2f">INGRESAR</button>
    </div>
    <script>
        async function auth(type) {
            const data = {
                username: document.getElementById('user').value,
                email: document.getElementById('email').value,
                password: document.getElementById('pass').value
            };
            const res = await fetch('/api/auth/' + type, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (res.ok) {
                if (type === 'login') {
                    localStorage.setItem('user', JSON.stringify(result.user));
                    window.location.href = '/dashboard';
                } else { alert('Registro exitoso, ahora inicia sesión'); }
            } else { alert('Error: ' + result.error); }
        }
    </script>
</body>
</html>
`;

// Escribir el archivo en el sistema de Render al iniciar
fs.writeFileSync(path.join(__dirname, 'login.html'), loginHTMLContent);

// --- RUTAS ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
    // Si no existe index.html, podrías hacer lo mismo que con login
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- API ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, true) RETURNING id",
            [username.toLowerCase(), email.toLowerCase(), hashed]
        );
        await pool.query("INSERT INTO wallets (user_id, balance_available) VALUES ($1, 1000.00)", [newUser.rows[0].id]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Error en registro" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (result.rows.length === 0) return res.status(400).json({ error: "No existe" });
        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) return res.status(400).json({ error: "Clave mal" });
        res.json({ success: true, user: result.rows[0] });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Listo en puerto ${PORT}`))
