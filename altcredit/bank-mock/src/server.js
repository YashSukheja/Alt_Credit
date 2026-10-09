require('dotenv').config();
const { createBankApp } = require('./app');

const port = Number(process.env.PORT) || 5001;
const app = createBankApp({ apiKey: process.env.BANK_API_KEY });

app.listen(port, () => {
  console.log(JSON.stringify({ time: new Date().toISOString(), level: 'INFO', message: `Mock bank listening on http://localhost:${port}` }));
});
