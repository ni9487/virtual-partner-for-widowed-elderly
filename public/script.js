const form = document.getElementById('uploadForm');
const result = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);

  try {
    const res = await fetch('/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      result.textContent = '上傳並分析完成！\n' + JSON.stringify(data.analysis, null, 2);
    } else {
      result.textContent = '上傳失敗：' + data.error;
    }
  } catch (err) {
    result.textContent = '網路錯誤：' + err.message;
  }
});
