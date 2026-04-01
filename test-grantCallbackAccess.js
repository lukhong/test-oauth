import axios from "axios";

// Test data based on the requirements
const testData = {
  "headers": {
    "schema": "st-schema",
    "version": "1.0",
    "interactionType": "grantCallbackAccess",
    "requestId": "abc-123-456"
  },
  "authentication": {
    "tokenType": "Bearer",
    "token": "Token received during oauth from partner"
  },
  "callbackAuthentication": {
    "grantType": "authorization_code",
    "scope": "callback_access",
    "code": "xxxxxxxxxxx",
    "clientId": "The SmartThings client ID provided to you during Schema App registration"
  },
  "callbackUrls": {
    "oauthToken": "http://localhost:3000/token", // Using the local token endpoint for testing
    "stateCallback": "http://localhost:3000/callback"
  }
};

async function testGrantCallbackAccess() {
  try {
    console.log("Sending grantCallbackAccess request...");
    const response = await axios.post("http://localhost:3000/interaction", testData);
    console.log("Response received:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error("Error:", error.response ? error.response.data : error.message);
  }
}

testGrantCallbackAccess();