const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Servir archivos estáticos desde la raíz
app.use(express.static(__dirname));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicialización de Base de Datos
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                kyc_level INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                balance_available DECIMAL(18,2) DEFAULT 0
            );
        `);
        console.log("✅ Tablas listas y conectadas");
    } catch (err) {
        console.error("❌ Error DB:", err);
    }
}
initDB();

// RUTAS DE NAVEGACIÓN
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API: Registro
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userCount = await pool.query("SELECT COUNT(*) FROM users");
        const isFirstUser = parseInt(userCount.rows[0].count) === 0;
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash, is_admin, kyc_level) VALUES ($1, $2, $3, $4, 2) RETURNING id",
            [username.toLowerCase(), email.toLowerCase(), hashedPassword, isFirstUser]
        );
        
        await pool.query("INSERT INTO wallets (user_id, balance_available) VALUES ($1, 1000.00)", [newUser.rows[0].id]);
        
        res.json({ success: true, message: "Cuenta creada" });
    } catch (e) {
        res.status(400).json({ error: "El usuario o email ya existen." });
    }
});

// API: Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (result.rows.length === 0) return res.status(400).json({ error: "No encontrado" });

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) return res.status(400).json({ error: "Clave incorrecta" });

        res.json({ success: true, user: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: "Error de servidor" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Corriendo en puerto ${PORT}`));
