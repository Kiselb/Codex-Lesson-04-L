const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DISABLE_LLM = 'true';
const { generateReply, systemPrompt } = require('../src/llm');

test('LLM получает базу знаний, память и историю диалога', async () => {
  let request;
  const client = { chat: { completions: { create: async (body) => {
    request = body;
    return { choices: [{ message: { content: 'Персональный ответ модели' } }] };
  } } } };
  const result = await generateReply({
    text: 'Что посоветуете?',
    memory: { name: 'Анна', color: 'розовый' },
    history: [{ role: 'user', text: 'Нужны шнурки для кроссовок' }, { role: 'assistant', text: 'Уточните цвет' }, { role: 'user', text: 'Что посоветуете?' }],
    client,
  });
  assert.equal(result.source, 'openai');
  assert.equal(result.text, 'Персональный ответ модели');
  assert.match(request.messages[0].content, /Шальные Шнурки/);
  assert.match(request.messages[0].content, /розовый/);
  assert.match(request.messages[0].content, /Серийно|серийно/);
  assert.equal(request.messages.at(-1).content, 'Что посоветуете?');
});

test('системный промпт исправляет устаревшее название компании', () => {
  const prompt = systemPrompt({});
  assert.match(prompt, /Всегда называй компанию «Шальные Шнурки»/);
  assert.match(prompt, /не выдумывай/i);
});
