export default function handler(req, res) {
  const auth = req.headers.authorization || '';
  const [scheme, encoded] = auth.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.status(401).setHeader('WWW-Authenticate', 'Basic realm="LindaBot"');
    return res.end('Access denied');
  }

  const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  const VALID_USER = 'linda';
  const VALID_PASS = 'LindaDezember25';

  if (user === VALID_USER && pass === VALID_PASS) {
    res.status(200).sendFile('/index2510.html');
  } else {
    res.status(401).setHeader('WWW-Authenticate', 'Basic realm="LindaBot"');
    res.end('Unauthorized');
  }
}
