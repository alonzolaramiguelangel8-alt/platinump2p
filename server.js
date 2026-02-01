const/**
 * PLATINUM P2P - SERVER CORE
 * Solución al error "Cannot GET /index.html"
 */
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const app = express();

// --- CONFIGURACIÓN CRÍTICA PARA ARCHIVOS ESTÁTICOS ---
// Esto le dice al servidor: "Busca los HTML en la carpeta 'public'"
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cors());

// --- BASE DE DATOS (POSTGRESQL) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Necesario para Render
});

// --- RUTAS DE NAVEGACIÓN ---

// 1. Si entran a la raíz '/', enviarlos al Login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 2. Ruta explícita para el Dashboard (por seguridad)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API DE USUARIOS (LOGIN Y REGISTRO) ---

// Registro
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Verificar si existe
        const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ success: false, message: "El usuario ya existe" });
        }

        // Crear usuario con 1000 USDT de bono (según tu solicitud)
        const newUser = await pool.query(
            "INSERT INTO users (email, password, balance_usdt) VALUES ($1, $2, 1000.00) RETURNING *",
            [email, password]
        );
        res.json({ success: true, user: newUser.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error en base de datos" });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, password]);
        
        if (result.rows.length > 0) {
            // LOGIN EXITOSO
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Error de servidor" });
    }
});

// API para obtener saldo actualizado
app.get('/api/user/:email', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [req.params.email]);
        if(result.rows.length > 0) res.json(result.rows[0]);
        else res.status(404).send("User not found");
    } catch (e) { res.status(500).send(e.message); }
});

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo. Archivos estáticos servidos desde /public`);
});
