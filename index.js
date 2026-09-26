<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Deadpool V7 — Pair Session</title>
  <style>
    :root {
      --bg: #0b0b0f;
      --card: #14141c;
      --red: #e11d48;
      --red2: #fb7185;
      --text: #f8fafc;
      --muted: #94a3b8;
      --line: #1e1e2a;
      --ok: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(1200px 600px at 50% -10%, #3f0d1a 0%, var(--bg) 55%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 26px 22px;
      box-shadow: 0 20px 50px rgba(0,0,0,.45);
    }
    .logo { text-align: center; font-size: 42px; margin-bottom: 6px; }
    h1 { margin: 0 0 4px; text-align: center; font-size: 1.4rem; }
    .sub { text-align: center; color: var(--muted); font-size: .88rem; margin-bottom: 18px; }
    label { display: block; font-size: .82rem; color: var(--muted); margin-bottom: 6px; }
    input {
      width: 100%;
      padding: 13px 14px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: #0d0d14;
      color: var(--text);
      font-size: 1rem;
      outline: none;
    }
    input:focus { border-color: var(--red); }
    button {
      width: 100%;
      margin-top: 12px;
      padding: 13px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--red), #9f1239);
      color: white;
      font-weight: 700;
      font-size: .95rem;
      cursor: pointer;
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    button.secondary {
      background: #1e293b;
      border: 1px solid var(--line);
      margin-top: 8px;
    }
    .box {
      margin-top: 16px;
      padding: 14px;
      border-radius: 12px;
      background: #0d0d14;
      border: 1px solid var(--line);
      display: none;
    }
    .box.show { display: block; }
    .code {
      font-size: 1.6rem;
      letter-spacing: .18em;
      text-align: center;
      font-weight: 800;
      color: var(--red2);
      margin: 8px 0;
    }
    .hint { color: var(--muted); font-size: .84rem; line-height: 1.45; }
    .session {
      word-break: break-all;
      font-size: .7rem;
      background: #000;
      padding: 10px;
      border-radius: 8px;
      max-height: 110px;
      overflow: auto;
      margin-top: 8px;
    }
    .ok { color: var(--ok); }
    .err { color: var(--red2); }
    .qr-wrap { text-align: center; margin: 10px 0; }
    .qr-wrap img {
      width: 260px;
      max-width: 100%;
      border-radius: 12px;
      background: #fff;
      padding: 8px;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .tab {
      flex: 1;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: #0d0d14;
      color: var(--muted);
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      font-size: .85rem;
    }
    .tab.active {
      background: #3f0d1a;
      color: #fff;
      border-color: var(--red);
    }
    .panel { display: none; }
    .panel.active { display: block; }
    .footer {
      text-align: center;
      margin-top: 16px;
      font-size: .8rem;
      color: var(--muted);
    }
    a { color: var(--red2); text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">💀</div>
    <h1>Deadpool V7</h1>
    <p class="sub">Get your WhatsApp session · Works on Chrome, Edge, Safari</p>

    <div class="tabs">
      <div class="tab active" data-tab="qr">📷 Scan QR</div>
      <div class="tab" data-tab="code">🔢 Pair Code</div>
    </div>

    <!-- QR TAB (recommended) -->
    <div id="panel-qr" class="panel active">
      <p class="hint">Open this page on <b>Chrome / Edge / Safari</b>. Tap below, then scan the QR with your phone.</p>
      <button id="btnQr" type="button">Generate QR Code</button>
    </div>

    <!-- CODE TAB -->
    <div id="panel-code" class="panel">
      <label for="phone">WhatsApp number (country code, no +)</label>
      <input id="phone" type="tel" placeholder="e.g. 254712345678" />
      <button id="btnCode" type="button">Get Code (DEADPOOL)</button>
      <p class="hint" style="margin-top:10px">On phone: Linked Devices → Link with phone number</p>
    </div>

    <div id="statusBox" class="box">
      <div id="statusText" class="hint"></div>
      <div id="qrWrap" class="qr-wrap" style="display:none">
        <img id="qrImg" alt="QR Code" />
      </div>
      <div id="codeEl" class="code" style="display:none"></div>
      <div id="sessionWrap" style="display:none">
        <p class="ok">✅ Session ready — also sent to your WhatsApp PM</p>
        <div id="sessionEl" class="session"></div>
        <button type="button" id="copyBtn" class="secondary">📋 Copy Session</button>
      </div>
    </div>

    <p class="footer">
      Powered by Confronter<br />
      <a href="https://wa.me/254796283064" target="_blank">Developer support</a>
    </p>
  </div>

  <script>
    const tabs = document.querySelectorAll('.tab');
    const panels = { qr: document.getElementById('panel-qr'), code: document.getElementById('panel-code') };
    tabs.forEach(t => t.onclick = () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      Object.values(panels).forEach(p => p.classList.remove('active'));
      panels[t.dataset.tab].classList.add('active');
    });

    const statusBox = document.getElementById('statusBox');
    const statusText = document.getElementById('statusText');
    const qrWrap = document.getElementById('qrWrap');
    const qrImg = document.getElementById('qrImg');
    const codeEl = document.getElementById('codeEl');
    const sessionWrap = document.getElementById('sessionWrap');
    const sessionEl = document.getElementById('sessionEl');
    const copyBtn = document.getElementById('copyBtn');
    const btnQr = document.getElementById('btnQr');
    const btnCode = document.getElementById('btnCode');
    let pollTimer = null;

    function resetUI() {
      statusBox.classList.add('show');
      sessionWrap.style.display = 'none';
      qrWrap.style.display = 'none';
      codeEl.style.display = 'none';
    }

    function poll(id) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/status/' + id);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Expired');

          if (data.qr) {
            qrImg.src = data.qr;
            qrWrap.style.display = 'block';
            statusText.innerHTML =
              '📷 <b>Scan this QR</b> with your phone:<br>' +
              'WhatsApp → ⋮ → <b>Linked Devices</b> → <b>Link a device</b> → point camera at QR';
          }
          if (data.code) {
            codeEl.style.display = 'block';
            codeEl.textContent = data.code;
            statusText.innerHTML =
              '⏰ Enter code <b>now</b>:<br>' +
              'Linked Devices → <b>Link with phone number</b>';
          }
          if (data.status === 'done' && data.session) {
            clearInterval(pollTimer);
            qrWrap.style.display = 'none';
            sessionWrap.style.display = 'block';
            sessionEl.textContent = data.session;
            statusText.innerHTML = '<span class="ok">✅ Linked! Copy session below (also in your WhatsApp PM).</span>';
            btnQr.disabled = false;
            btnCode.disabled = false;
          }
          if (data.status === 'error') {
            clearInterval(pollTimer);
            statusText.innerHTML =
              '<span class="err">❌ ' + (data.error || 'Failed') + '</span><br>' +
              '<span class="hint">Tap Generate QR / Get Code again.</span>';
            btnQr.disabled = false;
            btnCode.disabled = false;
          }
        } catch (e) {
          clearInterval(pollTimer);
          statusText.innerHTML = '<span class="err">❌ ' + e.message + '</span>';
          btnQr.disabled = false;
          btnCode.disabled = false;
        }
      }, 1200);
    }

    btnQr.onclick = async () => {
      btnQr.disabled = true;
      btnCode.disabled = true;
      resetUI();
      statusText.innerHTML = '⏳ Generating QR...';
      try {
        const res = await fetch('/api/pair/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        poll(data.id);
      } catch (e) {
        statusText.innerHTML = '<span class="err">❌ ' + e.message + '</span>';
        btnQr.disabled = false;
        btnCode.disabled = false;
      }
    };

    btnCode.onclick = async () => {
      const num = document.getElementById('phone').value.trim();
      if (!num) return alert('Enter your number');
      btnQr.disabled = true;
      btnCode.disabled = true;
      resetUI();
      statusText.innerHTML = '⏳ Requesting pairing code...';
      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: num })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        poll(data.id);
      } catch (e) {
        statusText.innerHTML = '<span class="err">❌ ' + e.message + '</span>';
        btnQr.disabled = false;
        btnCode.disabled = false;
      }
    };

    copyBtn.onclick = () => {
      navigator.clipboard.writeText(sessionEl.textContent).then(() => {
        copyBtn.textContent = '✅ Copied';
        setTimeout(() => (copyBtn.textContent = '📋 Copy Session'), 1500);
      });
    };
  </script>
</body>
</html>
