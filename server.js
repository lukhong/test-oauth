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

// 2️⃣ /token POST — code 교환
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

  // access token 생성
  const accessToken = jwt.sign({ sub: record.user.id }, JWT_SECRET, { expiresIn: "1h" });

  // refresh token 생성 (랜덤 문자열)
  const refreshToken = crypto.randomBytes(16).toString("hex");

  // 메모리 저장
  tokens[accessToken] = record.user;
  tokens[refreshToken] = record.user; // 필요시 refresh token 확인용

  delete authCodes[code];

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken // 추가
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

// SmartThings 상호작용 단일 엔드포인트
app.post("/interaction", async (req, res) => {
  const { headers, configurationData, callbackAuthentication } = req.body;
  const { interactionType, requestId } = headers;

  if (!interactionType) {
    return res.status(400).json({ error: "missing interactionType" });
  }

  // ----------------------
  // Discovery 처리
  // ----------------------
  if (interactionType === "discovery") {
    const response = {
      headers: {
        schema: "st-schema",
        version: "1.0",
        interactionType: "discoveryResponse",
        requestId: "abcabcabc",
      },
      devices: [
      {
         "externalDeviceId": "partner-device-id-1",
         "friendlyName": "Rend Bulb",
         "manufacturerInfo": {
            "manufacturerName": "RENDER_TEST",
            "modelName": "A19",
            "hwVersion": "bulb",
            "swVersion": "13.123.231"
         },
         "deviceContext" : {
            "categories": ["light", "switch"]
         },
         "deviceHandlerType": "c2c-rgbw-color-bulb"
      }
      ],
    };
    return res.json(response);
  }

  // ----------------------
  // grantCallbackAccess 처리
  // ----------------------
  if (interactionType === "grantCallbackAccess") {
    try {
      const { code, clientId, clientSecret, callbackUrls } = callbackAuthentication;
      if (!callbackUrls?.oauthToken) {
        return res.status(400).json({ error: "missing oauthToken URL in callbackUrls" });
      }

      // SmartThings가 제공한 URL로 POST해서 access token 요청
      const tokenResponse = await axios.post(callbackUrls.oauthToken, {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = {
        headers: {
          schema: "st-schema",
          version: "1.0",
          interactionType: "accessTokenResponse",
          requestId,
        },
        callbackAuthentication: {
          tokenType: "Bearer",
          accessToken: tokenResponse.data.access_token,
          refreshToken: tokenResponse.data.refresh_token,
          expiresIn: tokenResponse.data.expires_in || 86400,
        },
      };

      return res.json(response);
    } catch (err) {
      console.error(err.response?.data || err.message);
      return res.status(500).json({ error: "Failed to obtain access token from callbackUrls.oauthToken" });
    }
  }

  // ----------------------
  // 미지원 interactionType 처리
  // ----------------------
  return res.status(400).json({ error: `unsupported interactionType: ${interactionType}` });
});


// 서버 시작
app.listen(PORT, () => console.log(`✅ Mock OAuth server running on ${PORT}`));
