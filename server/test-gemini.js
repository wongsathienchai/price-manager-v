require('dotenv').config({ path: '../.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('GEMINI_API_KEY not found'); process.exit(1); }

const genAI = new GoogleGenerativeAI(API_KEY);
const MODELS = [
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

(async () => {
  console.log('Testing Gemini API key...\n');
  for (const m of MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const r = await model.generateContent('say OK');
      console.log('OK   ' + m);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429') || msg.includes('QUOTA') || msg.includes('quota')) {
        console.log('QUOTA ' + m);
      } else if (msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('not found')) {
        console.log('404  ' + m);
      } else {
        console.log('ERR  ' + m + ' | ' + msg.slice(0, 80));
      }
    }
  }
})();
