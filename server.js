import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";

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
  if (interactionType === "discoveryRequest") {
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
         "friendlyName": "Rend ",
         "manufacturerInfo": {
            "manufacturerName": "Virtual Hyundai",
            "modelName": "Test Model",
            "hwVersion": "3",
            "swVersion": "1.0"
         },
         "deviceContext" : {
            "categories": ["Car"]
         },
         "deviceHandlerType": "4e8bdf64-c46a-4c9c-8d01-3929d9c923ed"
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
  // stateRefresh 처리
  // ----------------------
  if (interactionType === "stateRefreshRequest") {
    const { devices } = req.body;
    
    const deviceState = {
      externalDeviceId: "partner-device-id-1",
      deviceCookie: {},
      states: [
        // vehicleHvacRemoteSwitch
        {
          "component": "main",
          "capability": "st.vehicleHvacRemoteSwitch",
          "attribute": "switch",
          "value": null
        },
        // vehicleWindowState
        {
          "component": "main",
          "capability": "st.vehicleWindowState",
          "attribute": "frontRightWindow",
          "value": "closed"
        },
        {
          "component": "main",
          "capability": "st.vehicleWindowState",
          "attribute": "rearRightWindow",
          "value": "closed"
        },
        {
          "component": "main",
          "capability": "st.vehicleWindowState",
          "attribute": "supportedAttributes",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleWindowState",
          "attribute": "frontLeftWindow",
          "value": "closed"
        },
        {
          "component": "main",
          "capability": "st.vehicleWindowState",
          "attribute": "rearLeftWindow",
          "value": "closed"
        },
        // vehicleRange
        {
          "component": "main",
          "capability": "st.vehicleRange",
          "attribute": "estimatedRemainingRange",
          "value": 216,
          "unit": "km"
        },
        // vehicleEngine
        {
          "component": "main",
          "capability": "st.vehicleEngine",
          "attribute": "engineState",
          "value": null
        },
        // vehicleInformation
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleColor",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleYear",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleImage",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleTrim",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehiclePlate",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleModel",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleId",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleInformation",
          "attribute": "vehicleMake",
          "value": null
        },
        // vehicleOdometer
        {
          "component": "main",
          "capability": "st.vehicleOdometer",
          "attribute": "odometerReading",
          "value": 25256,
          "unit": "km"
        },
        // healthCheck
        {
          "component": "main",
          "capability": "st.healthCheck",
          "attribute": "checkInterval",
          "value": 60,
          "unit": "s"
        },
        {
          "component": "main",
          "capability": "st.healthCheck",
          "attribute": "healthStatus",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.healthCheck",
          "attribute": "DeviceWatch-Enroll",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.healthCheck",
          "attribute": "DeviceWatch-DeviceStatus",
          "value": "online"
        },
        // custom.disabledCapabilities
        {
          "component": "main",
          "capability": "custom.disabledCapabilities",
          "attribute": "disabledCapabilities",
          "value": []
        },
        // vehicleDoorState
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "frontLeftDoor",
          "value": "locked"
        },
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "rearRightDoor",
          "value": "locked"
        },
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "rearLeftDoor",
          "value": "locked"
        },
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "supportedAttributes",
          "value": null
        },
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "lockState",
          "value": "locked"
        },
        {
          "component": "main",
          "capability": "st.vehicleDoorState",
          "attribute": "frontRightDoor",
          "value": "locked"
        },
          // vehicleHvac
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "temperatureRange",
          "value": {
            "minimum": 17,
            "maximum": 27
          },
          "unit": "C"
        },
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "defogState",
          "value": "off"
        },
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "hvacSpeedRange",
          "value": {
            "minimum": 0,
            "maximum": 8
          }
        },
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "temperature",
          "value": 24,
          "unit": "C"
        },
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "hvacState",
          "value": "off"
        },
        {
          "component": "main",
          "capability": "st.vehicleHvac",
          "attribute": "hvacSpeed",
          "value": 0
        },
        // vehicleWarning
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "fuel",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "tirePressureFrontLeft",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "electricVehicleBattery",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "supportedAttributes",
          "value": [
            "tirePressureFrontLeft",
            "tirePressureFrontRight",
            "tirePressureRearLeft",
            "tirePressureRearRight",
            "auxiliaryBattery",
            "washerFluid",
            "brakeFluid",
            "lampWire",
            "fuel",
            "engineOil"
          ]
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "lampWire",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "auxiliaryBattery",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "brakeFluid",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "tirePressureFrontRight",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "washerFluid",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "smartKeyBattery",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "engineOil",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "tirePressureRearLeft",
          "value": "normal"
        },
        {
          "component": "main",
          "capability": "st.vehicleWarning",
          "attribute": "tirePressureRearRight",
          "value": "normal"
        }
      ]
    };

    const response = {
      headers: {
        schema: "st-schema",
        version: "1.0",
        interactionType: "stateRefreshResponse",
        requestId: requestId
      },
      deviceState: [deviceState]
    };

    return res.json(response);
  }

  // ----------------------
  // 미지원 interactionType 처리
  // ----------------------
  return res.status(400).json({ error: `unsupported interactionType: ${interactionType}` });
});


// 서버 시작
app.listen(PORT, () => console.log(`✅ Mock OAuth server running on ${PORT}`));
