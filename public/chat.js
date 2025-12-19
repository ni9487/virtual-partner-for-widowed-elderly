const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const messages = document.getElementById('messages');

// 取得 profileId 與對方名稱
const urlParams = new URLSearchParams(window.location.search);
const profileId = urlParams.get('profileId');
const targetName = urlParams.get('name');

// -------------------- Web Speech API 初始化 --------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) alert('此瀏覽器不支援語音輸入，請使用 Chrome');

const recognition = new SpeechRecognition();
recognition.lang = 'zh-TW';
recognition.continuous = true;
recognition.interimResults = true;

let recording = false;

// -------------------- 語音按鈕 --------------------
micBtn.onclick = () => {
  if (!recording) {
    recognition.start();
    recording = true;
    micBtn.textContent = '🎙 錄音中';
    micBtn.style.backgroundColor = '#ff5252';
  } else {
    recognition.stop();
    recording = false;
    micBtn.textContent = '🎤';
    micBtn.style.backgroundColor = '#32d26a';
  }
};

recognition.onresult = (event) => {
  let interim = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const t = event.results[i][0].transcript;
    if (event.results[i].isFinal) {
      userInput.value = t;
    } else {
      interim += t;
    }
  }
  if (interim) userInput.value = interim;
};

recognition.onerror = () => {
  recording = false;
  micBtn.textContent = '🎤';
  micBtn.style.backgroundColor = '#32d26a';
};

// -------------------- 顯示訊息 --------------------
function appendMessage(sender, text, audioBase64 = null) {
  const msgDiv = document.createElement('div');
  msgDiv.className = sender === 'user' ? 'message user' : 'message bot';

  if (sender === 'bot') {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'sender-name';
    nameSpan.textContent = targetName;
    msgDiv.appendChild(nameSpan);
  }

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  // 🔊 喇叭
  if (sender === 'bot' && audioBase64) {
    const btn = document.createElement('button');
    btn.textContent = '🔊';
    btn.style.marginLeft = '8px';
    btn.onclick = () => {
      const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`);
      audio.play();
    };
    content.appendChild(btn);
  }

  msgDiv.appendChild(content);
  messages.appendChild(msgDiv);
  messages.scrollTop = messages.scrollHeight;
}


// -------------------- 發送訊息（✅ 已修正） --------------------
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !profileId) return;

  appendMessage('user', text);
  userInput.value = '';

  try {
    const res = await fetch(`/chat/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });

    const data = await res.json();

    if (data.success) {
      appendMessage('bot', data.reply, data.audio);
    } else {
      appendMessage('bot', `❌ ${data.error}`);
      console.error(data.error);
    }
  } catch (err) {
    console.error(err);
    appendMessage('bot', '❌ 回答失敗');
  }
}

//聊天歷史紀錄

async function loadHistory() {
  const res = await fetch(`/chat/${profileId}/history`);
  const data = await res.json();
  if (!data.success) return;

  data.history.forEach(m => {
    appendMessage(m.role, m.text);
  });
}

loadHistory();


// -------------------- 綁定 --------------------
sendBtn.onclick = sendMessage;
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});


