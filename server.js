import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // form submit 파싱
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Memory stores
const authCodes = {}; // code -> user
const tokens = {};    // token -> user

// 1️⃣ GET /authorize — 로그인 폼 표시
app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, state } = req.query;

  res.send(`
    <h2>Mock OAuth Login</h2>
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${client_id}" />
      <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
      <input type="hidden" name="state" value="${state || ""}" />
      <label>User ID: <input type="text" name="username" /></label><br/>
      <label>Password: <input type="password" name="password" /></label><br/>
      <button type="submit">Login</button>
    </form>
  `);
});

// 1️⃣ POST /authorize — 로그인 submit 처리
app.post("/authorize", (req, res) => {
  const { username, password, client_id, redirect_uri, state } = req.body;

  if (!username || !password) {
    return res.status(400).send("Missing username or password");
  }

  const code = crypto.randomBytes(8).toString("hex");
  authCodes[code] = { client_id, user: { id: username, name: username } };

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  res.redirect(redirect.toString());
});

// 2️⃣ POST /token — code 교환
app.post("/token", (req, res) => {
  const { grant_type, code } = req.body;

  if (!grant_type) {
    return res.status(400).json({ error: "missing grant_type" });
  }

  if (grant_type !== "authorization_code") {
    return res.status(400).json({ error: "unsupported_grant_type" });
  }

  const record = authCodes[code];
  if (!record) return res.status(400).json({ error: "invalid_grant" });

  const token = jwt.sign({ sub: record.user.id }, JWT_SECRET, { expiresIn: "1h" });
  tokens[token] = record.user;
  delete authCodes[code];

  res.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: 3600
  });
});

// 3️⃣ GET /userinfo — token 확인
app.get("/userinfo", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" });

  const token = auth.substring(7);
  try {
    jwt.verify(token, JWT_SECRET);
    res.json({ sub: "user123", name: "Test User", email: "test@example.com" });
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
});

// 4️⃣ GET /callback — 디버그용
app.get("/callback", (req, res) => {
  res.send(`<h3>Callback</h3><pre>${JSON.stringify(req.query, null, 2)}</pre>`);
});

// 서버 시작
app.listen(PORT, () => console.log(`✅ Mock OAuth server running on ${PORT}`));
