const express = require('express');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://adeebaab2_db_user:UrH4yqCV9Vyg6UZJrA@cluster0.ab3ua19.mongodb.net/';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-default-key';

let db;

MongoClient.connect(MONGO_URI).then(client => {
    db = client.db('spotify-licenses');
    console.log('✅ Connected to MongoDB');
}).catch(err => {
    console.error('❌ MongoDB error:', err.message);
});

app.get('/', (req, res) => {
    res.json({ 
        status: '✅ Spotify License Server Online',
        version: '1.0.0',
        adminKey: ADMIN_KEY,
        endpoints: {
            createLicense: 'POST /admin/create',
            listLicenses: 'GET /admin/list/:adminKey',
            toggleLicense: 'POST /admin/toggle',
            validateLicense: 'POST /validate'
        }
    });
});

app.post('/admin/create', async (req, res) => {
    try {
        const { adminKey, customerName } = req.body;
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, error: 'Wrong admin key' });
        }
        
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database not ready' });
        }
        
        const licenseKey = 'SPT-' + crypto.randomBytes(12).toString('hex').toUpperCase();
        
        await db.collection('licenses').insertOne({
            key: licenseKey,
            customerName: customerName || 'Unknown',
            deviceId: null,
            enabled: true,
            createdAt: Date.now(),
            activated: false
        });
        
        res.json({
            success: true,
            licenseKey: licenseKey,
            customerName: customerName
        });
        
        console.log(`✅ Created: ${licenseKey}`);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/admin/list/:adminKey', async (req, res) => {
    try {
        if (req.params.adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, error: 'Wrong admin key' });
        }
        
        if (!db) {
            return res.status(500).json({ success: false, error: 'Database not ready' });
        }
        
        const licenses = await db.collection('licenses').find({}).toArray();
        
        res.json({
            success: true,
            total: licenses.length,
            licenses: licenses.map(l => ({
                key: l.key,
                customer: l.customerName,
                enabled: l.enabled,
                activated: l.activated,
                deviceId: l.deviceId ? l.deviceId.substring(0, 16) + '...' : null,
                createdAt: new Date(l.createdAt).toLocaleString()
            }))
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/admin/toggle', async (req, res) => {
    try {
        const { adminKey, licenseKey, enabled } = req.body;
        
        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, error: 'Wrong admin key' });
        }
        
        await db.collection('licenses').updateOne(
            { key: licenseKey },
            { $set: { enabled: enabled } }
        );
        
        res.json({
            success: true,
            message: `License ${enabled ? 'enabled' : 'disabled'}`
        });
        
        console.log(`${enabled ? '✅' : '❌'} ${licenseKey}`);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/validate', async (req, res) => {
    try {
        const { licenseKey, deviceId } = req.body;
        
        if (!db) {
            return res.status(500).json({ valid: false, error: 'Database not ready' });
        }
        
        const license = await db.collection('licenses').findOne({ key: licenseKey });
        
        if (!license) {
            return res.status(404).json({ valid: false, error: 'Invalid license' });
        }
        
        if (!license.enabled) {
            return res.status(403).json({ valid: false, error: '⛔ License disabled' });
        }
        
        if (license.deviceId && license.deviceId !== deviceId) {
            return res.status(403).json({ valid: false, error: '⛔ Already activated on another device' });
        }
        
        if (!license.deviceId) {
            await db.collection('licenses').updateOne(
                { key: licenseKey },
                { $set: { deviceId: deviceId, activated: true, activatedAt: Date.now() } }
            );
            console.log(`✅ Activated: ${licenseKey}`);
        }
        
        res.json({
            valid: true,
            message: '✅ License valid!',
            customer: license.customerName
        });
        
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`🔑 Admin: ${ADMIN_KEY}`);
});
