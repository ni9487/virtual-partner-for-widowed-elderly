// firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./deceased2-e842f-firebase-adminsdk-fbsvc-3dd0952346.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// 取得 Firestore 資料庫的實例
const db = admin.firestore();

module.exports = db;
