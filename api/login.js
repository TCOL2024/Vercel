module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = req.body;
  try {
    if (!body || typeof body === "string") {
      body = JSON.parse(body || "{}");
    }
  } catch {
    body = {};
  }

  const username = (body?.username ? String(body.username) : "").trim();
  const password = body?.password ? String(body.password) : "";

  const USERS = {
    linda: "PasswortHierAendern123",
    admin: "NochEinPasswort456"
  };

  if (!username || !password) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Username and password are required" }));
    return;
  }

  if (USERS[username] !== password) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Invalid credentials" }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      redirectTo: "/index.html"
    })
  );
};
