import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(bodyParser.json());
// ✅ 추가: x-www-form-urlencoded 파싱
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Memory stores
const authCodes = {};   // code -> user
const tokens = {};      // token -> user

// 1️⃣ authorize endpoint (auto-approve)
app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, state } = req.query;
  const code = crypto.randomBytes(8).toString("hex");
  authCodes[code] = { client_id, user: { id: "user123", name: "Test User" } };

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  res.redirect(redirect.toString());
});

// 2️⃣ token endpoint
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

// 3️⃣ userinfo endpoint
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

// 4️⃣ callback page (debug)
app.get("/callback", (req, res) => {
  res.send(`<h3>Callback</h3><pre>${JSON.stringify(req.query, null, 2)}</pre>`);
});

app.listen(PORT, () => console.log(`✅ OAuth mock server running on ${PORT}`));
