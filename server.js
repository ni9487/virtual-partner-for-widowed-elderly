import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';

const app = express();
const upload = multer({ dest: 'uploads/' });

/* =========================
   Firebase Admin 初始化
========================= */
import serviceAccount from './deceased2-e842f-firebase-adminsdk-fbsvc-3dd0952346.json' with { type: 'json' };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* =========================
   Gemini 初始化
========================= */
const ai = new GoogleGenAI({}); // 使用 GEMINI_API_KEY

app.use(express.json());
app.use(express.static('public'));

/* =========================
   工具函式（原有）
========================= */
function extractNameFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace('[LINE]', '')
    .trim();
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('找不到 JSON 區塊');
  return JSON.parse(match[0]);
}

async function readChatFile(filePath) {
  return fs.readFile(filePath, 'utf-8');
}

/* =========================
   🔹 新增：聊天紀錄工具（不影響原本）
========================= */
async function appendChatMessage(profileId, role, text) {
  const ref = db.collection('ChatMessages').doc(profileId);
  await ref.set({
    messages: admin.firestore.FieldValue.arrayUnion({
      role,
      text,
      ts: Date.now()
    })
  }, { merge: true });
}

async function getChatHistory(profileId) {
  const doc = await db.collection('ChatMessages').doc(profileId).get();
  return doc.exists ? doc.data().messages : [];
}

/* =========================
   Gemini 分析主邏輯（原有）
========================= */
async function analyzeChat(chatText, targetName, originalFilename) {
  const prompt = `
你正在分析一份 LINE 私人聊天紀錄。

【重要背景資訊】
- 檔名為：「${originalFilename}」
- 這是使用者與「${targetName}」的一對一聊天
- 你【只能】分析並模仿「${targetName}」
- 請忽略其他聊天參與者（包含使用者）

【任務】
請根據聊天內容，產生「只屬於 ${targetName}」的角色記憶。

【輸出規則（非常重要）】
- 你【只能】輸出 JSON
- 不可有任何說明文字、Markdown、註解
- JSON 結構必須完全符合以下格式

{
  "nickname": "暱稱",
  "relationship": "與使用者的關係",
  "avatar_url": "",
  "personality_prompt": "完整、可直接餵給聊天模型的人格描述",
  "analysis_status": "completed",
  "sample_messages": ["訊息1", "訊息2"]
}

【聊天內容】
${chatText}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt
  });

  return extractJson(response.text);
}

/* =========================
   Firestore 存檔（原有）
========================= */
async function saveMemoryProfile(profileId, data) {
  await db.collection('MemoryProfiles').doc(profileId).set(data);
}

/* =========================
   上傳 API（原有）
========================= */
app.post('/upload', upload.single('chatFile'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const originalFilename = req.file.originalname;

    const targetName =
      req.body.deceasedName ||
      extractNameFromFilename(originalFilename);

    const profileId =
      req.body.profileId || targetName;

    const chatText = await readChatFile(filePath);

    const analysis = await analyzeChat(
      chatText,
      targetName,
      originalFilename
    );

    await saveMemoryProfile(profileId, {
      name: targetName,
      ...analysis
    });

    res.json({ success: true, profileId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   取得 Profile（原有）
========================= */
app.get('/profile/:id', async (req, res) => {
  const doc = await db.collection('MemoryProfiles').doc(req.params.id).get();
  if (!doc.exists) {
    return res.status(404).json({ success: false, error: 'Profile 不存在' });
  }
  res.json({ success: true, profile: doc.data() });
});

/* =========================
   🔹 聊天 API（僅「加功能」，不破壞）
========================= */
app.post('/chat/:id', async (req, res) => {
  try {
    const profileDoc = await db.collection('MemoryProfiles').doc(req.params.id).get();
    if (!profileDoc.exists) {
      return res.status(404).json({ success: false, error: 'Profile 不存在' });
    }

    const profile = profileDoc.data();
    const userMessage = req.body.message;

    // ⭐ 新增：存使用者訊息
    await appendChatMessage(req.params.id, 'user', userMessage);

    // ⭐ 新增：讀歷史
    const history = await getChatHistory(req.params.id);

    const conversation = history.map(m =>
      `${m.role === 'user' ? '使用者' : profile.name}：${m.text}`
    ).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `
你正在模仿以下角色：
${profile.personality_prompt}

以下是你與使用者的對話紀錄：
${conversation}

請接著回覆使用者最新一句話。
`
    });

    const replyText = response.text;

    // ⭐ 新增：存 AI 回覆
    await appendChatMessage(req.params.id, 'bot', replyText);

    // 🔊 原有 TTS（完全不動）
    let audioBase64 = null;
    try {
      const audioBuffer = await synthesizeWithMinimax(replyText);
      audioBase64 = Buffer.from(audioBuffer).toString('base64');
    } catch {}

    res.json({
      success: true,
      reply: replyText,
      audio: audioBase64
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   🔹 新增：聊天紀錄讀取 API
========================= */
app.get('/chat/:id/history', async (req, res) => {
  try {
    const history = await getChatHistory(req.params.id);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   多聊天室（原有）
========================= */
app.get('/profiles', async (req, res) => {
  const snapshot = await db.collection('MemoryProfiles').get();
  const profiles = [];
  snapshot.forEach(doc => {
    profiles.push({ profileId: doc.id, name: doc.data().name });
  });
  res.json({ success: true, profiles });
});

/* =========================
   MiniMax TTS（原有）
========================= */
async function synthesizeWithMinimax(text) {
  const res = await fetch('https://api.minimax.chat/v1/text_to_speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'speech-01',
      text,
      voice_id: 'moss_audio_733d9781-d687-11f0-b1f5-d622d05211d6',
      format: 'mp3'
    })
  });

  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer);
}

/* =========================
   啟動 Server
========================= */
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
