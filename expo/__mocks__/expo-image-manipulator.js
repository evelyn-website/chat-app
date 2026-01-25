/**
 * Mock for expo-image-manipulator
 * Provides image manipulation mocking for testing
 */

// Create a chainable context mock
function createManipulateContext(uri) {
  let callCount = 0;
  const context = {
    resize: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    flip: jest.fn().mockReturnThis(),
    crop: jest.fn().mockReturnThis(),
    renderAsync: jest.fn(() => {
      callCount++;
      // First call is for main image (needs base64), second is for thumbnail
      if (callCount === 1) {
        return Promise.resolve({
          uri: `file:///mock/images/${Date.now()}_rendered_main.jpeg`,
          width: 1920,
          height: 1080,
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          saveAsync: jest.fn().mockResolvedValue({
            uri: `file:///mock/images/${Date.now()}_saved_main.jpeg`,
            width: 1920,
            height: 1080,
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          }),
        });
      } else {
        // Thumbnail call
        return Promise.resolve({
          uri: `file:///mock/images/${Date.now()}_rendered_thumb.jpeg`,
          width: 100,
          height: 100,
          saveAsync: jest.fn().mockResolvedValue({
            uri: `file:///mock/images/${Date.now()}_saved_thumb.jpeg`,
            width: 100,
            height: 100,
          }),
        });
      }
    }),
  };
  return context;
}

module.exports = {
  ImageManipulator: {
    manipulate: jest.fn((uri) => createManipulateContext(uri)),
  },

  manipulateAsync: jest.fn((uri, actions, options = {}) => {
    // Generate a mock result with deterministic data
    const mockUri = `file:///mock/images/${Date.now()}_manipulated.${options.format || 'jpeg'}`;

    return Promise.resolve({
      uri: mockUri,
      width: options.width || 800,
      height: options.height || 600,
      format: options.format || 'jpeg',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
  }),

  SaveFormat: {
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp',
  },

  FlipType: {
    Vertical: { vertical: true },
    Horizontal: { horizontal: true },
  },

  RotationType: {
    '90deg': 90,
    '180deg': 180,
    '270deg': 270,
  },

  // Utility functions for testing
  __getMockUri: jest.fn(() => {
    return `file:///mock/images/${Date.now()}_test.jpeg`;
  }),

  __createMockImageResult: jest.fn((options = {}) => {
    return {
      uri: options.uri || 'file:///mock/images/test.jpeg',
      width: options.width || 1024,
      height: options.height || 768,
      format: options.format || 'jpeg',
      base64: options.base64 || 'mock_base64_data',
    };
  }),
};
