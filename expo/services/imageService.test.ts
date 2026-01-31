import { processImage } from './imageService';
import { Blurhash } from 'react-native-blurhash';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

// Mock dependencies
jest.mock('react-native-blurhash');
jest.mock('expo-image-manipulator');
jest.mock('expo-file-system');

describe('imageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processImage', () => {
    const mockOriginalUri = 'file:///path/to/original.jpg';
    const mockThumbUri = 'file:///path/to/thumb.jpg';
    const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const mockBlurhash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';

    // Helper function to create a properly mocked context
    // The implementation calls renderAsync() twice on the same context
    const createMockContext = (mainImageResult: any, thumbImageResult: any) => {
      const mockRenderAsync = jest.fn()
        .mockResolvedValueOnce(mainImageResult)  // First call: main image
        .mockResolvedValueOnce(thumbImageResult); // Second call: thumbnail

      return {
        resize: jest.fn().mockReturnThis(),
        renderAsync: mockRenderAsync,
      };
    };

    describe('Image resizing to max dimensions', () => {
      it('should resize image to 1920px width for main image', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockContext.resize).toHaveBeenCalledWith({ width: 1920 });
      });

      it('should save main image with base64: true option', async () => {
        const mockSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsync).toHaveBeenCalledWith({
          format: SaveFormat.JPEG,
          compress: 0.8,
          base64: true,
        });
      });

      it('should return base64 output from main image', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(result.normalized.base64).toBe(mockBase64);
      });

      it('should use 0.8 compression for main image', async () => {
        const mockSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            compress: 0.8,
          })
        );
      });
    });

    describe('Thumbnail generation', () => {
      it('should resize thumbnail to 100px width', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockContext.resize).toHaveBeenCalledWith({
          width: 100,
        });
      });

      it('should save thumbnail as JPEG with 0.5 compression', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockSaveAsyncThumb = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockSaveAsyncThumb }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsyncThumb).toHaveBeenCalledWith({
          format: SaveFormat.JPEG,
          compress: 0.5,
        });
      });

      it('should use thumbnail URI for blurhash encoding', async () => {
        const expectedThumbUri = 'file:///path/to/generated/thumb.jpg';

        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: expectedThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(Blurhash.encode).toHaveBeenCalledWith(expectedThumbUri, 4, 3);
      });
    });

    describe('Blurhash generation', () => {
      it('should generate blurhash from thumbnail', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(Blurhash.encode).toHaveBeenCalledWith(mockThumbUri, 4, 3);
        expect(result.blurhash).toBe(mockBlurhash);
      });

      it('should use blurhash component count of 4x3', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(Blurhash.encode).toHaveBeenCalledWith(expect.any(String), 4, 3);
      });

      it('should include blurhash in returned ProcessedImage', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(result).toHaveProperty('blurhash', mockBlurhash);
      });
    });

    describe('Format conversion to JPEG', () => {
      it('should convert main image to JPEG format', async () => {
        const mockSaveAsyncMain = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockSaveAsyncMain },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsyncMain).toHaveBeenCalledWith(
          expect.objectContaining({
            format: SaveFormat.JPEG,
          })
        );
      });

      it('should convert thumbnail to JPEG format', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockSaveAsyncThumb = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockSaveAsyncThumb }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsyncThumb).toHaveBeenCalledWith(
          expect.objectContaining({
            format: SaveFormat.JPEG,
          })
        );
      });
    });

    describe('Base64 output', () => {
      it('should request base64 output from main image save', async () => {
        const mockSaveAsyncMain = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockSaveAsyncMain },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(mockSaveAsyncMain).toHaveBeenCalledWith(
          expect.objectContaining({
            base64: true,
          })
        );
      });

      it('should return normalized image with base64 string', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(result.normalized.base64).toBe(mockBase64);
        expect(typeof result.normalized.base64).toBe('string');
      });
    });

    describe('Temporary file cleanup', () => {
      it('should delete thumbnail file after processing', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(mockThumbUri, {
          idempotent: true,
        });
      });

      it('should use idempotent: true for cleanup', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
          expect.any(String),
          { idempotent: true }
        );
      });

      it('should cleanup even if blurhash generation fails', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockRejectedValueOnce(
          new Error('Blurhash failed')
        );
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        try {
          await processImage(mockOriginalUri);
        } catch {
          // Expected error
        }

        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(mockThumbUri, {
          idempotent: true,
        });
      });
    });

    describe('Error handling', () => {
      it('should throw when base64 is missing from result', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          // Missing base64
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await expect(processImage(mockOriginalUri)).rejects.toThrow(
          'Image processing failed.'
        );
      });

      it('should throw on image manipulation failure', async () => {
        (ImageManipulator.manipulate as jest.Mock).mockImplementationOnce(
          () => {
            throw new Error('Manipulation failed');
          }
        );

        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await expect(processImage(mockOriginalUri)).rejects.toThrow(
          'Image processing failed.'
        );
      });

      it('should throw on blurhash generation errors', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockRejectedValueOnce(
          new Error('Blurhash error')
        );
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await expect(processImage(mockOriginalUri)).rejects.toThrow(
          'Image processing failed.'
        );
      });

      it('should log error to console on failure', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        (ImageManipulator.manipulate as jest.Mock).mockImplementationOnce(
          () => {
            throw new Error('Test error');
          }
        );

        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        try {
          await processImage(mockOriginalUri);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // Expected
        }

        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to process image:',
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });

    describe('Return type validation', () => {
      it('should return ProcessedImage object structure', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(result).toHaveProperty('normalized');
        expect(result).toHaveProperty('blurhash');
      });

      it('should return NormalizedImage with base64 property', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage(mockOriginalUri);

        expect(result.normalized).toHaveProperty('base64');
        expect(result.normalized).toHaveProperty('uri');
      });
    });

    describe('Concurrent processing', () => {
      it('should handle multiple concurrent processImage calls', async () => {
        (ImageManipulator.manipulate as jest.Mock).mockImplementation(() => {
          const mockMainSaveAsync = jest.fn().mockResolvedValue({
            uri: 'main-uri',
            base64: mockBase64,
          });
          const mockThumbSaveAsync = jest.fn().mockResolvedValue({
            uri: mockThumbUri,
          });

          return createMockContext(
            { saveAsync: mockMainSaveAsync },
            { saveAsync: mockThumbSaveAsync }
          );
        });

        (Blurhash.encode as jest.Mock).mockResolvedValue(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);

        const promises = [
          processImage('file:///image1.jpg'),
          processImage('file:///image2.jpg'),
          processImage('file:///image3.jpg'),
        ];

        const results = await Promise.all(promises);

        expect(results).toHaveLength(3);
        results.forEach((result) => {
          expect(result).toHaveProperty('normalized');
          expect(result).toHaveProperty('blurhash');
        });
      });
    });

    describe('Edge cases', () => {
      it('should handle very small images', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage('file:///tiny.jpg');

        expect(result.normalized.base64).toBe(mockBase64);
      });

      it('should handle very large images', async () => {
        const largeBase64 =
          'i'.repeat(10000) + mockBase64 + 'i'.repeat(10000);

        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'resized-uri',
          base64: largeBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        const result = await processImage('file:///large.jpg');

        expect(result.normalized.base64.length).toBeGreaterThan(20000);
      });

      it('should use manipulate context chaining pattern', async () => {
        const mockMainSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: 'main-uri',
          base64: mockBase64,
        });
        const mockThumbSaveAsync = jest.fn().mockResolvedValueOnce({
          uri: mockThumbUri,
        });

        const mockContext = createMockContext(
          { saveAsync: mockMainSaveAsync },
          { saveAsync: mockThumbSaveAsync }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        (Blurhash.encode as jest.Mock).mockResolvedValueOnce(mockBlurhash);
        (FileSystem.deleteAsync as jest.Mock).mockResolvedValueOnce(
          undefined
        );

        await processImage(mockOriginalUri);

        expect(ImageManipulator.manipulate).toHaveBeenCalledWith(
          mockOriginalUri
        );
        expect(mockContext.resize).toHaveBeenCalledTimes(2);
        expect(mockContext.renderAsync).toHaveBeenCalledTimes(2);
      });

      it('should handle rescue cleanup on image save errors', async () => {
        const mockSaveAsyncMain = jest
          .fn()
          .mockRejectedValueOnce(new Error('Save failed'));
        
        const mockSaveAsyncThumb = jest
          .fn()
          .mockResolvedValueOnce({ uri: mockThumbUri });

        const mockContext = createMockContext(
          { saveAsync: mockSaveAsyncMain },
          { saveAsync: mockSaveAsyncThumb }
        );

        (ImageManipulator.manipulate as jest.Mock).mockReturnValueOnce(
          mockContext
        );
        // Mock deleteAsync to handle undefined gracefully (idempotent: true)
        (FileSystem.deleteAsync as jest.Mock).mockImplementation((uri, options) => {
          if (!uri) {
            return Promise.resolve();
          }
          return Promise.resolve();
        });

        await expect(processImage(mockOriginalUri)).rejects.toThrow(
          'Image processing failed.'
        );

        // Cleanup should still attempt to run
        // In finally block, thumb cleanup occurs even if undefined
      });
    });
  });
});
