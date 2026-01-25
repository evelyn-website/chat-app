/**
 * Mock for react-native-blurhash
 * Provides blurhash encoding/decoding for testing
 */

let hashCounter = 0;

const Blurhash = {
  encode: jest.fn((uri, componentX, componentY) => {
    hashCounter++;
    // Return a deterministic blurhash string
    // Real blurhash format: base83 encoded string
    // For testing, we'll use a simple deterministic format
    return Promise.resolve(`UeKUpvxuo.SN%MRtS$%Mry-:IARjI:t6xFM{IV`);
  }),

  decode: jest.fn((blurhash, width, height, punch = 1) => {
    // Return a mock pixel array
    // In real blurhash, this would be a Uint8Array of RGB values
    const pixelCount = width * height;
    const pixels = new Uint8Array(pixelCount * 4); // RGBA

    // Fill with gray color for testing
    for (let i = 0; i < pixelCount * 4; i += 4) {
      pixels[i] = 128; // R
      pixels[i + 1] = 128; // G
      pixels[i + 2] = 128; // B
      pixels[i + 3] = 255; // A
    }

    return pixels;
  }),

  // Constants for ComponentX and ComponentY
  ComponentX: 4,
  ComponentY: 3,

  // Utility functions for testing
  __getHashCounter: jest.fn(() => {
    return hashCounter;
  }),

  __resetHashCounter: jest.fn(() => {
    hashCounter = 0;
  }),

  __createMockBlurhash: jest.fn((seed = 'test') => {
    // Create a deterministic blurhash from a seed
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let hash = '';
    for (let i = 0; i < 20; i++) {
      hash += chars[(seed.charCodeAt(i % seed.length) + i) % chars.length];
    }
    return hash;
  }),

  __createMockPixels: jest.fn((width, height, color = { r: 128, g: 128, b: 128 }) => {
    const pixelCount = width * height;
    const pixels = new Uint8Array(pixelCount * 4);

    for (let i = 0; i < pixelCount * 4; i += 4) {
      pixels[i] = color.r;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.b;
      pixels[i + 3] = 255;
    }

    return pixels;
  }),
};

module.exports = {
  Blurhash,
  // Also export encode/decode directly for backward compatibility
  encode: Blurhash.encode,
  decode: Blurhash.decode,
};
