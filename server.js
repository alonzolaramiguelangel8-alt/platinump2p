const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path'); // Importante para las rutas
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURACIÓN DE RUTAS ---

// 1. Servir archivos de la carpeta raíz
app.use(express.static(path.join(__dirname)));

// 2. Ruta principal (Cuando entras a la URL pelada)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// 3. Ruta del Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- EL RESTO DEL CÓDIGO (DB y API) ---
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
        await pool.query("INSERT INTO wallets (user_id) VALUES ($1)", [newUser.rows[0].id]);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: "Error al registrar" });
    }
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
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
