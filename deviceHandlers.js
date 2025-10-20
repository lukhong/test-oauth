import axios from 'axios';

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
    this.states = await this.loadStates();
  }

  async loadStates() {
    console.log('loading states from github...');
    try {
      const githubUrl = 'https://raw.githubusercontent.com/lukhong/test-oauth/main/carDeviceStates.json';
      const response = await axios.get(githubUrl);
      console.log('loaded data:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error loading car device states from GitHub:', error.message);
      return [];
    }
  }

  getDiscoveryResponse() {
    return {
      externalDeviceId: this.deviceId,
      friendlyName: this.deviceConfig.friendlyName || "Rend",
      manufacturerInfo: {
        manufacturerName: this.deviceConfig.manufacturerName || "Virtual Hyundai",
        modelName: this.deviceConfig.modelName || "Test Model",
        hwVersion: this.deviceConfig.hwVersion || "3",
        swVersion: this.deviceConfig.swVersion || "1.0"
      },
      deviceContext: {
        categories: ["Car"]
      },
      deviceHandlerType: this.deviceConfig.deviceHandlerType || "4e8bdf64-c46a-4c9c-8d01-3929d9c923ed"
    };
  }

  async getStateRefreshResponse() {
    // Always fetch fresh data from GitHub on each state refresh request
    const freshStates = await this.loadStates();
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
      manufacturerName: "Virtual Hyundai",
      modelName: "Test Model",
      hwVersion: "3",
      swVersion: "1.0",
      deviceHandlerType: "4e8bdf64-c46a-4c9c-8d01-3929d9c923ed"
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
    const handler = this.getDeviceHandler(deviceId);
    if (!handler) {
      throw new Error(`Device handler not found for device: ${deviceId}`);
    }
    return await handler.getStateRefreshResponse();
  }
}
