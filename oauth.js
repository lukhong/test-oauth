import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// Memory stores
const authCodes = {}; // code -> user
const tokens = {};    // token -> user
const render2_stClientId = 'a951c0a3-cddd-4232-94db-c8821685c626';
const render2_stSecret = '9fcde5beebbb17f28031075c76a03f622f3b7f61142bc7bbc9e6c02f26894f6d96aaeffac0ca0e48b3770fd8dbda176fd275a85e31dfc3042cad1d66640ead8d790985396c99c1ff3a700d26f031c489765f56cd60563125f210d9f8dcedec92fefab02deece9f061276336f794b3f8d9a53569aca3a377e3fcce08285cdbddbf293208f7f0e4e719061130793a396ea4f3b95296b29fc984c892ab66bca3da88b999b5feac1d2eaad4b47f217b7f0ca385402986cf071224a114921aaf2f4d3bb38309eaa83c5d6a7699508e926c450d438e2b6e284ac6d32c843ad7863946e1eee69aaba29ba6315f17cbcc389ef71872f89eca4ca44ae2d6aa02a8d68ae1b';

//st token cache
let stAccess = null;
let stRefresh = null;
let stStateCallbackUrl = null;

// Export functions to access cached tokens
export function getStAccessToken() {
  return stAccess;
}

export function getStRefreshToken() {
  return stRefresh;
}

export function getStStateCallbackUrl() {
  return stStateCallbackUrl;
}

export class OAuthHandler {
  // 1️⃣ GET /authorize — 로그인 폼 표시
  static getAuthorizeForm(req, res) {
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
  }

  // 1️⃣ POST /authorize — 로그인 submit 처리
  static handleAuthorize(req, res) {
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
  }

  // 2️⃣ /token POST — code 교환
  static handleToken(req, res) {
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
  }

  // 3️⃣ GET /userinfo — token 확인
  static getUserInfo(req, res) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "missing_token" });

    const token = auth.substring(7);
    try {
      jwt.verify(token, JWT_SECRET);
      res.json({ sub: "user123", name: "Test User", email: "test@example.com" });
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  }

  // 4️⃣ GET /callback — 디버그용
  static getCallback(req, res) {
    res.send(`<h3>Callback</h3><pre>${JSON.stringify(req.query, null, 2)}</pre>`);
  }

  // Memory store for callback URLs
  static callbackUrls = {};

  // SmartThings grantCallbackAccess 처리
  static async handleGrantCallbackAccess(requestBody, requestId) {
    console.log(`handleGrantCallbackAccess request: ${JSON.stringify(requestBody, null, 2)}`);
    
    const { callbackAuthentication, callbackUrls } = requestBody;
    
    // Store callbackUrls in memory
    this.callbackUrls = callbackUrls;
    stStateCallbackUrl = callbackUrls.stateCallback;
    
    // Create access token request
    const accessTokenRequest = {
      headers: {
        schema: "st-schema",
        version: "1.0",
        interactionType: "accessTokenRequest",
        requestId: "access_token_request_12345"
      },
      callbackAuthentication: {
        grantType: callbackAuthentication.grantType,
        code: callbackAuthentication.code,
        clientId: render2_stClientId,
        clientSecret: render2_stSecret
      }
    };
    
    try {
    
      // Make POST request to oauthToken URL with proper format
      const response = await axios.post(callbackUrls.oauthToken, accessTokenRequest, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`Access token response: ${JSON.stringify(response.data, null, 2)}`);
         
      // Cache the tokens for later use
      stAccess = response.data.callbackAuthentication.accessToken;
      stRefresh = response.data.callbackAuthentication.refreshToken;
      
      console.log(`Cached tokens - Access: ${stAccess}, Refresh: ${stRefresh}`);
      
      // Return the response data in SmartThings format
      return true;
    } catch (error) {
      console.error(`Error requesting access token: ${error.message}`);
      throw error;
    }
  }
}
