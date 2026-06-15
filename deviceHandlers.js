import axios from 'axios';
import { getStAccessToken, getStRefreshToken, getStStateCallbackUrl } from './oauth.js';

// Base Device Handler class
export class DeviceHandler {
  constructor(deviceConfig) {
    this.deviceConfig = deviceConfig;
  }

  // Discovery response - to be implemented by subclasses
  getDiscoveryResponse() {
    throw new Error("getDiscoveryResponse must be implemented by subclass");
  }

  // State refresh response - to be implemented by subclasses  
  getStateRefreshResponse(deviceId) {
    throw new Error("getStateRefreshResponse must be implemented by subclass");
  }

  // Command handling - to be implemented by subclasses
  handleCommand(deviceId, command, capability, component) {
    throw new Error("handleCommand must be implemented by subclass");
  }
}

// Car Device Handler implementation
export class CarDeviceHandler extends DeviceHandler {
  constructor(deviceConfig) {
    super(deviceConfig);
    this.deviceId = deviceConfig.externalDeviceId || "partner-device-id-1";
    this.states = [];
    this.initializeStates();
  }

  async initializeStates() {
    this.states = await this.loadStates_from_file();
  }

  async loadStates() {
    try {
      const githubUrl = 'https://raw.githubusercontent.com/lukhong/test-oauth/main/carDeviceStates.json';
      const timestamp = Date.now(); // Cache-busting parameter
      const response = await axios.get(`${githubUrl}?t=${timestamp}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error loading car device states from GitHub:', error.message);
      return [];
    }
  }

   async loadStates_from_file() {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(process.cwd(), 'hcaDeviceStates.json');
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading HCA device states from file:', error.message);
      return [];
    }
  }

  getDiscoveryResponse() {
    console.log(`discovery response`);
    return {
      externalDeviceId: this.deviceId,
      friendlyName: this.deviceConfig.friendlyName || "Rend HCA",
      // manufacturerInfo: {
      //   manufacturerName: this.deviceConfig.manufacturerName || "Virtual Hyundai",
      //   modelName: this.deviceConfig.modelName || "Test Model",
      //   hwVersion: this.deviceConfig.hwVersion || "3",
      //   swVersion: this.deviceConfig.swVersion || "1.0"
      // },
      manufacturerInfo: {
        manufacturerName: this.deviceConfig.manufacturerName || "Virtual HCA",
        modelName: this.deviceConfig.modelName || "Test Model"
      },

      deviceContext: {
        categories: ["Dryer"]
      },
      deviceHandlerType: "0a6ad5f2-07a1-3930-9d08-569940ad99d5" //hca dryer restricted
    };
  }

  async getStateRefreshResponse(deviceId) {
    // Always fetch fresh data from GitHub on each state refresh request
    const freshStates = await this.loadStates_from_file();
    return {
      externalDeviceId: this.deviceId,
      deviceCookie: {},
      states: freshStates
    };
  }

  handleCommand(deviceId, command, capability, component) {
    // Basic command handling implementation
    console.log(`Handling command: ${command} for capability: ${capability} on device: ${deviceId}`);
    return { success: true };
  }
}

// Device Manager to handle multiple device types
export class DeviceManager {
  constructor() {
    this.deviceHandlers = new Map();
    this.initializeDefaultDevices();
  }

  initializeDefaultDevices() {
    // Initialize with default car device using addDevice for consistency
    const carDeviceConfig = {
      externalDeviceId: "partner-device-id-1",
      friendlyName: "Rend",
      manufacturerName: "Virtual HCA",
      modelName: "Test Model",
      hwVersion: "3",
      swVersion: "1.0",
      deviceHandlerType: "0a6ad5f2-07a1-3930-9d08-569940ad99d5"//hca dryer restricted
    };
    
    this.addDevice(carDeviceConfig.externalDeviceId, 'car', carDeviceConfig);
  }

  addDevice(deviceId, deviceType, deviceConfig) {
    let handler;
    
    switch (deviceType) {
      case 'car':
        handler = new CarDeviceHandler(deviceConfig);
        break;
      default:
        throw new Error(`Unsupported device type: ${deviceType}`);
    }
    
    this.deviceHandlers.set(deviceId, handler);
    console.log(`[DeviceManager] Added device handler - deviceId: ${deviceId}, type: ${deviceType}`);
  }

  getDeviceHandler(deviceId) {
    return this.deviceHandlers.get(deviceId);
  }

  getAllDiscoveryResponses() {
    const responses = [];
    for (const handler of this.deviceHandlers.values()) {
      responses.push(handler.getDiscoveryResponse());
    }
    return responses;
  }

  async getStateRefreshResponse(deviceId) {
    console.log(`[DeviceManager] Looking for device handler with deviceId: ${deviceId}`);
    console.log(`[DeviceManager] Available deviceIds:`, Array.from(this.deviceHandlers.keys()));
    const handler = this.getDeviceHandler(deviceId);
    if (!handler) {
      throw new Error(`Device handler not found for device: ${deviceId}`);
    }
    console.log(`[DeviceManager] Found handler for device: ${deviceId}`);
    return await handler.getStateRefreshResponse(deviceId);
  }

  // State callback function that uses cached SmartThings tokens
  async stateCallback(deviceId, stateData) {
    // Get cached tokens
    const accessToken = getStAccessToken();
    const refreshToken = getStRefreshToken();
    const stUrl = getStStateCallbackUrl();
    
    console.log(`Using cached values for state callback - Access: ${accessToken}, Refresh: ${refreshToken}, Url: ${stUrl}`);
    
    // Check if we have valid tokens and URL
    if (!accessToken) {
      throw new Error('No access token available for state callback');
    }
    
    if (!stUrl) {
      throw new Error('No state callback URL available');
    }
    
    // Create the request body in the specified format
    const requestBody = {
      headers: {
        schema: "st-schema",
        version: "1.0",
        interactionType: "stateCallback",
        requestId: "abc-123-456" // This should be a unique ID in a real implementation
      },
      authentication: {
        tokenType: "Bearer",
        token: accessToken
      },
      deviceState: [
        {
          externalDeviceId: deviceId,
          states: [
            {
              component: stateData.component,
              capability: stateData.capability,
              attribute: stateData.attribute,
              value: stateData.value,
              timestamp: Date.now(),
              stateChange: "Y"
            }
          ]
        }
      ]
    };
    
    console.log(`State callback for device ${deviceId} with request body:`, JSON.stringify(requestBody, null, 2));
    
    try {
      // Send the POST request to SmartThings
      const response = await axios.post(stUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`State callback response:`, JSON.stringify(response.data, null, 2));
      
      return {
        success: true,
        message: 'State callback processed successfully',
        deviceId: deviceId,
        response: response.data
      };
    } catch (error) {
      console.error('Error sending state callback:', error.message);
      if (error.response) {
        console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Error response status:', error.response.status);
      }
      throw error;
    }
  }
}
