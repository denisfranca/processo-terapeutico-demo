const https = require('https');
const LIMITE = 30;
const usos = {};

function chave(req) {
  return Buffer.from((req.headers['x-forwarded-for']||'x')+(req.headers['user-agent']||'')).toString('base64').slice(0,32);
}

function mes() { const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1); }

function verificar(k) {
  const id=k+':'+mes();
  if(!usos[id])usos[id]=0;
  return {n:usos[id],ok:usos[id]<LIMITE};
}

function registrar(k) {
  const id=k+':'+mes();
  if(!usos[id])usos[id]=0;
  usos[id]++;
}

function chamarAnthropic(prompt, tipo) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: tipo==='preco' ? 1500 : 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error((parsed.error && parsed.error.message) || 'Erro '+res.statusCode));
          } else {
            const texto = (parsed.content||[]).map(b=>b.text||'').join('').trim();
            resolve(texto);
          }
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

module.exports = async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({erro:'Metodo invalido'});

  try {
    const k = chave(req);
    const v = verificar(k);
    if(!v.ok) return res.status(429).json({erro:'limite_atingido',mensagem:'Limite de '+LIMITE+' processos por mês atingido.',realizados:v.n});

    const {prompt, tipo} = req.body||{};
    if(!prompt) return res.status(400).json({erro:'Prompt ausente'});

    const texto = await chamarAnthropic(prompt, tipo);
    registrar(k);
    const v2 = verificar(k);
    return res.status(200).json({resultado:texto, uso:{realizados:v2.n,limite:LIMITE,restantes:LIMITE-v2.n}});
  } catch(err) {
    return res.status(500).json({erro:'Erro interno',mensagem:err.message});
  }
};
