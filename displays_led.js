/**
 * LED Matrix Display Module
 * Supports Adafruit RGB LED Matrix via Python subprocess
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const logger = {
  info: (msg, data) => console.log(`[LED] ${msg}`, data || ''),
  warn: (msg, data) => console.warn(`[LED] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[LED] ${msg}`, data || '')
};

let ledPythonPath = path.join(__dirname, 'led_driver.py');
let isInitialized = false;

/**
 * Verifies that the Python LED driver is available before LED rendering is used.
 * Hardware access is delegated to Python because the Adafruit matrix libraries
 * are Python-first on Raspberry Pi.
 */
async function init() {
  try {
    // Check if Python LED driver exists
    if (!fs.existsSync(ledPythonPath)) {
      logger.warn(`LED driver not found at ${ledPythonPath}`);
      logger.info('Copy led_driver.py to project root for LED support');
      return;
    }
    
    // Test if LED matrix is accessible
    logger.info('LED Matrix module loaded');
    isInitialized = true;
    
  } catch (error) {
    logger.error('LED initialization error:', error.message);
  }
}

/**
 * Sends text and color data to the LED matrix driver.
 * Calls are ignored when LED support is not initialized so the monitor display
 * can continue running on machines without GPIO hardware.
 */
async function displayText(text, options = {}) {
  if (!isInitialized) {
    logger.warn('LED display not initialized, skipping display');
    return;
  }
  
  try {
    const color = parseColor(options.color || '#FFFFFF');
    
    logger.info(`Displaying: "${text.substring(0, 32)}${text.length > 32 ? '...' : ''}" RGB(${color.r},${color.g},${color.b})`);
    
    // Call Python driver
    await runPythonLEDDriver(text, color);
    
  } catch (error) {
    logger.error('Display error:', error.message);
  }
}

/**
 * Converts a CSS-style hex color into RGB channel values for the Python driver.
 */
function parseColor(hexColor) {
  const hex = (hexColor || '#FFFFFF').replace('#', '');
  
  if (hex.length === 6) {
    return {
      r: parseInt(hex.substr(0, 2), 16),
      g: parseInt(hex.substr(2, 2), 16),
      b: parseInt(hex.substr(4, 2), 16)
    };
  }
  
  return { r: 255, g: 255, b: 255 };
}

/**
 * Runs `led_driver.py` as a short-lived subprocess with timeout protection.
 */
function runPythonLEDDriver(text, color) {
  return new Promise((resolve, reject) => {
    execFile('python3', [
      ledPythonPath,
      text,
      color.r.toString(),
      color.g.toString(),
      color.b.toString()
    ], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        logger.error('Python execution error:', stderr || error.message);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Placeholder cleanup hook kept for parity with the monitor display module.
 */
async function cleanup() {
  logger.info('LED display cleaned up');
}

module.exports = { init, displayText, cleanup };
