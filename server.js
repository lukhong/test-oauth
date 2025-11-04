import express from "express";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import { OAuthHandler } from "./oauth.js";
import { DeviceManager } from "./deviceHandlers.js";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // form submit 파싱
app.use(cookieParser());

const PORT = process.env.PORT || 3000;

// Initialize device manager
const deviceManager = new DeviceManager();

// OAuth endpoints
// 1️⃣ GET /authorize — 로그인 폼 표시
app.get("/authorize", (req, res) => {
  OAuthHandler.getAuthorizeForm(req, res);
});

// 1️⃣ POST /authorize — 로그인 submit 처리
app.post("/authorize", (req, res) => {
  OAuthHandler.handleAuthorize(req, res);
});

// 2️⃣ /token POST — code 교환
app.post("/token", (req, res) => {
  OAuthHandler.handleToken(req, res);
});

// 3️⃣ GET /userinfo — token 확인
app.get("/userinfo", (req, res) => {
  OAuthHandler.getUserInfo(req, res);
});

// 4️⃣ GET /callback — 디버그용
app.get("/callback", (req, res) => {
  OAuthHandler.getCallback(req, res);
});

// SmartThings 상호작용 단일 엔드포인트
app.post("/interaction", async (req, res) => {
  const { headers, authentication, callbackAuthentication, callbackUrls, devices } = req.body;
  const { interactionType, requestId } = headers;

  if (!interactionType) {
    return res.status(400).json({ error: "missing interactionType" });
  }

  try {
    // ----------------------
    // Discovery 처리
    // ----------------------
    if (interactionType === "discoveryRequest") {
      const response = {
        headers: {
          schema: "st-schema",
          version: "1.0",
          interactionType: "discoveryResponse",
          requestId: requestId,
        },
        devices: deviceManager.getAllDiscoveryResponses(),
      };
      return res.json(response);
    }

    // ----------------------
    // grantCallbackAccess 처리
    // ----------------------
    if (interactionType === "grantCallbackAccess") {
      const enhancedCallbackAuthentication = {
        ...callbackAuthentication,
        callbackUrls: callbackUrls
      };
      const response = await OAuthHandler.handleGrantCallbackAccess(enhancedCallbackAuthentication, requestId);
      return res.json(response);
    }

    // ----------------------
    // stateRefresh 처리
    // ----------------------
    if (interactionType === "stateRefreshRequest") {
      const deviceStates = [];

      for (const device of devices) {
        try {
          const deviceState = await deviceManager.getStateRefreshResponse(device.externalDeviceId);
          deviceStates.push(deviceState);
        } catch (error) {
          console.error(`Error getting state for device ${device.externalDeviceId}:`, error.message);
          // Continue with other devices even if one fails
        }
      }

      const response = {
        headers: {
          schema: "st-schema",
          version: "1.0",
          interactionType: "stateRefreshResponse",
          requestId: requestId
        },
        deviceState: deviceStates
      };

      return res.json(response);
    }

    // ----------------------
    // commandRequest 처리
    // ----------------------
    if (interactionType === "commandRequest") {
      const response = {
        headers: {
          schema: "st-schema",
          version: "1.0",
          interactionType: "commandResponse",
          requestId: requestId
        },
        deviceState: [
          {
            externalDeviceId: "partner-device-id-1",
            deviceError: [
              {
                errorEnum: "DEVICE-UNAVAILABLE",
                detail: "detail detail detail"
              }
            ]
          }
        ]
      };

      // 3초 지연 추가
      setTimeout(() => {
        return res.json(response);
      }, 3000);
    }

    // ----------------------
    // 미지원 interactionType 처리
    // ----------------------
    return res.status(400).json({ error: `unsupported interactionType: ${interactionType}` });
  } catch (error) {
    console.error("Error in /interaction endpoint:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// 서버 시작
app.listen(PORT, () => console.log(`✅ Mock OAuth server running on ${PORT}`));
