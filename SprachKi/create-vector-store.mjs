const key = process.env.ASK || process.env.OPENAI_API_KEY;
if (!key) throw new Error('ASK oder OPENAI_API_KEY fehlt.');
const name = process.env.VECTOR_STORE_NAME || 'SprachKi – Arbeitskontexte';
const response = await fetch('https://api.openai.com/v1/vector_stores', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name })
});
const data = await response.json();
if (!response.ok) throw new Error(data?.error?.message || JSON.stringify(data));
console.log(`OPENAI_VECTOR_STORE_ID=${data.id}`);
