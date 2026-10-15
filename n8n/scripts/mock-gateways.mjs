/**
 * Local stand-ins for the outside world, for developing and testing the workflow:
 *
 *   POST /sms/primary     an SMS gateway (refuses with 503 while "primary down" is on)
 *   POST /sms/fallback    the second SMS gateway
 *   POST /email           an e-mail API (multipart: to, subject, text, attachment)
 *   GET  /messages        everything "sent" so far
 *   POST /control         { "primaryDown": true|false, "reset": true }
 *
 *   node scripts/mock-gateways.mjs        (port 5680, or MOCK_PORT)
 *
 * Real gateways (e.g. SSL Wireless, BulkSMSBD, Mailgun, Brevo) have their own
 * request formats: adjust the three "Send ..." / "SMS ..." nodes of the workflow.
 */
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_PORT ?? 5680);
let primaryDown = process.env.MOCK_SMS_PRIMARY_DOWN === '1';
let messages = [];
let seq = 0;

function read(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const body = await read(req);
  const url = new URL(req.url, `http://localhost:${port}`);
  const auth = req.headers.authorization ?? null;

  if (req.method === 'GET' && url.pathname === '/messages') return reply(res, 200, messages);

  if (req.method === 'POST' && url.pathname === '/control') {
    const c = JSON.parse(body.toString() || '{}');
    if (typeof c.primaryDown === 'boolean') primaryDown = c.primaryDown;
    if (c.reset) messages = [];
    return reply(res, 200, { primaryDown, messages: messages.length });
  }

  if (req.method === 'POST' && url.pathname.startsWith('/sms/')) {
    const gateway = url.pathname.slice(5);
    if (gateway === 'primary' && primaryDown) return reply(res, 503, { error: 'primary gateway down (mock)' });
    const sms = JSON.parse(body.toString());
    const id = `${gateway}-${++seq}`;
    messages.push({ id, channel: 'sms', gateway, to: sms.to, text: sms.text, reference: sms.reference, auth, at: new Date().toISOString() });
    console.log(`SMS via ${gateway} to ${sms.to}: ${sms.text}`);
    return reply(res, 200, { id, status: 'accepted' });
  }

  if (req.method === 'POST' && url.pathname === '/email') {
    // multipart/form-data (or JSON)
    let mail;
    const type = req.headers['content-type'] ?? '';
    if (type.startsWith('multipart/form-data')) {
      const form = await new Response(body, { headers: { 'content-type': type } }).formData();
      const file = form.get('attachment');
      mail = {
        to: form.get('to'),
        subject: form.get('subject'),
        text: form.get('text'),
        attachment: file && typeof file !== 'string' ? { name: file.name, bytes: file.size, pdf: (await file.text()).startsWith('%PDF-'), encrypted: (await file.text()).includes('/Encrypt') } : null,
      };
    } else {
      mail = JSON.parse(body.toString());
    }
    const id = `email-${++seq}`;
    messages.push({ id, channel: 'email', ...mail, auth, at: new Date().toISOString() });
    console.log(`E-mail to ${mail.to}: ${mail.subject}${mail.attachment ? ` [${mail.attachment.name}, ${mail.attachment.bytes} bytes]` : ''}`);
    return reply(res, 200, { id, status: 'queued' });
  }

  reply(res, 404, { error: 'not found' });
}).listen(port, () => console.log(`mock gateways on http://localhost:${port}  (SMS primary ${primaryDown ? 'DOWN' : 'up'})`));
