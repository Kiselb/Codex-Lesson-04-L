const $ = (selector) => document.querySelector(selector);
const state = { token: sessionStorage.getItem('laceToken') || '', dialogId: sessionStorage.getItem('laceDialogId') || '', user: null, mode: 'login' };
const fields = [
  ['name', 'Имя'], ['budget', 'Бюджет'], ['shoeType', 'Тип обуви'], ['style', 'Стиль'],
  ['color', 'Цвет'], ['material', 'Материал'], ['urgency', 'Желаемый срок'], ['lastRequest', 'Последний запрос'],
];

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2300);
}

function showAuth() {
  state.user = null; state.token = ''; state.dialogId = ''; sessionStorage.removeItem('laceToken'); sessionStorage.removeItem('laceDialogId');
  $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); $('#user-chip').classList.add('hidden');
}

function openApp(user) {
  state.user = user; $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden'); $('#user-chip').classList.remove('hidden');
  $('#user-name').textContent = `${user.username} · ${user.role === 'admin' ? 'администратор' : 'клиент'}`;
  $('#greeting').textContent = user.memory.name ? `Добрый день, ${user.memory.name}!` : `Добрый день, ${user.username}!`;
  $('#admin-nav').classList.toggle('hidden', user.role !== 'admin');
  renderMemory(user.memory);
  if (!$('#messages').children.length) addMessage(user.memory.name ? `${user.memory.name}, рад снова вас видеть! Я готов продолжить с учётом сохранённых предпочтений.` : 'Добрый день! Я помогу подобрать, заказать, отремонтировать или утилизировать шнурки. Для какой обуви ищете пару?', 'bot');
}

function addMessage(text, role, remembered = [], source = '') {
  const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = text;
  if (remembered.length) { const mark = document.createElement('span'); mark.className = 'remembered'; mark.textContent = `Запомнил: ${remembered.map(k => Object.fromEntries(fields)[k] || k).join(', ')}`; node.append(mark); }
  if (role === 'bot' && source) { const mark = document.createElement('span'); mark.className = 'answer-source'; mark.textContent = source === 'openai' ? 'Ответ OpenAI' : 'Резервный ответ'; node.append(mark); }
  $('#messages').append(node); $('#messages').scrollTop = $('#messages').scrollHeight;
}

function renderMemory(memory) {
  $('#memory-form').innerHTML = fields.map(([key, label]) => `<label class="${key === 'lastRequest' ? 'wide' : ''}">${label}<input name="${key}" value="${escapeHtml(memory[key] || '')}" placeholder="Пока не указано"><button class="field-delete" type="button" data-delete-key="${key}" aria-label="Удалить ${label}">×</button></label>`).join('') + '<div class="memory-actions"><button class="primary" type="submit"><span>Сохранить</span><b>✓</b></button><button class="danger" type="button" id="delete-memory">Удалить все сведения</button></div>';
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]); }

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  state.mode = tab.dataset.mode; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $('#auth-title').textContent = state.mode === 'login' ? 'Рады снова видеть' : 'Создайте свой профиль';
  $('#auth-action').textContent = state.mode === 'login' ? 'Войти' : 'Зарегистрироваться';
  $('#password').autocomplete = state.mode === 'login' ? 'current-password' : 'new-password'; $('#auth-error').textContent = '';
}));

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#auth-error').textContent = '';
  try {
    const data = await api(`/api/${state.mode}`, { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
    state.token = data.token; state.dialogId = data.dialogId; sessionStorage.setItem('laceToken', state.token); sessionStorage.setItem('laceDialogId', state.dialogId); openApp(data.user);
  } catch (error) { $('#auth-error').textContent = error.message; }
});

$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} showAuth(); });
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === button));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden')); $(`#${button.dataset.panel}-panel`).classList.remove('hidden');
  if (button.dataset.panel === 'admin') loadUsers();
}));

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const input = $('#message'); const text = input.value.trim(); if (!text) return;
  addMessage(text, 'user'); input.value = ''; input.style.height = 'auto';
  const typing = document.createElement('div'); typing.className = 'message bot typing'; typing.innerHTML = '<i></i><i></i><i></i>'; $('#messages').append(typing);
  try {
    const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, dialogId: state.dialogId }) });
    state.dialogId = data.dialogId; sessionStorage.setItem('laceDialogId', state.dialogId);
    typing.remove(); addMessage(data.reply, 'bot', data.remembered, data.source); state.user.memory = data.memory; renderMemory(data.memory);
    if (data.memory.name) $('#greeting').textContent = `Добрый день, ${data.memory.name}!`;
  } catch (error) { typing.remove(); addMessage(`Не удалось ответить: ${error.message}`, 'bot'); }
});

$('#message').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; });
$('#quick-actions').addEventListener('click', (event) => { if (event.target.tagName !== 'BUTTON') return; $('#message').value = event.target.textContent; $('#chat-form').requestSubmit(); });
$('#clear-chat').addEventListener('click', async () => {
  try { const data = await api('/api/dialogs/new', { method: 'POST' }); state.dialogId = data.dialogId; sessionStorage.setItem('laceDialogId', state.dialogId); $('#messages').innerHTML = ''; addMessage('Начат новый диалог. Долгосрочные предпочтения сохранены и будут учтены.', 'bot'); } catch (error) { toast(error.message); }
});

$('#memory-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const memory = Object.fromEntries(new FormData(event.target));
  try { const data = await api('/api/me/memory', { method: 'PATCH', body: JSON.stringify({ memory }) }); state.user = data.user; renderMemory(data.user.memory); toast('Предпочтения сохранены'); } catch (error) { toast(error.message); }
});

$('#memory-form').addEventListener('click', async (event) => {
  const key = event.target.dataset.deleteKey;
  if (!key && event.target.id !== 'delete-memory') return;
  try {
    const query = key ? `?key=${encodeURIComponent(key)}` : '';
    const data = await api(`/api/me/memory${query}`, { method: 'DELETE' });
    state.user = data.user; renderMemory(data.user.memory); toast(key ? 'Сведение удалено' : 'Все сведения удалены');
  } catch (error) { toast(error.message); }
});

async function loadUsers() {
  try {
    const { users } = await api('/api/admin/users');
    $('#users-table').innerHTML = users.map(user => `<details class="user-card"><summary><strong>${escapeHtml(user.username)}</strong><span class="role">${user.role}</span><span>${new Date(user.updatedAt).toLocaleDateString('ru')}</span></summary><form data-id="${user.id}">${fields.filter(([k]) => k !== 'lastRequest').map(([key,label]) => `<input name="${key}" aria-label="${label}" title="${label}" value="${escapeHtml(user.memory[key] || '')}" placeholder="${label}">`).join('')}<button type="submit">Сохранить изменения</button><button type="button" class="admin-delete" data-user-id="${user.id}">Удалить все сведения</button></form></details>`).join('');
  } catch (error) { toast(error.message); }
}

$('#users-table').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.target; const memory = Object.fromEntries(new FormData(form));
  try { await api(`/api/admin/users/${form.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ memory }) }); toast('Данные пользователя обновлены'); } catch (error) { toast(error.message); }
});

$('#users-table').addEventListener('click', async (event) => {
  const id = event.target.dataset.userId; if (!id) return;
  try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); toast('Сведения пользователя удалены'); loadUsers(); } catch (error) { toast(error.message); }
});

(async function restore() { if (!state.token) return showAuth(); try { const data = await api('/api/me'); state.dialogId ||= data.dialogId; sessionStorage.setItem('laceDialogId', state.dialogId); openApp(data.user); } catch { showAuth(); } })();
